import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Subject, combineLatest, interval, of } from 'rxjs';
import { takeUntil, debounceTime, catchError, timeout } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import {
  DashboardKPIs, Operation, MaintenanceRecord, Shift, InventoryItem, Task, StockMovement, DashboardUrgentAlerts
} from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';

Chart.register(...registerables);

export interface ActivityFeedItem {
  id: number;
  title: string;
  category: 'OPERATION' | 'MAINTENANCE' | 'TASK' | 'STOCK';
  icon: string;
  color: string;
  timestamp: string | Date;
  statusText: string;
  badgeClass: string;
  subtitle: string;
  routerLink: string[];
  queryParams?: Record<string, any>;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe, TitleCasePipe, ExportMenuComponent, DropdownComponent, DropdownOptionComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  Math = Math;

  loading = true;
  refreshing = false;
  lastRefreshed = new Date();
  kpis: DashboardKPIs | null = null;
  recentOps: Operation[] = [];
  recentMaintenance: MaintenanceRecord[] = [];
  recentTasks: Task[] = [];
  recentMovements: StockMovement[] = [];
  urgentAlerts: DashboardUrgentAlerts | null = null;

  todayShifts: Shift[] = [];
  lowStockItems: InventoryItem[] = [];
  lowStockPage = 1;
  lowStockPageSize = 10;
  readonly lowStockPageSizeOptions = [10, 20, 50, 100];
  today = new Date();
  dateFilterLabel = 'All time';
  uiPrefs: UiSectionPreferences | null = null;

  activeActivityTab: 'ALL' | 'OPS' | 'MAINT' | 'TASKS' | 'STOCK' = 'ALL';
  fleetReadinessPct = 100;

  private opsTrendChart: Chart | null = null;
  private taskDistChart: Chart | null = null;

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private uiCustomization: UiCustomizationService,
    private router: Router,
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

