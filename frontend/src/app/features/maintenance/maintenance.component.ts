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
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ApiService, AuthService, SocketService, UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import {
  Asset,
  AssetCategory,
  InventoryItem,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceSummary,
  Simulator
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { MaintenanceWorkOrdersComponent } from './work-orders/maintenance-work-orders.component';
import { MaintenanceAssetsComponent } from './assets/maintenance-assets.component';
import { MaintenanceQtgComponent } from './qtg/maintenance-qtg.component';
import { MaintenanceModalsComponent } from './modals/maintenance-modals.component';

export type MaintenanceTab = 'work-orders' | 'assets' | 'qtg';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [
    CommonModule,
    ExportMenuComponent,
    MaintenanceWorkOrdersComponent,
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

  private destroy$ = new Subject<void>();

  activeTab: MaintenanceTab = 'work-orders';
  refreshTick = 0;

  simulators: Simulator[] = [];
  assets: Asset[] = [];
  assetCategories: AssetCategory[] = [];
  warehouseItems: InventoryItem[] = [];
  uiPrefs: UiSectionPreferences | null = null;

  maintSummary: MaintenanceSummary | null = null;
  workOrdersExportParams: Record<string, any> = {};
  externalStatusFilter = '';
  externalSearch = '';
  externalSimulatorId: number | null = null;
  private actionHandled = false;

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private socketService: SocketService,
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
      if (tab === 'planned') {
        this.router.navigate(['/maintenance/planned'], { replaceUrl: true });
        return;
      }
      if (tab === 'work-orders' || tab === 'assets' || tab === 'qtg') {
        this.activeTab = tab;
      }
      if (qp['simulatorId'] !== undefined) {
        const simId = Number(qp['simulatorId']);
        this.externalSimulatorId = Number.isFinite(simId) && simId > 0 ? simId : null;
      } else {
        this.externalSimulatorId = null;
      }
      if (qp['status'] !== undefined) {
        const st = String(qp['status'] || '').toUpperCase();
        if (['', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DEFERRED', 'OVERDUE'].includes(st)) {
          this.externalStatusFilter = st;
        }
      } else {
        this.externalStatusFilter = '';
      }
      if (qp['search'] !== undefined) {
        this.externalSearch = String(qp['search'] || '');
      } else {
        this.externalSearch = '';
      }
      if (qp['action'] !== 'new') {
        this.actionHandled = false;
      }
      if (qp['action'] === 'new' && !this.actionHandled && this.auth.canWrite) {
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

    this.socketService.domainUpdates$
      .pipe(debounceTime(450), takeUntil(this.destroy$))
      .subscribe(evt => {
        const d = evt?.domain;
        if (!d || d === 'maintenance' || d === 'simulators') {
          this.refreshTick += 1;
          this.api.get<any>('/maintenance/summary').pipe(takeUntil(this.destroy$)).subscribe({
            next: r => { this.maintSummary = r?.data || null; this.cdr.markForCheck(); }
          });
          this.cdr.markForCheck();
        }
      });

    this.loadReferenceData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadReferenceData(): void {
    this.api.get<any>('/simulators').pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.simulators = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/assets').pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.assets = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/asset-categories').pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.assetCategories = r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/warehouse', { limit: 500, page: 1 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.warehouseItems = r?.data?.items || r?.data || []; this.cdr.markForCheck(); }
    });
    this.api.get<any>('/maintenance/summary').pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.maintSummary = r?.data || null; this.cdr.markForCheck(); }
    });
  }

  selectTab(tab: MaintenanceTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.router.navigate(['/maintenance'], { queryParams: { tab } });
  }

  // ── Header Primary CTA ─────────────────────────────────────────────────────
  get primaryActionLabel(): string {
    if (this.activeTab === 'assets') return 'Add Asset';
    return 'Log Work Order / DR';
  }

  triggerPrimaryAction(): void {
    if (this.activeTab === 'assets') {
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

  createWorkOrderFromQtg(qtg: any): void {
    const catToSub: Record<string, any> = {
      MOTION_CUEING: 'MOTION',
      VISUAL_SYSTEM: 'VISUAL',
      SOUND: 'SOUND',
      IOS_NAV: 'IOS',
      HANDLING: 'CONTROL_LOADING',
      PERFORMANCE: 'HOST_COMPUTE'
    };
    this.modals?.openRecordModal(undefined, {
      simulator_id: qtg.simulator_id,
      subsystem_code: catToSub[qtg.category] || 'HOST_COMPUTE',
      is_snag: true,
      severity: 'DEGRADED',
      type: 'CORRECTIVE',
      priority: 'HIGH',
      status: 'SCHEDULED',
      title: `QTG Failure: ${qtg.test_code} — ${qtg.title}`,
      description: `Failed ${qtg.quarter} ${qtg.year} QTG (${qtg.test_code}). Measured delta: ${qtg.measured_delta || 'Out of tolerance'}. ${qtg.notes || ''}`.trim(),
      scheduled_date: new Date().toISOString()
    });
  }

  onMutated(): void {
    this.refreshTick += 1;
    this.api.notifyNavBadgesChanged();
    this.api.get<any>('/maintenance/summary').pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.maintSummary = r?.data || null; this.cdr.markForCheck(); }
    });
    this.cdr.markForCheck();
  }

  onAssetsMutated(): void {
    this.loadReferenceData();
    this.api.notifyNavBadgesChanged();
    this.cdr.markForCheck();
  }
}
