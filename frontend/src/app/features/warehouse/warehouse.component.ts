// =============================================================================
// warehouse.component.ts — updated: ToastService + ConfirmService
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService }       from '../../core/services/api.service';
import { DateFilterService } from '../../core/services/date-filter.service';
import { ToastService }     from '../../core/services/toast.service';
import { ConfirmService }   from '../../core/services/confirm.service';
import { InventoryItem, MovementType } from '../../core/models/interfaces';

@Component({
  selector: 'app-warehouse',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './warehouse.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  items:      InventoryItem[] = [];
  categories: any[]           = [];
  loading  = true;
  saving   = false;
  search   = '';
  lowStockOnly = false;

  showItemModal  = false;
  editingItem:   InventoryItem | null = null;
  itemForm:      any = this.emptyItemForm();

  showMovementModal = false;
  movementItem: InventoryItem | null = null;
  movementForm: { type: MovementType; quantity: number; reference: string; reason: string } = {
    type: 'IN', quantity: 1, reference: '', reason: ''
  };

  movementTypes = [
    { value: 'IN'         as MovementType, label: 'Stock In',  color: '#10B981' },
    { value: 'OUT'        as MovementType, label: 'Stock Out', color: '#EF4444' },
    { value: 'TRANSFER'   as MovementType, label: 'Transfer',  color: '#0288D1' },
    { value: 'ADJUSTMENT' as MovementType, label: 'Adjust',    color: '#F59E0B' },
    { value: 'RETURN'     as MovementType, label: 'Return',    color: '#8B5CF6' },
  ];

  get totalItems():   number { return this.items.length; }
  get healthyItems(): number { return this.items.filter(i => i.quantity > i.reorder_point).length; }
  get lowItems():     number { return this.items.filter(i => i.quantity > 0 && i.quantity <= i.reorder_point).length; }
  get outOfStock():   number { return this.items.filter(i => i.quantity === 0).length; }

  async exportWarehouse(format: 'xlsx' | 'pdf' | 'docx'): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const url = `${this.api.baseUrl}/export/warehouse?format=${format}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `warehouse_inventory.${format}`;
      a.click();
      URL.revokeObjectURL(href);
      this.toast.success('Warehouse report exported.');
    } catch {
      this.toast.error('Warehouse export failed.');
    }
  }

  constructor(
    private api:     ApiService,
    private dateFilter: DateFilterService,
    private toast:   ToastService,
    private confirm: ConfirmService,
    private cdr:     ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.get<any>('/warehouse/categories').subscribe({
      next: r => { this.categories = r?.data || []; this.cdr.markForCheck(); }
    });
    this.dateFilter.range$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadItems());
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  loadItems(): void {
    this.loading = true;
    this.api.get<any>('/warehouse', { search: this.search, low_stock: this.lowStockOnly ? 'true' : '', limit: 100 }).subscribe({
      next: r => { this.items = r?.data?.items || r?.data || []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  toggleLowStock(): void { this.lowStockOnly = !this.lowStockOnly; this.loadItems(); }

  private emptyItemForm() {
    return { category_id: null, sku:'', name:'', description:'', unit:'pcs',
             quantity:0, min_stock:0, max_stock:null, reorder_point:0, unit_cost:null, supplier:'' };
  }

  openItemModal(item?: InventoryItem): void {
    if (item) {
      this.editingItem = item;
      this.itemForm = {
        category_id:   (item as any).category_id ?? null,
        sku: item.sku, name: item.name, description: item.description ?? '',
        unit: item.unit, quantity: item.quantity, min_stock: item.min_stock,
        max_stock: item.max_stock ?? null, reorder_point: item.reorder_point,
        unit_cost: item.unit_cost ?? null, supplier: item.supplier ?? '',
      };
    } else {
      this.editingItem = null; this.itemForm = this.emptyItemForm();
    }
    this.showItemModal = true; this.cdr.markForCheck();
  }

  editItem(item: InventoryItem): void { this.openItemModal(item); }

  closeItemModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showItemModal = false;
  }

  saveItem(): void {
    if (!this.itemForm.name?.trim())  { this.toast.warning('Item name is required.'); return; }
    if (!this.itemForm.sku?.trim())   { this.toast.warning('SKU is required.'); return; }
    if (!this.editingItem && !this.itemForm.category_id) { this.toast.warning('Please select a category.'); return; }

    this.saving = true;
    const isEdit = !!this.editingItem;
    const req$   = isEdit
      ? this.api.put<any>(`/warehouse/${this.editingItem!.id}`, this.itemForm)
      : this.api.post<any>('/warehouse', this.itemForm);

    req$.subscribe({
      next: () => {
        this.saving = false; this.showItemModal = false; this.loadItems();
        this.toast.success(isEdit ? 'Item updated.' : 'Item created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save item.');
        this.cdr.markForCheck();
      }
    });
  }

  async deleteItem(item: InventoryItem): Promise<void> {
    const ok = await this.confirm.confirm(`Delete "${item.name}"? This cannot be undone.`, 'Delete Item');
    if (!ok) return;
    this.api.put<any>(`/warehouse/${item.id}`, { is_active: false }).subscribe({
      next: () => { this.loadItems(); this.toast.success('Item deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  openMovementModal(item: InventoryItem): void {
    this.movementItem = item;
    this.movementForm = { type:'IN', quantity:1, reference:'', reason:'' };
    this.showMovementModal = true; this.cdr.markForCheck();
  }

  closeMovementModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showMovementModal = false;
  }

  getProjectedQty(): number {
    if (!this.movementItem) return 0;
    const q = this.movementForm.quantity || 0;
    switch (this.movementForm.type) {
      case 'IN': case 'RETURN':    return this.movementItem.quantity + q;
      case 'OUT': case 'TRANSFER': return this.movementItem.quantity - q;
      case 'ADJUSTMENT':           return q;
      default:                     return this.movementItem.quantity;
    }
  }

  getProjectedColor(): string { return this.getProjectedQty() < 0 ? '#EF4444' : '#10B981'; }

  submitMovement(): void {
    if (!this.movementItem || !this.movementForm.quantity) return;
    this.saving = true;
    this.api.post<any>(`/warehouse/${this.movementItem.id}/movement`, this.movementForm).subscribe({
      next: () => {
        this.saving = false; this.showMovementModal = false; this.loadItems();
        this.toast.success('Stock movement recorded.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to record movement.');
        this.cdr.markForCheck();
      }
    });
  }

  getStockColor(i: InventoryItem): string {
    if (i.quantity === 0) return '#EF4444';
    if (i.quantity <= i.reorder_point) return '#F59E0B';
    return '#10B981';
  }
  getStockStatus(i: InventoryItem): string {
    if (i.quantity === 0) return 'Out of Stock';
    if (i.quantity <= i.reorder_point) return 'Low Stock';
    return 'In Stock';
  }
  getStockBadgeBg(i: InventoryItem): string {
    if (i.quantity === 0) return '#FEE2E2';
    if (i.quantity <= i.reorder_point) return '#FEF3C7';
    return '#DCFCE7';
  }
}


