import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService, ConfirmService, ToastService } from '../../core/services/services';
import {
  Simulator,
  SimulatorPlatformCategory,
  SimulatorStationKind,
  SimulatorStatus
} from '../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { SimulatorFormModalComponent } from './modals/simulator-form-modal.component';
import { StationMntRecordsModalComponent } from './modals/station-mnt-records-modal.component';
import { StationDailyOpsComponent } from './daily-ops/station-daily-ops.component';
import { SimulatorWorkspaceComponent, SimulatorWorkspaceTab } from './workspace/simulator-workspace.component';
import {
  SIM_CATEGORY_LABELS,
  SIM_STATUS_META,
  STATION_KIND_LABELS,
  formatCertExpiryBadge
} from './simulator-helpers';

export interface FleetApiSummary {
  total_simulators: number;
  ready_count: number;
  in_sortie_count: number;
  degraded_count: number;
  aog_or_maint_count: number;
  today_flight_hours: number;
  avg_dispatch_reliability_pct: number;
  qtg_compliance_pct: number;
  cert_expiring_count: number;
  open_snags_count: number;
}

export type SimulatorTopView = 'test-places' | 'ios-consoles' | 'fleet';

const VALID_TABS: SimulatorWorkspaceTab[] = ['overview', 'subsystems', 'qtg', 'maintenance', 'sorties'];
const VALID_TOP_VIEWS: SimulatorTopView[] = ['test-places', 'ios-consoles', 'fleet'];

