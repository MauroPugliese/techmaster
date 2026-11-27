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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiCustomizationService, UiSectionPreferences } from '../../../core/services/ui-customization.service';
import {
  InventoryItem,
  WarehouseLocation,
  WarehouseStockStatus
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { MovementPreset } from '../modals/warehouse-modals.component';
import { SUBSYSTEM_META } from '../../simulators/simulator-helpers';
import {
  formatMoney,
  getItemTotalValue,
  getStockBadgeBg,
  getStockProgressPercent,
  getStockStatusColor,
  getStockStatusLabel,
  printBinLabel
} from '../warehouse-helpers';

@Component({
  selector: 'app-warehouse-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  templateUrl: './warehouse-inventory.component.html',
  styleUrls: ['./warehouse-inventory.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseInventoryComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  @Input() categories: any[] = [];
  @Input() locations: WarehouseLocation[] = [];
  @Input() suppliers: string[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Input() refreshTick = 0;
  @Input() externalSearch = '';
  @Input() externalStatusFilter: 'all' | WarehouseStockStatus = 'all';
  @Input() externalLocationFilter: string | number = '';

  @Output() addItemRequested = new EventEmitter<void>();
  @Output() editItemRequested = new EventEmitter<InventoryItem>();
  @Output() detailRequested = new EventEmitter<InventoryItem>();
  @Output() movementRequested = new EventEmitter<{ item: InventoryItem; preset?: MovementPreset }>();
  @Output() historyRequested = new EventEmitter<InventoryItem>();
  @Output() deleteRequested = new EventEmitter<InventoryItem>();
  @Output() statusFilterChanged = new EventEmitter<'all' | WarehouseStockStatus>();
  @Output() exportParamsChange = new EventEmitter<Record<string, any>>();
  @Output() mutated = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private initialized = false;
  Math = Math;

  items: InventoryItem[] = [];
  loading = true;
  total = 0;
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  search = '';
  categoryFilter: number | '' = '';
  locationFilter: number | string = '';
  supplierFilter = '';
  stockStatusFilter: 'all' | WarehouseStockStatus = 'all';
  partClassificationFilter: '' | 'CONSUMABLE' | 'ROTATABLE_LRU' | 'TOOL_CALIBRATED' = '';
  lruStatusFilter = '';
  subsystemFilter = '';
  aogOnly = false;
  showAdvancedFilters = false;

  readonly subsystemOptions = Object.entries(SUBSYSTEM_META).map(([code, meta]) => ({
    code,
    label: meta.label
  }));

  sortBy = '';
  sortDir: 'ASC' | 'DESC' = 'ASC';

  openMenuItemId: number | null = null;
  selectedIds = new Set<number>();
  bulkCategoryId: number | null = null;
  bulkLocationId: number | string | null = null;
  bulkBusy = false;

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  trackByItemId(_: number, item: InventoryItem): number {
    return item.id;
  }

  ngOnInit(): void {
    this.search = this.externalSearch || '';
    this.stockStatusFilter = this.externalStatusFilter || 'all';
    this.locationFilter = this.externalLocationFilter ?? '';

    this.searchInput$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.search = val;
        this.page = 1;
        this.loadItems();
      });

    this.initialized = true;
    this.loadItems();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;

    let shouldReload = false;

    if (changes['externalSearch'] && this.externalSearch !== this.search) {
      this.search = this.externalSearch || '';
      this.page = 1;
      shouldReload = true;
    }

    if (changes['externalStatusFilter'] && this.externalStatusFilter !== this.stockStatusFilter) {
      this.stockStatusFilter = this.externalStatusFilter || 'all';
      this.page = 1;
      shouldReload = true;
    }

    if (changes['externalLocationFilter'] && this.externalLocationFilter !== this.locationFilter) {
      this.locationFilter = this.externalLocationFilter ?? '';
      this.page = 1;
      shouldReload = true;
    }

    if (changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      shouldReload = true;
    }

    if (shouldReload) {
      this.loadItems();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenuItemId !== null) {
      this.openMenuItemId = null;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.openMenuItemId !== null) {
      this.openMenuItemId = null;
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

  loadItems(): void {
    this.loading = true;
    this.openMenuItemId = null;

    const params: Record<string, any> = {
      search: this.search.trim(),
      category_id: this.categoryFilter || '',
      location_id: this.locationFilter || '',
      supplier: this.supplierFilter || '',
      stock_status: this.stockStatusFilter !== 'all' ? this.stockStatusFilter : '',
      low_stock: (this.stockStatusFilter === 'low' || this.stockStatusFilter === 'out') ? 'true' : '',
      part_classification: this.partClassificationFilter || '',
      lru_status: this.lruStatusFilter || '',
      subsystem_code: this.subsystemFilter || '',
      aog_critical: this.aogOnly ? 'true' : '',
      sort_by: this.sortBy || '',
      sort_dir: this.sortDir,
      page: this.page,
      limit: this.pageSize
    };

    this.exportParamsChange.emit({
      category_id: this.categoryFilter || '',
      location_id: this.locationFilter || '',
      stock_status: this.stockStatusFilter !== 'all' ? this.stockStatusFilter : '',
      low_stock: (this.stockStatusFilter === 'low' || this.stockStatusFilter === 'out') ? 'true' : '',
      part_classification: this.partClassificationFilter || '',
      lru_status: this.lruStatusFilter || '',
      subsystem_code: this.subsystemFilter || '',
      aog_critical: this.aogOnly ? 'true' : '',
      search: this.search.trim()
    });

    this.api.get<any>('/warehouse', params).subscribe({
      next: r => {
        this.items = r?.data?.items || r?.data || [];
        this.total = r?.data?.total ?? this.items.length;
        const visibleIds = new Set(this.items.map(i => i.id));
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

  onSearchModelChange(value: string): void {
    this.search = value;
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    this.search = '';
    this.searchInput$.next('');
    this.page = 1;
    this.loadItems();
  }

  applyFilters(): void {
    this.page = 1;
    this.loadItems();
  }

  onStatusSelectChange(): void {
    this.statusFilterChanged.emit(this.stockStatusFilter);
    this.applyFilters();
  }

  get advancedFilterCount(): number {
    let count = 0;
    if (this.categoryFilter !== '') count++;
    if (this.locationFilter !== '') count++;
    if (this.supplierFilter !== '') count++;
    if (this.partClassificationFilter !== '') count++;
    if (this.lruStatusFilter !== '') count++;
    if (this.subsystemFilter !== '') count++;
    return count;
  }

  get hasActiveFilters(): boolean {
    return Boolean(
      this.search.trim() ||
      this.categoryFilter !== '' ||
      this.locationFilter !== '' ||
      this.supplierFilter !== '' ||
      this.stockStatusFilter !== 'all' ||
      this.partClassificationFilter !== '' ||
      this.lruStatusFilter !== '' ||
      this.subsystemFilter !== '' ||
      this.aogOnly ||
      this.sortBy !== ''
    );
  }

  toggleAogFilter(): void {
    this.aogOnly = !this.aogOnly;
    this.applyFilters();
  }

  resetFilters(): void {
    this.search = '';
    this.categoryFilter = '';
    this.locationFilter = '';
    this.supplierFilter = '';
    this.stockStatusFilter = 'all';
    this.partClassificationFilter = '';
    this.lruStatusFilter = '';
    this.subsystemFilter = '';
    this.aogOnly = false;
    this.sortBy = '';
    this.sortDir = 'ASC';
    this.statusFilterChanged.emit('all');
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
    this.loadItems();
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return 'unfold_more';
    return this.sortDir === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  toggleRowMenu(itemId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuItemId = this.openMenuItemId === itemId ? null : itemId;
  }

  closeRowMenu(): void {
    this.openMenuItemId = null;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.loadItems();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadItems();
  }

  // ── Multi-select & Bulk Actions ────────────────────────────────────────────
  get allVisibleSelected(): boolean {
    return this.items.length > 0 && this.items.every(i => this.selectedIds.has(i.id));
  }

  toggleSelectAll(checked: boolean): void {
    if (checked) {
      this.items.forEach(i => this.selectedIds.add(i.id));
    } else {
      this.selectedIds.clear();
    }
  }

  toggleItemSelection(item: InventoryItem, checked: boolean): void {
    if (checked) this.selectedIds.add(item.id);
    else this.selectedIds.delete(item.id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.bulkCategoryId = null;
    this.bulkLocationId = null;
  }

  applyBulkCategory(): void {
    if (!this.selectedIds.size || !this.bulkCategoryId) return;
    this.runBulkAction('category', this.bulkCategoryId, 'Category updated for selected items.');
  }

  applyBulkLocation(): void {
    if (!this.selectedIds.size || this.bulkLocationId === null) return;
    const val = this.bulkLocationId === 'unassign' ? null : Number(this.bulkLocationId);
    this.runBulkAction('location', val, 'Location updated for selected items.');
  }

  async applyBulkDeactivate(): Promise<void> {
    if (!this.selectedIds.size) return;
    const count = this.selectedIds.size;
    const ok = await this.confirm.confirm(
      `Archive ${count} selected inventory item${count > 1 ? 's' : ''}? They will leave active inventory.`,
      'Bulk Archive Items'
    );
    if (!ok) return;
    this.runBulkAction('deactivate', null, `${count} item${count > 1 ? 's' : ''} archived.`);
  }

  private runBulkAction(action: 'category' | 'location' | 'deactivate', value: any, successMsg: string): void {
    this.bulkBusy = true;
    this.api.patch<any>('/warehouse/bulk', {
      ids: [...this.selectedIds],
      action,
      value
    }).subscribe({
      next: () => {
        this.bulkBusy = false;
        this.clearSelection();
        this.toast.success(successMsg);
        this.loadItems();
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

  // ── UI Customization & Cell Helpers ────────────────────────────────────────
  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  itemSubline(item: InventoryItem): string {
    const parts: string[] = [];
    if (this.showTableField('sku') && item.sku) parts.push(item.sku);
    if (this.showTableField('part_number') && item.part_number) parts.push(`PN ${item.part_number}`);
    if (this.showTableField('supplier') && item.supplier) parts.push(item.supplier);
    return parts.join(' · ');
  }

  quickIn(item: InventoryItem): void {
    this.closeRowMenu();
    this.movementRequested.emit({ item, preset: { type: 'IN', quantity: 1 } });
  }

  quickOut(item: InventoryItem): void {
    this.closeRowMenu();
    this.movementRequested.emit({ item, preset: { type: 'OUT', quantity: 1 } });
  }

  printLabel(item: InventoryItem): void {
    this.closeRowMenu();
    if (!printBinLabel(item)) {
      this.toast.warning('Pop-up blocked: allow pop-ups to print bin labels.');
    }
  }

  stockColor(item: InventoryItem): string { return getStockStatusColor(item); }
  stockStatus(item: InventoryItem): string { return getStockStatusLabel(item); }
  stockBadgeBg(item: InventoryItem): string { return getStockBadgeBg(item); }
  stockProgress(item: InventoryItem): number { return getStockProgressPercent(item); }
  unitCostText(item: InventoryItem): string { return formatMoney(item.unit_cost); }
  totalValueText(item: InventoryItem): string { return formatMoney(getItemTotalValue(item)); }
}