  refreshDashboard(isManual = false): void {
    if (isManual) {
      this.refreshing = true;
      this.cdr.markForCheck();
    } else {
      this.loading = true;
    }
    this.dateFilterLabel = this.dateFilter.getLabel();

    combineLatest([
      this.api.get<any>('/dashboard/kpis', {}, this.dateFilter.currentRange).pipe(
        timeout(10000),
        catchError(() => of({ data: { kpis: this.emptyKpis(), opsTrend: [], taskTrend: [], maintenanceTrend: [] } }))
      ),
      this.api.get<any>('/dashboard/recent-activity').pipe(
        timeout(10000),
        catchError(() => of({ data: { operations: [], maintenance: [], tasks: [], movements: [] } }))
      ),
      this.api.get<any>('/dashboard/urgent-alerts').pipe(
        timeout(10000),
        catchError(() => of({ data: { overdueTasks: [], criticalMaintenance: [], outOfStock: [] } }))
      )
    ]).subscribe({
      next: ([kpisRes, activityRes, alertsRes]) => {
        this.kpis = kpisRes?.data?.kpis || this.emptyKpis();
        this.recentOps = activityRes?.data?.operations || [];
        this.recentMaintenance = activityRes?.data?.maintenance || [];
        this.recentTasks = activityRes?.data?.tasks || [];
        this.recentMovements = activityRes?.data?.movements || [];
        this.urgentAlerts = alertsRes?.data || { overdueTasks: [], criticalMaintenance: [], outOfStock: [] };

        const totalAssets = this.kpis.totalAssets ?? 0;
        const activeAssets = this.kpis.activeAssets ?? 0;
        this.fleetReadinessPct = totalAssets > 0 ? Math.round((activeAssets / totalAssets) * 100) : 100;

        this.updateCharts(
          kpisRes?.data?.opsTrend || [],
          kpisRes?.data?.taskTrend || [],
          kpisRes?.data?.maintenanceTrend || []
        );

        this.lastRefreshed = new Date();
        this.loading = false;
        this.refreshing = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.refreshing = false;
        this.cdr.markForCheck();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initCharts();
    if (this.kpis) {
      this.refreshDashboard();
    }
  }

  private loadTodayShifts(): void {
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    this.api.get<any>('/shifts', { from: todayStr, to: todayStr }).pipe(
      timeout(10000),
      catchError(() => of({ data: { items: [] } }))
    ).subscribe({
      next: res => {
        this.todayShifts = res.data?.items?.slice(0, 6) || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.todayShifts = [];
        this.cdr.markForCheck();
      }
    });
  }

  private loadLowStock(): void {
    this.api.get<any>('/warehouse', { low_stock: true, limit: 100 }).pipe(
      timeout(10000),
      catchError(() => of({ data: { items: [] } }))
    ).subscribe({
      next: res => {
        this.lowStockItems = res.data?.items || [];
        this.lowStockPage = 1;
        this.cdr.markForCheck();
      },
      error: () => {
        this.lowStockItems = [];
        this.lowStockPage = 1;
        this.cdr.markForCheck();
      }
    });
  }

  private emptyKpis(): DashboardKPIs {
    return {
      totalOps: 0,
      activeOps: 0,
      pendingMaint: 0,
      lowStockCount: 0,
      openTasks: 0,
      activeUsers: 0
    };
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

  // ── Urgent Alerts & Activity Getters ──────────────────────────────────────
  get urgentAlertsTotal(): number {
    if (!this.urgentAlerts) return 0;
    return (
      (this.urgentAlerts.overdueTasks?.length || 0) +
      (this.urgentAlerts.criticalMaintenance?.length || 0) +
      (this.urgentAlerts.outOfStock?.length || 0)
    );
  }

  get hasUrgentAlerts(): boolean {
    return this.urgentAlertsTotal > 0;
  }

  setActivityTab(tab: 'ALL' | 'OPS' | 'MAINT' | 'TASKS' | 'STOCK'): void {
    this.activeActivityTab = tab;
  }

  getMovementTypeBadge(type: string): string {
    switch (type) {
      case 'IN':
      case 'RETURN':
        return 'badge-movement-in';
      case 'OUT':
      case 'TRANSFER':
        return 'badge-movement-out';
      default:
        return 'badge-movement-adj';
    }
  }

  getMovementTypeIcon(type: string): string {
    switch (type) {
      case 'IN':
      case 'RETURN':
        return 'south_west';
      case 'OUT':
      case 'TRANSFER':
        return 'north_east';
      default:
        return 'sync_alt';
    }
  }

  get combinedActivities(): ActivityFeedItem[] {
    const items: ActivityFeedItem[] = [];

    if (this.activeActivityTab === 'ALL' || this.activeActivityTab === 'OPS') {
      for (const op of this.recentOps) {
        items.push({
          id: op.id,
          title: op.title,
          category: 'OPERATION',
          icon: 'rocket_launch',
          color: op.type?.color || '#1565C0',
          timestamp: op.created_at,
          statusText: op.status,
          badgeClass: this.getStatusBadge(op.status),
          subtitle: `${op.type?.name || 'Sortie'} · ${op.location || 'Base'}`,
          routerLink: ['/operations'],
          queryParams: { search: op.title }
        });
      }
    }

    if (this.activeActivityTab === 'ALL' || this.activeActivityTab === 'MAINT') {
      for (const m of this.recentMaintenance) {
        items.push({
          id: m.id,
          title: m.title,
          category: 'MAINTENANCE',
          icon: 'build_circle',
          color: '#F59E0B',
          timestamp: m.scheduled_date || m.created_at,
          statusText: m.status,
          badgeClass: this.getStatusBadge(m.status),
          subtitle: `${m.asset?.name || 'Equipment'} · ${m.type || 'Service'}`,
          routerLink: ['/maintenance'],
          queryParams: { search: m.title }
        });
      }
    }

    if (this.activeActivityTab === 'ALL' || this.activeActivityTab === 'TASKS') {
      for (const t of this.recentTasks) {
        items.push({
          id: t.id,
          title: t.title,
          category: 'TASK',
          icon: 'task_alt',
          color: '#8B5CF6',
          timestamp: t.created_at,
          statusText: t.status,
          badgeClass: this.getStatusBadge(t.status),
          subtitle: `${t.assignee ? (t.assignee.first_name + ' ' + (t.assignee.last_name || '')) : 'Unassigned'} · ${t.interval_type || 'Task'}`,
          routerLink: ['/tasks'],
          queryParams: { search: t.title }
        });
      }
    }

    if (this.activeActivityTab === 'ALL' || this.activeActivityTab === 'STOCK') {
      for (const mv of this.recentMovements) {
        items.push({
          id: mv.id,
          title: `${mv.item?.name || 'Stock item'} (${mv.type === 'IN' || mv.type === 'RETURN' ? '+' : '-'}${mv.quantity} ${mv.item?.unit || 'units'})`,
          category: 'STOCK',
          icon: this.getMovementTypeIcon(mv.type),
          color: '#10B981',
          timestamp: mv.movement_date,
          statusText: mv.type,
          badgeClass: this.getMovementTypeBadge(mv.type),
          subtitle: `${mv.reason || 'Warehouse Move'} · by ${mv.user?.first_name || 'Staff'}`,
          routerLink: ['/warehouse'],
          queryParams: { search: mv.item?.sku || '' }
        });
      }
    }

    // Sort descending by timestamp
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);
  }

  navigateTo(path: string, queryParams?: Record<string, any>): void {
    this.router.navigate([path], { queryParams });
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
