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
import { UiCustomizationService, UiSectionPreferences } from '../../../../core/services/ui-customization.service';
import {
  AnalyticsMaintSummaryRow,
  AnalyticsTopAsset,
  formatCurrency,
  formatDowntimeHours,
  formatEnumLabel
} from '../../analytics-helpers';
import {
  applySmartChartDefaults,
  SMART_CHART_FONT_FAMILY,
  SMART_CHART_GRID_COLOR,
  SMART_CHART_TEXT_COLOR
} from '../../../../shared/utils/chart-theme';

Chart.register(...registerables);
applySmartChartDefaults(Chart);

type MaintSortCol = 'type' | 'count' | 'avg_downtime' | 'total_cost' | 'completion_rate';

@Component({
  selector: 'app-maintenance-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './maintenance-analytics.component.html',
  styleUrls: ['./maintenance-analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceAnalyticsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('costDowntimeCanvas') costDowntimeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('topAssetsCanvas') topAssetsCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() maintSummary: AnalyticsMaintSummaryRow[] = [];
  @Input() topAssets: AnalyticsTopAsset[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Input() loading = false;

  sortBy: MaintSortCol = 'total_cost';
  sortDir: 'ASC' | 'DESC' = 'DESC';

  private viewReady = false;
  private costChart: Chart | null = null;
  private assetsChart: Chart | null = null;

  constructor(private uiCustomization: UiCustomizationService) {}

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCharts();
    this.renderCharts();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;
    if (changes['maintSummary'] || changes['topAssets']) {
      this.renderCharts();
    }
  }

  ngOnDestroy(): void {
    this.costChart?.destroy();
    this.assetsChart?.destroy();
  }

  get hasSummaryData(): boolean {
    return (this.maintSummary || []).length > 0;
  }

  get hasAssetsData(): boolean {
    return (this.topAssets || []).some(a => Number(a.total_cost) > 0 || Number(a.total_downtime) > 0 || Number(a.records_count) > 0);
  }

  get sortedSummary(): AnalyticsMaintSummaryRow[] {
    const dir = this.sortDir === 'ASC' ? 1 : -1;
    return [...(this.maintSummary || [])].sort((a, b) => {
      if (this.sortBy === 'type') {
        return a.type.localeCompare(b.type) * dir;
      }
      return ((Number(a[this.sortBy]) || 0) - (Number(b[this.sortBy]) || 0)) * dir;
    });
  }

  get totalRecords(): number {
    return (this.maintSummary || []).reduce((s, r) => s + (Number(r.count) || 0), 0);
  }

  get totalCost(): number {
    return (this.maintSummary || []).reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
  }

  get overallAvgDowntimeHours(): number {
    const total = this.totalRecords;
    if (!total) return 0;
    const totalDown = (this.maintSummary || []).reduce((s, r) => s + (Number(r.total_downtime) || 0), 0);
    return totalDown / total;
  }

  get overallCompletionRate(): number {
    const total = this.totalRecords;
    if (!total) return 0;
    const done = (this.maintSummary || []).reduce((s, r) => s + (Number(r.completed_count) || 0), 0);
    return Math.round((done / total) * 100);
  }

  toggleSort(col: MaintSortCol): void {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy = col;
      this.sortDir = col === 'type' ? 'ASC' : 'DESC';
    }
  }

  sortIcon(col: MaintSortCol): string {
    if (this.sortBy !== col) return 'unfold_more';
    return this.sortDir === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  money(val?: number | null): string {
    return formatCurrency(val);
  }

  downtimeLabel(hours?: number | null): string {
    return formatDowntimeHours(hours);
  }

  enumLabel(val?: string | null): string {
    return formatEnumLabel(val);
  }

  showTableField(key: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', key, true);
  }

  fieldLabel(key: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, 'table', key, fallback);
  }

  private initCharts(): void {
    const tickFont = { family: SMART_CHART_FONT_FAMILY, size: 11 };

    const cCtx = this.costDowntimeCanvas?.nativeElement?.getContext('2d');
    if (cCtx) {
      this.costChart = new Chart(cCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: tickFont } },
            tooltip: {
              backgroundColor: '#0A1628',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => {
                  if (ctx.datasetIndex === 0) return ` Spend: ${formatCurrency(Number(ctx.raw))}`;
                  return ` Weighted Avg Downtime: ${formatDowntimeHours(Number(ctx.raw))}`;
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: tickFont, color: SMART_CHART_TEXT_COLOR } },
            y: {
              beginAtZero: true,
              position: 'left',
              grid: { color: SMART_CHART_GRID_COLOR },
              ticks: { font: tickFont, callback: v => `$${v}` }
            },
            y1: {
              beginAtZero: true,
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { font: tickFont, callback: v => formatDowntimeHours(Number(v)) }
            }
          }
        }
      });
    }

    const aCtx = this.topAssetsCanvas?.nativeElement?.getContext('2d');
    if (aCtx) {
      this.assetsChart = new Chart(aCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0A1628',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => {
                  const asset = this.topAssets?.[ctx.dataIndex];
                  if (!asset) return ` ${formatCurrency(Number(ctx.raw))}`;
                  return ` ${formatCurrency(asset.total_cost)} · ${formatDowntimeHours(asset.total_downtime)} down (${asset.records_count} WO)`;
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: SMART_CHART_GRID_COLOR },
              ticks: { font: tickFont, callback: v => `$${v}` }
            },
            y: { grid: { display: false }, ticks: { font: tickFont, color: SMART_CHART_TEXT_COLOR } }
          }
        }
      });
    }
  }

  private renderCharts(): void {
    const rows = this.maintSummary || [];
    if (this.costChart) {
      this.costChart.data.labels = rows.map(r => formatEnumLabel(r.type));
      this.costChart.data.datasets = [
        {
          label: 'Total Cost ($)',
          data: rows.map(r => r.total_cost),
          backgroundColor: 'rgba(21, 101, 192, 0.72)',
          borderColor: '#1565C0',
          borderWidth: 1.5,
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'Weighted Avg Downtime',
          data: rows.map(r => r.avg_downtime),
          backgroundColor: 'rgba(217, 119, 6, 0.78)',
          borderColor: '#D97706',
          borderWidth: 1.5,
          borderRadius: 6,
          yAxisID: 'y1'
        }
      ];
      this.costChart.update('none');
    }

    if (this.assetsChart) {
      const assets = this.topAssets || [];
      this.assetsChart.data.labels = assets.map(a => a.name);
      this.assetsChart.data.datasets = [{
        label: 'Maintenance Spend',
        data: assets.map(a => Number(a.total_cost) || 0),
        backgroundColor: 'rgba(220, 38, 38, 0.72)',
        borderColor: '#DC2626',
        borderWidth: 1.5,
        borderRadius: 6
      }];
      this.assetsChart.update('none');
    }
  }
}
