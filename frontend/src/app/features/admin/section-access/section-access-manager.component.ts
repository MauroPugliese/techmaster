import {
  Component, OnInit, Input, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, SectionAccessService, ToastService, ConfirmService } from '../../../core/services/services';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';

export type AccessTarget = 'global' | 'role' | 'user';

export interface NavSectionRow {
  section_key: string;
  label: string;
  path: string;
  group: string;
  icon: string;
  is_visible: boolean;
  source: 'user' | 'role' | 'global' | 'default' | string;
}

export interface AccessSummaryItem {
  label: string;
  value: number;
  color: string;
  textColor: string;
}

@Component({
  selector: 'app-section-access-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, TitleCasePipe, DropdownComponent, DropdownOptionComponent],
  templateUrl: './section-access-manager.component.html',
  styleUrls: ['./section-access-manager.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SectionAccessManagerComponent implements OnInit {
  @Input() roles: any[] = [];

  target: AccessTarget = 'global';
  selectedRole = 'viewer';
  selectedUserId: number | null = null;

  users: any[] = [];
  usersLoading = false;
  userSearch = '';

  catalog: Record<string, any> = {};
  sections: NavSectionRow[] = [];
  loading = false;
  saving = false;

  sectionSearch = '';
  selectedGroupFilter = 'ALL';
  selectedStatusFilter: 'all' | 'visible' | 'hidden' | 'overridden' = 'all';

  constructor(
    private api: ApiService,
    private sectionAccess: SectionAccessService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.roles.length && !this.roles.some(r => r.name === this.selectedRole)) {
      this.selectedRole = this.roles[0].name;
    }
    this.loadCatalog();
    this.loadUsers();
  }

  // ── Catalog & Preferences Loading ─────────────────────────────────────────
  loadCatalog(): void {
    this.loading = true;
    this.api.get<any>('/admin/ui-navigation/catalog').subscribe({
      next: (res) => {
        this.catalog = res.data || {};
        this.loadPreferences();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load navigation section catalog.');
        this.cdr.markForCheck();
      }
    });
  }

  loadUsers(): void {
    this.usersLoading = true;
    this.api.get<any>('/admin/users', { page: 1, limit: 500 }).subscribe({
      next: (res) => {
        this.users = res.data?.items || [];
        this.usersLoading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.usersLoading = false;
        this.toast.error(err?.error?.message || 'Failed to load users for section access.');
        this.cdr.markForCheck();
      }
    });
  }

  loadPreferences(): void {
    if (!Object.keys(this.catalog).length) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    if (this.target === 'user' && !this.selectedUserId) {
      this.sections = [];
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.api.get<any>('/admin/ui-navigation/access', this.buildParams()).subscribe({
      next: (res) => {
        const data = res.data || [];
        const rawList = Array.isArray(data)
          ? data
          : (Array.isArray(data.sections) ? data.sections : []);

        this.sections = rawList.map((item: any): NavSectionRow => ({
          section_key: String(item.section_key || ''),
          label: String(item.label || item.section_key || ''),
          path: String(item.path || ''),
          group: String(item.group || 'Other'),
          icon: String(item.icon || 'apps'),
          is_visible: !(item.is_visible === false || item.is_visible === 0 || item.is_visible === '0'),
          source: String(item.source || 'default')
        }));

        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load section preferences.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Target Handlers ────────────────────────────────────────────────────────
  setTarget(target: AccessTarget): void {
    if (this.target === target) return;
    this.target = target;
    if (target === 'role' && !this.selectedRole && this.roles.length) {
      this.selectedRole = this.roles[0].name;
    }
    this.loadPreferences();
  }

  onRoleChange(roleName: string): void {
    this.selectedRole = roleName;
    this.loadPreferences();
  }

  selectUser(userId: number): void {
    this.selectedUserId = userId;
    this.loadPreferences();
  }

  // ── User Filtering ─────────────────────────────────────────────────────────
  get filteredUsers(): any[] {
    const q = this.userSearch.trim().toLowerCase();
    if (!q) return this.users;
    return this.users.filter(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const username = (u.username || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const role = (u.role?.name || '').toLowerCase();
      return name.includes(q) || username.includes(q) || email.includes(q) || role.includes(q);
    });
  }

  get selectedUser(): any | null {
    if (!this.selectedUserId) return null;
    return this.users.find(u => u.id === this.selectedUserId) || null;
  }

  // ── Section Filtering ──────────────────────────────────────────────────────
  get availableGroups(): string[] {
    const groups = new Set<string>();
    for (const s of this.sections) {
      if (s.group) groups.add(s.group);
    }
    return Array.from(groups).sort();
  }

  get filteredSections(): NavSectionRow[] {
    const q = this.sectionSearch.trim().toLowerCase();
    return this.sections.filter(s => {
      if (this.selectedGroupFilter !== 'ALL' && s.group !== this.selectedGroupFilter) {
        return false;
      }
      if (this.selectedStatusFilter === 'visible' && !s.is_visible) return false;
      if (this.selectedStatusFilter === 'hidden' && s.is_visible) return false;
      if (this.selectedStatusFilter === 'overridden') {
        if (this.target === 'user' && s.source !== 'user') return false;
        if (this.target === 'role' && s.source !== 'role') return false;
        if (this.target === 'global' && s.source !== 'global') return false;
      }
      if (q) {
        const key = s.section_key.toLowerCase();
        const label = s.label.toLowerCase();
        const path = s.path.toLowerCase();
        const group = s.group.toLowerCase();
        return key.includes(q) || label.includes(q) || path.includes(q) || group.includes(q);
      }
      return true;
    });
  }

  // ── Toggle and Bulk Actions (Immutable) ────────────────────────────────────
  toggleSection(sectionKey: string): void {
    this.sections = this.sections.map(s => {
      if (s.section_key !== sectionKey) return s;
      return {
        ...s,
        is_visible: !s.is_visible,
        source: this.target === 'user' ? 'user' : (this.target === 'role' ? 'role' : 'global')
      };
    });
    this.cdr.markForCheck();
  }

  setAllVisibility(visible: boolean): void {
    const currentSource = this.target === 'user' ? 'user' : (this.target === 'role' ? 'role' : 'global');
    this.sections = this.sections.map(s => ({
      ...s,
      is_visible: visible,
      source: currentSource
    }));
    this.cdr.markForCheck();
  }

  invertVisibility(): void {
    const currentSource = this.target === 'user' ? 'user' : (this.target === 'role' ? 'role' : 'global');
    this.sections = this.sections.map(s => ({
      ...s,
      is_visible: !s.is_visible,
      source: currentSource
    }));
    this.cdr.markForCheck();
  }

  // ── Save & Revert ──────────────────────────────────────────────────────────
  save(): void {
    if (this.target === 'user' && !this.selectedUserId) {
      this.toast.warning('Please select a user first.');
      return;
    }

    this.saving = true;
    const payload = {
      target: this.target,
      role_name: this.selectedRole,
      user_id: this.selectedUserId,
      sections: this.sections.map(s => ({
        section_key: s.section_key,
        is_visible: s.is_visible
      }))
    };

    this.api.put<any>('/admin/ui-navigation/access', payload).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success('Section access settings saved successfully.');
        this.sectionAccess.refresh().subscribe();
        this.loadPreferences();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save section access.');
        this.cdr.markForCheck();
      }
    });
  }

  async revertSingleSection(sectionKey: string, event: Event): Promise<void> {
    event.stopPropagation();
    const params = {
      ...this.buildParams(),
      section_key: sectionKey
    };

    this.saving = true;
    this.api.delete<any>('/admin/ui-navigation/access', params).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(`Restored section "${sectionKey}" to inherited default.`);
        this.sectionAccess.refresh().subscribe();
        this.loadPreferences();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to revert section override.');
        this.cdr.markForCheck();
      }
    });
  }

  async resetAll(): Promise<void> {
    if (this.target === 'user' && !this.selectedUserId) {
      this.toast.warning('Select a user first.');
      return;
    }

    const title = 'Reset Section Access';
    let message = 'Reset all sections to system defaults for ALL users?';
    if (this.target === 'role') {
      message = `Reset all overrides for role "${this.selectedRole}" to organization defaults?`;
    } else if (this.target === 'user') {
      const u = this.selectedUser;
      const userName = u ? `${u.first_name} ${u.last_name}` : 'selected user';
      message = `Remove all individual overrides for ${userName} and revert to role/global settings?`;
    }

    const confirmed = await this.confirm.confirm(message, title);
    if (!confirmed) return;

    this.saving = true;
    this.api.delete<any>('/admin/ui-navigation/access', this.buildParams()).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success('Section access has been reset to defaults.');
        this.sectionAccess.refresh().subscribe();
        this.loadPreferences();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to reset section access.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private buildParams(): Record<string, any> {
    return {
      target: this.target,
      role: this.target === 'role' ? this.selectedRole : null,
      user_id: this.target === 'user' ? this.selectedUserId : null
    };
  }

  get summary(): AccessSummaryItem[] {
    const total = this.sections.length;
    const visible = this.sections.filter(s => s.is_visible).length;
    const hidden = total - visible;
    const userOverrides = this.sections.filter(s => s.source === 'user').length;
    const roleOverrides = this.sections.filter(s => s.source === 'role').length;
    const globalDefaults = this.sections.filter(s => s.source === 'global').length;

    return [
      { label: 'Visible', value: visible, color: 'var(--blue-50)', textColor: 'var(--primary)' },
      { label: 'Hidden', value: hidden, color: '#FEE2E2', textColor: '#B91C1C' },
      ...(this.target === 'user' ? [{ label: 'User Overrides', value: userOverrides, color: '#FEF3C7', textColor: '#92400E' }] : []),
      ...(this.target === 'user' || this.target === 'role' ? [{ label: 'Role Rules', value: roleOverrides, color: '#DBEAFE', textColor: '#1D4ED8' }] : []),
      { label: 'Global Defaults', value: globalDefaults, color: '#DCFCE7', textColor: '#166534' }
    ];
  }

  get targetTitle(): string {
    if (this.target === 'global') return 'Organization-Wide Defaults (All Users)';
    if (this.target === 'role') return `Role Configuration: ${this.selectedRole.toUpperCase()}`;
    if (this.selectedUser) {
      return `User Override: ${this.selectedUser.first_name} ${this.selectedUser.last_name} (@${this.selectedUser.username})`;
    }
    return 'User-Specific Section Access';
  }

  get isAdminSectionHidden(): boolean {
    const adminSec = this.sections.find(s => s.section_key === 'admin');
    return !!adminSec && !adminSec.is_visible;
  }

  getUserInitials(user: any): string {
    if (!user) return '?';
    const first = user.first_name?.[0] || user.username?.[0] || '?';
    const last = user.last_name?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }

  getRoleBadgeColor(roleName: string): string {
    const r = (roleName || '').toLowerCase();
    switch (r) {
      case 'admin': return '#9D174D';
      case 'manager': return '#1565C0';
      case 'tech': return '#065F46';
      case 'viewer': return '#374151';
      default: return 'var(--primary)';
    }
  }

  getSourceBadgeClass(source: string): string {
    switch (source) {
      case 'user': return 'badge-source-user';
      case 'role': return 'badge-source-role';
      case 'global': return 'badge-source-global';
      default: return 'badge-source-default';
    }
  }

  getSourceLabel(source: string): string {
    switch (source) {
      case 'user': return 'User Override';
      case 'role': return `Role (${this.selectedUser?.role?.name || this.selectedRole})`;
      case 'global': return 'Global Default';
      default: return 'System Default';
    }
  }

  canRevertSection(section: NavSectionRow): boolean {
    if (this.target === 'user') {
      return section.source === 'user';
    }
    if (this.target === 'role') {
      return section.source === 'role';
    }
    if (this.target === 'global') {
      return section.source === 'global';
    }
    return false;
  }
}
