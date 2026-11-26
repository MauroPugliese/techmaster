import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import { DateFilterService } from '../../core/services/date-filter.service';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/ui-customization.service';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { ExecutiveOverviewChartsComponent } from './components/executive-overview/executive-overview-charts.component';
import { OperationsDeepDiveComponent } from './components/operations-deep-dive/operations-deep-dive.component';
import { MaintenanceAnalyticsComponent } from './components/maintenance-analytics/maintenance-analytics.component';
import { WorkforceWarehouseAnalyticsComponent } from './components/workforce-warehouse-analytics/workforce-warehouse-analytics.component';
import { ReportsCenterComponent } from './components/reports-center/reports-center.component';
import {
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsTab,
  formatCurrency,
  formatDelta,
  formatDowntimeHours
} from './analytics-helpers';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    CommonModule,
    ExportMenuComponent,
    ExecutiveOverviewChartsComponent,
    OperationsDeepDiveComponent,
    MaintenanceAnalyticsComponent,
    WorkforceWarehouseAnalyticsComponent,
    ReportsCenterComponent
  ],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private reload$ = new Subject<void>();

  activeTab: AnalyticsTab = 'overview';
  period: AnalyticsPeriod = 'all';
  loading = true;
  dateLabel = 'All time';
  uiPrefs: UiSectionPreferences | null = null;
  overview: AnalyticsOverview | null = null;
  readonly emptyArr: any[] = [];
  exportMenuParams: Record<string, string | number | boolean | null | undefined> = {};

  readonly periodOptions: Array<{ value: AnalyticsPeriod; label: string }> = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' }
  ];

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const tab = qp['tab'];
      if (tab === 'overview' || tab === 'operations' || tab === 'maintenance' || tab === 'workforce' || tab === 'reports') {
        this.activeTab = tab;
      }
      this.cdr.markForCheck();
    });

    this.uiCustomization.load('analytics').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.reload$
      .pipe(
        debounceTime(40),
        switchMap(() => {
          this.loading = true;
          this.dateLabel = this.buildScopeLabel();
          this.exportMenuParams = (this.period === 'all' || this.period === 'custom') ? {} : { period: this.period };
          this.cdr.markForCheck();

          const apiPeriod = this.period === 'custom' ? 'all' : this.period;
          return this.api
            .get<any>('/analytics/overview', { period: apiPeriod }, this.dateFilter.currentRange)
            .pipe(catchError(() => of(null)));
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(res => {
        this.overview = res?.data || null;
        this.loading = false;
        this.cdr.markForCheck();
      });

    this.dateFilter.range$
      .pipe(debounceTime(80), takeUntil(this.destroy$))
      .subscribe(range => {
        if (range?.from || range?.to) {
          this.period = 'custom';
        } else if (this.period === 'custom') {
          this.period = 'all';
        }
        this.reload$.next();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectTab(tab: AnalyticsTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  selectPeriod(next: AnalyticsPeriod): void {
    this.period = next;
    if (this.dateFilter.currentRange.from || this.dateFilter.currentRange.to) {
      this.dateFilter.clearRange();
      return;
    }
    this.reload$.next();
  }

  private buildScopeLabel(): string {
    const global = this.dateFilter.getLabel();
    if (global !== 'All time') return global;
    const labels: Record<AnalyticsPeriod, string> = {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '90d': 'Last 90 days',
      ytd: 'Year to date',
      all: 'All time (last 30d series)',
      custom: global
    };
    return labels[this.period];
  }

  get kpis() {
    return this.overview?.kpis;
  }

  get deltas() {
    return this.overview?.deltas;
  }

  money(val?: number | null): string {
    return formatCurrency(val);
  }

  downtimeLabel(hours?: number | null): string {
    return formatDowntimeHours(hours);
  }

  deltaLabel(delta?: number | null, suffix = '%'): string {
    return formatDelta(delta, suffix);
  }

  deltaClass(delta: number | null | undefined, inverse = false): string {
    if (delta === null || delta === undefined || delta === 0) return '';
    const favorable = inverse ? delta < 0 : delta > 0;
    return favorable ? 'is-good' : 'is-bad';
  }

  exportJson(): void {
    if (!this.overview) return;
    const payload = {
      generated: new Date().toISOString(),
      scope: this.dateLabel,
      overview: this.overview
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `smart-analytics-${new Date().toISOString().slice(0, 10)}.json`
    });
    a.click();
    URL.revokeObjectURL(url);
  }
}
