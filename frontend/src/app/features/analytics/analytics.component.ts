// =============================================================================
// analytics.component.ts — Operational Intelligence & Analytics Dashboard
// =============================================================================
import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin, of } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';
import { Chart, registerables, ChartConfiguration } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';

Chart.register(...registerables, zoomPlugin);

export interface AnalyticsKpis {
  totalOperations: number;
  operationCompletionRate: number;
  totalMaintenanceCost: number;
  totalDowntimeHours: number;
  avgDowntimeHours: number;
  netStockFlow: number;
  taskCompletionRate: number;
  shiftAttendanceRate: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, TitleCasePipe, ExportMenuComponent, DropdownComponent, DropdownOptionComponent],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  Math = Math;

  loading = true;
  dateLabel = 'All time';
  uiPrefs: UiSectionPreferences | null = null;

  kpis: AnalyticsKpis | null = null;
  maintSummary: any[] = [];
  summaryPage = 1;
  summaryPageSize = 10;
  readonly summaryPageSizeOptions = [10, 20, 50, 100];

  // Cached API data to handle async view readiness smoothly
  private rawData: {
    opsByType?: any[];
    opsByStatus?: any[];
    maintData?: any[];
    stockData?: any[];
    taskData?: any[];
    shiftData?: any[];
  } = {};

  private charts: Record<string, Chart | null> = {
    opsByType: null,
    statusDonut: null,
    maintOverview: null,
    stock: null,
    taskComp: null,
    shiftCoverage: null
  };

  private isViewReady = false;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.uiCustomization.load('analytics').subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      switchMap(range => {
        this.loading = true;
        this.dateLabel = this.dateFilter.getLabel();
        this.cdr.markForCheck();

        return forkJoin({
          kpis:        this.api.get<any>('/analytics/kpis', {}, range).pipe(catchError(() => of({ data: null }))),
          opsByType:   this.api.get<any>('/analytics/operations-by-type', {}, range).pipe(catchError(() => of({ data: [] }))),
          opsByStatus: this.api.get<any>('/analytics/operations-by-status', {}, range).pipe(catchError(() => of({ data: [] }))),
          maintData:   this.api.get<any>('/analytics/maintenance-overview', {}, range).pipe(catchError(() => of({ data: [] }))),
          stockData:   this.api.get<any>('/analytics/stock-movements', {}, range).pipe(catchError(() => of({ data: [] }))),
          taskData:    this.api.get<any>('/analytics/task-completion', {}, range).pipe(catchError(() => of({ data: [] }))),
          shiftData:   this.api.get<any>('/analytics/shift-coverage', {}, range).pipe(catchError(() => of({ data: [] })))
        });
      })
    ).subscribe({
      next: ({ kpis, opsByType, opsByStatus, maintData, stockData, taskData, shiftData }) => {
        this.kpis = kpis?.data || null;
        this.rawData = {
          opsByType: opsByType?.data || [],
          opsByStatus: opsByStatus?.data || [],
          maintData: maintData?.data || [],
          stockData: stockData?.data || [],
          taskData: taskData?.data || [],
          shiftData: shiftData?.data || []
        };

        this.buildMaintSummary(this.rawData.maintData || []);
        this.loading = false;

        if (this.isViewReady) {
          this.renderAllCharts();
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    setTimeout(() => {
      this.renderAllCharts();
      this.cdr.markForCheck();
    }, 60);
  }

  // ── Render / Update All Charts ─────────────────────────────────────────────
  renderAllCharts(): void {
    if (!this.isViewReady) return;
    this.renderOpsByType(this.rawData.opsByType || []);
    this.renderStatusDonut(this.rawData.opsByStatus || []);
    this.renderMaintOverview(this.rawData.maintData || []);
    this.renderStockChart(this.rawData.stockData || []);
    this.renderTaskChart(this.rawData.taskData || []);
    this.renderShiftChart(this.rawData.shiftData || []);
  }

  private getOrCreateChart(canvasId: string, config: ChartConfiguration | any): Chart | null {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return null;
    Chart.getChart(canvas)?.destroy();
    return new Chart(canvas, config);
  }

  private getBaseFont(): { family: string; size: number } {
    return { family: 'Plus Jakarta Sans, sans-serif', size: 11 };
  }

  // ── 1) Operations by Category (Bar Chart) ──────────────────────────────────
  private renderOpsByType(data: any[]): void {
    const baseFont = this.getBaseFont();
    const labels = data.map(d => d.type || 'Unnamed');
    const totalData = data.map(d => Number(d.count) || 0);
    const completedData = data.map(d => Number(d.completed) || 0);
    const colors = data.map(d => d.color || '#1565C0');

    this.charts['opsByType'] = this.getOrCreateChart('opsByTypeChart', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Planned / Assigned',
            data: totalData,
            backgroundColor: colors.map(c => c + '80'),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Completed Operations',
            data: completedData,
            backgroundColor: '#10B981CC',
            borderColor: '#10B981',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: baseFont, usePointStyle: true, padding: 14 }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8,
            titleFont: { ...baseFont, weight: 'bold' as any },
            bodyFont: baseFont
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: baseFont } },
          y: {
            beginAtZero: true,
            grid: { color: '#F1F5F9' },
            ticks: { font: baseFont, precision: 0 }
          }
        }
      }
    });
  }

  // ── 2) Operation Status Lifecycle (Donut Chart) ────────────────────────────
  private renderStatusDonut(data: any[]): void {
    const baseFont = this.getBaseFont();
    const statusColorMap: Record<string, string> = {
      'COMPLETED':   '#10B981',
      'IN_PROGRESS': '#0288D1',
      'PLANNED':     '#5C6BC0',
      'ON_HOLD':     '#F59E0B',
      'CANCELLED':   '#EF4444'
    };

    const labels = data.length ? data.map(d => d.status) : ['No Data'];
    const counts = data.length ? data.map(d => Number(d.count) || 0) : [0];
    const bgColors = data.length ? data.map(d => statusColorMap[d.status] || '#94A3B8') : ['#E2E8F0'];

    this.charts['statusDonut'] = this.getOrCreateChart('statusDonutChart', {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: '#FFFFFF',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: baseFont, usePointStyle: true, padding: 12 }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8,
            titleFont: { ...baseFont, weight: 'bold' as any },
            bodyFont: baseFont,
            callbacks: {
              label: (item) => {
                const total = counts.reduce((a, b) => a + b, 0);
                const val = Number(item.raw) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(0) : '0';
                return ` ${item.label}: ${val} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ── 3) Maintenance Overview & Costs (Grouped Bar) ──────────────────────────
  private renderMaintOverview(data: any[]): void {
    const baseFont = this.getBaseFont();
    const types = Array.from(new Set(data.map(d => d.type)));
    const colors: Record<string, string> = {
      'PREVENTIVE': '#10B981',
      'CORRECTIVE': '#EF4444',
      'PREDICTIVE': '#6366F1',
      'UPGRADE':    '#0288D1',
      'INSPECTION': '#F59E0B'
    };

    const typeTotals = types.map(t => {
      const rows = data.filter(d => d.type === t);
      return {
        type: t,
        count: rows.reduce((s, r) => s + (Number(r.count) || 0), 0),
        cost: rows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0),
        avgDowntime: rows.length ? Number(rows[0].avg_downtime) || 0 : 0
      };
    });

    this.charts['maintOverview'] = this.getOrCreateChart('maintOverviewChart', {
      type: 'bar',
      data: {
        labels: typeTotals.map(t => t.type),
        datasets: [
          {
            label: 'Total Cost ($)',
            data: typeTotals.map(t => t.cost),
            backgroundColor: '#6366F1B3',
            borderColor: '#6366F1',
            borderWidth: 1.5,
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            label: 'Avg Downtime (hrs)',
            data: typeTotals.map(t => t.avgDowntime),
            backgroundColor: '#F59E0BCC',
            borderColor: '#F59E0B',
            borderWidth: 1.5,
            borderRadius: 6,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: baseFont, usePointStyle: true, padding: 12 }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                if (ctx.datasetIndex === 0) return ` Cost: $${(Number(ctx.raw) || 0).toLocaleString()}`;
                return ` Avg Downtime: ${Number(ctx.raw) || 0} hrs`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: baseFont } },
          y: {
            beginAtZero: true,
            position: 'left',
            grid: { color: '#F1F5F9' },
            ticks: {
              font: baseFont,
              callback: (val) => `$${val}`
            }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: {
              font: baseFont,
              callback: (val) => `${val}h`
            }
          }
        }
      }
    });
  }

  // ── 4) Stock Movements Velocity (IN vs OUT Area/Bar) ──────────────────────
  private renderStockChart(data: any[]): void {
    const baseFont = this.getBaseFont();
    const dates = Array.from(new Set(data.map(d => d.date))).sort();

    const inData = dates.map(d => {
      const r = data.find(x => x.date === d && x.type === 'IN');
      return r ? Number(r.total_qty) || 0 : 0;
    });

    const outData = dates.map(d => {
      const r = data.find(x => x.date === d && x.type === 'OUT');
      return r ? Number(r.total_qty) || 0 : 0;
    });

    const formattedDates = dates.map(d => {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    this.charts['stock'] = this.getOrCreateChart('stockChart', {
      type: 'line',
      data: {
        labels: formattedDates,
        datasets: [
          {
            label: 'Stock IN (Received)',
            data: inData,
            borderColor: '#10B981',
            backgroundColor: '#10B98125',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6
          },
          {
            label: 'Stock OUT (Dispatched)',
            data: outData,
            borderColor: '#EF4444',
            backgroundColor: '#EF444420',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: baseFont, usePointStyle: true }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: baseFont } },
          y: {
            beginAtZero: true,
            grid: { color: '#F1F5F9' },
            ticks: { font: baseFont, precision: 0 }
          }
        }
      }
    });
  }

  // ── 5) Task Completion Performance (Radar) ────────────────────────────────
  private renderTaskChart(data: any[]): void {
    const baseFont = this.getBaseFont();
    const intervals = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'ONCE'];

    const doneData = intervals.map(i => {
      const r = data.find(d => d.interval_type === i && d.status === 'DONE');
      return r ? Number(r.count) || 0 : 0;
    });

    const pendingData = intervals.map(i => {
      const r = data.find(d => d.interval_type === i && d.status !== 'DONE');
      return r ? Number(r.count) || 0 : 0;
    });

    this.charts['taskComp'] = this.getOrCreateChart('taskCompChart', {
      type: 'radar',
      data: {
        labels: ['Daily', 'Weekly', 'Monthly', 'Yearly', 'One-time'],
        datasets: [
          {
            label: 'Completed Tasks',
            data: doneData,
            backgroundColor: '#10B98135',
            borderColor: '#10B981',
            pointBackgroundColor: '#10B981',
            borderWidth: 2,
            pointRadius: 4
          },
          {
            label: 'Pending / In-Progress',
            data: pendingData,
            backgroundColor: '#F59E0B35',
            borderColor: '#F59E0B',
            pointBackgroundColor: '#F59E0B',
            borderWidth: 2,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: baseFont, usePointStyle: true }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          r: {
            beginAtZero: true,
            grid: { color: '#E2E8F0' },
            ticks: { font: baseFont, backdropColor: 'transparent', precision: 0 },
            pointLabels: { font: { ...baseFont, size: 12, weight: 'bold' as any } }
          }
        }
      }
    });
  }

  // ── 6) Shift Workforce & Absences (Stacked Bar) ───────────────────────────
  private renderShiftChart(data: any[]): void {
    const baseFont = this.getBaseFont();
    const dates = Array.from(new Set(data.map(d => d.date))).sort().slice(-14);
    const shiftNames = Array.from(new Set(data.map(d => d.shift_name)));
    const colorMap = data.reduce((acc: any, d: any) => {
      acc[d.shift_name] = d.color || '#1565C0';
      return acc;
    }, {});

    const formattedDates = dates.map(d => {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const datasets: any[] = shiftNames.map(name => ({
      type: 'bar',
      label: `${name} Staff`,
      data: dates.map(d => {
        const r = data.find(x => x.date === d && x.shift_name === name);
        return r ? Number(r.employees) || 0 : 0;
      }),
      backgroundColor: (colorMap[name] || '#1565C0') + 'CC',
      borderColor: colorMap[name] || '#1565C0',
      borderWidth: 1,
      stack: 'staff'
    }));

    // Add absence line overlay
    const absenceData = dates.map(d => {
      const rows = data.filter(x => x.date === d);
      return rows.reduce((s, r) => s + (Number(r.absences) || 0), 0);
    });

    datasets.push({
      type: 'line',
      label: 'Total Absences',
      data: absenceData,
      borderColor: '#EF4444',
      backgroundColor: '#EF4444',
      borderWidth: 2,
      pointRadius: 4,
      fill: false,
      tension: 0.2
    });

    this.charts['shiftCoverage'] = this.getOrCreateChart('shiftCoverageChart', {
      type: 'bar',
      data: {
        labels: formattedDates,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: baseFont, usePointStyle: true, padding: 12 }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: baseFont } },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: '#F1F5F9' },
            ticks: { font: baseFont, precision: 0 }
          }
        }
      }
    });
  }

  // ── Maintenance Summary Table ─────────────────────────────────────────────
  private buildMaintSummary(data: any[]): void {
    const types = Array.from(new Set(data.map(d => d.type)));
    this.maintSummary = types.map(type => {
      const rows = data.filter(d => d.type === type);
      const total = rows.reduce((s: number, r: any) => s + (Number(r.count) || 0), 0);
      const done = rows.filter((r: any) => r.status === 'COMPLETED').reduce((s: number, r: any) => s + (Number(r.count) || 0), 0);
      return {
        type,
        count: total,
        avg_downtime: rows[0]?.avg_downtime || 0,
        total_cost: rows.reduce((s: number, r: any) => s + (Number(r.total_cost) || 0), 0),
        completion_rate: total > 0 ? (done / total) * 100 : 0
      };
    });
    this.summaryPage = 1;
  }

  get pagedMaintSummary(): any[] {
    const start = (this.summaryPage - 1) * this.summaryPageSize;
    return this.maintSummary.slice(start, start + this.summaryPageSize);
  }

  get summaryTotalPages(): number {
    return Math.max(1, Math.ceil(this.maintSummary.length / this.summaryPageSize));
  }

  changeSummaryPage(page: number): void {
    if (page < 1 || page > this.summaryTotalPages) return;
    this.summaryPage = page;
  }

  onSummaryPageSizeChange(): void {
    this.summaryPage = 1;
  }

  // ── Helper Checks for Template ────────────────────────────────────────────
  hasChartData(chartKey: 'opsByType' | 'statusDonut' | 'maintOverview' | 'stock' | 'taskComp' | 'shiftCoverage'): boolean {
    switch (chartKey) {
      case 'opsByType':    return (this.rawData.opsByType?.length ?? 0) > 0;
      case 'statusDonut':  return (this.rawData.opsByStatus?.length ?? 0) > 0;
      case 'maintOverview':return (this.rawData.maintData?.length ?? 0) > 0;
      case 'stock':        return (this.rawData.stockData?.length ?? 0) > 0;
      case 'taskComp':     return (this.rawData.taskData?.length ?? 0) > 0;
      case 'shiftCoverage':return (this.rawData.shiftData?.length ?? 0) > 0;
    }
  }

  // ── Export Features ───────────────────────────────────────────────────────
  exportReport(): void {
    const report = {
      generated: new Date().toISOString(),
      period: this.dateLabel,
      kpis: this.kpis,
      summary: this.maintSummary,
      data: this.rawData
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `smart-analytics-${Date.now()}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  async exportPdf(): Promise<void> {
    const dashboard = document.getElementById('analytics-dashboard');
    if (!dashboard) return;

    try {
      const canvas = await html2canvas(dashboard, {
        scale: 2,
        backgroundColor: '#F8FAFC',
        useCORS: true
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * pageWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`smart-analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error('PDF generation error:', e);
    }
  }

  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  ngOnDestroy(): void {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.destroy$.next();
    this.destroy$.complete();
  }
}
