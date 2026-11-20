// =============================================================================
// tasks.component.ts — Full-Width Recursive Task Manager (Block 1 + Block 2)
//   • Proportional fluid full-width Kanban (zero empty right-hand gap)
//   • Multi-view switcher: Kanban | Full-Width List | Swimlanes
//   • Interactive KPI cards, My Tasks / Assignee / Priority / Status / Search
//   • Inline column Quick-Add + 2-column Slide-Over Detail Drawer + ?id= link
// =============================================================================
import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  HostListener, ViewChild, ViewChildren, QueryList, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import {
  ApiService, AuthService, ConfirmService, DateFilterService,
  ToastService, UiCustomizationService, UiSectionPreferences
} from '../../core/services/services';
import {
  IntervalType, Priority, Task, TaskAssignee, TaskStatus, User
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import {
  BulkTaskCommand, TaskListViewComponent
} from './components/task-list-view/task-list-view.component';
import { TaskDetailDrawerComponent } from './components/task-detail-drawer/task-detail-drawer.component';
import {
  DEFAULT_COL_WEIGHTS,
  Density,
  KANBAN_COLUMNS,
  SortKey,
  StatFilterKey,
  SwimlaneBy,
  SwimlaneGroup,
  TASK_INTERVAL_TABS,
  TaskColumn,
  TaskFilterState,
  TaskViewMode,
  buildSwimlanes,
  daysUntilDue,
  filterAndSortTasks,
  formatDueLabel,
  getAvatarColor,
  getDoneSubtasks,
  getHoursProgress,
  getInitials,
  getPriorityColor,
  getUserDisplayName,
  isTaskOverdue,
  rebalanceWeights,
  resolveDisplayColumn,
  sumEstimatedHours
} from './task-helpers';

const LS_WEIGHTS  = 'tasks.columnWeights.v2';
const LS_DENSITY  = 'tasks.density.v1';
const LS_SORT     = 'tasks.sort.v1';
const LS_VIEW     = 'tasks.viewMode.v1';
const LS_SWIMLANE = 'tasks.swimlaneBy.v1';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    ExportMenuComponent,
    DropdownComponent,
    DropdownOptionComponent,
    TaskListViewComponent,
    TaskDetailDrawerComponent
  ],
  templateUrl: './tasks.component.html',
  styleUrls:   ['./tasks.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TasksComponent implements OnInit, OnDestroy {
  @ViewChild('kanbanBoardEl') kanbanBoardRef?: ElementRef<HTMLDivElement>;
  @ViewChild('searchInput')   searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChildren('quickAddInput') quickAddInputs?: QueryList<ElementRef<HTMLInputElement>>;

  private destroy$ = new Subject<void>();

  tasks:     Task[] = [];
  allTasks:  Task[] = [];
  assignees: TaskAssignee[] = [];
  loading  = true;
  saving   = false;
  busyBulk = false;

  // ── View & filter state ────────────────────────────────────────────────────
  viewMode:       TaskViewMode = 'kanban';
  swimlaneBy:     SwimlaneBy   = 'assignee';
  activeInterval: IntervalType | '' = '';
  statusFilter   = '';
  priorityFilter: Priority | '' = '';
  assigneeFilter: number | 'unassigned' | '' = '';
  statFilter:     StatFilterKey = 'all';
  searchTerm     = '';
  sortKey: SortKey = 'due';
  sortAsc        = true;
  density: Density = 'comfortable';

  // ── Proportional Kanban weights (sum remains constant = 100% width) ────────
  colWeights: number[] = [...DEFAULT_COL_WEIGHTS];
  readonly MIN_COL_WEIGHT = 0.55;
  readonly MIN_COL_PX     = 250;

  // ── Inline quick-add per column ────────────────────────────────────────────
  quickAddStatus: TaskStatus | null = null;
  quickAddTitle  = '';
  savingQuickAdd = false;

  // ── Swimlane collapsed state ───────────────────────────────────────────────
  collapsedLanes = new Set<string>();

  // ── Detail drawer state ────────────────────────────────────────────────────
  drawerOpen      = false;
  editingTask: Task | null = null;
  drawerStatus: TaskStatus = 'TODO';
  drawerPreTitle  = '';

  uiPrefs: UiSectionPreferences | null = null;

  readonly intervals = TASK_INTERVAL_TABS;
  readonly columns: TaskColumn[] = KANBAN_COLUMNS;
  readonly sortOptions: Array<{ k: SortKey; l: string }> = [
    { k: 'due',      l: 'Due' },
    { k: 'priority', l: 'Priority' },
    { k: 'title',    l: 'Title' },
    { k: 'created',  l: 'Created' }
  ];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef,
    private toast: ToastService,
    private confirm: ConfirmService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.restorePrefs();
  }

  get currentUser(): User | null { return this.auth.currentUser; }
  get isMyTasksActive(): boolean {
    return !!this.currentUser?.id && this.assigneeFilter === this.currentUser.id;
  }
  get dropListIds(): string[] { return this.columns.map(c => 'col-' + c.status); }
  get hasCustomWeights(): boolean {
    return this.colWeights.some(w => Math.abs(w - 1) > 0.03);
  }
  get activeFilterCount(): number {
    let n = 0;
    if (this.activeInterval) n++;
    if (this.statusFilter) n++;
    if (this.priorityFilter) n++;
    if (this.assigneeFilter !== '') n++;
    if (this.statFilter !== 'all') n++;
    if (this.searchTerm.trim()) n++;
    return n;
  }

  private get filterState(): TaskFilterState {
    return {
      priority:   this.priorityFilter,
      assigneeId: this.assigneeFilter,
      statFilter: this.statFilter,
      searchTerm: this.searchTerm,
      sortKey:    this.sortKey,
      sortAsc:    this.sortAsc
    };
  }

  /** Tasks matching toolbar filters BEFORE KPI stat-card filter. */
  get baseFilteredTasks(): Task[] {
    return filterAndSortTasks(this.tasks, this.filterState, false);
  }

  /** Tasks displayed across active views after all filters & sorting. */
  get filteredTasks(): Task[] {
    return filterAndSortTasks(this.tasks, this.filterState, true);
  }

  get swimlanes(): SwimlaneGroup[] {
    return buildSwimlanes(this.filteredTasks, this.swimlaneBy);
  }

  get taskStats(): Array<{
    key: StatFilterKey; label: string; count: number; icon: string; color: string; sub: string;
  }> {
    const scope    = this.baseFilteredTasks;
    const total    = scope.length;
    const progress = scope.filter(t => t.status === 'IN_PROGRESS').length;
    const overdue  = scope.filter(t => isTaskOverdue(t)).length;
    const done     = scope.filter(t => t.status === 'DONE').length;
    const rate     = total ? Math.round((done / total) * 100) : 0;
    return [
      { key: 'all',         label: 'Total',       count: total,    icon: 'task_alt',     color: '#1565C0', sub: 'Visible scope' },
      { key: 'in_progress', label: 'In Progress', count: progress, icon: 'pending',      color: '#0288D1', sub: 'Active work' },
      { key: 'overdue',     label: 'Overdue',     count: overdue,  icon: 'warning',      color: '#EF4444', sub: 'Past due date' },
      { key: 'done',        label: 'Completed',   count: done,     icon: 'check_circle', color: '#10B981', sub: `${rate}% completion` }
    ];
  }

  ngOnInit(): void {
    this.uiCustomization.load('tasks').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.api.get<any>('/tasks/assignees').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.assignees = res.data || [];
        this.cdr.markForCheck();
      },
      error: () => { /* optional metadata fallback */ }
    });

    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      switchMap(() => {
        this.loading = true;
        this.cdr.markForCheck();
        return this.fetchTasksObservable();
      })
    ).subscribe({
      next: res => {
        this.tasks = res.data.items || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });

    this.loadAllParentCandidates();

    // Handle /tasks?id=123 deep-links from notifications
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const id = Number(params.get('id'));
      if (id > 0) this.openTaskById(id);
    });
  }

  private fetchTasksObservable() {
    return this.api.get<any>('/tasks', {
      interval_type: this.activeInterval,
      status:        this.statusFilter,
      limit:         150
    });
  }

  loadTasks(): void {
    this.loading = true;
    this.cdr.markForCheck();
    this.fetchTasksObservable().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.tasks = res.data.items || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  private loadAllParentCandidates(): void {
    this.api.get<any>('/tasks', { limit: 200 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.allTasks = res.data.items || [];
        this.cdr.markForCheck();
      }
    });
  }

  private openTaskById(id: number): void {
    const existing = this.tasks.find(t => t.id === id);
    if (existing) {
      this.openDrawerForEdit(existing);
      return;
    }
    this.api.get<any>(`/tasks/${id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (res.data) this.openDrawerForEdit(res.data);
      },
      error: () => this.toast.error('Requested task was not found.')
    });
  }

  // ── View & filter actions ──────────────────────────────────────────────────
  setViewMode(mode: TaskViewMode): void {
    this.viewMode = mode;
    this.cancelQuickAdd();
    try { localStorage.setItem(LS_VIEW, mode); } catch { /* noop */ }
  }

  setSwimlaneBy(by: SwimlaneBy): void {
    this.swimlaneBy = by;
    this.collapsedLanes = new Set<string>();
    try { localStorage.setItem(LS_SWIMLANE, by); } catch { /* noop */ }
  }

  toggleLaneCollapse(key: string): void {
    const next = new Set(this.collapsedLanes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsedLanes = next;
  }

  setInterval(v: IntervalType | ''): void {
    this.activeInterval = v;
    this.loadTasks();
  }

  onStatusFilterChange(status: string): void {
    this.statusFilter = status;
    this.loadTasks();
  }

  toggleMyTasks(): void {
    if (!this.currentUser?.id) return;
    this.assigneeFilter = this.isMyTasksActive ? '' : this.currentUser.id;
  }

  toggleStatFilter(key: StatFilterKey): void {
    this.statFilter = (key === 'all' || this.statFilter === key) ? 'all' : key;
  }

  clearFilters(): void {
    const serverChanged = this.activeInterval !== '' || this.statusFilter !== '';
    this.activeInterval = '';
    this.statusFilter   = '';
    this.priorityFilter = '';
    this.assigneeFilter = '';
    this.statFilter     = 'all';
    this.searchTerm     = '';
    if (serverChanged) this.loadTasks();
  }

  setDensity(d: Density): void {
    this.density = d;
    try { localStorage.setItem(LS_DENSITY, d); } catch { /* noop */ }
  }

  setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else { this.sortKey = key; this.sortAsc = true; }
    try { localStorage.setItem(LS_SORT, JSON.stringify({ key: this.sortKey, asc: this.sortAsc })); } catch { /* noop */ }
    this.cdr.markForCheck();
  }

  // ── Column / swimlane selectors ────────────────────────────────────────────
  getColumnTasks(colStatus: TaskStatus): Task[] {
    return this.filteredTasks.filter(t => resolveDisplayColumn(t) === colStatus);
  }

  getLaneColumnTasks(lane: SwimlaneGroup, colStatus: TaskStatus): Task[] {
    return lane.tasks.filter(t => resolveDisplayColumn(t) === colStatus);
  }

  colEstHours(colStatus: TaskStatus): number {
    return sumEstimatedHours(this.getColumnTasks(colStatus));
  }

  laneEstHours(lane: SwimlaneGroup): number {
    return sumEstimatedHours(lane.tasks);
  }

  // ── Drag & drop (immutable optimistic updates) ─────────────────────────────
  onTaskDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus): void {
    if (event.previousContainer === event.container) return;
    const task: Task = event.item.data;
    if (!task || task.status === targetStatus) return;

    this.applyTaskPatchOptimistic(task, { status: targetStatus }, `Moved to ${this.columnLabel(targetStatus)}`);
  }

  onSwimlaneDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus, lane: SwimlaneGroup): void {
    const task: Task = event.item.data;
    if (!task) return;

    const patch: Partial<Task> = {};
    if (task.status !== targetStatus) patch.status = targetStatus;

    if (this.swimlaneBy === 'priority') {
      const targetPrio = lane.key.replace('priority-', '') as Priority;
      if (targetPrio && task.priority !== targetPrio) patch.priority = targetPrio;
    } else if (this.swimlaneBy === 'assignee') {
      const nextAssigneeId = lane.key === 'unassigned' ? null : Number(lane.key.replace('user-', ''));
      const currentAssigneeId = task.assigned_to ?? task.assignee?.id ?? null;
      if (currentAssigneeId !== nextAssigneeId) patch.assigned_to = nextAssigneeId;
    }

    if (!Object.keys(patch).length) return;
    this.applyTaskPatchOptimistic(task, patch, 'Task updated.');
  }

  onListInlineUpdate(ev: { task: Task; patch: Partial<Task> }): void {
    this.applyTaskPatchOptimistic(ev.task, ev.patch, 'Task updated.');
  }

  private applyTaskPatchOptimistic(task: Task, patch: Partial<Task>, successMsg: string): void {
    const prevTasks = this.tasks;
    const matchedAssignee = Object.prototype.hasOwnProperty.call(patch, 'assigned_to')
      ? (patch.assigned_to ? (this.assignees.find(u => u.id === patch.assigned_to) || task.assignee) : null)
      : task.assignee;

    this.tasks = this.tasks.map(t =>
      t.id === task.id ? { ...t, ...patch, assignee: matchedAssignee } : t
    );
    this.cdr.markForCheck();

    this.api.put<any>(`/tasks/${task.id}`, patch).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const updated: Task = res.data;
        if (updated) {
          this.tasks = this.tasks.map(t => t.id === updated.id ? updated : t);
        }
        this.toast.success(successMsg);
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.tasks = prevTasks;
        this.toast.error(e?.error?.message || 'Failed to update task.');
        this.cdr.markForCheck();
      }
    });
  }

  quickStatusChange(task: Task, event: MouseEvent): void {
    event.stopPropagation();
    const nextStatus: Record<TaskStatus, TaskStatus> = {
      TODO:        'IN_PROGRESS',
      IN_PROGRESS: 'REVIEW',
      REVIEW:      'DONE',
      DONE:        'TODO',
      CANCELLED:   'TODO',
      OVERDUE:     'IN_PROGRESS'
    };
    const target = nextStatus[task.status];
    this.applyTaskPatchOptimistic(task, { status: target }, `Moved to ${this.columnLabel(target)}.`);
  }

  // ── Inline quick-add ───────────────────────────────────────────────────────
  openQuickAdd(status: TaskStatus): void {
    this.quickAddStatus = status;
    this.quickAddTitle  = '';
    this.cdr.markForCheck();
    setTimeout(() => this.quickAddInputs?.first?.nativeElement.focus(), 0);
  }

  cancelQuickAdd(): void {
    this.quickAddStatus = null;
    this.quickAddTitle  = '';
    this.savingQuickAdd = false;
  }

  submitQuickAdd(status: TaskStatus): void {
    const title = this.quickAddTitle.trim();
    if (!title || this.savingQuickAdd) return;

    this.savingQuickAdd = true;
    const payload: any = {
      title,
      status,
      interval_type: this.activeInterval || 'ONCE',
      priority:      this.priorityFilter || 'MEDIUM'
    };
    if (typeof this.assigneeFilter === 'number') {
      payload.assigned_to = this.assigneeFilter;
    }

    this.api.post<any>('/tasks', payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const created: Task = res.data;
        if (created) {
          this.tasks = [created, ...this.tasks];
          this.allTasks = [created, ...this.allTasks];
        }
        this.quickAddTitle = '';
        this.savingQuickAdd = false;
        this.toast.success('Task added.');
        this.cdr.markForCheck();
        setTimeout(() => this.quickAddInputs?.first?.nativeElement.focus(), 0);
      },
      error: (e: any) => {
        this.savingQuickAdd = false;
        this.toast.error(e?.error?.message || 'Failed to add task.');
        this.cdr.markForCheck();
      }
    });
  }

  expandQuickAddToDrawer(status: TaskStatus): void {
    const prefillTitle = this.quickAddTitle.trim();
    this.cancelQuickAdd();
    this.drawerStatus   = status;
    this.editingTask    = prefillTitle
      ? ({ title: prefillTitle, status, interval_type: (this.activeInterval || 'ONCE'), priority: 'MEDIUM' } as any)
      : null;
    // If prefilled, keep create mode cleanly by clearing id via null editingTask + drawerPreTitle:
    if (prefillTitle) {
      this.editingTask = null;
      this.drawerPreTitle = prefillTitle;
    }
    this.drawerOpen = true;
  }

  // ── Proportional fluid column resizing ─────────────────────────────────────
  private resizeState: { index: number; startX: number; boardW: number; startWeights: number[] } | null = null;

  startResize(event: MouseEvent, index: number): void {
    event.preventDefault();
    const boardW = this.kanbanBoardRef?.nativeElement?.clientWidth || 1200;
    this.resizeState = {
      index,
      startX:       event.clientX,
      boardW,
      startWeights: [...this.colWeights]
    };
    document.body.classList.add('tasks-resizing');
    window.addEventListener('mousemove', this.onResizeMove);
    window.addEventListener('mouseup',   this.onResizeEnd);
  }

  private onResizeMove = (e: MouseEvent) => {
    if (!this.resizeState) return;
    const { index, startX, boardW, startWeights } = this.resizeState;
    const totalWeight = startWeights.reduce((acc, w) => acc + w, 0);
    const deltaWeight = ((e.clientX - startX) / Math.max(400, boardW)) * totalWeight;
    this.colWeights = rebalanceWeights(startWeights, index, deltaWeight, this.MIN_COL_WEIGHT);
    this.cdr.markForCheck();
  };

  private onResizeEnd = () => {
    document.body.classList.remove('tasks-resizing');
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup',   this.onResizeEnd);
    this.resizeState = null;
    try { localStorage.setItem(LS_WEIGHTS, JSON.stringify(this.colWeights)); } catch { /* noop */ }
  };

  resetColumnWidths(): void {
    this.colWeights = [...DEFAULT_COL_WEIGHTS];
    try { localStorage.removeItem(LS_WEIGHTS); } catch { /* noop */ }
    this.cdr.markForCheck();
    this.toast.info('Column widths reset to balanced.');
  }

  // ── Detail drawer & CRUD ───────────────────────────────────────────────────
  openDrawerForCreate(defaultStatus: TaskStatus = 'TODO'): void {
    this.editingTask    = null;
    this.drawerStatus   = defaultStatus;
    this.drawerPreTitle = '';
    this.drawerOpen     = true;
  }

  openDrawerForEdit(task: Task): void {
    this.editingTask    = task;
    this.drawerStatus   = task.status;
    this.drawerPreTitle = '';
    this.drawerOpen     = true;
    this.cdr.markForCheck();
  }

  closeDrawer(): void {
    this.drawerOpen  = false;
    this.editingTask = null;
    if (this.route.snapshot.queryParamMap.has('id')) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { id: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  onDrawerSave(ev: { id: number | null; payload: any }): void {
    this.saving = true;
    const isEdit = ev.id !== null;
    const req$ = isEdit
      ? this.api.put<any>(`/tasks/${ev.id}`, ev.payload)
      : this.api.post<any>('/tasks', ev.payload);

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const saved: Task = res.data;
        if (isEdit && saved) {
          this.tasks    = this.tasks.map(t => t.id === saved.id ? saved : t);
          this.allTasks = this.allTasks.map(t => t.id === saved.id ? saved : t);
        } else if (saved) {
          this.tasks    = [saved, ...this.tasks];
          this.allTasks = [saved, ...this.allTasks];
        }
        this.saving = false;
        this.closeDrawer();
        this.toast.success(isEdit ? 'Task updated.' : 'Task created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save task.');
        this.cdr.markForCheck();
      }
    });
  }

  onTaskMutatedFromDrawer(updated: Task): void {
    this.tasks       = this.tasks.map(t => t.id === updated.id ? { ...t, ...updated } : t);
    this.editingTask = this.editingTask?.id === updated.id ? updated : this.editingTask;
    this.cdr.markForCheck();
  }

  async deleteTask(task: Task, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const ok = await this.confirm.confirm(`Delete "${task.title}"? This cannot be undone.`, 'Delete Task');
    if (!ok) return;

    this.api.delete<any>(`/tasks/${task.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.tasks    = this.tasks.filter(t => t.id !== task.id);
        this.allTasks = this.allTasks.filter(t => t.id !== task.id);
        if (this.editingTask?.id === task.id) this.closeDrawer();
        this.toast.success('Task deleted.');
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  duplicateTask(task: Task, event?: MouseEvent): void {
    event?.stopPropagation();
    const payload: any = {
      title:           `${task.title} (copy)`,
      description:     task.description,
      interval_type:   task.interval_type,
      status:          'TODO',
      priority:        task.priority,
      assigned_to:     task.assigned_to ?? task.assignee?.id ?? null,
      due_date:        task.due_date || null,
      estimated_hours: task.estimated_hours ?? null,
      tags:            task.tags || []
    };

    this.api.post<any>('/tasks', payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (res.data) {
          this.tasks    = [res.data, ...this.tasks];
          this.allTasks = [res.data, ...this.allTasks];
        }
        this.toast.success('Task duplicated.');
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to duplicate.')
    });
  }

  async onBulkAction(cmd: BulkTaskCommand): Promise<void> {
    if (cmd.action === 'delete') {
      const ok = await this.confirm.confirm(
        `Delete ${cmd.ids.length} selected task(s)? This cannot be undone.`,
        'Bulk Delete Tasks'
      );
      if (!ok) return;
    }

    this.busyBulk = true;
    this.cdr.markForCheck();

    this.api.patch<any>('/tasks/bulk', cmd).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.busyBulk = false;
        this.toast.success(`Updated ${cmd.ids.length} task(s).`);
        this.loadTasks();
      },
      error: (e: any) => {
        this.busyBulk = false;
        this.toast.error(e?.error?.message || 'Bulk action failed.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Keyboard shortcuts (outside inputs / closed drawer) ────────────────────
  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (this.drawerOpen || this.quickAddStatus || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (event.key === '/') {
      event.preventDefault();
      this.searchInputRef?.nativeElement.focus();
    } else if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      this.openDrawerForCreate();
    }
  }

  // ── Prefs persistence & view helpers ───────────────────────────────────────
  private restorePrefs(): void {
    try {
      const wRaw = localStorage.getItem(LS_WEIGHTS);
      if (wRaw) {
        const arr = JSON.parse(wRaw);
        if (Array.isArray(arr) && arr.length === DEFAULT_COL_WEIGHTS.length) {
          this.colWeights = arr.map((n: any) => Math.max(this.MIN_COL_WEIGHT, Number(n) || 1));
        }
      }
      const d = localStorage.getItem(LS_DENSITY) as Density | null;
      if (d === 'compact' || d === 'comfortable') this.density = d;

      const v = localStorage.getItem(LS_VIEW) as TaskViewMode | null;
      if (v === 'kanban' || v === 'list' || v === 'swimlanes') this.viewMode = v;

      const sw = localStorage.getItem(LS_SWIMLANE) as SwimlaneBy | null;
      if (sw === 'assignee' || sw === 'priority') this.swimlaneBy = sw;

      const s = localStorage.getItem(LS_SORT);
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed?.key) { this.sortKey = parsed.key; this.sortAsc = !!parsed.asc; }
      }
    } catch { /* ignore */ }
  }

  columnLabel(status: TaskStatus): string {
    return this.columns.find(c => c.status === status)?.label ?? status;
  }

  trackById  = (_: number, t: Task) => t.id;
  trackByKey = (_: number, g: SwimlaneGroup) => g.key;

  readonly isOverdue       = isTaskOverdue;
  readonly daysUntilDue    = daysUntilDue;
  readonly dueLabel        = formatDueLabel;
  readonly getDoneSubtasks = getDoneSubtasks;
  readonly hoursProgress   = getHoursProgress;
  readonly priorityColor   = getPriorityColor;
  readonly getInitials     = getInitials;
  readonly getAvatarColor  = getAvatarColor;
  readonly userName        = getUserDisplayName;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
