// =============================================================================
// features/admin/roles/admin-roles.component.ts — Role & Permission Directory
// =============================================================================
import {
  Component, OnInit, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { ApiService } from '../../../core/services/services';
import { ToastService } from '../../../core/services/toast.service';
import { getRoleColor } from '../admin-helpers';

interface RoleCapabilityRow {
  capability: string;
  description: string;
  check: (roleName: string, perms: string[]) => boolean;
}

@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [CommonModule, TitleCasePipe],
  templateUrl: './admin-roles.component.html',
  styleUrls: ['./admin-roles.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRolesComponent implements OnInit {
  @Output() viewRoleUsers = new EventEmitter<number>();
  @Output() configureSectionAccess = new EventEmitter<string>();

  roles: any[] = [];
  loading = false;

  readonly capabilities: RoleCapabilityRow[] = [
    {
      capability: 'Read Workspace Data',
      description: 'View dashboards, operations, maintenance, inventory, shifts, and wiki documentation',
      check: (role, perms) => perms.includes('*') || perms.includes('read') || role === 'viewer',
    },
    {
      capability: 'Create & Edit Records',
      description: 'Log sorties, maintenance interventions, stock movements, shifts, tasks, and wiki articles',
      check: (_role, perms) => perms.includes('*') || perms.includes('write'),
    },
    {
      capability: 'Approve & Manage Team Users',
      description: 'Create/edit team members and manage operational assignments',
      check: (_role, perms) => perms.includes('*') || perms.includes('manage_users'),
    },
    {
      capability: 'Full Admin & Schema Console',
      description: 'Inspect audit logs, modify DB columns, manage lookup catalogs, and control UI visibility',
      check: (role, perms) => perms.includes('*') || role === 'admin',
    },
  ];

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadRoles();
  }

  getRoleColor = getRoleColor;

  loadRoles(): void {
    this.loading = true;
    this.api.get<any>('/admin/roles').subscribe({
      next: res => {
        this.roles = res.data || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load roles.');
        this.cdr.markForCheck();
      }
    });
  }

  parsePermissions(role: any): string[] {
    if (Array.isArray(role?.permissions)) return role.permissions;
    if (typeof role?.permissions === 'string') {
      try {
        const parsed = JSON.parse(role.permissions);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  hasCapability(role: any, cap: RoleCapabilityRow): boolean {
    const perms = this.parsePermissions(role);
    return cap.check(String(role?.name || '').toLowerCase(), perms);
  }
}
