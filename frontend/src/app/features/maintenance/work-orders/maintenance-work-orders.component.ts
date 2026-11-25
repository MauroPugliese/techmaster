import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { DateFilterService } from '../../../core/services/date-filter.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiCustomizationService, UiSectionPreferences } from '../../../core/services/ui-customization.service';
import {
  Asset,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceSummary,
  Simulator
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { SUBSYSTEM_META } from '../../simulators/simulator-helpers';
import {
  formatDowntime,
  formatEnumLabel,
  formatMoney,
  formatTechnicianName,
  getPriorityBadgeClass,
  getStatusBadgeClass,
  isMaintenanceOverdue
} from '../maintenance-helpers';

@Component({
  selector: 'app-maintenance-work-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DropdownComponent, DropdownOptionComponent],
  templateUrl: './maintenance-work-orders.component.html',
  styleUrls: ['./maintenance-work-orders.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceWorkOrdersComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  @Input() simulators: Simulator[] = [];
  @Input() assets: Asset[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Input() refreshTick = 0;
  @Input() externalStatusFilter = '';
  @Input() externalSearch = '';
  @Input() externalSimulatorId: number | null = null;

  @Output() logWorkOrderRequested = new EventEmitter<void>();
  @Output() editWorkOrderRequested = new EventEmitter<MaintenanceRecord>();
  @Output() detailRequested = new EventEmitter<MaintenanceRecord>();
  @Output() statusChangeRequested = new EventEmitter<{ record: MaintenanceRecord; status: MaintenanceStatus }>();
  @Output() deleteRequested = new EventEmitter<MaintenanceRecord>();
  @Output() openAssetsTabRequested = new EventEmitter<void>();
  @Output() exportParamsChange = new EventEmitter<Record<string, any>>();
  @Output() summaryChange = new EventEmitter<MaintenanceSummary | null>();
  @Output() mutated = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private initialized = false;
  Math = Math;

  records: MaintenanceRecord[] = [];
  summary: MaintenanceSummary | null = null;
  loading = true;
  total = 0;
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  searchQuery = '';
  statusFilter = '';
  priorityFilter = '';
  typeFilter = '';
  assetFilter: number | '' = '';
  simulatorFilter: number | '' = '';
  sortBy = 'scheduled_date';
  sortDir: 'ASC' | 'DESC' = 'ASC';

  openMenuRecordId: number | null = null;
  selectedIds = new Set<number>();
  bulkStatus = '';
  bulkPriority = '';
  bulkBusy = false;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.externalStatusFilter) {
      this.statusFilter = this.externalStatusFilter;
    }
    if (this.externalSearch) {
      this.searchQuery = this.externalSearch;
    }
    if (this.externalSimulatorId) {
      this.simulatorFilter = this.externalSimulatorId;
    }

    this.searchInput$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.searchQuery = val;
        this.page = 1;
        this.load();
      });

    this.dateFilter.range$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadSummary();
        this.load();
      });

    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;

    let shouldReload = false;
    if (changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadSummary();
      shouldReload = true;
    }
    if (changes['externalStatusFilter'] && this.statusFilter !== this.externalStatusFilter) {
      this.statusFilter = this.externalStatusFilter;
      this.page = 1;
      shouldReload = true;
    }
    if (changes['externalSearch'] && this.searchQuery !== this.externalSearch) {
      this.searchQuery = this.externalSearch;
      this.page = 1;
      shouldReload = true;
    }
    if (changes['externalSimulatorId'] && (this.simulatorFilter || null) !== this.externalSimulatorId) {
      this.simulatorFilter = this.externalSimulatorId || '';
      this.page = 1;
      shouldReload = true;
    }
    if (shouldReload) {
      this.load();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenuRecordId !== null) {
      this.openMenuRecordId = null;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.openMenuRecordId !== null) {
      this.openMenuRecordId = null;
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

  loadSummary(): void {
    this.api.get<any>('/maintenance/summary').subscribe({
      next: r => {
        this.summary = r?.data || null;
        this.summaryChange.emit(this.summary);
        this.cdr.markForCheck();
      }
    });
  }

  load(): void {
    this.loading = true;
    this.openMenuRecordId = null;

    const params: Record<string, any> = {
      search: this.searchQuery.trim(),
      status: this.statusFilter,
      priority: this.priorityFilter,
      type: this.typeFilter,
      asset_id: this.assetFilter || '',
      simulator_id: this.simulatorFilter || '',
      sort_by: this.sortBy,
      sort_dir: this.sortDir,
      page: this.page,
      limit: this.pageSize
    };

    this.exportParamsChange.emit({
      status: this.statusFilter,
      priority: this.priorityFilter,
      type: this.typeFilter,
      asset_id: this.assetFilter || '',
      simulator_id: this.simulatorFilter || '',
      search: this.searchQuery.trim()
    });

    this.api.get<any>('/maintenance', params).subscribe({
      next: r => {
        this.records = r?.data?.items || [];
        this.total = r?.data?.total ?? this.records.length;
        const visibleIds = new Set(this.records.map(rec => rec.id));
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
    this.searchInput$.next(val);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchInput$.next('');
    this.page = 1;
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
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
      this.typeFilter ||
      this.assetFilter !== '' ||
      this.simulatorFilter !== ''
    );
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.priorityFilter = '';
    this.typeFilter = '';
    this.assetFilter = '';
    this.simulatorFilter = '';
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
    this.load();
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return 'unfold_more';
    return this.sortDir === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  toggleRowMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.openMenuRecordId = this.openMenuRecordId === id ? null : id;
  }

  closeRowMenu(): void {
    this.openMenuRecordId = null;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.load();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.load();
  }

  // ── Bulk Selection & Actions ───────────────────────────────────────────────
  get allVisibleSelected(): boolean {
    return this.records.length > 0 && this.records.every(r => this.selectedIds.has(r.id));
  }

  toggleSelectAll(checked: boolean): void {
    if (checked) this.records.forEach(r => this.selectedIds.add(r.id));
    else this.selectedIds.clear();
  }

  toggleSelection(record: MaintenanceRecord, checked: boolean): void {
    if (checked) this.selectedIds.add(record.id);
    else this.selectedIds.delete(record.id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.bulkStatus = '';
    this.bulkPriority = '';
  }

  applyBulkStatus(): void {
    if (!this.selectedIds.size || !this.bulkStatus) return;
    this.runBulk('status', this.bulkStatus, 'Work orders status updated.');
  }

  applyBulkPriority(): void {
    if (!this.selectedIds.size || !this.bulkPriority) return;
    this.runBulk('priority', this.bulkPriority, 'Work orders priority updated.');
  }

  async applyBulkDelete(): Promise<void> {
    if (!this.selectedIds.size) return;
    const count = this.selectedIds.size;
    const ok = await this.confirm.confirm(
      `Delete ${count} selected work order${count > 1 ? 's' : ''}?`,
      'Bulk Delete Work Orders',
      true
    );
    if (!ok) return;
    this.runBulk('delete', null, `${count} work order${count > 1 ? 's' : ''} deleted.`);
  }

  private runBulk(action: 'status' | 'priority' | 'delete', value: any, msg: string): void {
    this.bulkBusy = true;
    this.api.patch<any>('/maintenance/bulk', {
      ids: [...this.selectedIds],
      action,
      value
    }).subscribe({
      next: () => {
        this.bulkBusy = false;
        this.clearSelection();
        this.toast.success(msg);
        this.loadSummary();
        this.load();
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.bulkBusy = false;
        this.toast.error(e?.error?.message || 'Bulk action failed.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── UI Customization & Row Formatting ──────────────────────────────────────
  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  recordSubline(r: MaintenanceRecord): string {
    const parts: string[] = [];
    if (r.simulator) {
      parts.push(`${r.simulator.bay_code || r.simulator.code}`);
    }
    if (r.subsystem_code) {
      const sub = (SUBSYSTEM_META as any)[r.subsystem_code];
      parts.push(sub ? sub.label : r.subsystem_code);
    }
    if (this.showTableField('asset') && r.asset?.name) {
      parts.push(r.asset.name);
      if (r.asset.serial_number) parts.push(`S/N ${r.asset.serial_number}`);
    }
    if (this.showTableField('type') && r.type) {
      parts.push(formatEnumLabel(r.type));
    }
    if (r.lost_training_hours && Number(r.lost_training_hours) > 0) {
      parts.push(`${r.lost_training_hours}h lost training`);
    }
    return parts.join(' · ');
  }

  overdue(r: MaintenanceRecord): boolean { return isMaintenanceOverdue(r); }
  label(v?: string | null): string { return formatEnumLabel(v); }
  statusBadge(s: string): string { return getStatusBadgeClass(s); }
  priorityBadge(p: string): string { return getPriorityBadgeClass(p); }
  money(v?: number | null): string { return formatMoney(v); }
  downtime(v?: number | null): string { return formatDowntime(v); }
  techName(r: MaintenanceRecord): string { return formatTechnicianName(r.technician); }
}
