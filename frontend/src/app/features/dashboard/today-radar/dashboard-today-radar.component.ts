import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardPlannedDueItem, DashboardTodaySchedule, MaintenanceRecord, Operation } from '../../../core/models/interfaces';
import {
  formatEnumLabel,
  getMaintenanceStatusBadge,
  getOperationStatusBadge,
  getPriorityBadge
} from '../dashboard-helpers';

export type RadarTab = 'sorties' | 'planned' | 'workorders';

@Component({
  selector: 'app-dashboard-today-radar',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './dashboard-today-radar.component.html',
  styleUrls: ['./dashboard-today-radar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardTodayRadarComponent {
  @Input() todaySchedule: DashboardTodaySchedule | null = null;
  @Input() loading = false;

  activeTab: RadarTab = 'sorties';

  setTab(tab: RadarTab): void {
    this.activeTab = tab;
  }

  get operations(): Operation[] {
    return this.todaySchedule?.operations || [];
  }

  get plannedItems(): DashboardPlannedDueItem[] {
    return this.todaySchedule?.plannedDue?.items || [];
  }

  get workOrders(): MaintenanceRecord[] {
    return this.todaySchedule?.upcomingWorkOrders || [];
  }

  get plannedTodaySummary(): string {
    const p = this.todaySchedule?.plannedDue;
    if (!p) return '0 due';
    return `${p.todayDone}/${p.todayTotal} done today · ${p.pendingNext7d} pending 7d`;
  }

  isWorkOrderOverdue(record: MaintenanceRecord): boolean {
    if (record.status !== 'SCHEDULED' || !record.scheduled_date) return false;
    return new Date(record.scheduled_date).getTime() < Date.now();
  }

  isOperationOverdue(op: Operation): boolean {
    if (['COMPLETED', 'CANCELLED'].includes(op.status) || !op.end_date) return false;
    return new Date(op.end_date).getTime() < Date.now();
  }

  opBadge(status: string): string {
    return getOperationStatusBadge(status);
  }

  maintBadge(status: string): string {
    return getMaintenanceStatusBadge(status);
  }

  priorityBadge(priority: string): string {
    return getPriorityBadge(priority);
  }

  label(val?: string | null): string {
    return formatEnumLabel(val);
  }
}
