import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { DashboardBreakdowns, DashboardTrendSeries } from '../../../core/models/interfaces';
import {
  applySmartChartDefaults,
  SMART_CHART_FONT_FAMILY,
  SMART_CHART_GRID_COLOR,
  SMART_CHART_TEXT_COLOR
} from '../../../shared/utils/chart-theme';

Chart.register(...registerables);
applySmartChartDefaults(Chart);

export interface BreakdownLegendItem {
  label: string;
  count: number;
  pct: number;
  color: string;
}

@Component({
  selector: 'app-dashboard-charts',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-charts.component.html',
  styleUrls: ['./dashboard-charts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardChartsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('velocityCanvas') velocityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('breakdownCanvas') breakdownCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() trends: DashboardTrendSeries | null = null;
  @Input() breakdowns: DashboardBreakdowns | null = null;
  @Input() trendDays: 7 | 30 | 90 = 30;
  @Input() dateFilterLabel = 'All time';

  @Output() trendDaysChange = new EventEmitter<7 | 30 | 90>();

  readonly windowOptions: Array<7 | 30 | 90> = [7, 30, 90];
  visibleSeries = {
    operations: true,
    maintenance: true,
    tasks: true
  };
  breakdownMode: 'tasks' | 'status' = 'tasks';
  legendItems: BreakdownLegendItem[] = [];
  breakdownTotal = 0;

  private viewReady = false;
  private velocityChart: Chart | null = null;
  private breakdownChart: Chart | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initVelocityChart();
    this.initBreakdownChart();
    this.renderVelocityChart();
    this.renderBreakdownChart();
    this.cdr.markForCheck();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['trends']) {
      this.renderVelocityChart();
    }
    if (changes['breakdowns']) {
      this.renderBreakdownChart();
    }
  }

  ngOnDestroy(): void {
    this.velocityChart?.destroy();
    this.breakdownChart?.destroy();
  }

  selectWindow(days: 7 | 30 | 90): void {
    if (this.trendDays === days) return;
    this.trendDaysChange.emit(days);
  }

  toggleSeries(key: 'operations' | 'maintenance' | 'tasks'): void {
    const activeCount = Object.values(this.visibleSeries).filter(Boolean).length;
    if (this.visibleSeries[key] && activeCount === 1) return;
    this.visibleSeries = {
      ...this.visibleSeries,
      [key]: !this.visibleSeries[key]
    };
    this.renderVelocityChart();
  }

  setBreakdownMode(mode: 'tasks' | 'status'): void {
    if (this.breakdownMode === mode) return;
    this.breakdownMode = mode;
    this.renderBreakdownChart();
  }

  get hasGlobalDateFilter(): boolean {
    return !!this.dateFilterLabel && this.dateFilterLabel !== 'All time';
  }

  private initVelocityChart(): void {
    const ctx = this.velocityCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;

    this.velocityChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0A1628',
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: 8,
              color: SMART_CHART_TEXT_COLOR,
              font: { family: SMART_CHART_FONT_FAMILY, size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: SMART_CHART_GRID_COLOR },
            ticks: {
              precision: 0,
              color: SMART_CHART_TEXT_COLOR,
              font: { family: SMART_CHART_FONT_FAMILY, size: 11 }
            }
          }
        },
        elements: {
          line: { tension: 0.35, borderWidth: 2.25 },
          point: { radius: 2.5, hoverRadius: 5, hitRadius: 10 }
        }
      }
    });
  }

  private initBreakdownChart(): void {
    const ctx = this.breakdownCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;

    this.breakdownChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [],
          borderWidth: 2,
          borderColor: '#FFFFFF',
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0A1628',
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  private formatShortDateLabel(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  private renderVelocityChart(): void {
    if (!this.velocityChart) return;
    const dates = this.trends?.dates || [];
    const labels = dates.map(d => this.formatShortDateLabel(d));

    const seriesDefs: Array<{
      key: 'operations' | 'maintenance' | 'tasks';
      label: string;
      color: string;
      fill: string;
      data: number[];
    }> = [
      {
        key: 'operations',
        label: 'Operations',
        color: '#1565C0',
        fill: 'rgba(21, 101, 192, 0.10)',
        data: this.trends?.operations || []
      },
      {
        key: 'maintenance',
        label: 'Maintenance',
        color: '#D97706',
        fill: 'rgba(217, 119, 6, 0.08)',
        data: this.trends?.maintenance || []
      },
      {
        key: 'tasks',
        label: 'Tasks',
        color: '#7C3AED',
        fill: 'rgba(124, 58, 237, 0.08)',
        data: this.trends?.tasks || []
      }
    ];

    this.velocityChart.data.labels = labels;
    this.velocityChart.data.datasets = seriesDefs
      .filter(s => this.visibleSeries[s.key])
      .map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.fill,
        fill: true,
        pointRadius: dates.length > 35 ? 0 : 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: s.color
      }));

    this.velocityChart.update('none');
  }

  private renderBreakdownChart(): void {
    if (!this.breakdownChart) return;

    let rawItems: Array<{ label: string; count: number; color: string }> = [];

    if (this.breakdownMode === 'tasks') {
      const countsMap = new Map<string, number>();
      for (const b of this.breakdowns?.taskByInterval || []) {
        countsMap.set(String(b.label || 'ONCE'), Number(b.count) || 0);
      }
      const order = [
        { key: 'DAILY', label: 'Daily', color: '#1565C0' },
        { key: 'WEEKLY', label: 'Weekly', color: '#0288D1' },
        { key: 'MONTHLY', label: 'Monthly', color: '#00B0FF' },
        { key: 'YEARLY', label: 'Yearly', color: '#7C3AED' },
        { key: 'ONCE', label: 'One-time', color: '#10B981' }
      ];
      rawItems = order.map(o => ({
        label: o.label,
        count: countsMap.get(o.key) || 0,
        color: o.color
      }));
    } else {
      const opsMap = new Map<string, number>();
      for (const b of this.breakdowns?.opsByStatus || []) {
        opsMap.set(String(b.label), Number(b.count) || 0);
      }
      const maintMap = new Map<string, number>();
      for (const b of this.breakdowns?.maintByStatus || []) {
        maintMap.set(String(b.label), Number(b.count) || 0);
      }
      rawItems = [
        {
          label: 'Ops Active / Hold',
          count: (opsMap.get('IN_PROGRESS') || 0) + (opsMap.get('ON_HOLD') || 0),
          color: '#0288D1'
        },
        {
          label: 'Ops Planned',
          count: opsMap.get('PLANNED') || 0,
          color: '#5C6BC0'
        },
        {
          label: 'Maint Open',
          count: (maintMap.get('SCHEDULED') || 0) + (maintMap.get('IN_PROGRESS') || 0),
          color: '#D97706'
        },
        {
          label: 'Maint Issues',
          count: (maintMap.get('FAILED') || 0) + (maintMap.get('DEFERRED') || 0),
          color: '#DC2626'
        },
        {
          label: 'Completed Total',
          count: (opsMap.get('COMPLETED') || 0) + (maintMap.get('COMPLETED') || 0),
          color: '#16A34A'
        }
      ];
    }

    const total = rawItems.reduce((acc, item) => acc + item.count, 0);
    this.breakdownTotal = total;
    this.legendItems = rawItems.map(item => ({
      ...item,
      pct: total > 0 ? Math.round((item.count / total) * 100) : 0
    }));

    const hasValues = total > 0;
    this.breakdownChart.data.labels = hasValues
      ? rawItems.map(i => i.label)
      : ['No data'];
    this.breakdownChart.data.datasets[0].data = hasValues
      ? rawItems.map(i => i.count)
      : [1];
    this.breakdownChart.data.datasets[0].backgroundColor = hasValues
      ? rawItems.map(i => i.color)
      : ['#E2E8F0'];

    this.breakdownChart.update('none');
    this.cdr.markForCheck();
  }
}
