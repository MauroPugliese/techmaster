// =============================================================================
// features/admin/admin.component.ts
// =============================================================================
import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/services';
import { ToastService }   from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

type Tab = 'overview' | 'users' | 'operation-types' | 'shift-types' |
           'asset-categories' | 'item-categories' | 'wiki-categories' | 'warehouse-locations';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, TitleCasePipe, SlicePipe],
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminComponent implements OnInit {

  activeTab: Tab = 'overview';

  // ── Overview ────────────────────────────────────────────────────────────────
  systemInfo: any = null;

  // ── Users ───────────────────────────────────────────────────────────────────
  users:      any[] = [];
  roles:      any[] = [];
  userSearch  = '';
  userLoading = false;
  showUserModal  = false;
  showResetModal = false;
  editingUser: any = null;
  userForm:    any = this.emptyUser();
  newPassword  = '';
  saving       = false;

  // ── Generic config list ──────────────────────────────────────────────────────
  listData:    any[] = [];
  listLoading  = false;
  showModal    = false;
  editingItem: any = null;
  itemForm:    any = {};

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview',            label: 'Overview',           icon: 'dashboard'          },
    { id: 'users',               label: 'Users',              icon: 'group'              },
    { id: 'operation-types',     label: 'Operation Types',    icon: 'rocket_launch'      },
    { id: 'shift-types',         label: 'Shift Types',        icon: 'schedule'           },
    { id: 'asset-categories',    label: 'Asset Categories',   icon: 'category'           },
    { id: 'item-categories',     label: 'Item Categories',    icon: 'inventory_2'        },
    { id: 'wiki-categories',     label: 'Wiki Categories',    icon: 'menu_book'          },
    { id: 'warehouse-locations', label: 'Locations',          icon: 'warehouse'          },
  ];

  // Getter used in template to avoid complex pipe chains
  get activeTabLabel(): string {
    return this.tabs.find(t => t.id === this.activeTab)?.label ?? '';
  }

  constructor(private api: ApiService, private cdr: ChangeDetectorRef, private toast: ToastService, private confirm: ConfirmService) {}

  ngOnInit(): void {
    this.loadOverview();
    this.api.get<any>('/admin/roles').subscribe(r => {
      this.roles = r.data;
      this.cdr.markForCheck();
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  setTab(tab: Tab): void {
    this.activeTab = tab;
    this.showModal = false;
    this.showUserModal = false;
    if (tab === 'overview')   this.loadOverview();
    else if (tab === 'users') this.loadUsers();
    else                      this.loadList(tab);
    this.cdr.markForCheck();
  }

  // ── Overview ────────────────────────────────────────────────────────────────
  loadOverview(): void {
    this.api.get<any>('/admin/system').subscribe({
      next: r => { this.systemInfo = r.data; this.cdr.markForCheck(); },
      error: ()  => { this.cdr.markForCheck(); }
    });
  }

  formatUptime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  get overviewCountCards(): { label: string; val: number; icon: string; color: string }[] {
    if (!this.systemInfo) return [];
    const c = this.systemInfo.counts;
    return [
      { label: 'Total Users',       val: c.users,           icon: 'group',         color: '#1565C0' },
      { label: 'Active Users',      val: c.active_users,    icon: 'how_to_reg',    color: '#10B981' },
      { label: 'Operations',        val: c.operations,      icon: 'rocket_launch', color: '#0288D1' },
      { label: 'Maintenance',       val: c.maintenance,     icon: 'build_circle',  color: '#F59E0B' },
      { label: 'Inventory Items',   val: c.inventory_items, icon: 'inventory_2',   color: '#8B5CF6' },
      { label: 'Shifts',            val: c.shifts,          icon: 'schedule',      color: '#EC4899' },
      { label: 'Tasks',             val: c.tasks,           icon: 'task_alt',      color: '#EF4444' },
      { label: 'Wiki Articles',     val: c.wiki_articles,   icon: 'menu_book',     color: '#059669' },
    ];
  }

  // ── Users ───────────────────────────────────────────────────────────────────
  loadUsers(): void {
    this.userLoading = true;
    this.api.get<any>('/admin/users', { search: this.userSearch, limit: 100 }).subscribe({
      next: r => {
        this.users = r.data?.items || r.data || [];
        this.userLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.userLoading = false; this.cdr.markForCheck(); }
    });
  }

  private emptyUser() {
    return {
      role_id: null, username: '', email: '', password: '',
      first_name: '', last_name: '', department: '',
      job_title: '', phone: '', is_active: true
    };
  }

  openUserModal(user?: any): void {
    this.editingUser = user ?? null;
    this.userForm    = user
      ? { ...user, role_id: user.role?.id ?? user.role_id, password: '' }
      : this.emptyUser();
    this.showUserModal = true;
    this.cdr.markForCheck();
  }

  saveUser(): void {
    if (!this.userForm.first_name || !this.userForm.email) {
      alert('Name and email are required.'); return;
    }
    if (!this.editingUser && !this.userForm.password) {
      alert('Password is required for new users.'); return;
    }
    this.saving = true;
    const payload = { ...this.userForm };
    if (!payload.password) delete payload.password;

    const req$ = this.editingUser
      ? this.api.put<any>('/admin/users/' + this.editingUser.id, payload)
      : this.api.post<any>('/admin/users', payload);

    req$.subscribe({
      next: () => {
        this.saving = false; this.showUserModal = false; this.loadUsers();
        this.toast.success(this.editingUser ? 'User updated.' : 'User created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save user.');
        this.cdr.markForCheck();
      }
    });
  }

  toggleUserActive(user: any): void {
    this.api.patch<any>('/admin/users/' + user.id + '/toggle', {})
      .subscribe(() => this.loadUsers());
  }

  async deleteUser(user: any): Promise<void> {
    const ok = await this.confirm.confirm(
      `Delete user "${user.username}"? This cannot be undone.`, 'Delete User');
    if (!ok) return;
    this.api.delete<any>('/admin/users/' + user.id).subscribe({
      next: () => { this.loadUsers(); this.toast.success('User deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  openResetModal(user: any): void {
    this.editingUser = user;
    this.newPassword = '';
    this.showResetModal = true;
    this.cdr.markForCheck();
  }

  resetPassword(): void {
    if (!this.newPassword || this.newPassword.length < 8) {
      this.toast.warning('Min 8 characters required.'); return;
    }
    this.saving = true;
    this.api.patch<any>('/admin/users/' + this.editingUser.id + '/reset-password',
      { new_password: this.newPassword }
    ).subscribe({
      next: () => {
        this.saving = false; this.showResetModal = false;
        this.toast.success('Password reset successfully.');
        this.cdr.markForCheck();
      },
      error: (e: any) => { this.saving = false; this.toast.error(e?.error?.message || 'Reset failed.'); this.cdr.markForCheck(); }
    });
  }

  getRoleBadgeColor(role: string): string {
    const map: Record<string, string> = {
      admin: '#9D174D', manager: '#1565C0', tech: '#065F46', viewer: '#374151'
    };
    return map[role] || '#374151';
  }

  // ── Generic config list ──────────────────────────────────────────────────────
  private apiPath(tab: Tab): string { return '/admin/' + tab; }

  loadList(tab: Tab): void {
    this.listLoading = true;
    this.api.get<any>(this.apiPath(tab)).subscribe({
      next: r => { this.listData = r.data || []; this.listLoading = false; this.cdr.markForCheck(); },
      error: () => { this.listLoading = false; this.cdr.markForCheck(); }
    });
  }

  openItemModal(item?: any): void {
    this.editingItem = item ?? null;
    this.itemForm    = item ? { ...item } : this.defaultForm(this.activeTab);
    this.showModal   = true;
    this.cdr.markForCheck();
  }

  private defaultForm(tab: Tab): any {
    switch (tab) {
      case 'operation-types':     return { name: '', color: '#1565C0', icon: 'settings', description: '' };
      case 'shift-types':         return { name: '', code: '', start_time: '08:00', end_time: '16:00', color: '#1565C0' };
      case 'asset-categories':    return { name: '', type: 'HARDWARE', description: '' };
      case 'item-categories':     return { name: '', description: '' };
      case 'wiki-categories':     return { name: '', icon: 'folder', sort_order: 0 };
      case 'warehouse-locations': return { name: '', code: '', description: '', is_active: true };
      default: return {};
    }
  }

  saveItem(): void {
    if (!this.itemForm.name?.trim()) { alert('Name is required.'); return; }
    this.saving = true;

    const req$ = this.editingItem
      ? this.api.put<any>(this.apiPath(this.activeTab) + '/' + this.editingItem.id, this.itemForm)
      : this.api.post<any>(this.apiPath(this.activeTab), this.itemForm);

    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.loadList(this.activeTab);
        this.toast.success(this.editingItem ? 'Item updated.' : 'Item created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save.');
        this.cdr.markForCheck();
      }
    });
  }

  async deleteItem(item: any): Promise<void> {
    const ok = await this.confirm.confirm(`Delete "${item.name}"? This cannot be undone.`, 'Delete Item');
    if (!ok) return;
    this.api.delete<any>(this.apiPath(this.activeTab) + '/' + item.id).subscribe({
      next: () => { this.loadList(this.activeTab); this.toast.success('Item deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Cannot delete this item.')
    });
  }
}
