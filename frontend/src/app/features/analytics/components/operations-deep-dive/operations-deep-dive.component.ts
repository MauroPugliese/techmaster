import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap, takeUntil } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../../../core/services/api.service';
import { DateFilterService } from '../../../../core/services/date-filter.service';
import {
  AnalyticsGranularity,
  AnalyticsPeriod,
  OperationsMetricsPayload,
  formatDurationMinutes,
  formatEnumLabel,
  formatShortDateLabel
} from '../../analytics-helpers';
import {
  applySmartChartDefaults,
  SMART_CHART_FONT_FAMILY,
  SMART_CHART_GRID_COLOR,
  SMART_CHART_TEXT_COLOR
} from '../../../../shared/utils/chart-theme';

Chart.register(...registerables);
applySmartChartDefaults(Chart);

@Component({
  selector: 'app-operations-deep-dive',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './operations-deep-dive.component.html',
  styleUrls: ['./operations-deep-dive.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsDeepDiveComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('timeDistCanvas') timeDistCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('statusCanvas') statusCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() period: AnalyticsPeriod = 'all';
  @Input() embedded = true;

  private destroy$ = new Subject<void>();
  private reload$ = new Subject<void>();
  private initialized = false;
  private viewReady = false;

  loading = true;
  granularity: AnalyticsGranularity = 'day';
  readonly granularities: Array<{ value: AnalyticsGranularity; label: string }> = [
    { value: 'hour', label: 'Hour' },
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' }
  ];

  payload: OperationsMetricsPayload | null = null;
  statusLegend: Array<{ label: string; count: number; pct: number; color: string }> = [];
  statusTotal = 0;

  private trendChart: Chart | null = null;
  private timeChart: Chart | null = null;
  private statusChart: Chart | null = null;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.reload$
      .pipe(
        debounceTime(40),
        switchMap(() => {
          this.loading = true;
          this.cdr.markForCheck();
          const apiPeriod = this.period === 'custom' ? 'all' : this.period;
          return this.api
            .get<any>('/analytics/operations-metrics', {
              period: apiPeriod,
              granularity: this.granularity
            }, this.dateFilter.currentRange)
            .pipe(catchError(() => of(null)));
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(res => {
        this.payload = res?.data || null;
        this.loading = false;
        if (this.viewReady) {
          this.renderAllCharts();
        }
        this.cdr.markForCheck();
      });

    this.dateFilter.range$
      .pipe(debounceTime(80), takeUntil(this.destroy$))
      .subscribe(() => this.reload$.next());

    this.initialized = true;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCharts();
    if (this.payload) {
      this.renderAllCharts();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['period'] && !changes['period'].firstChange) {
      this.reload$.next();
    }
  }

  ngOnDestroy(): void {
    this.trendChart?.destroy();
    this.timeChart?.destroy();
    this.statusChart?.destroy();
    this.destroy$.next();
    this.destroy$.complete();
  }

  setGranularity(g: AnalyticsGranularity): void {
    if (this.granularity === g) return;
    this.granularity = g;
    this.reload$.next();
  }

  get metrics() {
    return this.payload?.metrics;
  }

  get insights() {
    return this.payload?.insights;
  }

  get hasTrendData(): boolean {
    return (this.payload?.charts?.trend || []).some(r => Number(r.count) > 0);
  }

  get hasTimeDistData(): boolean {
    return (this.payload?.charts?.timeDistribution || []).length > 0;
  }

  get hasStatusData(): boolean {
    return (this.payload?.charts?.statusBreakdown || []).some(r => Number(r.count) > 0);
  }

  dur(mins?: number | null): string {
    return formatDurationMinutes(mins);
  }

  get totalTimeLabel(): string {
    if (!this.metrics) return '0m';
    return formatDurationMinutes(this.metrics.totalMinutes);
  }

  get rangeSpanLabel(): string {
    if (!this.metrics) return '—';
    return `${formatDurationMinutes(this.metrics.minDuration)} – ${formatDurationMinutes(this.metrics.maxDuration)}`;
  }

  private initCharts(): void {
    const tickFont = { family: SMART_CHART_FONT_FAMILY, size: 11 };

    const trCtx = this.trendCanvas?.nativeElement?.getContext('2d');
    if (trCtx) {
      this.trendChart = new Chart(trCtx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 14, font: tickFont } },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: tickFont, color: SMART_CHART_TEXT_COLOR } },
            y: { beginAtZero: true, position: 'left', grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } },
            y1: {
              beginAtZero: true,
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { precision: 0, font: tickFont, callback: val => `${val}m` }
            }
          },
          elements: { line: { tension: 0.35, borderWidth: 2.2 } }
        }
      });
    }

    const tmCtx = this.timeDistCanvas?.nativeElement?.getContext('2d');
    if (tmCtx) {
      this.timeChart = new Chart(tmCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0A1628',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => ` ${formatDurationMinutes(Number(ctx.raw))}`
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: tickFont } },
            y: { beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { font: tickFont, callback: v => formatDurationMinutes(Number(v)) } }
          }
        }
      });
    }

    const stCtx = this.statusCanvas?.nativeElement?.getContext('2d');
    if (stCtx) {
      this.statusChart = new Chart(stCtx, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#FFFFFF', hoverOffset: 5 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          }
        }
      });
    }
  }

  private renderAllCharts(): void {
    const charts = this.payload?.charts;
    if (!charts) return;

    if (this.trendChart) {
      const trend = charts.trend || [];
      const pointR = trend.length > 35 ? 0 : 3;
      this.trendChart.data.labels = trend.map(r => formatShortDateLabel(r.date, this.granularity));
      this.trendChart.data.datasets = [
        {
          label: 'Operations Count',
          data: trend.map(r => Number(r.count) || 0),
          borderColor: '#1565C0',
          backgroundColor: 'rgba(21, 101, 192, 0.12)',
          fill: true,
          pointRadius: pointR,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Avg Duration (min)',
          data: trend.map(r => Math.round(Number(r.avgDuration) || 0)),
          borderColor: '#D97706',
          backgroundColor: 'rgba(217, 119, 6, 0.08)',
          fill: false,
          pointRadius: pointR,
          pointHoverRadius: 5,
          yAxisID: 'y1'
        }
      ];
      this.trendChart.update('none');
    }

    if (this.timeChart) {
      const dist = charts.timeDistribution || [];
      this.timeChart.data.labels = dist.map(d => d.type);
      this.timeChart.data.datasets = [{
        label: 'Total Mission Time',
        data: dist.map(d => Number(d.totalMinutes) || 0),
        backgroundColor: dist.map(d => (d.color || '#1565C0') + 'B8'),
        borderColor: dist.map(d => d.color || '#1565C0'),
        borderWidth: 1.5,
        borderRadius: 6
      }];
      this.timeChart.update('none');
    }

    if (this.statusChart) {
      const statusColors: Record<string, string> = {
        COMPLETED: '#10B981',
        IN_PROGRESS: '#0288D1',
        PLANNED: '#5C6BC0',
        ON_HOLD: '#D97706',
        CANCELLED: '#DC2626'
      };
      const rows = (charts.statusBreakdown || []).filter(r => Number(r.count) > 0);
      const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
      this.statusTotal = total;
      this.statusLegend = rows.map(r => ({
        label: formatEnumLabel(r.status),
        count: Number(r.count) || 0,
        pct: total > 0 ? Math.round(((Number(r.count) || 0) / total) * 100) : 0,
        color: statusColors[r.status] || '#94A3B8'
      }));

      this.statusChart.data.labels = total > 0 ? this.statusLegend.map(i => i.label) : ['No data'];
      this.statusChart.data.datasets[0].data = total > 0 ? this.statusLegend.map(i => i.count) : [1];
      this.statusChart.data.datasets[0].backgroundColor = total > 0 ? this.statusLegend.map(i => i.color) : ['#E2E8F0'];
      this.statusChart.update('none');
    }
  }
}
