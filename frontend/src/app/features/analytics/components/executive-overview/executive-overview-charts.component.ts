import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import {
  AnalyticsOpsTypeRow,
  AnalyticsStatusBucket,
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

export interface StatusLegendRow {
  label: string;
  count: number;
  pct: number;
  color: string;
}

@Component({
  selector: 'app-executive-overview-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './executive-overview-charts.component.html',
  styleUrls: ['./executive-overview-charts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExecutiveOverviewChartsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('velocityCanvas') velocityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('opsTypeCanvas') opsTypeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('statusCanvas') statusCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() activityTrend: { dates: string[]; operations: number[]; maintenance: number[]; tasks: number[] } | null = null;
  @Input() opsByType: AnalyticsOpsTypeRow[] = [];
  @Input() opsByStatus: AnalyticsStatusBucket[] = [];
  @Input() loading = false;

  statusLegend: StatusLegendRow[] = [];
  statusTotal = 0;

  private viewReady = false;
  private velocityChart: Chart | null = null;
  private opsTypeChart: Chart | null = null;
  private statusChart: Chart | null = null;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCharts();
    this.renderAll();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['activityTrend']) this.renderVelocity();
    if (changes['opsByType']) this.renderOpsByType();
    if (changes['opsByStatus']) this.renderStatusDonut();
  }

  ngOnDestroy(): void {
    this.velocityChart?.destroy();
    this.opsTypeChart?.destroy();
    this.statusChart?.destroy();
  }

  get hasVelocityData(): boolean {
    const t = this.activityTrend;
    if (!t?.dates?.length) return false;
    return [...t.operations, ...t.maintenance, ...t.tasks].some(v => v > 0);
  }

  get hasOpsTypeData(): boolean {
    return (this.opsByType || []).some(r => Number(r.count) > 0);
  }

  get hasStatusData(): boolean {
    return (this.opsByStatus || []).some(r => Number(r.count) > 0);
  }

  private initCharts(): void {
    const tickFont = { family: SMART_CHART_FONT_FAMILY, size: 11 };

    const velCtx = this.velocityCanvas?.nativeElement?.getContext('2d');
    if (velCtx) {
      this.velocityChart = new Chart(velCtx, {
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
            y: { beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } }
          },
          elements: { line: { tension: 0.35, borderWidth: 2.2 } }
        }
      });
    }

    const typeCtx = this.opsTypeCanvas?.nativeElement?.getContext('2d');
    if (typeCtx) {
      this.opsTypeChart = new Chart(typeCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: tickFont } },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: tickFont } },
            y: { beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } }
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
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          }
        }
      });
    }
  }

  private renderAll(): void {
    this.renderVelocity();
    this.renderOpsByType();
    this.renderStatusDonut();
  }

  private renderVelocity(): void {
    if (!this.velocityChart) return;
    const t = this.activityTrend;
    const dates = t?.dates || [];
    const pointR = dates.length > 35 ? 0 : 2.5;

    this.velocityChart.data.labels = dates.map(d => formatShortDateLabel(d, 'day'));
    this.velocityChart.data.datasets = [
      {
        label: 'Operations',
        data: t?.operations || [],
        borderColor: '#1565C0',
        backgroundColor: 'rgba(21, 101, 192, 0.10)',
        fill: true,
        pointRadius: pointR,
        pointHoverRadius: 5
      },
      {
        label: 'Maintenance',
        data: t?.maintenance || [],
        borderColor: '#D97706',
        backgroundColor: 'rgba(217, 119, 6, 0.08)',
        fill: true,
        pointRadius: pointR,
        pointHoverRadius: 5
      },
      {
        label: 'Tasks',
        data: t?.tasks || [],
        borderColor: '#7C3AED',
        backgroundColor: 'rgba(124, 58, 237, 0.08)',
        fill: true,
        pointRadius: pointR,
        pointHoverRadius: 5
      }
    ];
    this.velocityChart.update('none');
  }

  private renderOpsByType(): void {
    if (!this.opsTypeChart) return;
    const rows = (this.opsByType || []).filter(r => r.count > 0 || (this.opsByType || []).length <= 8);
    const colors = rows.map(r => r.color || '#1565C0');

    this.opsTypeChart.data.labels = rows.map(r => r.type);
    this.opsTypeChart.data.datasets = [
      {
        label: 'Total Sorties',
        data: rows.map(r => Number(r.count) || 0),
        backgroundColor: colors.map(c => c + '88'),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 6
      },
      {
        label: 'Completed',
        data: rows.map(r => Number(r.completed) || 0),
        backgroundColor: '#10B981CC',
        borderColor: '#10B981',
        borderWidth: 1.5,
        borderRadius: 6
      }
    ];
    this.opsTypeChart.update('none');
  }

  private renderStatusDonut(): void {
    if (!this.statusChart) return;
    const statusColorMap: Record<string, string> = {
      COMPLETED: '#10B981',
      IN_PROGRESS: '#0288D1',
      PLANNED: '#5C6BC0',
      ON_HOLD: '#D97706',
      CANCELLED: '#DC2626'
    };

    const rows = (this.opsByStatus || []).filter(r => Number(r.count) > 0);
    const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    this.statusTotal = total;
    this.statusLegend = rows.map(r => ({
      label: formatEnumLabel(r.status),
      count: Number(r.count) || 0,
      pct: total > 0 ? Math.round(((Number(r.count) || 0) / total) * 100) : 0,
      color: statusColorMap[r.status] || '#94A3B8'
    }));

    this.statusChart.data.labels = total > 0 ? this.statusLegend.map(i => i.label) : ['No data'];
    this.statusChart.data.datasets[0].data = total > 0 ? this.statusLegend.map(i => i.count) : [1];
    this.statusChart.data.datasets[0].backgroundColor = total > 0 ? this.statusLegend.map(i => i.color) : ['#E2E8F0'];
    this.statusChart.update('none');
  }
}
