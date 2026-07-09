// =============================================================================
// tasks.component.ts — Recursive Task Manager (Enhanced)
//   • Drag & drop between Kanban columns (Angular CDK)
//   • Resizable columns with persisted widths
//   • Search, sort, priority filter, density toggle, Esc-to-close modal
//   • Better card visuals, empty states, assignee color-hashing
// =============================================================================
import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  HostListener
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import { ToastService }   from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { Task, IntervalType, TaskStatus, Priority } from '../../core/models/interfaces';
import { OwlDateTimeModule, OwlNativeDateTimeModule } from '@danielmoncada/angular-datetime-picker';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';

interface Column { status: TaskStatus; label: string; color: string; icon: string; }
type   SortKey  = 'due' | 'priority' | 'created' | 'title';
type   Density  = 'comfortable' | 'compact';

const LS_WIDTHS  = 'tasks.columnWidths.v1';
const LS_DENSITY = 'tasks.density.v1';
const LS_SORT    = 'tasks.sort.v1';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    OwlDateTimeModule, OwlNativeDateTimeModule,
    ExportMenuComponent, DragDropModule
  ],
  templateUrl: './tasks.component.html',
  styleUrls:   ['./tasks.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TasksComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  tasks:    Task[] = [];
  allTasks: Task[] = []; // flat list for parent selector
  loading = true;
  saving  = false;

  // ── Filters / view state ────────────────────────────────────────────────
  activeInterval: IntervalType | '' = '';
  statusFilter = '';
  priorityFilter: Priority | '' = '';
  searchTerm = '';
  sortKey: SortKey = 'due';
  sortAsc  = true;
  density: Density = 'comfortable';

  showModal   = false;
  editingTask: Task | null = null;
  form:        any = this.emptyForm();
  tagsInput   = '';

  intervals = [
    { value: '' as const,         label: 'All',     icon: 'apps' },
    { value: 'DAILY' as const,    label: 'Daily',   icon: 'today' },
    { value: 'WEEKLY' as const,   label: 'Weekly',  icon: 'view_week' },
    { value: 'MONTHLY' as const,  label: 'Monthly', icon: 'calendar_month' },
    { value: 'YEARLY' as const,   label: 'Yearly',  icon: 'event' },
    { value: 'ONCE' as const,     label: 'Once',    icon: 'looks_one' },
  ];

  columns: Column[] = [
    { status: 'TODO',        label: 'To Do',       color: '#6B7280', icon: 'radio_button_unchecked' },
    { status: 'IN_PROGRESS', label: 'In Progress', color: '#0288D1', icon: 'play_circle' },
    { status: 'REVIEW',      label: 'In Review',   color: '#F59E0B', icon: 'rate_review' },
    { status: 'DONE',        label: 'Done',        color: '#10B981', icon: 'check_circle' },
  ];

  /** Live width (px) per column, aligned with `columns`. */
  colWidths: number[] = [300, 300, 300, 300];
  readonly MIN_COL_WIDTH = 240;

  /** IDs used by CDK drop lists for cross-column drag. */
  get dropListIds(): string[] { return this.columns.map(c => 'col-' + c.status); }

  connectedTo(status: TaskStatus): string[] {
    return this.dropListIds.filter(id => id !== 'col-' + status);
  }

  get taskStats() {
    const total    = this.tasks.length;
    const progress = this.tasks.filter(t => t.status === 'IN_PROGRESS').length;
    const overdue  = this.tasks.filter(t => this.isOverdue(t)).length;
    const done     = this.tasks.filter(t => t.status === 'DONE').length;
    const rate     = total ? Math.round((done / total) * 100) : 0;
    return [
      { label: 'Total',       count: total,    icon: 'task_alt',     color: '#1565C0', sub: 'All visible' },
      { label: 'In Progress', count: progress, icon: 'pending',      color: '#0288D1', sub: 'Being worked on' },
      { label: 'Overdue',     count: overdue,  icon: 'warning',      color: '#EF4444', sub: 'Past due date' },
      { label: 'Completed',   count: done,     icon: 'check_circle', color: '#10B981', sub: rate + '% completion' },
    ];
  }

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef,
    private toast:   ToastService,
    private confirm: ConfirmService,
  ) {
    this.restorePrefs();
  }

  ngOnInit(): void {
    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      switchMap(() => {
        this.loading = true;
        this.cdr.markForCheck();
        return this.api.get<any>('/tasks', {
          interval_type: this.activeInterval,
          status: this.statusFilter,
          limit: 100
        });
      })
    ).subscribe({
      next: res => {
        this.tasks = res.data.items;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });

    // Load all tasks for parent selector
    this.api.get<any>('/tasks', { limit: 200 }).subscribe(res => {
      this.allTasks = res.data.items;
      this.cdr.markForCheck();
    });
  }

  loadTasks(): void {
    this.loading = true;
    this.api.get<any>('/tasks', {
      interval_type: this.activeInterval,
      status: this.statusFilter,
      limit: 100
    }).subscribe({
      next: res => { this.tasks = res.data.items; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  setInterval(v: IntervalType | ''): void {
    this.activeInterval = v;
    this.loadTasks();
  }

  /** Filtered + sorted tasks for a given column. */
  getTasksByStatus(status: TaskStatus): Task[] {
    const q = this.searchTerm.trim().toLowerCase();
    let list = this.tasks.filter(t => t.status === status);

    if (this.priorityFilter) list = list.filter(t => t.priority === this.priorityFilter);
    if (q) {
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      );
    }

    const pri: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const dir = this.sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      let d = 0;
      switch (this.sortKey) {
        case 'due': {
          const av = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
          const bv = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
          d = av - bv; break;
        }
        case 'priority': d = (pri[a.priority] ?? 9) - (pri[b.priority] ?? 9); break;
        case 'created':  d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        case 'title':    d = a.title.localeCompare(b.title); break;
      }
      return d * dir;
    });
  }

  getDoneSubtasks(task: Task): number {
    return task.subtasks?.filter(s => s.status === 'DONE').length ?? 0;
  }

  isOverdue(task: Task): boolean {
    if (!task.due_date || task.status === 'DONE') return false;
    return new Date(task.due_date) < new Date();
  }

  daysUntilDue(task: Task): number | null {
    if (!task.due_date) return null;
    const ms = new Date(task.due_date).getTime() - Date.now();
    return Math.round(ms / 86_400_000);
  }

  dueLabel(task: Task): string {
    if (!task.due_date) return 'No due date';
    const d = this.daysUntilDue(task);
    if (d === null) return 'No due date';
    if (d <   0) return `Overdue ${-d}d`;
    if (d === 0) return 'Due today';
    if (d === 1) return 'Due tomorrow';
    if (d <=  7) return `In ${d} days`;
    return new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ── Drag & drop ────────────────────────────────────────────────────────
  onTaskDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus): void {
    if (event.previousContainer === event.container) return; // same-column reorder isn't persisted
    const task: Task = event.item.data;
    if (!task || task.status === targetStatus) return;

    const previous = task.status;
    // Optimistic update
    task.status = targetStatus;
    this.cdr.markForCheck();

    this.api.put<any>(`/tasks/${task.id}`, { status: targetStatus }).subscribe({
      next: () => this.toast.success(`Moved to ${this.columnLabel(targetStatus)}`),
      error: (e: any) => {
        task.status = previous; // rollback
        this.cdr.markForCheck();
        this.toast.error(e?.error?.message || 'Failed to move task.');
      }
    });
  }

  columnLabel(status: TaskStatus): string {
    return this.columns.find(c => c.status === status)?.label ?? status;
  }

  // ── Column resize ──────────────────────────────────────────────────────
  private resizeState: { index: number; startX: number; startW: number; nextW: number } | null = null;

  startResize(event: MouseEvent, index: number): void {
    event.preventDefault();
    this.resizeState = {
      index,
      startX: event.clientX,
      startW: this.colWidths[index],
      nextW:  this.colWidths[index + 1] ?? this.colWidths[index]
    };
    document.body.classList.add('tasks-resizing');
    window.addEventListener('mousemove', this.onResizeMove);
    window.addEventListener('mouseup',   this.onResizeEnd);
  }

  private onResizeMove = (e: MouseEvent) => {
    if (!this.resizeState) return;
    const { index, startX, startW, nextW } = this.resizeState;
    const dx = e.clientX - startX;
    const w  = Math.max(this.MIN_COL_WIDTH, startW + dx);
    this.colWidths[index] = w;
    if (index < this.colWidths.length - 1) {
      const shrink = Math.max(this.MIN_COL_WIDTH, nextW - dx);
      this.colWidths[index + 1] = shrink;
    }
    this.cdr.markForCheck();
  };

  private onResizeEnd = () => {
    document.body.classList.remove('tasks-resizing');
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup',   this.onResizeEnd);
    this.resizeState = null;
    try { localStorage.setItem(LS_WIDTHS, JSON.stringify(this.colWidths)); } catch { /* noop */ }
  };

  resetColumnWidths(): void {
    this.colWidths = this.columns.map(() => 300);
    try { localStorage.removeItem(LS_WIDTHS); } catch { /* noop */ }
    this.cdr.markForCheck();
    this.toast.info('Column widths reset.');
  }

  // ── Density / sort persistence ─────────────────────────────────────────
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

  clearFilters(): void {
    this.activeInterval = '';
    this.statusFilter   = '';
    this.priorityFilter = '';
    this.searchTerm     = '';
    this.loadTasks();
  }

  private restorePrefs(): void {
    try {
      const raw = localStorage.getItem(LS_WIDTHS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === this.colWidths.length) {
          this.colWidths = arr.map((n: any) => Math.max(this.MIN_COL_WIDTH, Number(n) || 300));
        }
      }
      const d = localStorage.getItem(LS_DENSITY) as Density | null;
      if (d === 'compact' || d === 'comfortable') this.density = d;
      const s = localStorage.getItem(LS_SORT);
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed?.key) { this.sortKey = parsed.key; this.sortAsc = !!parsed.asc; }
      }
    } catch { /* ignore */ }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.showModal) { this.showModal = false; this.cdr.markForCheck(); } }

  openModal(defaultStatus?: TaskStatus): void {
    this.editingTask = null;
    this.form = this.emptyForm();
    if (defaultStatus) this.form.status = defaultStatus;
    if (this.activeInterval) this.form.interval_type = this.activeInterval as IntervalType;
    this.tagsInput = '';
    this.showModal = true;
  }

  editTask(task: Task): void {
    this.editingTask = task;
    this.form = {
      ...task,
      due_date: task.due_date ? new Date(task.due_date) : null
    };
    this.tagsInput = (task.tags || []).join(', ');
    this.showModal = true;
  }

  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  saveTask(): void {
    if (!this.form.title) return;
    this.saving = true;
    this.form.tags = this.tagsInput ? this.tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isEdit = !!this.editingTask;
    const req$   = isEdit
      ? this.api.put<any>(`/tasks/${this.editingTask!.id}`, this.form)
      : this.api.post<any>('/tasks', this.form);
    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.loadTasks();
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

  quickStatusChange(task: Task, event: MouseEvent): void {
    event.stopPropagation();
    const nextStatus: Record<TaskStatus, TaskStatus> = {
      'TODO':'IN_PROGRESS','IN_PROGRESS':'REVIEW','REVIEW':'DONE',
      'DONE':'TODO','CANCELLED':'TODO','OVERDUE':'IN_PROGRESS'
    };
    const target = nextStatus[task.status];
    this.api.put<any>(`/tasks/${task.id}`, { status: target }).subscribe({
      next: () => { this.loadTasks(); this.toast.info(`Moved to ${this.columnLabel(target)}.`); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update status.')
    });
  }

  async deleteTask(task: Task, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const ok = await this.confirm.confirm(`Delete "${task.title}"? This cannot be undone.`, 'Delete Task');
    if (!ok) return;
    this.api.delete<any>(`/tasks/${task.id}`).subscribe({
      next: () => { this.loadTasks(); this.toast.success('Task deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  duplicateTask(task: Task, event: MouseEvent): void {
    event.stopPropagation();
    const payload: any = {
      title:           `${task.title} (copy)`,
      description:     task.description,
      interval_type:   task.interval_type,
      status:          'TODO',
      priority:        task.priority,
      due_date:        task.due_date,
      estimated_hours: task.estimated_hours,
      tags:            task.tags || []
    };
    this.api.post<any>('/tasks', payload).subscribe({
      next: () => { this.toast.success('Task duplicated.'); this.loadTasks(); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to duplicate.')
    });
  }

  addSubtaskToEditing(): void {
    if (!this.editingTask) return;
    const title = prompt('Subtask title:');
    if (!title) return;
    this.api.post<any>('/tasks', {
      title, parent_id: this.editingTask.id,
      interval_type: 'ONCE', status: 'TODO', priority: 'MEDIUM'
    }).subscribe(() => {
      this.api.get<any>(`/tasks/${this.editingTask!.id}`).subscribe(res => {
        this.editingTask = res.data;
        this.cdr.markForCheck();
      });
      this.loadTasks();
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  getPriorityColor(p: Priority): string {
    const m: Record<string,string> = { LOW:'#10B981', MEDIUM:'#F59E0B', HIGH:'#EF4444', CRITICAL:'#9D174D' };
    return m[p] || '#F59E0B';
  }

  getPriorityBadge(p: Priority): string {
    const m: Record<string,string> = { LOW:'badge-low', MEDIUM:'badge-medium', HIGH:'badge-high', CRITICAL:'badge-critical' };
    return m[p] || 'badge-medium';
  }

  getInitials(user: Partial<{ first_name: string; last_name: string }>): string {
    return `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase();
  }

  /** Stable, pleasant HSL color per user (hashed from name). */
  getAvatarColor(user: Partial<{ first_name: string; last_name: string }>): string {
    const s = `${user.first_name || ''} ${user.last_name || ''}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 55% 45%)`;
  }

  trackById = (_: number, t: Task) => t.id;

  private emptyForm(): any {
    return {
      title: '', description: '', interval_type: 'ONCE', status: 'TODO',
      priority: 'MEDIUM', due_date: null, estimated_hours: undefined,
      parent_id: undefined, tags: []
    };
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
