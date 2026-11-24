import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardAlertCounts, DashboardUrgentAlerts } from '../../../core/models/interfaces';
import { getPriorityBadge } from '../dashboard-helpers';

export type UrgentFilterTab = 'ALL' | 'OPS' | 'MAINT' | 'TASKS' | 'STOCK';

export interface UrgentQueueRow {
  domain: 'OPS' | 'MAINT' | 'TASKS' | 'STOCK';
  title: string;
  subtitle: string;
  sku?: string;
  badgeText: string;
  badgeClass: string;
  accentColor: string;
  ctaLabel: string;
  routerLink: string[];
  queryParams: Record<string, any>;
}

@Component({
  selector: 'app-dashboard-urgent-center',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './dashboard-urgent-center.component.html',
  styleUrls: ['./dashboard-urgent-center.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardUrgentCenterComponent {
  @Input() alerts: DashboardUrgentAlerts | null = null;
  @Input() alertCounts: DashboardAlertCounts | null = null;
  @Input() loading = false;

  activeTab: UrgentFilterTab = 'ALL';

  setTab(tab: UrgentFilterTab): void {
    this.activeTab = tab;
  }

  get opsCount(): number {
    return this.alertCounts?.overdueOperations ?? (this.alerts?.overdueOperations?.length || 0);
  }

  get maintCount(): number {
    return this.alertCounts?.criticalMaintenance ?? (this.alerts?.criticalMaintenance?.length || 0);
  }

  get tasksCount(): number {
    return this.alertCounts?.overdueTasks ?? (this.alerts?.overdueTasks?.length || 0);
  }

  get stockCount(): number {
    return this.alertCounts?.outOfStock ?? (this.alerts?.outOfStock?.length || 0);
  }

  get totalCount(): number {
    return this.alertCounts?.total ?? (this.opsCount + this.maintCount + this.tasksCount + this.stockCount);
  }

  get visibleRows(): UrgentQueueRow[] {
    const rows: UrgentQueueRow[] = [];
    const nowMs = Date.now();
    const datePipe = new DatePipe('en-US');

    if (this.activeTab === 'ALL' || this.activeTab === 'OPS') {
      for (const op of this.alerts?.overdueOperations || []) {
        const endTxt = op.end_date ? (datePipe.transform(op.end_date, 'MMM d, HH:mm') || 'past due') : 'past due';
        rows.push({
          domain: 'OPS',
          title: op.title,
          subtitle: `Operation · ${op.type?.name || 'Sortie'} · Due ${endTxt}`,
          badgeText: 'OVERDUE',
          badgeClass: 'badge-cancelled',
          accentColor: '#1565C0',
          ctaLabel: 'Inspect',
          routerLink: ['/operations'],
          queryParams: { status: 'OVERDUE', search: op.title }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'MAINT') {
      for (const m of this.alerts?.criticalMaintenance || []) {
        const isOverdue = m.status === 'SCHEDULED' && m.scheduled_date && new Date(m.scheduled_date).getTime() < nowMs;
        const schedTxt = m.scheduled_date ? (datePipe.transform(m.scheduled_date, 'MMM d') || '') : '';
        rows.push({
          domain: 'MAINT',
          title: m.title,
          subtitle: `Work Order · ${m.asset?.name || 'Equipment'}${schedTxt ? ' · ' + schedTxt : ''}`,
          badgeText: isOverdue ? 'OVERDUE' : (m.priority || 'HIGH'),
          badgeClass: isOverdue ? 'badge-cancelled' : getPriorityBadge(m.priority),
          accentColor: '#D97706',
          ctaLabel: 'Inspect',
          routerLink: ['/maintenance'],
          queryParams: { search: m.title }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'TASKS') {
      for (const t of this.alerts?.overdueTasks || []) {
        const dueTxt = t.due_date ? (datePipe.transform(t.due_date, 'MMM d') || 'No date') : 'No date';
        const isOverdue = Boolean(t.due_date && new Date(t.due_date).getTime() < nowMs);
        const assigneeName = t.assignee ? `${t.assignee.first_name || ''} ${t.assignee.last_name || ''}`.trim() : 'Unassigned';
        rows.push({
          domain: 'TASKS',
          title: t.title,
          subtitle: `Task · ${assigneeName} · Due ${dueTxt}`,
          badgeText: isOverdue ? 'OVERDUE' : (t.priority || 'CRITICAL'),
          badgeClass: isOverdue ? 'badge-cancelled' : getPriorityBadge(t.priority),
          accentColor: '#7C3AED',
          ctaLabel: 'Inspect',
          routerLink: ['/tasks'],
          queryParams: { id: t.id }
        });
      }
    }

    if (this.activeTab === 'ALL' || this.activeTab === 'STOCK') {
      for (const item of this.alerts?.outOfStock || []) {
        rows.push({
          domain: 'STOCK',
          title: item.name,
          subtitle: `Depleted · Reorder point ${item.reorder_point} ${item.unit || 'pcs'}`,
          sku: item.sku,
          badgeText: 'DEPLETED',
          badgeClass: 'badge-cancelled',
          accentColor: '#DC2626',
          ctaLabel: 'Restock',
          routerLink: ['/warehouse'],
          queryParams: { tab: 'reorder', search: item.sku }
        });
      }
    }

    return rows.slice(0, this.activeTab === 'ALL' ? 6 : 8);
  }
}
