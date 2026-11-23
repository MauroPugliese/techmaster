// =============================================================================
// features/admin/admin.component.ts — Modular Admin Settings Console Shell
// =============================================================================
import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/services';
import { ToastService } from '../../core/services/toast.service';
import {
  ADMIN_NAV_GROUPS,
  ALL_ADMIN_TABS,
  AdminTab,
} from './admin-helpers';
import { AdminOverviewComponent } from './overview/admin-overview.component';
import { AdminAuditLogsComponent } from './audit-logs/admin-audit-logs.component';
import { AdminUsersComponent } from './users/admin-users.component';
import { AdminRolesComponent } from './roles/admin-roles.component';
import { AccessTarget, SectionAccessManagerComponent } from './section-access/section-access-manager.component';
import { AdminCatalogsComponent, CatalogTab } from './catalogs/admin-catalogs.component';
import { AdminCustomizationComponent } from './customization/admin-customization.component';

const CATALOG_TABS = new Set<string>([
  'operation-types',
  'shift-types',
  'asset-categories',
  'item-categories',
  'wiki-categories',
  'warehouse-locations',
]);

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    AdminOverviewComponent,
    AdminAuditLogsComponent,
    AdminUsersComponent,
    AdminRolesComponent,
    SectionAccessManagerComponent,
    AdminCatalogsComponent,
    AdminCustomizationComponent,
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  readonly navGroups = ADMIN_NAV_GROUPS;
  readonly validTabs = new Set<string>(ALL_ADMIN_TABS.map(t => t.id));

  activeTab: AdminTab = 'overview';

  roles: any[] = [];
  systemInfo: any = null;
  overviewLoading = false;
  sidebarCounts: Record<string, number> = {};

  // Cross-tab deep-link state
  usersInitialRoleFilterId: number | null = null;
  sectionAccessTarget: AccessTarget | null = null;
  sectionAccessRole: string | null = null;
  sectionAccessUserId: number | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  get activeTabLabel(): string {
    return ALL_ADMIN_TABS.find(t => t.id === this.activeTab)?.label ?? 'Admin Settings';
  }

  get activeCatalogTab(): CatalogTab | null {
    return CATALOG_TABS.has(this.activeTab) ? (this.activeTab as CatalogTab) : null;
  }

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const requested = String(params['tab'] || '').trim();
        if (requested && this.validTabs.has(requested) && requested !== this.activeTab) {
          this.activeTab = requested as AdminTab;
          this.cdr.markForCheck();
        }
      });

    this.loadRoles();
    this.loadSystemInfo();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: AdminTab, preserveDeepLinks = false): void {
    this.activeTab = tab;
    if (!preserveDeepLinks) {
      if (tab !== 'users') this.usersInitialRoleFilterId = null;
      if (tab !== 'section-access') {
        this.sectionAccessTarget = null;
        this.sectionAccessRole = null;
        this.sectionAccessUserId = null;
      }
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
    if (tab === 'overview') {
      this.loadSystemInfo();
    }
    this.cdr.markForCheck();
  }

  loadRoles(): void {
    this.api.get<any>('/admin/roles').subscribe({
      next: res => {
        this.roles = res.data || [];
        this.sidebarCounts = {
          ...this.sidebarCounts,
          roles: this.roles.length,
        };
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  loadSystemInfo(): void {
    this.overviewLoading = true;
    this.api.get<any>('/admin/system').subscribe({
      next: res => {
        this.systemInfo = res.data || null;
        const counts = res.data?.counts || {};
        const catalogs = res.data?.catalog_counts || {};
        this.sidebarCounts = {
          ...this.sidebarCounts,
          users: Number(counts.users) || 0,
          roles: this.roles.length || this.sidebarCounts['roles'] || 0,
          operation_types: Number(catalogs.operation_types) || 0,
          shift_types: Number(catalogs.shift_types) || 0,
          asset_categories: Number(catalogs.asset_categories) || 0,
          item_categories: Number(catalogs.item_categories) || 0,
          wiki_categories: Number(catalogs.wiki_categories) || 0,
          warehouse_locations: Number(catalogs.warehouse_locations) || 0,
        };
        this.overviewLoading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.overviewLoading = false;
        if (this.activeTab === 'overview') {
          this.toast.error(err?.error?.message || 'Failed to load system overview.');
        }
        this.cdr.markForCheck();
      }
    });
  }

  onOpenUsersByRoleName(roleName: string): void {
    const found = this.roles.find(r => String(r.name).toLowerCase() === String(roleName).toLowerCase());
    this.usersInitialRoleFilterId = found ? found.id : null;
    this.setTab('users', true);
  }

  onOpenUsersByRoleId(roleId: number): void {
    this.usersInitialRoleFilterId = roleId;
    this.setTab('users', true);
  }

  onOpenUserSectionAccess(userId: number): void {
    this.sectionAccessTarget = 'user';
    this.sectionAccessUserId = userId;
    this.sectionAccessRole = null;
    this.setTab('section-access', true);
  }

  onOpenRoleSectionAccess(roleName: string): void {
    this.sectionAccessTarget = 'role';
    this.sectionAccessRole = roleName;
    this.sectionAccessUserId = null;
    this.setTab('section-access', true);
  }

  getItemCount(countKey?: string): number | null {
    if (!countKey) return null;
    const val = this.sidebarCounts[countKey];
    return typeof val === 'number' ? val : null;
  }
}
