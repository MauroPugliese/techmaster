import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/ui-customization.service';
import {
  InventoryItem,
  Simulator,
  WarehouseLocation,
  WarehouseStockStatus,
  WarehouseSummary
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { WarehouseInventoryComponent } from './inventory/warehouse-inventory.component';
import { WarehouseMovementsComponent } from './movements/warehouse-movements.component';
import { WarehouseReorderComponent } from './reorder/warehouse-reorder.component';
import { MovementPreset, WarehouseModalsComponent } from './modals/warehouse-modals.component';
import { formatMoney } from './warehouse-helpers';

export type WarehouseTab = 'inventory' | 'movements' | 'reorder';

@Component({
  selector: 'app-warehouse',
  standalone: true,
  imports: [
    CommonModule,
    ExportMenuComponent,
    WarehouseInventoryComponent,
    WarehouseMovementsComponent,
    WarehouseReorderComponent,
    WarehouseModalsComponent
  ],
  templateUrl: './warehouse.component.html',
  styleUrls: ['./warehouse.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseComponent implements OnInit, OnDestroy {
  @ViewChild(WarehouseModalsComponent) modals?: WarehouseModalsComponent;

  private destroy$ = new Subject<void>();

  activeTab: WarehouseTab = 'inventory';
  refreshTick = 0;

  categories: any[] = [];
  locations: WarehouseLocation[] = [];
  suppliers: string[] = [];
  simulators: Simulator[] = [];
  uiPrefs: UiSectionPreferences | null = null;
  summary: WarehouseSummary | null = null;

  externalSearch = '';
  externalStatusFilter: 'all' | WarehouseStockStatus = 'all';
  externalLocationFilter: string | number = '';
  exportParams: Record<string, any> = {};
  private actionHandled = false;

  constructor(
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.uiCustomization.load('warehouse').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const tab = qp['tab'];
      if (tab === 'inventory' || tab === 'movements' || tab === 'reorder') {
        this.activeTab = tab;
      }

      if (qp['search'] !== undefined) {
        this.externalSearch = String(qp['search'] || '');
        if (!tab && this.externalSearch) {
          this.activeTab = 'inventory';
        }
      }

      const st = qp['status'];
      if (st === 'all' || st === 'healthy' || st === 'low' || st === 'out' || st === 'overstock') {
        this.externalStatusFilter = st;
      } else if (qp['filter'] === 'low_stock' || st === 'LOW_STOCK') {
        this.externalStatusFilter = 'low';
      }

      if (qp['location_id'] !== undefined) {
        const rawLoc = qp['location_id'];
        this.externalLocationFilter = rawLoc === 'unassigned' ? 'unassigned' : (Number(rawLoc) || '');
      }

      const act = qp['action'];
      if (act === 'movement') {
        this.activeTab = 'movements';
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { action: null, tab: 'movements' },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      } else if (act === 'new' && !this.actionHandled) {
        this.actionHandled = true;
        setTimeout(() => {
          this.openAddItem();
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { action: null },
            queryParamsHandling: 'merge',
            replaceUrl: true
          });
        }, 0);
      }

      this.cdr.markForCheck();
    });

    this.loadReferenceData();
    this.loadSummary();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadReferenceData(): void {
    this.api.get<any>('/warehouse/categories').subscribe({
      next: r => { this.categories = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/warehouse/locations').subscribe({
      next: r => { this.locations = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/warehouse/suppliers').subscribe({
      next: r => { this.suppliers = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/simulators').subscribe({
      next: r => { this.simulators = r?.data || []; this.cdr.markForCheck(); }
    });
  }

  loadSummary(): void {
    this.api.get<any>('/warehouse/summary').subscribe({
      next: r => {
        this.summary = r?.data || null;
        this.cdr.markForCheck();
      }
    });
  }

  selectTab(tab: WarehouseTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge'
    });
  }

  filterByKpi(targetStatus: 'all' | WarehouseStockStatus): void {
    const next = targetStatus !== 'all' && this.externalStatusFilter === targetStatus
      ? 'all'
      : targetStatus;
    this.externalStatusFilter = next;
    if (this.activeTab !== 'inventory') {
      this.selectTab('inventory');
    }
    this.cdr.markForCheck();
  }

  onStatusFilterFromChild(status: 'all' | WarehouseStockStatus): void {
    this.externalStatusFilter = status;
  }

  get reorderBadgeCount(): number {
    if (!this.summary) return 0;
    return (this.summary.low_count || 0) + (this.summary.out_of_stock_count || 0);
  }

  money(val: number | null | undefined): string {
    return formatMoney(val);
  }

  // ── Modal Delegation ───────────────────────────────────────────────────────
  openAddItem(): void {
    this.modals?.openItemModal();
  }

  openEditItem(item: InventoryItem): void {
    this.modals?.openItemModal(item);
  }

  openDetail(item: InventoryItem): void {
    this.modals?.openDetailModal(item);
  }

  openMovement(evt: { item: InventoryItem; preset?: MovementPreset }): void {
    this.modals?.openMovementModal(evt.item, evt.preset);
  }

  openQuickRestock(evt: { item: InventoryItem; quantity: number }): void {
    this.modals?.openMovementModal(evt.item, {
      type: 'IN',
      quantity: evt.quantity,
      reference: 'RESTOCK',
      reason: 'Replenishment from Reorder Planner'
    });
  }

  openHistory(item: InventoryItem): void {
    this.modals?.openHistoryModal(item);
  }

  deleteItem(item: InventoryItem): void {
    this.modals?.deleteItem(item);
  }

  onMutated(): void {
    this.refreshTick += 1;
    this.loadSummary();
    this.loadReferenceData();
    this.cdr.markForCheck();
  }
}
