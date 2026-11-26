import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { InventoryItem, WarehouseReorderItem } from '../../../core/models/interfaces';
import { formatMoney } from '../warehouse-helpers';

export interface ReorderSupplierGroup {
  supplier: string;
  items: WarehouseReorderItem[];
  totalDeficit: number;
  totalEstimatedCost: number;
}

@Component({
  selector: 'app-warehouse-reorder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './warehouse-reorder.component.html',
  styleUrls: ['./warehouse-reorder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseReorderComponent implements OnInit, OnChanges {
  @Input() refreshTick = 0;
  @Output() quickRestockRequested = new EventEmitter<{ item: InventoryItem; quantity: number }>();
  @Output() detailRequested = new EventEmitter<InventoryItem>();
  @Output() mutated = new EventEmitter<void>();

  private initialized = false;
  loading = true;
  viewMode: 'urgency' | 'supplier' = 'urgency';
  search = '';

  items: WarehouseReorderItem[] = [];
  totals = {
    items_count: 0,
    critical_count: 0,
    total_deficit_units: 0,
    total_estimated_cost: 0,
    suppliers_count: 0
  };

  creatingTaskIds = new Set<number>();
  createdTaskIds = new Set<number>();
  receivingPoIds = new Set<number>();

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.initialized = true;
    this.loadQueue();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadQueue();
    }
  }

  loadQueue(): void {
    this.loading = true;
    this.api.get<any>('/warehouse/reorder').subscribe({
      next: r => {
        this.items = r?.data?.items || [];
        if (r?.data?.totals) this.totals = r.data.totals;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  get filteredItems(): WarehouseReorderItem[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.items;
    return this.items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      (i.supplier || '').toLowerCase().includes(q) ||
      (i.location?.name || '').toLowerCase().includes(q)
    );
  }

  get supplierGroups(): ReorderSupplierGroup[] {
    const map = new Map<string, ReorderSupplierGroup>();
    for (const item of this.filteredItems) {
      const sup = (item.supplier || '').trim() || 'Unspecified Supplier';
      const existing = map.get(sup) || {
        supplier: sup,
        items: [],
        totalDeficit: 0,
        totalEstimatedCost: 0
      };
      existing.items.push(item);
      existing.totalDeficit += item.reorder_metrics.deficit;
      existing.totalEstimatedCost += item.reorder_metrics.estimated_cost || 0;
      map.set(sup, existing);
    }

    return Array.from(map.values())
      .map(g => ({ ...g, totalEstimatedCost: Number(g.totalEstimatedCost.toFixed(2)) }))
      .sort((a, b) => b.totalEstimatedCost - a.totalEstimatedCost || b.items.length - a.items.length);
  }

  urgencyBg(urgency: string): string {
    if (urgency === 'CRITICAL') return '#FEE2E2';
    if (urgency === 'HIGH') return '#FEF3C7';
    return '#E0F2FE';
  }

  urgencyColor(urgency: string): string {
    if (urgency === 'CRITICAL') return '#DC2626';
    if (urgency === 'HIGH') return '#D97706';
    return '#0288D1';
  }

  createRestockTask(item: WarehouseReorderItem): void {
    if (this.creatingTaskIds.has(item.id)) return;
    this.creatingTaskIds.add(item.id);
    this.cdr.markForCheck();

    this.api.post<any>(`/warehouse/${item.id}/restock-task`, {}).subscribe({
      next: () => {
        this.creatingTaskIds.delete(item.id);
        this.createdTaskIds.add(item.id);
        this.toast.success(`Restock task created for ${item.sku}.`);
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.creatingTaskIds.delete(item.id);
        this.toast.error(e?.error?.message || 'Failed to create restock task.');
        this.cdr.markForCheck();
      }
    });
  }

  quickRestock(item: WarehouseReorderItem): void {
    this.quickRestockRequested.emit({
      item,
      quantity: Math.max(1, item.reorder_metrics.deficit || 1)
    });
  }

  receivePo(item: WarehouseReorderItem): void {
    const qty = Math.max(0, Math.floor(Number(item.on_order_qty || 0)));
    if (qty <= 0 || this.receivingPoIds.has(item.id)) return;
    this.receivingPoIds.add(item.id);
    this.cdr.markForCheck();

    this.api.post<any>(`/warehouse/${item.id}/movement`, {
      type: 'IN',
      quantity: qty,
      reference: 'PO-RECEIPT',
      reason: `Received inbound PO (+${qty} ${item.unit || 'pcs'}) via Reorder Planner`,
      clear_on_order: true
    }).subscribe({
      next: () => {
        this.receivingPoIds.delete(item.id);
        this.toast.success(`Received +${qty} ${item.unit || 'pcs'} of ${item.sku} into stock.`);
        this.loadQueue();
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.receivingPoIds.delete(item.id);
        this.toast.error(e?.error?.message || 'Failed to receive PO.');
        this.cdr.markForCheck();
      }
    });
  }

  money(val: number | null | undefined): string {
    return formatMoney(val);
  }
}
