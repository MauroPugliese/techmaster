// =============================================================================
// analytics.component.ts — Full Analytics with Multiple Chart.js Charts
// =============================================================================
import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe } from '@angular/common';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { Chart, registerables, ChartConfiguration } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';

Chart.register(...registerables, zoomPlugin);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, DecimalPipe, TitleCasePipe],
  templateUrl: './analytics.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private charts: Record<string, Chart | null> = {
    opsByType: null, maintOverview: null, stock: null,
    taskComp: null, shiftCoverage: null, statusDonut: null
  };

  maintSummary: any[] = [];
  dateLabel = 'All time';

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      switchMap(range => {
        this.dateLabel = this.dateFilter.getLabel();
        return forkJoin({
          opsByType:  this.api.get<any>('/analytics/operations-by-type', {}, range),
          maintData:  this.api.get<any>('/analytics/maintenance-overview', {}, range),
          stockData:  this.api.get<any>('/analytics/stock-movements', {}, range),
          taskData:   this.api.get<any>('/analytics/task-completion', {}, range),
          shiftData:  this.api.get<any>('/analytics/shift-coverage', {}, range)
        });
      })
    ).subscribe({
      next: ({ opsByType, maintData, stockData, taskData, shiftData }) => {
        this.updateOpsByType(opsByType.data);
        this.updateMaintOverview(maintData.data);
        this.updateStockChart(stockData.data);
        this.updateTaskChart(taskData.data);
        this.updateShiftChart(shiftData.data);
        this.updateStatusDonut(opsByType.data);
        this.buildMaintSummary(maintData.data);
        this.cdr.markForCheck();
      }
    });
  }

  ngAfterViewInit(): void { setTimeout(() => this.initCharts(), 50); }

  private initCharts(): void {
    // Shared chart defaults
    const baseFont = { family: 'Plus Jakarta Sans', size: 12 };
    const gridColor = '#E1EAF5';

    // 1) Operations by Type — Grouped Bar
    const opsCtx = this.getCtx('opsByTypeChart');
    if (opsCtx) {
      this.charts['opsByType'] = new Chart(opsCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true, padding: 14 } },
            zoom: {
              pan: { enabled: true, mode: 'x' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: baseFont } },
            y: { beginAtZero: true, grid: { color: gridColor }, ticks: { font: baseFont, precision: 0 } }
          },
          borderRadius: 6
        }
      } as ChartConfiguration);
    }

    // 2) Maintenance Overview — Horizontal Bar
    const maintCtx = this.getCtx('maintOverviewChart');
    if (maintCtx) {
      this.charts['maintOverview'] = new Chart(maintCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true } },
            zoom: {
              pan: { enabled: true, mode: 'x' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
          },
          scales: {
            x: { beginAtZero: true, stacked: true, grid: { color: gridColor }, ticks: { font: baseFont, precision: 0 } },
            y: { stacked: true, grid: { display: false }, ticks: { font: baseFont } }
          },
          borderRadius: 4
        }
      } as ChartConfiguration);
    }

    // 3) Stock Movements — Stacked Area Chart
    const stockCtx = this.getCtx('stockChart');
    if (stockCtx) {
      this.charts['stock'] = new Chart(stockCtx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true } },
            zoom: {
              pan: { enabled: true, mode: 'x' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
          },
          scales: {
            x: { grid: { color: gridColor }, ticks: { font: baseFont } },
            y: { beginAtZero: true, stacked: true, grid: { color: gridColor }, ticks: { font: baseFont, precision: 0 } }
          },
          elements: { line: { tension: 0.4, borderWidth: 2 }, point: { radius: 3 } }
        }
      });
    }

    // 4) Task Completion — Radar
    const taskCtx = this.getCtx('taskCompChart');
    if (taskCtx) {
      this.charts['taskComp'] = new Chart(taskCtx, {
        type: 'radar',
        data: { labels: ['Daily','Weekly','Monthly','Yearly','Once'], datasets: [] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true } },
            zoom: {
              pan: { enabled: true, mode: 'xy' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
            }
          },
          scales: {
            r: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { font: baseFont, backdropColor: 'transparent' },
              pointLabels: { font: { ...baseFont, size: 13 } }
            }
          },
          elements: { line: { borderWidth: 2 } }
        }
      });
    }

    // 5) Shift Coverage — Stacked Bar
    const shiftCtx = this.getCtx('shiftCoverageChart');
    if (shiftCtx) {
      this.charts['shiftCoverage'] = new Chart(shiftCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: baseFont, usePointStyle: true, padding: 12 } },
            zoom: {
              pan: { enabled: true, mode: 'x' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: baseFont } },
            y: { stacked: true, beginAtZero: true, grid: { color: gridColor }, ticks: { font: baseFont, precision: 0 } }
          },
          borderRadius: 4
        }
      } as ChartConfiguration);
    }

    // 6) Status Donut
    const donutCtx = this.getCtx('statusDonutChart');
    if (donutCtx) {
      this.charts['statusDonut'] = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0, hoverOffset: 8 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '70%',
          plugins: {
            legend: { position: 'bottom', labels: { font: baseFont, usePointStyle: true, padding: 12 } },
            zoom: {
              pan: { enabled: true, mode: 'xy' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
            }
          }
        }
      });
    }
  }

  // ── Data Update Methods ───────────────────────────────────────────────────
  private updateOpsByType(data: any[]): void {
    const c = this.charts['opsByType'];
    if (!c || !data?.length) return;
    c.data.labels = data.map(d => d.type);
    c.data.datasets = [
      { label: 'Total', data: data.map(d => +d.count), backgroundColor: data.map(d => d.color + 'CC'), borderColor: data.map(d => d.color), borderWidth: 1.5 },
      { label: 'Completed', data: data.map(d => +d.completed), backgroundColor: '#10B98144', borderColor: '#10B981', borderWidth: 1.5 }
    ];
    c.update('active');
  }

  private updateMaintOverview(data: any[]): void {
    const c = this.charts['maintOverview'];
    if (!c || !data?.length) return;
    const types = [...new Set(data.map((d: any) => d.type))];
    const statuses = [...new Set(data.map((d: any) => d.status))];
    const colors: Record<string,string> = { 'SCHEDULED':'#0288D1','IN_PROGRESS':'#F59E0B','COMPLETED':'#10B981','FAILED':'#EF4444','DEFERRED':'#6B7280' };

    c.data.labels = types;
    c.data.datasets = statuses.map(s => ({
      label: s,
      data: types.map(t => {
        const row = data.find((d: any) => d.type === t && d.status === s);
        return row ? +row.count : 0;
      }),
      backgroundColor: (colors[s] || '#9CA3AF') + 'BB',
      borderColor: colors[s] || '#9CA3AF',
      borderWidth: 1
    }));
    c.update('active');
  }

  private updateStockChart(data: any[]): void {
    const c = this.charts['stock'];
    if (!c || !data?.length) return;
    const dates = [...new Set(data.map((d: any) => d.date))].sort();
    c.data.labels = dates;
    c.data.datasets = [
      {
        label: 'Stock In',
        data: dates.map(d => { const r = data.find((x: any) => x.date === d && x.type === 'IN'); return r ? +r.total_qty : 0; }),
        borderColor: '#10B981',
        backgroundColor: '#10B98140',
        fill: true,
        stack: 'stock',
        tension: 0.4,
        borderWidth: 2
      },
      {
        label: 'Stock Out',
        data: dates.map(d => { const r = data.find((x: any) => x.date === d && x.type === 'OUT'); return r ? +r.total_qty : 0; }),
        borderColor: '#EF4444',
        backgroundColor: '#EF444440',
        fill: true,
        stack: 'stock',
        tension: 0.4,
        borderWidth: 2
      }
    ];
    c.update('active');
  }

  private updateTaskChart(data: any[]): void {
    const c = this.charts['taskComp'];
    if (!c || !data?.length) return;
    const intervals = ['DAILY','WEEKLY','MONTHLY','YEARLY','ONCE'];
    const doneData  = intervals.map(i => { const r = data.find((d: any) => d.interval_type === i && d.status === 'DONE'); return r ? +r.count : 0; });
    const pendData  = intervals.map(i => { const r = data.find((d: any) => d.interval_type === i && d.status !== 'DONE'); return r ? +r.count : 0; });
    c.data.datasets = [
      { label: 'Completed', data: doneData, backgroundColor: '#10B98130', borderColor: '#10B981', pointBackgroundColor: '#10B981' },
      { label: 'Pending',   data: pendData, backgroundColor: '#F59E0B30', borderColor: '#F59E0B', pointBackgroundColor: '#F59E0B' }
    ];
    c.update('active');
  }

  private updateShiftChart(data: any[]): void {
    const c = this.charts['shiftCoverage'];
    if (!c || !data?.length) return;
    const dates      = [...new Set(data.map((d: any) => d.date))].sort().slice(-14);
    const shiftNames = [...new Set(data.map((d: any) => d.shift_name))];
    const colorMap   = data.reduce((acc: any, d: any) => { acc[d.shift_name] = d.color; return acc; }, {});

    c.data.labels = dates.map(d => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}));
    c.data.datasets = shiftNames.map(name => ({
      label: name,
      data: dates.map(d => { const r = data.find((x: any) => x.date === d && x.shift_name === name); return r ? +r.employees : 0; }),
      backgroundColor: (colorMap[name] || '#1565C0') + 'BB',
      borderColor: colorMap[name] || '#1565C0',
      borderWidth: 1
    }));
    c.update('active');
  }

  private updateStatusDonut(data: any[]): void {
    const c = this.charts['statusDonut'];
    if (!c || !data?.length) return;
    // aggregate by status (use ops data as proxy)
    const statusColors: Record<string,string> = {
      'PLANNED':'#5C6BC0','IN_PROGRESS':'#0288D1','COMPLETED':'#10B981','CANCELLED':'#EF4444','ON_HOLD':'#F59E0B'
    };
    c.data.labels = data.map(d => d.type);
    (c.data.datasets[0] as any).data = data.map(d => +d.count);
    (c.data.datasets[0] as any).backgroundColor = data.map(d => d.color + 'CC');
    c.update('active');
  }

  private buildMaintSummary(data: any[]): void {
    const types = [...new Set(data.map((d: any) => d.type))];
    this.maintSummary = types.map(type => {
      const rows = data.filter((d: any) => d.type === type);
      const total = rows.reduce((s: number, r: any) => s + +r.count, 0);
      const done  = rows.filter((r: any) => r.status === 'COMPLETED').reduce((s: number, r: any) => s + +r.count, 0);
      return {
        type,
        count: total,
        avg_downtime: rows[0]?.avg_downtime || 0,
        total_cost: rows.reduce((s: number, r: any) => s + (+r.total_cost || 0), 0),
        completion_rate: total > 0 ? (done / total) * 100 : 0
      };
    });
  }

  private getCtx(id: string): CanvasRenderingContext2D | null {
    return (document.getElementById(id) as HTMLCanvasElement)?.getContext('2d') ?? null;
  }

  exportReport(): void {
    const report: any = { generated: new Date().toISOString(), period: this.dateLabel, summary: this.maintSummary };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `smart-report-${Date.now()}.json` });
    a.click(); URL.revokeObjectURL(url);
  }

  async exportPdf(): Promise<void> {
    const dashboard = document.getElementById('analytics-dashboard');
    if (!dashboard) return;

    const canvas = await html2canvas(dashboard, {
      scale: 2,
      backgroundColor: '#F0F4F8',
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
  }

  ngOnDestroy(): void {
    Object.values(this.charts).forEach(c => c?.destroy());
    this.destroy$.next(); this.destroy$.complete();
  }
}
