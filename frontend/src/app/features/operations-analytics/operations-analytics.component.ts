// =============================================================================
// operations-analytics.component.ts — Comprehensive Operations Analytics
// =============================================================================
import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { Subject, combineLatest } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';

Chart.register(...registerables);

@Component({
  selector: 'app-operations-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule, MatNativeDateModule],
  templateUrl: './operations-analytics.component.html',
  styleUrls: ['./operations-analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsAnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private charts: Record<string, Chart | null> = {
    trend: null,
    timeDistribution: null,
    statusBreakdown: null
  };

  loading = true;
  selectedPeriod: string = 'monthly';
  customFromDate: Date | null = null;
  customToDate: Date | null = null;
  showCustomRange = false;

  metrics: any = {};
  insights: any = {};

  periodOptions = [
    { value: 'daily', label: 'Today' },
    { value: 'weekly', label: 'This Week' },
    { value: 'monthly', label: 'This Month' },
    { value: 'yearly', label: 'This Year' },
    { value: 'all', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' }
  ];

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.initCharts(), 100);
  }

  onPeriodChange(): void {
    this.showCustomRange = this.selectedPeriod === 'custom';
    if (this.selectedPeriod !== 'custom') {
      this.loadData();
    }
  }

  onCustomRangeApply(): void {
    if (this.customFromDate && this.customToDate) {
      this.loadData();
    }
  }

  private loadData(): void {
    this.loading = true;
    this.cdr.markForCheck();

    const params: any = { period: this.selectedPeriod };
    if (this.selectedPeriod === 'custom' && this.customFromDate && this.customToDate) {
      params.from = this.customFromDate.toISOString().slice(0, 10);
      params.to = this.customToDate.toISOString().slice(0, 10);
    }

    this.api.get<any>('/analytics/operations-metrics', params).subscribe({
      next: (response) => {
        this.metrics = response.data.metrics;
        this.insights = response.data.insights;
        this.updateCharts(response.data.charts);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private initCharts(): void {
    const baseFont = { family: 'Plus Jakarta Sans', size: 12 };
    const gridColor = '#E1EAF5';

    // 1) Operations Trend Chart
    const trendCtx = this.getCtx('trendChart');
    if (trendCtx) {
      this.charts['trend'] = new Chart(trendCtx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true } }
          },
          scales: {
            x: { grid: { color: gridColor }, ticks: { font: baseFont } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { font: baseFont, precision: 0 },
              title: { display: true, text: 'Operations Count' }
            }
          },
          elements: { line: { tension: 0.4, borderWidth: 2 }, point: { radius: 4 } }
        }
      });
    }

    // 2) Time Distribution Chart
    const timeCtx = this.getCtx('timeDistributionChart');
    if (timeCtx) {
      this.charts['timeDistribution'] = new Chart(timeCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: baseFont } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { font: baseFont, precision: 0 },
              title: { display: true, text: 'Minutes' }
            }
          },
          elements: { bar: { borderRadius: 4 } }
        }
      });
    }

    // 3) Status Breakdown Chart
    const statusCtx = this.getCtx('statusBreakdownChart');
    if (statusCtx) {
      this.charts['statusBreakdown'] = new Chart(statusCtx, {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: { position: 'bottom', labels: { font: baseFont, usePointStyle: true } }
          }
        }
      });
    }
  }

  private updateCharts(chartData: any): void {
    // Update Trend Chart
    const trendChart = this.charts['trend'];
    if (trendChart && chartData.trend) {
      trendChart.data.labels = chartData.trend.map((d: any) => new Date(d.date).toLocaleDateString());
      trendChart.data.datasets = [
        {
          label: 'Operations Count',
          data: chartData.trend.map((d: any) => d.count),
          borderColor: '#1565C0',
          backgroundColor: '#1565C020',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Avg Duration (min)',
          data: chartData.trend.map((d: any) => d.avgDuration),
          borderColor: '#F59E0B',
          backgroundColor: '#F59E0B20',
          fill: true,
          tension: 0.4,
          yAxisID: 'y1'
        }
      ];
      trendChart.options.scales = {
        ...trendChart.options.scales,
        y1: {
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 12 }, precision: 0 },
          title: { display: true, text: 'Avg Duration (min)' }
        }
      };
      trendChart.update('active');
    }

    // Update Time Distribution Chart
    const timeChart = this.charts['timeDistribution'];
    if (timeChart && chartData.timeDistribution) {
      timeChart.data.labels = chartData.timeDistribution.map((d: any) => d.type);
      timeChart.data.datasets = [{
        data: chartData.timeDistribution.map((d: any) => d.totalMinutes),
        backgroundColor: chartData.timeDistribution.map((d: any) => d.color || '#1565C0'),
        borderColor: chartData.timeDistribution.map((d: any) => d.color || '#1565C0'),
        borderWidth: 1
      }];
      timeChart.update('active');
    }

    // Update Status Breakdown Chart
    const statusChart = this.charts['statusBreakdown'];
    if (statusChart && chartData.statusBreakdown) {
      const statusColors: Record<string, string> = {
        'PLANNED': '#5C6BC0',
        'IN_PROGRESS': '#0288D1',
        'COMPLETED': '#10B981',
        'CANCELLED': '#EF4444',
        'ON_HOLD': '#F59E0B'
      };

      statusChart.data.labels = chartData.statusBreakdown.map((d: any) => d.status);
      statusChart.data.datasets = [{
        data: chartData.statusBreakdown.map((d: any) => d.count),
        backgroundColor: chartData.statusBreakdown.map((d: any) => statusColors[d.status] || '#9CA3AF'),
        borderWidth: 0,
        hoverOffset: 8
      }];
      statusChart.update('active');
    }
  }

  private getCtx(id: string): CanvasRenderingContext2D | null {
    return (document.getElementById(id) as HTMLCanvasElement)?.getContext('2d') ?? null;
  }

  exportReport(): void {
    const report = {
      generated: new Date().toISOString(),
      period: this.selectedPeriod,
      metrics: this.metrics,
      insights: this.insights
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `operations-analytics-${this.selectedPeriod}-${Date.now()}.json`
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.destroy$.next();
    this.destroy$.complete();
  }
}