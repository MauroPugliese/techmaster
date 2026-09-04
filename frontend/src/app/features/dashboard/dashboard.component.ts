// =============================================================================
// dashboard.component.ts — Full Dashboard with Chart.js
// =============================================================================
import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, combineLatest, interval } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import { DashboardKPIs, Operation, MaintenanceRecord, Shift, InventoryItem } from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, TitleCasePipe, ExportMenuComponent],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  Math = Math;

  loading = true;
  kpis: DashboardKPIs | null = null;
  recentOps:       Operation[]          = [];
  recentMaintenance: MaintenanceRecord[] = [];
  todayShifts:     Shift[]              = [];
  lowStockItems:   InventoryItem[]      = [];
  lowStockPage = 1;
  lowStockPageSize = 10;
  readonly lowStockPageSizeOptions = [10, 20, 50, 100];
  today            = new Date();
  dateFilterLabel  = 'All time';
  uiPrefs: UiSectionPreferences | null = null;

  private opsTrendChart: Chart | null = null;
  private taskDistChart: Chart | null = null;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.uiCustomization.load('dashboard').subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    // Re-fetch data whenever the global date filter changes or periodically.
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshDashboard());

    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      debounceTime(200)
    ).subscribe(() => this.refreshDashboard());

    this.refreshDashboard();
    this.loadTodayShifts();
    this.loadLowStock();
  }

  private refreshDashboard(): void {
    this.loading = true;
    this.dateFilterLabel = this.dateFilter.getLabel();
    this.cdr.markForCheck();

    combineLatest([
      this.api.get<any>('/dashboard/kpis', {}, this.dateFilter.currentRange),
      this.api.get<any>('/dashboard/recent-activity')
    ]).subscribe({
      next: ([kpisRes, activityRes]) => {
        this.kpis = kpisRes.data.kpis;
        this.recentOps = activityRes.data.operations;
        this.recentMaintenance = activityRes.data.maintenance;

        this.updateCharts(
          kpisRes.data.opsTrend,
          kpisRes.data.taskTrend,
          kpisRes.data.maintenanceTrend
        );
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  ngAfterViewInit(): void {
    this.initCharts();
  }

  private loadTodayShifts(): void {
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    this.api.get<any>('/shifts', { from: todayStr, to: todayStr }).subscribe(res => {
      this.todayShifts = res.data?.items?.slice(0, 6) || [];
      this.cdr.markForCheck();
    });
  }

  private loadLowStock(): void {
    this.api.get<any>('/warehouse', { low_stock: true, limit: 100 }).subscribe(res => {
      this.lowStockItems = res.data.items;
      this.lowStockPage = 1;
      this.cdr.markForCheck();
    });
  }

  get pagedLowStockItems(): InventoryItem[] {
    const start = (this.lowStockPage - 1) * this.lowStockPageSize;
    return this.lowStockItems.slice(start, start + this.lowStockPageSize);
  }

  get lowStockTotalPages(): number {
    return Math.max(1, Math.ceil(this.lowStockItems.length / this.lowStockPageSize));
  }

  changeLowStockPage(page: number): void {
    if (page < 1 || page > this.lowStockTotalPages) return;
    this.lowStockPage = page;
  }

  onLowStockPageSizeChange(): void {
    this.lowStockPage = 1;
  }

  private initCharts(): void {
    // Operations Trend Chart
    const opsCtx = (document.getElementById('opsTrendChart') as HTMLCanvasElement)?.getContext('2d');
    if (opsCtx) {
      this.opsTrendChart = new Chart(opsCtx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16, font: { family: 'Plus Jakarta Sans', size: 12 } } } },
          scales: {
            x: { grid: { color: '#E1EAF5' }, ticks: { font: { family: 'Plus Jakarta Sans', size: 11 } } },
            y: { beginAtZero: true, grid: { color: '#E1EAF5' }, ticks: { precision: 0, font: { family: 'Plus Jakarta Sans', size: 11 } } }
          },
          elements: { line: { tension: 0.4, borderWidth: 2.5 }, point: { radius: 4, hoverRadius: 6 } }
        }
      });
    }

    // Task Distribution Chart
    const taskCtx = (document.getElementById('taskDistChart') as HTMLCanvasElement)?.getContext('2d');
    if (taskCtx) {
      this.taskDistChart = new Chart(taskCtx, {
        type: 'doughnut',
        data: {
          labels: ['Daily', 'Weekly', 'Monthly', 'Yearly', 'One-time'],
          datasets: [{
            data: [0, 0, 0, 0, 0],
            backgroundColor: ['#1565C0','#0288D1','#00B0FF','#8B5CF6','#10B981'],
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { position: 'right', labels: { padding: 16, usePointStyle: true, font: { family: 'Plus Jakarta Sans', size: 12 } } }
          }
        }
      });
    }
  }

  private updateCharts(opsTrend: any[], taskTrend: any[], maintenanceTrend: any[]): void {
    if (!this.opsTrendChart) return;

    // Combine all three trend datasets for multi-series line chart
    // Extract all unique dates from all three data sources
    const allDates = [
      ...(opsTrend?.map((p: any) => p.date) || []),
      ...(taskTrend?.map((p: any) => p.date) || []),
      ...(maintenanceTrend?.map((p: any) => p.date) || [])
    ];
    const dateSet = [...new Set(allDates)].sort();

    // Define colors for each KPI type
    const kpiColors: Record<string, string> = {
      'Operations':  '#1565C0',
      'Tasks':       '#8B5CF6',
      'Maintenance': '#F59E0B'
    };

    // Calculate daily totals for each KPI type
    const operationsTotals = dateSet.map(date => {
      const records = opsTrend?.filter((p: any) => p.date === date) || [];
      return records.reduce((sum: number, r: any) => sum + Number(r.count), 0);
    });

    const tasksTotals = dateSet.map(date => {
      const records = taskTrend?.filter((p: any) => p.date === date) || [];
      return records.reduce((sum: number, r: any) => sum + Number(r.count), 0);
    });

    const maintenanceTotals = dateSet.map(date => {
      const records = maintenanceTrend?.filter((p: any) => p.date === date) || [];
      return records.reduce((sum: number, r: any) => sum + Number(r.count), 0);
    });

    // Update chart with multi-series data
    this.opsTrendChart.data.labels = dateSet;
    this.opsTrendChart.data.datasets = [
      {
        label: 'Operations',
        data: operationsTotals,
        borderColor: kpiColors['Operations'],
        backgroundColor: kpiColors['Operations'] + '15',
        fill: false,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: kpiColors['Operations']
      },
      {
        label: 'Tasks',
        data: tasksTotals,
        borderColor: kpiColors['Tasks'],
        backgroundColor: kpiColors['Tasks'] + '15',
        fill: false,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: kpiColors['Tasks']
      },
      {
        label: 'Maintenance',
        data: maintenanceTotals,
        borderColor: kpiColors['Maintenance'],
        backgroundColor: kpiColors['Maintenance'] + '15',
        fill: false,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: kpiColors['Maintenance']
      }
    ];
    this.opsTrendChart.update('active');

    // Task distribution chart remains unchanged
    if (taskTrend && this.taskDistChart) {
      const intervalOrder = ['DAILY','WEEKLY','MONTHLY','YEARLY','ONCE'];
      const counts = intervalOrder.map(it => {
        const rows = taskTrend.filter((r: any) => r.interval_type === it);
        return rows.reduce((sum: number, r: any) => sum + Number(r.count), 0);
      });
      this.taskDistChart.data.datasets[0].data = counts;
      this.taskDistChart.update('active');
    }
  }

  // ── Template Helpers ──────────────────────────────────────────────────────
  getStatusBadge(status: string): string {
    const map: Record<string,string> = {
      'PLANNED': 'badge-planned', 'IN_PROGRESS': 'badge-in-progress',
      'COMPLETED': 'badge-completed', 'CANCELLED': 'badge-cancelled',
      'ON_HOLD': 'badge-on-hold'
    };
    return map[status] || 'badge-planned';
  }

  getPriorityBadge(priority: string): string {
    const map: Record<string,string> = { 'LOW': 'badge-low', 'MEDIUM': 'badge-medium', 'HIGH': 'badge-high', 'CRITICAL': 'badge-critical' };
    return map[priority] || 'badge-medium';
  }

  getPriorityColor(priority: string): string {
    const map: Record<string,string> = { 'LOW': '#15803D', 'MEDIUM': '#D97706', 'HIGH': '#DC2626', 'CRITICAL': '#9D174D' };
    return map[priority] || '#D97706';
  }

  getShiftStatusBadge(status: string): string {
    const map: Record<string,string> = {
      'SCHEDULED': 'badge-planned', 'CONFIRMED': 'badge-in-progress',
      'IN_PROGRESS': 'badge-in-progress', 'COMPLETED': 'badge-completed',
      'ABSENT': 'badge-cancelled'
    };
    return map[status] || 'badge-planned';
  }

  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  ngOnDestroy(): void {
    this.opsTrendChart?.destroy();
    this.taskDistChart?.destroy();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
