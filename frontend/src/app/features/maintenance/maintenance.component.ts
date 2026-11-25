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
import { ApiService, UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import {
  Asset,
  AssetCategory,
  InventoryItem,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceSummary,
  PlannedMaintenanceSummary,
  PlannedMaintenanceTask,
  Simulator
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { MaintenanceWorkOrdersComponent } from './work-orders/maintenance-work-orders.component';
import { PlannedMaintenanceDashboardComponent } from './planned/planned-maintenance-dashboard.component';
import { MaintenanceAssetsComponent } from './assets/maintenance-assets.component';
import { MaintenanceQtgComponent } from './qtg/maintenance-qtg.component';
import { MaintenanceModalsComponent } from './modals/maintenance-modals.component';

export type MaintenanceTab = 'work-orders' | 'planned' | 'assets' | 'qtg';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [
    CommonModule,
    ExportMenuComponent,
    MaintenanceWorkOrdersComponent,
    PlannedMaintenanceDashboardComponent,
    MaintenanceAssetsComponent,
    MaintenanceQtgComponent,
    MaintenanceModalsComponent
  ],
  templateUrl: './maintenance.component.html',
  styleUrls: ['./maintenance.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceComponent implements OnInit, OnDestroy {
  @ViewChild(MaintenanceModalsComponent) modals?: MaintenanceModalsComponent;
  @ViewChild(PlannedMaintenanceDashboardComponent) plannedChild?: PlannedMaintenanceDashboardComponent;

  private destroy$ = new Subject<void>();

  activeTab: MaintenanceTab = 'work-orders';
  refreshTick = 0;

  simulators: Simulator[] = [];
  assets: Asset[] = [];
  assetCategories: AssetCategory[] = [];
  warehouseItems: InventoryItem[] = [];
  uiPrefs: UiSectionPreferences | null = null;

  maintSummary: MaintenanceSummary | null = null;
  plannedSummary: PlannedMaintenanceSummary | null = null;
  workOrdersExportParams: Record<string, any> = {};
  plannedExportParams: Record<string, any> = {};
  externalStatusFilter = '';
  externalSearch = '';
  externalSimulatorId: number | null = null;
  private actionHandled = false;

  constructor(
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const defaultTab = (this.route.snapshot.data?.['defaultTab'] as MaintenanceTab) || 'work-orders';
    this.activeTab = defaultTab;

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const tab = qp['tab'];
      if (tab === 'work-orders' || tab === 'planned' || tab === 'assets' || tab === 'qtg') {
        this.activeTab = tab;
      }
      if (qp['simulatorId'] !== undefined) {
        const simId = Number(qp['simulatorId']);
        this.externalSimulatorId = Number.isFinite(simId) && simId > 0 ? simId : null;
      }
      if (qp['status'] !== undefined) {
        const st = String(qp['status'] || '').toUpperCase();
        if (['', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DEFERRED', 'OVERDUE'].includes(st)) {
          this.externalStatusFilter = st;
        }
      }
      if (qp['search'] !== undefined) {
        this.externalSearch = String(qp['search'] || '');
      }
      if (qp['action'] === 'new' && !this.actionHandled) {
        this.actionHandled = true;
        setTimeout(() => {
          this.openAddWorkOrder();
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

    this.uiCustomization.load('maintenance').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.loadReferenceData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadReferenceData(): void {
    this.api.get<any>('/simulators').subscribe({
      next: r => { this.simulators = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/assets').subscribe({
      next: r => { this.assets = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/asset-categories').subscribe({
      next: r => { this.assetCategories = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/warehouse', { limit: 100, page: 1 }).subscribe({
      next: r => { this.warehouseItems = r?.data?.items || r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/summary').subscribe({
      next: r => { this.maintSummary = r?.data || null; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/planned/summary').subscribe({
      next: r => { this.plannedSummary = r?.data || null; this.cdr.markForCheck(); }
    });
  }

  selectTab(tab: MaintenanceTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.router.navigate(['/maintenance'], { queryParams: { tab } });
  }

  // ── Header Primary CTA ─────────────────────────────────────────────────────
  get primaryActionLabel(): string {
    if (this.activeTab === 'planned') return 'New Planned Task';
    if (this.activeTab === 'assets') return 'Add Asset';
    return 'Log Work Order / DR';
  }

  triggerPrimaryAction(): void {
    if (this.activeTab === 'planned') {
      this.plannedChild?.openModal();
    } else if (this.activeTab === 'assets') {
      this.modals?.openAssetModal();
    } else {
      this.modals?.openRecordModal(undefined, this.externalSimulatorId ? { simulator_id: this.externalSimulatorId } : undefined);
    }
  }

  // ── Modal Delegation ───────────────────────────────────────────────────────
  openAddWorkOrder(): void {
    this.modals?.openRecordModal(undefined, this.externalSimulatorId ? { simulator_id: this.externalSimulatorId } : undefined);
  }

  openEditWorkOrder(record: MaintenanceRecord): void {
    this.modals?.openRecordModal(record);
  }

  openWorkOrderDetail(record: MaintenanceRecord): void {
    this.modals?.openDetailModal(record);
  }

  changeWorkOrderStatus(evt: { record: MaintenanceRecord; status: MaintenanceStatus }): void {
    this.modals?.updateRecordStatus(evt.record, evt.status);
  }

  deleteWorkOrder(record: MaintenanceRecord): void {
    this.modals?.deleteRecord(record);
  }

  openAddAsset(): void {
    this.modals?.openAssetModal();
  }

  openEditAsset(asset: Asset): void {
    this.modals?.openAssetModal(asset);
  }

  logWorkOrderForAsset(asset: Asset): void {
    this.modals?.openRecordModal(undefined, {
      asset_id: asset.id,
      type: 'PREVENTIVE',
      status: 'SCHEDULED',
      scheduled_date: new Date().toISOString()
    });
  }

  createWorkOrderFromPlanned(evt: { task: PlannedMaintenanceTask; occurrenceDate?: string }): void {
    const task = evt.task;
    const occDate = evt.occurrenceDate || task.occurrenceDate || null;
    const scheduledIso = occDate ? `${occDate}T09:00:00.000Z` : (task.operationDateStart || new Date().toISOString());

    const descriptionLines = [
      `Generated from Planned Maintenance #${task.masterId || task.id} (${task.system} / ${task.subsystem}).`,
      task.reference ? `Reference: ${task.reference}` : null,
      occDate ? `Occurrence Date: ${occDate}` : null,
      '',
      task.task
    ].filter(v => v !== null);

    this.modals?.openRecordModal(undefined, {
      title: `${task.system}: ${String(task.task || '').slice(0, 150)}`.slice(0, 200),
      description: descriptionLines.join('\n'),
      type: 'PREVENTIVE',
      priority: 'MEDIUM',
      status: 'SCHEDULED',
      scheduled_date: scheduledIso
    });
  }

  onMutated(): void {
    this.refreshTick += 1;
    this.api.get<any>('/maintenance/summary').subscribe({
      next: r => { this.maintSummary = r?.data || null; this.cdr.markForCheck(); }
    });
    this.cdr.markForCheck();
  }

  onAssetsMutated(): void {
    this.refreshTick += 1;
    this.loadReferenceData();
    this.cdr.markForCheck();
  }
}
