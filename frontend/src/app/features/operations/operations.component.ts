import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, skip, takeUntil } from 'rxjs/operators';
import {
  ApiService,
  ConfirmService,
  DateFilterService,
  ToastService,
  UiCustomizationService,
  UiSectionPreferences
} from '../../core/services/services';
import {
  Operation,
  OperationStatus,
  OperationSummary,
  OperationType,
  ShiftUsageStatus,
  Simulator,
  SimulatorDailyLog,
  SimulatorStationKind,
  SimulatorStatus,
  SortieOutcome,
  TimelineShiftBlock,
  User
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import { OperationModalsComponent } from './modals/operation-modals.component';
import { SortieBayTimelineComponent } from './bay-timeline/sortie-bay-timeline.component';
import { StationMntRecordsModalComponent } from '../simulators/modals/station-mnt-records-modal.component';
import { SHIFT_USAGE_STATUS_META, SIM_STATUS_META } from '../simulators/simulator-helpers';
import {
  SORTIE_OUTCOME_META,
  formatDurationMinutes,
  formatDurationRange,
  formatEnumLabel,
  getOutcomeMeta,
  getPriorityBadgeClass,
  getStatusBadgeClass,
  getUserDisplayName,
  getUserInitials,
  isOperationOverdue
} from './operation-helpers';

@Component({
  selector: 'app-operations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    ExportMenuComponent,
    DropdownComponent,
    DropdownOptionComponent,
    OperationModalsComponent,
    SortieBayTimelineComponent,
    StationMntRecordsModalComponent
  ],
  templateUrl: './operations.component.html',
  styleUrls: ['./operations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsComponent implements OnInit, OnDestroy {
  @ViewChild(OperationModalsComponent) modals?: OperationModalsComponent;
  @ViewChild('mntRecordsModal') mntRecordsModal?: StationMntRecordsModalComponent;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private search$ = new Subject<string>();
  private actionHandled = false;
  Math = Math;

  operations: Operation[] = [];
  timelineOps: Operation[] = [];
  timelineShiftBlocks: TimelineShiftBlock[] = [];
  timelineShiftStatuses: Record<number, ShiftUsageStatus> = {};
  simulators: Simulator[] = [];
  opTypes: OperationType[] = [];
  staffUsers: Partial<User>[] = [];
  summary: OperationSummary | null = null;
  uiPrefs: UiSectionPreferences | null = null;

  loading = true;
  total = 0;
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  viewMode: 'timeline' | 'table' | 'cards' | 'board' = 'timeline';
  timelineDate = SortieBayTimelineComponent.todayIso();
  showFleetDeck = false;
  deckKindFilter: 'FFS_BAY' | 'TEST_PLACE' | 'IOS_CONSOLE' | 'ALL' = 'ALL';
  todayPlantLog: SimulatorDailyLog | null = null;

  searchQuery = '';
  statusFilter = '';
  priorityFilter = '';
  typeFilter: number | '' = '';
  simulatorFilter: number | '' = '';
  outcomeFilter: '' | SortieOutcome = '';
  sortBy = 'start_date';
  sortDir: 'ASC' | 'DESC' = 'DESC';

  readonly outcomeOptions: Array<{ value: SortieOutcome; label: string }> = [
    { value: 'PENDING', label: SORTIE_OUTCOME_META.PENDING.label },
    { value: 'CLEAN', label: SORTIE_OUTCOME_META.CLEAN.label },
    { value: 'COMPLETED_WITH_SNAGS', label: SORTIE_OUTCOME_META.COMPLETED_WITH_SNAGS.label },
    { value: 'INTERRUPTED_TECH', label: SORTIE_OUTCOME_META.INTERRUPTED_TECH.label },
    { value: 'NO_SHOW', label: SORTIE_OUTCOME_META.NO_SHOW.label },
    { value: 'CANCELLED', label: SORTIE_OUTCOME_META.CANCELLED.label }
  ];

  openMenuOpId: number | null = null;
  selectedIds = new Set<number>();
  bulkStatus = '';
  bulkPriority = '';
  bulkBusy = false;

  readonly boardColumns: { status: OperationStatus; label: string; color: string }[] = [
    { status: 'PLANNED', label: 'Planned', color: '#5C6BC0' },
    { status: 'IN_PROGRESS', label: 'In Progress', color: '#0288D1' },
    { status: 'ON_HOLD', label: 'On Hold', color: '#D97706' },
    { status: 'COMPLETED', label: 'Completed', color: '#16A34A' }
  ];

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.applyQueryParams(this.route.snapshot.queryParams, false);

    this.route.queryParams.pipe(skip(1), takeUntil(this.destroy$)).subscribe(qp => {
      this.applyQueryParams(qp, true);
    });

    this.uiCustomization.load('operations').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.api.get<any>('/operations/types').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.opTypes = res?.data || []; this.cdr.markForCheck(); }
    });

    this.api.get<any>('/operations/staff').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.staffUsers = res?.data || []; this.cdr.markForCheck(); }
    });

    this.loadSimulators();
    this.loadTimelineOps();
    this.loadTimelineShiftBlocks();

    this.search$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.searchQuery = val;
        this.page = 1;
        this.loadOperations();
        this.loadTimelineOps();
      });

    this.dateFilter.range$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadSummary();
        this.loadOperations();
        this.loadTimelineOps();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadSimulators(): void {
    this.api.get<any>('/simulators').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.simulators = res?.data || [];
        this.cdr.markForCheck();
      }
    });
  }

  loadTimelineShiftBlocks(): void {
    this.api
      .get<any>('/simulators/daily-sheet/timeline', { date: this.timelineDate })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          const data = res?.data;
          this.timelineShiftBlocks = data?.blocks || [];
          this.timelineShiftStatuses = data?.statusBySimulator || {};
          if (data?.operatingHours?.TEST_PLACE) {
            this.todayPlantLog = data.operatingHours.TEST_PLACE;
          }
          this.cdr.markForCheck();
        }
      });
  }

  openShiftBlockInSimulators(block: TimelineShiftBlock): void {
    const view = block.station_kind === 'IOS_CONSOLE' ? 'ios-consoles' : 'test-places';
    this.router.navigate(['/simulators'], {
      queryParams: { view, date: this.timelineDate }
    });
  }

  deckChipDotColor(sim: Simulator): string {
    const shiftSt = this.timelineShiftStatuses[sim.id];
    if (shiftSt && SHIFT_USAGE_STATUS_META[shiftSt]) {
      return SHIFT_USAGE_STATUS_META[shiftSt].dot;
    }
    return this.simStatusMeta(sim.status).color;
  }

  deckChipStatusLabel(sim: Simulator): string {
    const shiftSt = this.timelineShiftStatuses[sim.id];
    if (shiftSt && SHIFT_USAGE_STATUS_META[shiftSt]) {
      return SHIFT_USAGE_STATUS_META[shiftSt].label;
    }
    return this.simStatusMeta(sim.status).label;
  }

  get deckSimulators(): Simulator[] {
    if (this.deckKindFilter === 'ALL') return this.simulators;
    const filtered = this.simulators.filter(
      s => (s.station_kind || 'FFS_BAY') === this.deckKindFilter
    );
    if (filtered.length === 0 && this.deckKindFilter === 'FFS_BAY' && this.simulators.length > 0) {
      return this.simulators;
    }
    return filtered;
  }

  countByKind(kind: SimulatorStationKind): number {
    return this.simulators.filter(s => (s.station_kind || 'FFS_BAY') === kind).length;
  }

  loadTimelineOps(): void {
    this.api.get<any>('/operations', {
      date: this.timelineDate,
      simulator_id: this.simulatorFilter || '',
      outcome: this.outcomeFilter || '',
      limit: 200
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.timelineOps = res?.data?.items || [];
        this.cdr.markForCheck();
      }
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenuOpId !== null) {
      this.openMenuOpId = null;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.openMenuOpId !== null) {
      this.openMenuOpId = null;
      return;
    }
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable;
    if (isEditable) return;
    if (this.searchInput?.nativeElement) {
      e.preventDefault();
      this.searchInput.nativeElement.focus();
    }
  }

  private applyQueryParams(qp: Record<string, any>, reload: boolean): void {
    let changed = false;
    if (qp['status'] !== undefined) {
      const st = String(qp['status'] || '').toUpperCase();
      const allowed = ['', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'OVERDUE'];
      if (allowed.includes(st) && this.statusFilter !== st) {
        this.statusFilter = st;
        changed = true;
      }
    }
    if (qp['simulatorId'] !== undefined) {
      const simId = qp['simulatorId'] ? Number(qp['simulatorId']) : '';
      const validId = simId && Number.isFinite(simId) ? simId : '';
      if (this.simulatorFilter !== validId) {
        this.simulatorFilter = validId;
        changed = true;
      }
    }
    if (qp['search'] !== undefined) {
      const q = String(qp['search'] || '');
      if (this.searchQuery !== q) {
        this.searchQuery = q;
        changed = true;
      }
    }
    if (qp['action'] === 'new' && !this.actionHandled) {
      this.actionHandled = true;
      const preSim = qp['simulatorId'] ? Number(qp['simulatorId']) : (this.simulatorFilter || undefined);
      setTimeout(() => {
        this.openModal(undefined, typeof preSim === 'number' && Number.isFinite(preSim) ? preSim : undefined);
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { action: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }, 0);
    }
    if (reload && changed) {
      this.page = 1;
      this.loadOperations();
      this.loadTimelineOps();
    }
    this.cdr.markForCheck();
  }

  loadSummary(): void {
    this.api.get<any>('/operations/summary', {
      simulator_id: this.simulatorFilter || ''
    }).subscribe({
      next: res => {
        this.summary = res?.data || null;
        this.cdr.markForCheck();
      }
    });
  }

  loadOperations(): void {
    this.loading = true;
    this.openMenuOpId = null;

    this.api.get<any>('/operations', {
      status: this.statusFilter,
      priority: this.priorityFilter,
      type_id: this.typeFilter || '',
      simulator_id: this.simulatorFilter || '',
      outcome: this.outcomeFilter || '',
      search: this.searchQuery.trim(),
      sort_by: this.sortBy,
      sort_dir: this.sortDir,
      page: this.page,
      limit: this.pageSize
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.operations = res?.data?.items || [];
        this.total = res?.data?.total ?? this.operations.length;
        const visibleIds = new Set(this.operations.map(o => o.id));
        this.selectedIds = new Set([...this.selectedIds].filter(id => visibleIds.has(id)));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearchModelChange(val: string): void {
    this.searchQuery = val;
    this.search$.next(val);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.search$.next('');
    this.page = 1;
    this.loadOperations();
  }

  applyFilters(): void {
    this.page = 1;
    this.loadOperations();
    this.loadTimelineOps();
    this.loadSummary();
  }

  filterByKpi(status: string): void {
    this.statusFilter = this.statusFilter === status ? '' : status;
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return Boolean(
      this.searchQuery.trim() ||
      this.statusFilter ||
      this.priorityFilter ||
      this.typeFilter !== '' ||
      this.simulatorFilter !== '' ||
      this.outcomeFilter !== ''
    );
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.priorityFilter = '';
    this.typeFilter = '';
    this.simulatorFilter = '';
    this.outcomeFilter = '';
    this.applyFilters();
  }

  selectDeckSimulator(simId: number): void {
    this.simulatorFilter = this.simulatorFilter === simId ? '' : simId;
    this.applyFilters();
  }

  onTimelineDateChange(dateIso: string): void {
    this.timelineDate = dateIso;
    this.loadTimelineOps();
    this.loadTimelineShiftBlocks();
  }

  onTimelineScheduleSlot(evt: { simulatorId: number; hour: number }): void {
    const parts = this.timelineDate.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2], evt.hour, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    this.modals?.openFormWithSlot(evt.simulatorId, start, end);
  }

  openSimulatorWorkspace(simId: number, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/simulators'], { queryParams: { id: simId } });
  }

  openStationMnt(sim: Simulator, event: Event): void {
    event.stopPropagation();
    this.mntRecordsModal?.open(sim.id, sim.name);
  }

  onMntMutated(): void {
    this.loadSimulators();
  }

  toggleSort(column: string): void {
    if (this.sortBy === column) {
      this.sortDir = this.sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy = column;
      this.sortDir = 'ASC';
    }
    this.page = 1;
    this.loadOperations();
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return 'unfold_more';
    return this.sortDir === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  toggleRowMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.openMenuOpId = this.openMenuOpId === id ? null : id;
  }

  closeRowMenu(): void {
    this.openMenuOpId = null;
  }

  // ── Board & Pagination ─────────────────────────────────────────────────────
  operationsByStatus(status: OperationStatus): Operation[] {
    return this.operations.filter(o => o.status === status);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadOperations();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadOperations();
  }

  // ── Multi-select & Bulk Actions ────────────────────────────────────────────
  get allVisibleSelected(): boolean {
    return this.operations.length > 0 && this.operations.every(o => this.selectedIds.has(o.id));
  }

  toggleSelectAll(checked: boolean): void {
    if (checked) this.operations.forEach(o => this.selectedIds.add(o.id));
    else this.selectedIds.clear();
  }

  toggleSelection(op: Operation, checked: boolean): void {
    if (checked) this.selectedIds.add(op.id);
    else this.selectedIds.delete(op.id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.bulkStatus = '';
    this.bulkPriority = '';
  }

  applyBulkStatus(): void {
    if (!this.selectedIds.size || !this.bulkStatus) return;
    this.runBulk('status', this.bulkStatus, 'Operations status updated.');
  }

  applyBulkPriority(): void {
    if (!this.selectedIds.size || !this.bulkPriority) return;
    this.runBulk('priority', this.bulkPriority, 'Operations priority updated.');
  }

  async applyBulkDelete(): Promise<void> {
    if (!this.selectedIds.size) return;
    const count = this.selectedIds.size;
    const ok = await this.confirm.confirm(
      `Delete ${count} selected operation${count > 1 ? 's' : ''}?`,
      'Bulk Delete Operations',
      true
    );
    if (!ok) return;
    this.runBulk('delete', null, `${count} operation${count > 1 ? 's' : ''} deleted.`);
  }

  private runBulk(action: 'status' | 'priority' | 'delete', value: any, msg: string): void {
    this.bulkBusy = true;
    this.api.patch<any>('/operations/bulk', {
      ids: [...this.selectedIds],
      action,
      value
    }).subscribe({
      next: () => {
        this.bulkBusy = false;
        this.clearSelection();
        this.toast.success(msg);
        this.onMutated();
      },
      error: (e: any) => {
        this.bulkBusy = false;
        this.toast.error(e?.error?.message || 'Bulk action failed.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Modal & Mutation Triggers ──────────────────────────────────────────────
  openModal(op?: Operation, preselectedSimId?: number): void {
    if (!op && preselectedSimId) {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      this.modals?.openFormWithSlot(preselectedSimId, start, end);
      return;
    }
    this.modals?.openFormModal(op);
  }
  openDetail(op: Operation): void { this.modals?.openDetailModal(op); }
  setStatus(op: Operation, status: OperationStatus): void {
    this.closeRowMenu();
    this.modals?.updateStatus(op, status);
  }
  duplicate(op: Operation): void {
    this.closeRowMenu();
    this.modals?.duplicateOperation(op);
  }
  deleteOp(op: Operation): void {
    this.closeRowMenu();
    this.modals?.deleteOperation(op);
  }

  onMutated(): void {
    this.loadSummary();
    this.loadOperations();
    this.loadTimelineOps();
    this.loadTimelineShiftBlocks();
    this.loadSimulators();
  }

  // ── UI Customization & Row Formatters ──────────────────────────────────────
  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  opSubline(op: Operation): string {
    const parts: string[] = [];
    if (op.customer_operator) parts.push(op.customer_operator);
    if (op.scenario_code) parts.push(op.scenario_code);
    if (this.showTableField('location') && op.location && !op.simulator) parts.push(op.location);
    const crewCount = op.members?.length || 0;
    if (crewCount > 0) parts.push(`${crewCount} crew`);
    return parts.join(' · ');
  }

  simStatusMeta(st?: SimulatorStatus) {
    return SIM_STATUS_META[st || 'READY'] || SIM_STATUS_META.READY;
  }

  outcomeMeta(outcome?: SortieOutcome | string | null) {
    return getOutcomeMeta(outcome);
  }

  avgDurationText(): string {
    const mins = this.summary?.avg_duration_minutes ?? 0;
    return mins > 0 ? formatDurationMinutes(mins) : '—';
  }

  totalHoursText(): string {
    const act = this.summary?.total_actual_hours ?? 0;
    const sched = this.summary?.total_scheduled_hours ?? 0;
    return `${act > 0 ? act : sched}h`;
  }

  durationText(op: Operation): string {
    return formatDurationRange(op.start_date, op.actual_end_date || op.end_date);
  }

  overdue(op: Operation): boolean { return isOperationOverdue(op); }
  label(v?: string | null): string { return formatEnumLabel(v); }
  statusBadge(s: string): string { return getStatusBadgeClass(s); }
  priorityBadge(p: string): string { return getPriorityBadgeClass(p); }
  creatorName(op: Operation): string { return getUserDisplayName(op.creator); }
  creatorInitials(op: Operation): string { return getUserInitials(op.creator); }
}
