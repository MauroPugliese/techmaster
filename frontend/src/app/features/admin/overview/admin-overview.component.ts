// =============================================================================
// features/admin/overview/admin-overview.component.ts
// =============================================================================
import {
  Component, Input, Output, EventEmitter, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';
import {
  AdminTab,
  formatUptimeDetailed,
  getHttpStatusBadgeStyle,
  getMethodBadgeStyle,
  getRoleColor,
} from '../admin-helpers';

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, TitleCasePipe, ExportMenuComponent],
  templateUrl: './admin-overview.component.html',
  styleUrls: ['./admin-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewComponent {
  @Input() systemInfo: any = null;
  @Input() loading = false;

  @Output() refreshRequested = new EventEmitter<void>();
  @Output() navigateTab = new EventEmitter<AdminTab>();
  @Output() openRoleUsers = new EventEmitter<string>();

  constructor(private router: Router) {}

  getRoleColor = getRoleColor;
  getMethodBadgeStyle = getMethodBadgeStyle;
  getHttpStatusBadgeStyle = getHttpStatusBadgeStyle;

  get uptimeLabel(): string {
    return formatUptimeDetailed(this.systemInfo?.uptime || 0);
  }

  get heapUsagePct(): number {
    const used = Number(this.systemInfo?.health?.memory?.heap_used_mb) || 0;
    const total = Number(this.systemInfo?.health?.memory?.heap_total_mb) || 1;
    return Math.min(100, Math.round((used / total) * 100));
  }

  get countCards(): {
    label: string;
    val: number;
    icon: string;
    color: string;
    tab?: AdminTab;
    route?: string;
  }[] {
    const c = this.systemInfo?.counts;
    if (!c) return [];
    return [
      { label: 'Total Users',     val: c.users,           icon: 'group',         color: '#1565C0', tab: 'users' },
      { label: 'Active Users',    val: c.active_users,    icon: 'how_to_reg',    color: '#10B981', tab: 'users' },
      { label: 'Operations',      val: c.operations,      icon: 'rocket_launch', color: '#0288D1', route: '/operations' },
      { label: 'Maintenance',     val: c.maintenance,     icon: 'build_circle',  color: '#F59E0B', route: '/maintenance' },
      { label: 'Inventory Items', val: c.inventory_items, icon: 'inventory_2',   color: '#8B5CF6', route: '/warehouse' },
      { label: 'Shifts',          val: c.shifts,          icon: 'schedule',      color: '#EC4899', route: '/shifts' },
      { label: 'Tasks',           val: c.tasks,           icon: 'task_alt',      color: '#EF4444', route: '/tasks' },
      { label: 'Wiki Articles',   val: c.wiki_articles,   icon: 'menu_book',     color: '#059669', route: '/wiki' },
    ];
  }

  onCardClick(card: { tab?: AdminTab; route?: string }): void {
    if (card.tab) {
      this.navigateTab.emit(card.tab);
    } else if (card.route) {
      this.router.navigate([card.route]);
    }
  }
}