@Component({
  selector: 'app-simulators',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    DropdownComponent,
    DropdownOptionComponent,
    ExportMenuComponent,
    SimulatorFormModalComponent,
    StationMntRecordsModalComponent,
    StationDailyOpsComponent,
    SimulatorWorkspaceComponent
  ],
  templateUrl: './simulators.component.html',
  styleUrls: ['./simulators.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SimulatorsComponent implements OnInit, OnDestroy {
  @ViewChild('formModal') formModal?: SimulatorFormModalComponent;
  @ViewChild('mntRecordsModal') mntRecordsModal?: StationMntRecordsModalComponent;

  private destroy$ = new Subject<void>();
  private loadSeq = 0;

  activeView: SimulatorTopView = 'test-places';
  dailyRefreshTick = 0;
  dailyInitialDate: string | null = null;

  simulators: Simulator[] = [];
  filtered: Simulator[] = [];
  testPlaceCount = 0;
  iosConsoleCount = 0;
  ffsBayCount = 0;
  fleetExportParams: Record<string, string> = {};
  loadError = false;
  summary: FleetApiSummary = {
    total_simulators: 0,
    ready_count: 0,
    in_sortie_count: 0,
    degraded_count: 0,
    aog_or_maint_count: 0,
    today_flight_hours: 0,
    avg_dispatch_reliability_pct: 100,
    qtg_compliance_pct: 100,
    cert_expiring_count: 0,
    open_snags_count: 0
  };

  loading = true;
  viewMode: 'cards' | 'table' = 'cards';
  searchQuery = '';
  stationKindFilter: 'ALL' | SimulatorStationKind = 'ALL';
  categoryFilter: 'ALL' | SimulatorPlatformCategory = 'ALL';
  statusFilter: 'ALL' | 'READY_GROUP' | 'ATTENTION_GROUP' | SimulatorStatus = 'ALL';

  selectedSimId: number | null = null;
  workspaceTab: SimulatorWorkspaceTab = 'overview';
  private pendingCreateAction = false;

  readonly stationKindOptions: Array<{ value: SimulatorStationKind; label: string }> = [
    { value: 'FFS_BAY', label: STATION_KIND_LABELS.FFS_BAY },
    { value: 'TEST_PLACE', label: STATION_KIND_LABELS.TEST_PLACE },
    { value: 'IOS_CONSOLE', label: STATION_KIND_LABELS.IOS_CONSOLE }
  ];

  readonly categoryOptions: Array<{ value: SimulatorPlatformCategory; label: string }> = [
    { value: 'COMMERCIAL_FIXED_WING', label: SIM_CATEGORY_LABELS.COMMERCIAL_FIXED_WING },
    { value: 'ROTORCRAFT', label: SIM_CATEGORY_LABELS.ROTORCRAFT },
    { value: 'DEFENSE_FMS', label: SIM_CATEGORY_LABELS.DEFENSE_FMS },
    { value: 'FTD_FNPT', label: SIM_CATEGORY_LABELS.FTD_FNPT }
  ];

  readonly statusOptions: Array<{ value: SimulatorStatus; label: string }> = [
    { value: 'READY', label: 'Ready' },
    { value: 'IN_SORTIE', label: 'In Sortie' },
    { value: 'PRE_FLIGHT', label: 'Pre-Flight' },
    { value: 'DEGRADED', label: 'Degraded' },
    { value: 'MAINTENANCE', label: 'Maintenance' },
    { value: 'AOG', label: 'AOG / Down' }
  ];

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const rawId = params['id'] ?? params['simulatorId'];
      const idParam = rawId ? Number(rawId) : null;
      const tabParam = params['tab'] as SimulatorWorkspaceTab | undefined;
      const viewParam = params['view'] as SimulatorTopView | undefined;
      const dateParam = typeof params['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params['date'])
        ? params['date']
        : null;

      if (tabParam && VALID_TABS.includes(tabParam)) {
        this.workspaceTab = tabParam;
      } else if (!idParam) {
        this.workspaceTab = 'overview';
      }
      this.selectedSimId = idParam && Number.isFinite(idParam) ? idParam : null;
      if (viewParam && VALID_TOP_VIEWS.includes(viewParam)) {
        this.activeView = viewParam;
      }
      if (dateParam) {
        this.dailyInitialDate = dateParam;
      }

      if (params['action'] === 'new') {
        this.pendingCreateAction = true;
        this.router.navigate([], {
          queryParams: { action: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
        setTimeout(() => this.consumePendingCreate(), 0);
      }

      this.cdr.markForCheck();
    });

    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get activeViewDescription(): string {
    if (this.activeView === 'test-places') {
      return 'Monitor daily shift status across all Test Places, bulk-set session hours, record handover notes and inspect MNT history.';
    }
    if (this.activeView === 'ios-consoles') {
      return 'Monitor daily shift status across all IOS Consoles, bulk-set session hours, record handover notes and inspect MNT history.';
    }
    return 'Manage simulator bays, Test Places and IOS Consoles configuration, readiness telemetry and technical dossiers.';
  }

  get hasActiveFleetFilters(): boolean {
    return (
      this.searchQuery.trim() !== '' ||
      this.stationKindFilter !== 'ALL' ||
      this.categoryFilter !== 'ALL' ||
      this.statusFilter !== 'ALL'
    );
  }

  private recomputeStationCounts(): void {
    let tp = 0;
    let ios = 0;
    let ffs = 0;
    for (const s of this.simulators) {
      const k = s.station_kind || 'FFS_BAY';
      if (k === 'TEST_PLACE') tp += 1;
      else if (k === 'IOS_CONSOLE') ios += 1;
      else ffs += 1;
    }
    this.testPlaceCount = tp;
    this.iosConsoleCount = ios;
    this.ffsBayCount = ffs;
  }

  private syncFleetExportParams(): void {
    const p: Record<string, string> = {};
    if (this.stationKindFilter !== 'ALL') p['station_kind'] = this.stationKindFilter;
    if (this.categoryFilter !== 'ALL') p['platform_category'] = this.categoryFilter;
    if (this.statusFilter !== 'ALL') p['status'] = this.statusFilter;
    if (this.searchQuery.trim()) p['search'] = this.searchQuery.trim();
    this.fleetExportParams = p;
  }

  loadData(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.cdr.markForCheck();

    forkJoin({
      list: this.api.get<any>('/simulators').pipe(catchError(() => of({ __error: true, data: [] }))),
      sum: this.api.get<any>('/simulators/summary').pipe(catchError(() => of({ __error: true, data: null })))
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ list, sum }) => {
        if (seq !== this.loadSeq) return;
        if (list?.__error) {
          this.loadError = true;
          this.toast.error('Failed to load simulator fleet.');
        } else {
          this.loadError = false;
          this.simulators = list?.data || [];
        }
        if (sum?.data) {
          this.summary = sum.data;
        }
        this.recomputeStationCounts();
        this.applyFilters();
        this.loading = false;
        this.consumePendingCreate();
        this.cdr.markForCheck();
      },
      error: () => {
        if (seq !== this.loadSeq) return;
        this.loading = false;
        this.loadError = true;
        this.toast.error('Failed to load simulator fleet.');
        this.cdr.markForCheck();
      }
    });
  }

  setTopView(view: SimulatorTopView): void {
    this.activeView = view;
    this.router.navigate([], {
      queryParams: { view },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.cdr.markForCheck();
  }

  private consumePendingCreate(): void {
    if (this.pendingCreateAction && this.formModal) {
      this.pendingCreateAction = false;
      this.selectedSimId = null;
      const defaultKind: SimulatorStationKind =
        this.activeView === 'test-places'
          ? 'TEST_PLACE'
          : this.activeView === 'ios-consoles'
            ? 'IOS_CONSOLE'
            : 'FFS_BAY';
      this.formModal.open(null, defaultKind, this.simulators);
      this.cdr.markForCheck();
    }
  }

  applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    this.filtered = this.simulators.filter((sim) => {
      const kind = sim.station_kind || 'FFS_BAY';
      if (this.stationKindFilter !== 'ALL' && kind !== this.stationKindFilter) {
        return false;
      }

      if (this.categoryFilter !== 'ALL' && sim.platform_category !== this.categoryFilter) {
        return false;
      }

      if (this.statusFilter === 'READY_GROUP') {
        if (!['READY', 'IN_SORTIE', 'PRE_FLIGHT'].includes(sim.status)) return false;
      } else if (this.statusFilter === 'ATTENTION_GROUP') {
        if (!['DEGRADED', 'MAINTENANCE', 'AOG'].includes(sim.status)) return false;
      } else if (this.statusFilter !== 'ALL' && sim.status !== this.statusFilter) {
        return false;
      }

      if (q) {
        const hay = [
          sim.code,
          sim.name,
          sim.bay_code,
          sim.aircraft_type,
          sim.certificate_code,
          sim.authority,
          sim.manufacturer
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
    this.syncFleetExportParams();
    this.cdr.markForCheck();
  }

  applyKpiFilter(target: 'ALL' | 'READY_GROUP' | 'ATTENTION_GROUP'): void {
    this.statusFilter = this.statusFilter === target ? 'ALL' : target;
    this.applyFilters();
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.stationKindFilter = 'ALL';
    this.categoryFilter = 'ALL';
    this.statusFilter = 'ALL';
    this.applyFilters();
  }

  openCreateModal(kind?: SimulatorStationKind): void {
    const resolved: SimulatorStationKind =
      kind ||
      (this.activeView === 'test-places'
        ? 'TEST_PLACE'
        : this.activeView === 'ios-consoles'
          ? 'IOS_CONSOLE'
          : 'FFS_BAY');
    this.formModal?.open(null, resolved, this.simulators);
  }

  openEditModal(sim: Simulator, event?: Event): void {
    event?.stopPropagation();
    this.formModal?.open(sim, sim.station_kind || 'FFS_BAY', this.simulators);
  }

  onSimulatorSaved(saved: Simulator): void {
    this.api.notifyNavBadgesChanged();
    this.loadData();
    this.dailyRefreshTick += 1;
    if (this.selectedSimId && saved?.id === this.selectedSimId) {
      const current = this.selectedSimId;
      this.selectedSimId = null;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.selectedSimId = current;
        this.cdr.markForCheck();
      }, 0);
    }
  }

  onOpenMntRecords(ev: { simulatorId: number; stationName: string }, domEvent?: Event): void {
    domEvent?.stopPropagation();
    this.mntRecordsModal?.open(ev.simulatorId, ev.stationName);
  }

  onDailySheetUpdated(): void {
    this.api.notifyNavBadgesChanged();
    this.api.get<any>('/simulators/summary').pipe(catchError(() => of({ data: null })), takeUntil(this.destroy$)).subscribe((sum) => {
      if (sum?.data) {
        this.summary = sum.data;
        this.cdr.markForCheck();
      }
    });
  }

  onMntMutated(): void {
    this.api.notifyNavBadgesChanged();
    this.loadData();
    this.dailyRefreshTick += 1;
  }

  openWorkspace(simId: number, tab: SimulatorWorkspaceTab = 'overview', event?: Event): void {
    event?.stopPropagation();
    this.workspaceTab = tab;
    this.selectedSimId = simId;
    this.router.navigate([], {
      queryParams: { id: simId, tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.cdr.markForCheck();
  }

  onWorkspaceTabChanged(tab: SimulatorWorkspaceTab): void {
    this.workspaceTab = tab;
    if (this.selectedSimId !== null) {
      this.router.navigate([], {
        queryParams: { tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  closeWorkspace(): void {
    this.selectedSimId = null;
    this.router.navigate([], {
      queryParams: { id: null, tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.loadData();
  }

  scheduleSortie(sim: Simulator, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/operations'], {
      queryParams: { simulatorId: sim.id, action: 'new' }
    });
  }

  quickChangeStatus(sim: Simulator, status: SimulatorStatus): void {
    if (!sim || sim.status === status) return;
    this.api.patch<any>(`/simulators/${sim.id}/status`, { status }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.api.notifyNavBadgesChanged();
        this.toast.success(`${sim.code} status updated to ${status}.`);
        this.loadData();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to update simulator status.')
    });
  }

  async deleteSimulator(sim: Simulator, event?: Event): Promise<void> {
    event?.stopPropagation();
    const ok = await this.confirm.confirm(
      `Remove "${sim.code} (${sim.name})" from the training center fleet? Existing sorties will retain historical bay references as null.`,
      'Delete Simulator / Station',
      true
    );
    if (!ok) return;

    this.api.delete(`/simulators/${sim.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.api.notifyNavBadgesChanged();
        this.toast.success(`Station ${sim.code} removed.`);
        this.dailyRefreshTick += 1;
        if (this.selectedSimId === sim.id) {
          this.closeWorkspace();
        } else {
          this.loadData();
        }
      },
      error: (err) => this.toast.error(err?.error?.message || 'Unable to delete simulator.')
    });
  }

  statusMeta(st?: SimulatorStatus) {
    return SIM_STATUS_META[st || 'READY'] || SIM_STATUS_META.READY;
  }

  stationKindLabel(kind?: SimulatorStationKind): string {
    return STATION_KIND_LABELS[kind || 'FFS_BAY'] || 'FFS Simulator Bay';
  }

  categoryLabel(cat?: SimulatorPlatformCategory): string {
    return SIM_CATEGORY_LABELS[cat || 'COMMERCIAL_FIXED_WING'] || cat || 'FFS';
  }

  certBadge(sim: Simulator) {
    return formatCertExpiryBadge(sim.telemetry?.certificate || null);
  }

  utilizationWidth(sim: Simulator): number {
    const pct = sim.telemetry?.bayUtilizationPct ?? 0;
    return Math.min(100, Math.max(0, pct));
  }

  trackBySimId(_: number, s: Simulator): number {
    return s.id;
  }
}
