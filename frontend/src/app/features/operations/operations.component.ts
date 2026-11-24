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
  User
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import { OperationModalsComponent } from './modals/operation-modals.component';
import {
  formatDurationMinutes,
  formatDurationRange,
  formatEnumLabel,
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
    OperationModalsComponent
  ],
  templateUrl: './operations.component.html',
  styleUrls: ['./operations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsComponent implements OnInit, OnDestroy {
  @ViewChild(OperationModalsComponent) modals?: OperationModalsComponent;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private search$ = new Subject<string>();
  private actionHandled = false;
  Math = Math;

  operations: Operation[] = [];
  opTypes: OperationType[] = [];
  staffUsers: Partial<User>[] = [];
  summary: OperationSummary | null = null;
  uiPrefs: UiSectionPreferences | null = null;

  loading = true;
  total = 0;
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  viewMode: 'table' | 'cards' | 'board' = 'table';

  searchQuery = '';
  statusFilter = '';
  priorityFilter = '';
  typeFilter: number | '' = '';
  sortBy = 'start_date';
  sortDir: 'ASC' | 'DESC' = 'DESC';

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

    this.search$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.searchQuery = val;
        this.page = 1;
        this.loadOperations();
      });

    this.dateFilter.range$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadSummary();
        this.loadOperations();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    if (qp['search'] !== undefined) {
      const q = String(qp['search'] || '');
      if (this.searchQuery !== q) {
        this.searchQuery = q;
        changed = true;
      }
    }
    if (qp['action'] === 'new' && !this.actionHandled) {
      this.actionHandled = true;
      setTimeout(() => {
        this.openModal();
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
    }
    this.cdr.markForCheck();
  }

  loadSummary(): void {
    this.api.get<any>('/operations/summary').subscribe({
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
  }

  filterByKpi(status: string): void {
    this.statusFilter = this.statusFilter === status ? '' : status;
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.searchQuery.trim() || this.statusFilter || this.priorityFilter || this.typeFilter !== '');
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.priorityFilter = '';
    this.typeFilter = '';
    this.applyFilters();
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
  openModal(op?: Operation): void { this.modals?.openFormModal(op); }
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
    if (this.showTableField('location') && op.location) parts.push(op.location);
    const crewCount = op.members?.length || 0;
    if (crewCount > 0) parts.push(`${crewCount} crew`);
    return parts.join(' · ');
  }

  avgDurationText(): string {
    const mins = this.summary?.avg_duration_minutes ?? 0;
    return mins > 0 ? formatDurationMinutes(mins) : '—';
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
