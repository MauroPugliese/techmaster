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
  AnalyticsStockByTypeRow,
  AnalyticsTaskCadenceRow,
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
  selector: 'app-workforce-warehouse-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './workforce-warehouse-analytics.component.html',
  styleUrls: ['./workforce-warehouse-analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkforceWarehouseAnalyticsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('stockCanvas') stockCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('taskCanvas') taskCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('shiftCanvas') shiftCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() stockFlow: { dates: string[]; in: number[]; out: number[] } | null = null;
  @Input() stockByType: AnalyticsStockByTypeRow[] = [];
  @Input() taskCadence: AnalyticsTaskCadenceRow[] = [];
  @Input() shiftCoverage: {
    dates: string[];
    series: Array<{ name: string; color: string; data: number[] }>;
    absences: number[];
  } | null = null;
  @Input() loading = false;

  private viewReady = false;
  private stockChart: Chart | null = null;
  private taskChart: Chart | null = null;
  private shiftChart: Chart | null = null;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCharts();
    this.renderAll();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['stockFlow']) this.renderStock();
    if (changes['taskCadence']) this.renderTasks();
    if (changes['shiftCoverage']) this.renderShifts();
  }

  ngOnDestroy(): void {
    this.stockChart?.destroy();
    this.taskChart?.destroy();
    this.shiftChart?.destroy();
  }

  get hasStockData(): boolean {
    const sf = this.stockFlow;
    if (!sf?.dates?.length) return false;
    return [...sf.in, ...sf.out].some(v => v > 0);
  }

  get hasTaskData(): boolean {
    return (this.taskCadence || []).some(r => r.completed > 0 || r.pending > 0);
  }

  get hasShiftData(): boolean {
    const sc = this.shiftCoverage;
    if (!sc?.dates?.length || !sc?.series?.length) return false;
    return sc.series.some(s => s.data.some(v => v > 0)) || sc.absences.some(v => v > 0);
  }

  label(val?: string | null): string {
    return formatEnumLabel(val);
  }

  private initCharts(): void {
    const tickFont = { family: SMART_CHART_FONT_FAMILY, size: 11 };

    const stCtx = this.stockCanvas?.nativeElement?.getContext('2d');
    if (stCtx) {
      this.stockChart = new Chart(stCtx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: tickFont } },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 9, font: tickFont, color: SMART_CHART_TEXT_COLOR } },
            y: { beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } }
          },
          elements: { line: { tension: 0.35, borderWidth: 2.2 } }
        }
      });
    }

    const tkCtx = this.taskCanvas?.nativeElement?.getContext('2d');
    if (tkCtx) {
      this.taskChart = new Chart(tkCtx, {
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
            x: { grid: { display: false }, ticks: { font: tickFont, color: SMART_CHART_TEXT_COLOR } },
            y: { beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } }
          }
        }
      });
    }

    const shCtx = this.shiftCanvas?.nativeElement?.getContext('2d');
    if (shCtx) {
      this.shiftChart = new Chart(shCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: tickFont } },
            tooltip: { backgroundColor: '#0A1628', padding: 10, cornerRadius: 8 }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 12, font: tickFont, color: SMART_CHART_TEXT_COLOR } },
            y: { stacked: true, beginAtZero: true, grid: { color: SMART_CHART_GRID_COLOR }, ticks: { precision: 0, font: tickFont } }
          }
        }
      });
    }
  }

  private renderAll(): void {
    this.renderStock();
    this.renderTasks();
    this.renderShifts();
  }

  private renderStock(): void {
    if (!this.stockChart) return;
    const sf = this.stockFlow;
    const dates = sf?.dates || [];
    const pointR = dates.length > 35 ? 0 : 2.5;

    this.stockChart.data.labels = dates.map(d => formatShortDateLabel(d, 'day'));
    this.stockChart.data.datasets = [
      {
        label: 'Stock IN (Units)',
        data: sf?.in || [],
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.14)',
        fill: true,
        pointRadius: pointR,
        pointHoverRadius: 5
      },
      {
        label: 'Stock OUT (Units)',
        data: sf?.out || [],
        borderColor: '#DC2626',
        backgroundColor: 'rgba(220, 38, 38, 0.12)',
        fill: true,
        pointRadius: pointR,
        pointHoverRadius: 5
      }
    ];
    this.stockChart.update('none');
  }

  private renderTasks(): void {
    if (!this.taskChart) return;
    const rows = this.taskCadence || [];
    this.taskChart.data.labels = rows.map(r => r.label);
    this.taskChart.data.datasets = [
      {
        label: 'Completed',
        data: rows.map(r => r.completed),
        backgroundColor: 'rgba(16, 185, 129, 0.80)',
        borderColor: '#10B981',
        borderWidth: 1.5,
        borderRadius: 6
      },
      {
        label: 'Open / Pending',
        data: rows.map(r => r.pending),
        backgroundColor: 'rgba(217, 119, 6, 0.78)',
        borderColor: '#D97706',
        borderWidth: 1.5,
        borderRadius: 6
      }
    ];
    this.taskChart.update('none');
  }

  private renderShifts(): void {
    if (!this.shiftChart) return;
    const sc = this.shiftCoverage;
    const dates = sc?.dates || [];
    const datasets: any[] = (sc?.series || []).map(s => ({
      type: 'bar',
      label: `${s.name} Staff`,
      data: s.data,
      backgroundColor: `${s.color || '#1565C0'}CC`,
      borderColor: s.color || '#1565C0',
      borderWidth: 1,
      stack: 'staff'
    }));

    datasets.push({
      type: 'line',
      label: 'Absences',
      data: sc?.absences || [],
      borderColor: '#DC2626',
      backgroundColor: '#DC2626',
      borderWidth: 2,
      pointRadius: dates.length > 35 ? 0 : 3,
      fill: false,
      tension: 0.2
    });

    this.shiftChart.data.labels = dates.map(d => formatShortDateLabel(d, 'day'));
    this.shiftChart.data.datasets = datasets;
    this.shiftChart.update('none');
  }
}
