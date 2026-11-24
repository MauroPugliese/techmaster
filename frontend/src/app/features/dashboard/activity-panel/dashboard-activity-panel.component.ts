import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MaintenanceRecord, Operation, StockMovement, Task } from '../../../core/models/interfaces';
import {
  formatEnumLabel,
  formatRelativeTime,
  getMaintenanceStatusBadge,
  getMovementBadge,
  getMovementIcon,
  getOperationStatusBadge,
  getTaskStatusBadge
} from '../dashboard-helpers';

export type ActivityTab = 'ALL' | 'OPS' | 'MAINT' | 'TASKS' | 'STOCK';

export interface ActivityFeedRow {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  timestamp: string | Date;
  relativeTime: string;
  statusText: string;
  badgeClass: string;
  routerLink: string[];
  queryParams: Record<string, any>;
}

@Component({
  selector: 'app-dashboard-activity-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './dashboard-activity-panel.component.html',
  styleUrls: ['./dashboard-activity-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardActivityPanelComponent {
  @Input() recentOps: Operation[] = [];
  @Input() recentMaintenance: MaintenanceRecord[] = [];
  @Input() recentTasks: Task[] = [];
  @Input() recentMovements: StockMovement[] = [];
  @Input() loading = false;

  activeTab: ActivityTab = 'ALL';

  setTab(tab: ActivityTab): void {
    this.activeTab = tab;
  }

  get feedItems(): ActivityFeedRow[] {
    const items: ActivityFeedRow[] = [];
    const now = new Date();

    if (this.activeTab === 'ALL' || this.activeTab === 'OPS') {
      for (const op of this.recentOps) {
        items.push({
          title: op.title,
          subtitle: `${op.type?.name || 'Sortie'} · ${op.location || 'Base'}`,
          icon: 'rocket_launch',
          color: op.type?.color || '#1565C0',
          timestamp: op.created_at,
          relativeTime: formatRelativeTime(op.created_at, now),
          statusText: formatEnumLabel(op.status),
          badgeClass: getOperationStatusBadge(op.status),
          routerLink: ['/operations'],
          queryParams: { search: op.title }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'MAINT') {
      for (const m of this.recentMaintenance) {
        items.push({
          title: m.title,
          subtitle: `${m.asset?.name || 'Equipment'} · ${formatEnumLabel(m.type)}`,
          icon: 'build_circle',
          color: '#D97706',
          timestamp: m.created_at || m.scheduled_date,
          relativeTime: formatRelativeTime(m.created_at || m.scheduled_date, now),
          statusText: formatEnumLabel(m.status),
          badgeClass: getMaintenanceStatusBadge(m.status),
          routerLink: ['/maintenance'],
          queryParams: { search: m.title }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'TASKS') {
      for (const t of this.recentTasks) {
        const assigneeName = t.assignee
          ? `${t.assignee.first_name || ''} ${t.assignee.last_name || ''}`.trim()
          : 'Unassigned';
        items.push({
          title: t.title,
          subtitle: `${assigneeName} · ${formatEnumLabel(t.interval_type)}`,
          icon: 'task_alt',
          color: '#7C3AED',
          timestamp: t.created_at,
          relativeTime: formatRelativeTime(t.created_at, now),
          statusText: formatEnumLabel(t.status),
          badgeClass: getTaskStatusBadge(t.status),
          routerLink: ['/tasks'],
          queryParams: { id: t.id }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'STOCK') {
      for (const mv of this.recentMovements) {
        const sign = mv.type === 'IN' || mv.type === 'RETURN' ? '+' : (mv.type === 'ADJUSTMENT' ? '' : '-');
        const actor = mv.user?.first_name || 'Staff';
        items.push({
          title: `${mv.item?.name || 'Inventory item'} (${sign}${mv.quantity} ${mv.item?.unit || 'pcs'})`,
          subtitle: `${mv.reason || 'Warehouse move'} · by ${actor}`,
          icon: getMovementIcon(mv.type),
          color: '#059669',
          timestamp: mv.movement_date,
          relativeTime: formatRelativeTime(mv.movement_date, now),
          statusText: mv.type,
          badgeClass: getMovementBadge(mv.type),
          routerLink: ['/warehouse'],
          queryParams: { tab: 'movements', search: mv.item?.sku || '' }
        });
      }
    }

    return items
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 12);
  }
}
