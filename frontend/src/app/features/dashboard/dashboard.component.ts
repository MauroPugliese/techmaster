import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subject, interval, of } from 'rxjs';
import { catchError, debounceTime, switchMap, takeUntil, timeout } from 'rxjs/operators';
import {
  ApiService,
  DateFilterService,
  UiCustomizationService,
  UiSectionPreferences
} from '../../core/services/services';
import {
  DashboardOverview,
  DashboardShiftItem
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DashboardChartsComponent } from './charts/dashboard-charts.component';
import { DashboardUrgentCenterComponent } from './urgent-center/dashboard-urgent-center.component';
import { DashboardTodayRadarComponent } from './today-radar/dashboard-today-radar.component';
import { DashboardActivityPanelComponent } from './activity-panel/dashboard-activity-panel.component';
import {
  formatCurrency,
  formatEnumLabel,
  formatShortTime,
  getShiftStatusBadge
} from './dashboard-helpers';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    RouterLink,
    ExportMenuComponent,
    DashboardChartsComponent,
    DashboardUrgentCenterComponent,
    DashboardTodayRadarComponent,
    DashboardActivityPanelComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private loadTrigger$ = new Subject<{ silent: boolean }>();
  Math = Math;

  overview: DashboardOverview | null = null;
  loading = true;
  refreshing = false;
  autoRefreshEnabled = true;
  trendDays: 7 | 30 | 90 = 30;
  lastRefreshed = new Date();
  today = new Date();
  dateFilterLabel = 'All time';
  uiPrefs: UiSectionPreferences | null = null;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.uiCustomization.load('dashboard').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.loadTrigger$
      .pipe(
        switchMap(({ silent }) => {
          this.dateFilterLabel = this.dateFilter.getLabel();
          if (!silent && !this.overview) {
            this.loading = true;
          } else {
            this.refreshing = true;
          }
          this.cdr.markForCheck();

          return this.api
            .get<any>('/dashboard/overview', { days: this.trendDays }, this.dateFilter.currentRange)
            .pipe(
              timeout(12000),
              catchError(() => of(null))
            );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(res => {
        if (res?.data) {
          this.overview = res.data;
          this.lastRefreshed = new Date();
          this.today = new Date();
        }
        this.loading = false;
        this.refreshing = false;
        this.cdr.markForCheck();
      });

    // BehaviorSubject emits initial range immediately -> triggers single clean initial fetch
    this.dateFilter.range$
      .pipe(debounceTime(120), takeUntil(this.destroy$))
      .subscribe(() => this.triggerLoad(false));

    // Silent background live refresh every 30s while tab is visible
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.autoRefreshEnabled && typeof document !== 'undefined' && !document.hidden) {
          this.triggerLoad(true);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  triggerLoad(silent: boolean): void {
    this.loadTrigger$.next({ silent });
  }

  onTrendDaysChange(days: 7 | 30 | 90): void {
    if (this.trendDays === days) return;
    this.trendDays = days;
    this.triggerLoad(true);
  }

  toggleAutoRefresh(): void {
    this.autoRefreshEnabled = !this.autoRefreshEnabled;
    this.cdr.markForCheck();
  }

  scrollToUrgent(): void {
    if (typeof document === 'undefined') return;
    document.getElementById('urgent-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  get kpis() {
    return this.overview?.kpis;
  }

  get fleet() {
    return this.overview?.fleet;
  }

  get warehouse() {
    return this.overview?.warehouse;
  }

  get fleetReadinessPct(): number {
    return this.fleet?.readinessPct ?? 100;
  }

  get fleetStatus(): 'OPTIMAL' | 'ATTENTION' | 'CRITICAL' {
    return this.fleet?.status ?? 'OPTIMAL';
  }

  get urgentTotal(): number {
    return this.overview?.alertCounts?.total ?? 0;
  }

  get hasUrgentAlerts(): boolean {
    return this.urgentTotal > 0;
  }

  get fleetActiveWidth(): number {
    const total = this.fleet?.totalAssets ?? 0;
    if (!total) return 100;
    return Math.min(100, ((this.fleet?.activeAssets ?? 0) / total) * 100);
  }

  get fleetMaintWidth(): number {
    const total = this.fleet?.totalAssets ?? 0;
    if (!total) return 0;
    return Math.min(100, ((this.fleet?.maintenanceAssets ?? 0) / total) * 100);
  }

  get fleetInactiveWidth(): number {
    const total = this.fleet?.totalAssets ?? 0;
    if (!total) return 0;
    return Math.max(0, 100 - this.fleetActiveWidth - this.fleetMaintWidth);
  }

  money(val?: number | null): string {
    return formatCurrency(val);
  }

  shiftBadge(status?: string | null): string {
    return getShiftStatusBadge(status);
  }

  enumLabel(val?: string | null): string {
    return formatEnumLabel(val);
  }

  shiftTimeWindow(shift: DashboardShiftItem): string {
    if (shift.entry_kind === 'LEAVE' || shift.shiftType?.category === 'LEAVE') {
      return shift.leave_type ? formatEnumLabel(shift.leave_type) : 'Leave';
    }
    const start = formatShortTime(shift.custom_start_time || shift.shiftType?.start_time);
    const end = formatShortTime(shift.custom_end_time || shift.shiftType?.end_time);
    return `${start} – ${end}`;
  }

  shiftInitials(shift: DashboardShiftItem): string {
    const first = shift.employee?.first_name?.trim()?.charAt(0) || '';
    const last = shift.employee?.last_name?.trim()?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }
}
