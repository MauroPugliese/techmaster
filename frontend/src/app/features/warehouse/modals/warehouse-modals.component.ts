import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiCustomizationService, UiSectionPreferences } from '../../../core/services/ui-customization.service';
import {
  InventoryItem,
  LruStatus,
  MovementType,
  Simulator,
  StockMovement,
  WarehouseLocation
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd } from '../../../shared/components/datetime-picker/datetime-picker.utils';
import { SUBSYSTEM_OPTIONS } from '../../simulators/simulator-helpers';
import {
  MOVEMENT_TYPES,
  formatMoney,
  formatMovementDelta,
  formatMovementUser,
  generateAutoSku,
  getEffectiveThreshold,
  getItemTotalValue,
  getMovementTypeMeta,
  getStockBadgeBg,
  getStockProgressPercent,
  getStockStatusColor,
  getStockStatusLabel,
  printBinLabel
} from '../warehouse-helpers';

export interface MovementPreset {
  type?: MovementType;
  quantity?: number;
  reference?: string;
  reason?: string;
}

@Component({
  selector: 'app-warehouse-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, DropdownComponent, DropdownOptionComponent, DateTimePickerComponent],
  templateUrl: './warehouse-modals.component.html',
  styleUrls: ['./warehouse-modals.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseModalsComponent {
  @Input() categories: any[] = [];
  @Input() locations: WarehouseLocation[] = [];
  @Input() simulators: Simulator[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Output() mutated = new EventEmitter<void>();

  readonly movementTypes = MOVEMENT_TYPES;
  readonly subsystemOptions = SUBSYSTEM_OPTIONS;

  // Create / Edit modal state
  showItemModal = false;
  editingItem: InventoryItem | null = null;
  itemForm: any = this.emptyItemForm();
  itemError = '';
  saving = false;

  // Stock Movement modal state
  showMovementModal = false;
  movementItem: InventoryItem | null = null;
  movementForm: {
    type: MovementType;
    quantity: number;
    reference: string;
    reason: string;
    destination: string;
    to_location_id: number | null;
    simulator_id: number | null;
  } = this.emptyMovementForm();
  transferMode: 'relocate' | 'external' = 'relocate';
  movementError = '';

  // History modal state
  showHistoryModal = false;
  historyLoading = false;
  historyItem: InventoryItem | null = null;
  itemHistory: StockMovement[] = [];
  historyPage = 1;
  historyPageSize = 10;
  readonly historyPageSizeOptions = [10, 20, 50, 100];

  // Detail modal state
  detailItem: InventoryItem | null = null;
  recentMovements: StockMovement[] = [];
  recentLoading = false;
  copiedKey: string | null = null;

  constructor(
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  // ── UI Customization helpers ───────────────────────────────────────────────
  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  // ── Keyboard Escape closes topmost modal ───────────────────────────────────
  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.showMovementModal) {
      this.showMovementModal = false;
      this.cdr.markForCheck();
    } else if (this.showHistoryModal) {
      this.showHistoryModal = false;
      this.cdr.markForCheck();
    } else if (this.showItemModal) {
      this.showItemModal = false;
      this.cdr.markForCheck();
    } else if (this.detailItem) {
      this.detailItem = null;
      this.cdr.markForCheck();
    }
  }

  // ── Create / Edit Item ─────────────────────────────────────────────────────
  private emptyItemForm() {
    return {
      category_id: null as number | null,
      location_id: null as number | null,
      sku: '',
      part_number: '',
      name: '',
      description: '',
      unit: 'pcs',
      part_classification: 'CONSUMABLE' as 'CONSUMABLE' | 'ROTATABLE_LRU' | 'TOOL_CALIBRATED',
      aog_critical: false,
      lead_time_days: 7,
      unserviceable_qty: 0,
      subsystem_code: '',
      serial_number: '',
      lru_status: 'SERVICEABLE' as LruStatus,
      installed_simulator_id: null as number | null,
      rma_reference: '',
      on_order_qty: 0,
      expected_delivery_date: null as Date | null,
      compatible_models_text: '',
      quantity: 0,
      min_stock: 0,
      reorder_point: 0,
      max_stock: null as number | null,
      unit_cost: null as number | null,
      supplier: ''
    };
  }

  openItemModal(item?: InventoryItem): void {
    this.itemError = '';
    if (item) {
      this.editingItem = item;
      this.itemForm = {
        category_id: item.category_id ?? null,
        location_id: item.location_id ?? null,
        sku: item.sku,
        part_number: item.part_number ?? '',
        name: item.name,
        description: item.description ?? '',
        unit: item.unit || 'pcs',
        part_classification: (item.part_classification || 'CONSUMABLE') as 'CONSUMABLE' | 'ROTATABLE_LRU' | 'TOOL_CALIBRATED',
        aog_critical: Boolean(item.aog_critical),
        lead_time_days: item.lead_time_days ?? 7,
        unserviceable_qty: item.unserviceable_qty ?? 0,
        subsystem_code: item.subsystem_code ?? '',
        serial_number: item.serial_number ?? '',
        lru_status: (item.lru_status || 'SERVICEABLE') as LruStatus,
        installed_simulator_id: item.installed_simulator_id ?? null,
        rma_reference: item.rma_reference ?? '',
        on_order_qty: item.on_order_qty ?? 0,
        expected_delivery_date: item.expected_delivery_date ? new Date(`${String(item.expected_delivery_date).slice(0, 10)}T00:00:00`) : null,
        compatible_models_text: Array.isArray(item.compatible_models) ? item.compatible_models.join(', ') : '',
        quantity: item.quantity,
        min_stock: item.min_stock ?? 0,
        reorder_point: item.reorder_point ?? 0,
        max_stock: item.max_stock ?? null,
        unit_cost: item.unit_cost ?? null,
        supplier: item.supplier ?? ''
      };
    } else {
      this.editingItem = null;
      this.itemForm = this.emptyItemForm();
    }
    this.showItemModal = true;
    this.cdr.markForCheck();
  }

  closeItemModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showItemModal = false;
    }
  }

  autoFillSku(): void {
    const cat = this.categories.find(c => Number(c.id) === Number(this.itemForm.category_id));
    this.itemForm.sku = generateAutoSku(cat?.name, this.itemForm.name);
    this.cdr.markForCheck();
  }

  get itemThresholdWarning(): string {
    const min = Number(this.itemForm.min_stock) || 0;
    const rop = Number(this.itemForm.reorder_point) || 0;
    const rawMax = this.itemForm.max_stock;
    if (rawMax !== null && rawMax !== undefined && rawMax !== '') {
      const maxVal = Number(rawMax);
      if (Number.isFinite(maxVal) && maxVal < Math.max(min, rop)) {
        return 'Max stock should be greater than or equal to Min stock and Reorder point.';
      }
    }
    return '';
  }

  get itemPreviewValue(): string {
    const qty = Number(this.itemForm.quantity) || 0;
    const cost = this.itemForm.unit_cost !== null && this.itemForm.unit_cost !== undefined && this.itemForm.unit_cost !== ''
      ? Number(this.itemForm.unit_cost)
      : null;
    if (cost === null || !Number.isFinite(cost)) return '—';
    return formatMoney(qty * cost);
  }

  saveItem(): void {
    this.itemError = '';
    if (this.showFormField('name') && !String(this.itemForm.name || '').trim()) {
      this.itemError = 'Item name is required.';
      return;
    }
    if (this.showFormField('sku') && !String(this.itemForm.sku || '').trim()) {
      this.itemError = 'SKU is required.';
      return;
    }
    if (!this.editingItem && this.showFormField('category_id') && !this.itemForm.category_id) {
      this.itemError = 'Please select a category.';
      return;
    }
    if (this.itemThresholdWarning) {
      this.itemError = this.itemThresholdWarning;
      return;
    }

    this.saving = true;
    const isEdit = !!this.editingItem;
    const { compatible_models_text, ...rest } = this.itemForm;
    const compatList = String(compatible_models_text || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const payload = {
      ...rest,
      aog_critical: Boolean(rest.aog_critical),
      lead_time_days: Math.max(0, Math.floor(Number(rest.lead_time_days || 0))),
      unserviceable_qty: Math.max(0, Math.floor(Number(rest.unserviceable_qty || 0))),
      on_order_qty: Math.max(0, Math.floor(Number(rest.on_order_qty || 0))),
      subsystem_code: rest.subsystem_code || null,
      serial_number: String(rest.serial_number || '').trim() || null,
      lru_status: rest.lru_status || 'SERVICEABLE',
      installed_simulator_id: rest.installed_simulator_id ? Number(rest.installed_simulator_id) : null,
      rma_reference: String(rest.rma_reference || '').trim() || null,
      expected_delivery_date: rest.expected_delivery_date ? formatLocalYmd(new Date(rest.expected_delivery_date)) : null,
      compatible_models: compatList
    };
    const req$ = isEdit
      ? this.api.put<any>(`/warehouse/${this.editingItem!.id}`, payload)
      : this.api.post<any>('/warehouse', payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showItemModal = false;
        this.toast.success(isEdit ? 'Item updated.' : 'Item created.');
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.itemError = e?.error?.message || 'Failed to save item.';
        this.toast.error(this.itemError);
        this.cdr.markForCheck();
      }
    });
  }

  async deleteItem(item: InventoryItem): Promise<void> {
    const ok = await this.confirm.confirm(
      `Archive "${item.name}" (${item.sku})? It will no longer appear in active inventory.`,
      'Archive Item'
    );
    if (!ok) return;

    this.api.delete<any>(`/warehouse/${item.id}`).subscribe({
      next: () => {
        this.showItemModal = false;
        if (this.detailItem?.id === item.id) this.detailItem = null;
        this.toast.success('Item archived.');
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to archive item.')
    });
  }

  // ── Stock Movement Modal ───────────────────────────────────────────────────
  private emptyMovementForm() {
    return {
      type: 'IN' as MovementType,
      quantity: 1,
      reference: '',
      reason: '',
      destination: '',
      to_location_id: null as number | null,
      simulator_id: null as number | null
    };
  }

  openMovementModal(item: InventoryItem, preset?: MovementPreset): void {
    this.movementItem = item;
    this.movementError = '';
    const nextType: MovementType = preset?.type || 'IN';
    const defaultQty = preset?.quantity !== undefined
      ? preset.quantity
      : (nextType === 'ADJUSTMENT' ? item.quantity : 1);

    this.movementForm = {
      type: nextType,
      quantity: defaultQty,
      reference: preset?.reference || '',
      reason: preset?.reason || '',
      destination: '',
      to_location_id: null,
      simulator_id: item.installed_simulator_id ?? null
    };
    this.transferMode = this.availableTransferLocations.length > 0 ? 'relocate' : 'external';
    this.showMovementModal = true;
    this.cdr.markForCheck();
  }

  closeMovementModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showMovementModal = false;
    }
  }

  selectMovementType(type: MovementType): void {
    this.movementForm.type = type;
    this.movementError = '';
    if (type === 'TRANSFER') {
      this.transferMode = this.availableTransferLocations.length > 0 ? 'relocate' : 'external';
      if (this.transferMode === 'relocate') {
        this.movementForm.to_location_id = this.availableTransferLocations[0]?.id ?? null;
      }
    } else if (type === 'ADJUSTMENT' && this.movementItem) {
      this.movementForm.quantity = this.movementItem.quantity;
    } else if ((this.movementForm.quantity ?? 0) < 1) {
      this.movementForm.quantity = 1;
    }
    this.cdr.markForCheck();
  }

  setTransferMode(mode: 'relocate' | 'external'): void {
    this.transferMode = mode;
    this.movementError = '';
    if (mode === 'relocate') {
      this.movementForm.to_location_id = this.availableTransferLocations[0]?.id ?? null;
    } else {
      this.movementForm.to_location_id = null;
      if ((this.movementForm.quantity ?? 0) < 1) this.movementForm.quantity = 1;
    }
    this.cdr.markForCheck();
  }

  get availableTransferLocations(): WarehouseLocation[] {
    const currentId = this.movementItem?.location_id ?? null;
    return this.locations.filter(loc => loc.id !== currentId);
  }

  get isInternalRelocation(): boolean {
    return this.movementForm.type === 'TRANSFER' && this.transferMode === 'relocate';
  }

  get movementPresets(): { label: string; value: number }[] {
    if (!this.movementItem) return [];
    const item = this.movementItem;
    const type = this.movementForm.type;

    if (type === 'IN' || type === 'RETURN') {
      const list = [
        { label: '+1', value: 1 },
        { label: '+5', value: 5 },
        { label: '+10', value: 10 },
        { label: '+25', value: 25 }
      ];
      if (item.max_stock && item.max_stock > item.quantity) {
        list.push({ label: `Fill to Max (+${item.max_stock - item.quantity})`, value: item.max_stock - item.quantity });
      }
      return list;
    }

    if (type === 'OUT' || (type === 'TRANSFER' && this.transferMode === 'external')) {
      const list = [
        { label: '1', value: 1 },
        { label: '5', value: 5 },
        { label: '10', value: 10 }
      ];
      if (item.quantity > 0) {
        list.push({ label: `All (${item.quantity})`, value: item.quantity });
      }
      return list;
    }

    if (type === 'ADJUSTMENT') {
      const list = [{ label: '0 (Empty)', value: 0 }];
      if (item.min_stock > 0) list.push({ label: `Min (${item.min_stock})`, value: item.min_stock });
      if (item.reorder_point > 0 && item.reorder_point !== item.min_stock) {
        list.push({ label: `Reorder (${item.reorder_point})`, value: item.reorder_point });
      }
      if (item.max_stock && item.max_stock > 0) {
        list.push({ label: `Max (${item.max_stock})`, value: item.max_stock });
      }
      return list;
    }

    return [];
  }

  applyMovementPreset(val: number): void {
    this.movementForm.quantity = val;
    this.movementError = '';
  }

  getProjectedQty(): number {
    if (!this.movementItem) return 0;
    if (this.isInternalRelocation) return this.movementItem.quantity;
    const q = Number(this.movementForm.quantity);
    if (!Number.isFinite(q)) return this.movementItem.quantity;

    switch (this.movementForm.type) {
      case 'IN':
      case 'RETURN':
        return this.movementItem.quantity + q;
      case 'OUT':
      case 'TRANSFER':
        return this.movementItem.quantity - q;
      case 'ADJUSTMENT':
        return q;
      default:
        return this.movementItem.quantity;
    }
  }

  getProjectedStatusItem(): Partial<InventoryItem> {
    if (!this.movementItem) return { quantity: 0 };
    return { ...this.movementItem, quantity: Math.max(0, this.getProjectedQty()) };
  }

  get selectedDestinationLocationName(): string {
    const loc = this.locations.find(l => Number(l.id) === Number(this.movementForm.to_location_id));
    return loc ? `${loc.code} — ${loc.name}` : 'Select destination';
  }

  submitMovement(): void {
    if (!this.movementItem) return;
    this.movementError = '';

    const rawQty = Number(this.movementForm.quantity);
    if (!this.isInternalRelocation) {
      if (!Number.isInteger(rawQty)) {
        this.movementError = 'Quantity must be a whole integer.';
        return;
      }
      if (this.movementForm.type === 'ADJUSTMENT') {
        if (rawQty < 0) {
          this.movementError = 'Adjusted quantity cannot be negative.';
          return;
        }
      } else if (rawQty < 1) {
        this.movementError = 'Quantity must be at least 1.';
        return;
      }
      if (this.getProjectedQty() < 0) {
        this.movementError = 'Insufficient stock for this movement.';
        return;
      }
    } else if (!this.movementForm.to_location_id) {
      this.movementError = 'Select a destination warehouse location.';
      return;
    }

    const payload: Record<string, any> = {
      type: this.movementForm.type,
      quantity: this.isInternalRelocation ? this.movementItem.quantity : rawQty,
      reference: this.movementForm.reference?.trim() || undefined,
      reason: this.movementForm.reason?.trim() || undefined
    };

    if (this.isInternalRelocation) {
      payload['to_location_id'] = this.movementForm.to_location_id;
    } else if (this.movementForm.type === 'TRANSFER' && this.movementForm.destination?.trim()) {
      payload['destination'] = this.movementForm.destination.trim();
    } else if ((this.movementForm.type === 'OUT' || this.movementForm.type === 'RETURN') && this.movementForm.simulator_id) {
      payload['simulator_id'] = Number(this.movementForm.simulator_id);
    }

    this.saving = true;
    this.api.post<any>(`/warehouse/${this.movementItem.id}/movement`, payload).subscribe({
      next: () => {
        this.saving = false;
        this.showMovementModal = false;
        this.toast.success(this.isInternalRelocation ? 'Item relocated to new location.' : 'Stock movement recorded.');
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.movementError = e?.error?.message || 'Failed to record movement.';
        this.toast.error(this.movementError);
        this.cdr.markForCheck();
      }
    });
  }

  // ── Detail Modal ───────────────────────────────────────────────────────────
  openDetailModal(item: InventoryItem): void {
    this.detailItem = item;
    this.recentMovements = [];
    this.recentLoading = true;
    this.copiedKey = null;
    this.cdr.markForCheck();

    this.api.get<any>(`/warehouse/${item.id}/movements`, { limit: 5 }).subscribe({
      next: r => {
        this.recentMovements = r?.data || [];
        this.recentLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.recentLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeDetailModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.detailItem = null;
    }
  }

  copyText(key: string, value?: string): void {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      this.copiedKey = key;
      this.toast.success(`Copied ${key}: ${value}`);
      this.cdr.markForCheck();
      setTimeout(() => {
        this.copiedKey = null;
        this.cdr.markForCheck();
      }, 1500);
    }).catch(() => {});
  }

  printLabel(): void {
    if (!this.detailItem) return;
    const opened = printBinLabel(this.detailItem);
    if (!opened) {
      this.toast.warning('Pop-up blocked: allow pop-ups to print bin labels.');
    }
  }

  editFromDetail(): void {
    if (!this.detailItem) return;
    const item = this.detailItem;
    this.detailItem = null;
    this.openItemModal(item);
  }

  movementFromDetail(): void {
    if (!this.detailItem) return;
    const item = this.detailItem;
    this.detailItem = null;
    this.openMovementModal(item);
  }

  historyFromDetail(): void {
    if (!this.detailItem) return;
    const item = this.detailItem;
    this.detailItem = null;
    this.openHistoryModal(item);
  }

  deleteFromDetail(): void {
    if (!this.detailItem) return;
    this.deleteItem(this.detailItem);
  }

  // ── Item History Modal ─────────────────────────────────────────────────────
  openHistoryModal(item: InventoryItem): void {
    this.historyItem = item;
    this.itemHistory = [];
    this.historyPage = 1;
    this.showHistoryModal = true;
    this.historyLoading = true;
    this.cdr.markForCheck();

    this.api.get<any>(`/warehouse/${item.id}/movements`).subscribe({
      next: r => {
        this.itemHistory = r?.data || [];
        this.historyLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.historyLoading = false;
        this.toast.error('Failed to load item history.');
        this.cdr.markForCheck();
      }
    });
  }

  closeHistoryModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showHistoryModal = false;
    }
  }

  get pagedItemHistory(): StockMovement[] {
    const start = (this.historyPage - 1) * this.historyPageSize;
    return this.itemHistory.slice(start, start + this.historyPageSize);
  }

  get historyTotalPages(): number {
    return Math.max(1, Math.ceil(this.itemHistory.length / this.historyPageSize));
  }

  changeHistoryPage(page: number): void {
    if (page < 1 || page > this.historyTotalPages) return;
    this.historyPage = page;
  }

  onHistoryPageSizeChange(): void {
    this.historyPage = 1;
  }

  // ── Shared Formatting Helpers Exposed to Template ──────────────────────────
  stockColor(item: Partial<InventoryItem> | null): string { return getStockStatusColor(item); }
  stockStatus(item: Partial<InventoryItem> | null): string { return getStockStatusLabel(item); }
  stockBadgeBg(item: Partial<InventoryItem> | null): string { return getStockBadgeBg(item); }
  stockProgress(item: Partial<InventoryItem> | null): number { return getStockProgressPercent(item); }
  effectiveThreshold(item: Partial<InventoryItem> | null): number { return getEffectiveThreshold(item); }
  totalValue(item: Partial<InventoryItem> | null): string { return formatMoney(getItemTotalValue(item)); }
  money(val: any): string { return formatMoney(val); }
  movementMeta(type: MovementType) { return getMovementTypeMeta(type); }
  movementDelta(m: StockMovement): string { return formatMovementDelta(m); }
  movementUser(m: StockMovement): string { return formatMovementUser(m); }
}
