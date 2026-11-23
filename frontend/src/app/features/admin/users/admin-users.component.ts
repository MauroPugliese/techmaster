// =============================================================================
// features/admin/users/admin-users.component.ts — Enterprise User Management
// =============================================================================
import {
  Component, OnInit, OnDestroy, OnChanges, SimpleChanges,
  Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ApiService, AuthService } from '../../../core/services/services';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import {
  evaluatePasswordStrength,
  generateStrongPassword,
  getHttpStatusBadgeStyle,
  getMethodBadgeStyle,
  getRoleColor,
} from '../admin-helpers';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, TitleCasePipe,
    ExportMenuComponent, DropdownComponent, DropdownOptionComponent
  ],
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersComponent implements OnInit, OnChanges, OnDestroy {
  Math = Math;

  @Input() roles: any[] = [];
  @Input() initialRoleFilterId: number | null = null;

  @Output() usersChanged = new EventEmitter<void>();
  @Output() manageSectionAccess = new EventEmitter<number>();

  private destroy$ = new Subject<void>();
  private searchTrigger$ = new Subject<void>();

  users: any[] = [];
  departments: string[] = [];
  loading = false;
  saving = false;
  bulkBusy = false;

  search = '';
  roleFilterId: number | null = null;
  statusFilter: '' | 'active' | 'inactive' = '';
  departmentFilter = '';

  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  total = 0;

  // Bulk selection
  selectedIds = new Set<number>();
  bulkRoleId: number | null = null;

  // Modals
  showUserModal = false;
  editingUser: any = null;
  userForm: any = this.emptyUser();
  userFormError = '';
  showUserPwd = false;

  showResetModal = false;
  resetTargetUser: any = null;
  newPassword = '';
  resetError = '';
  showResetPwd = false;

  detailSummary: any = null;
  detailLoading = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  getRoleColor = getRoleColor;
  getMethodBadgeStyle = getMethodBadgeStyle;
  getHttpStatusBadgeStyle = getHttpStatusBadgeStyle;

  get currentUserId(): number | null {
    return this.auth.currentUser?.id ?? null;
  }

  get userPasswordStrength() {
    return evaluatePasswordStrength(this.userForm.password);
  }

  get resetPasswordStrength() {
    return evaluatePasswordStrength(this.newPassword);
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.search.trim() || this.roleFilterId || this.statusFilter || this.departmentFilter);
  }

  get selectableUsers(): any[] {
    return this.users.filter(u => !this.isSelf(u));
  }

  get allPageSelected(): boolean {
    const selectable = this.selectableUsers;
    return selectable.length > 0 && selectable.every(u => this.selectedIds.has(u.id));
  }

  ngOnInit(): void {
    if (this.initialRoleFilterId) {
      this.roleFilterId = this.initialRoleFilterId;
    }

    this.searchTrigger$
      .pipe(debounceTime(280), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadUsers();
      });

    this.loadUsers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRoleFilterId'] && !changes['initialRoleFilterId'].firstChange) {
      this.roleFilterId = this.initialRoleFilterId;
      this.page = 1;
      this.loadUsers();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isSelf(user: any): boolean {
    return this.currentUserId !== null && Number(user?.id) === Number(this.currentUserId);
  }

  loadUsers(): void {
    this.loading = true;
    const params: Record<string, any> = {
      page: this.page,
      limit: this.pageSize,
    };
    if (this.search.trim()) params['search'] = this.search.trim();
    if (this.roleFilterId) params['role_id'] = this.roleFilterId;
    if (this.statusFilter) params['status'] = this.statusFilter;
    if (this.departmentFilter) params['department'] = this.departmentFilter;

    this.api.get<any>('/admin/users', params).subscribe({
      next: res => {
        this.users = res.data?.items || [];
        this.total = Number(res.data?.total) || 0;
        if (Array.isArray(res.data?.departments)) {
          this.departments = res.data.departments;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load users.');
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput(): void {
    this.searchTrigger$.next();
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadUsers();
  }

  clearFilters(): void {
    this.search = '';
    this.roleFilterId = null;
    this.statusFilter = '';
    this.departmentFilter = '';
    this.page = 1;
    this.loadUsers();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages) return;
    this.page = nextPage;
    this.loadUsers();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadUsers();
  }

  // ── Bulk Selection ─────────────────────────────────────────────────────────
  toggleSelection(user: any): void {
    if (this.isSelf(user)) return;
    const next = new Set(this.selectedIds);
    if (next.has(user.id)) next.delete(user.id);
    else next.add(user.id);
    this.selectedIds = next;
  }

  toggleSelectAllPage(): void {
    const next = new Set(this.selectedIds);
    if (this.allPageSelected) {
      for (const u of this.selectableUsers) next.delete(u.id);
    } else {
      for (const u of this.selectableUsers) next.add(u.id);
    }
    this.selectedIds = next;
  }

  clearSelection(): void {
    this.selectedIds = new Set<number>();
    this.bulkRoleId = null;
  }

  runBulkAction(action: 'activate' | 'deactivate' | 'set_role'): void {
    if (!this.selectedIds.size) return;
    if (action === 'set_role' && !this.bulkRoleId) {
      this.toast.warning('Select a role to assign.');
      return;
    }

    this.bulkBusy = true;
    const payload: any = {
      user_ids: Array.from(this.selectedIds),
      action,
    };
    if (action === 'set_role') payload.role_id = this.bulkRoleId;

    this.api.patch<any>('/admin/users/bulk', payload).subscribe({
      next: res => {
        this.bulkBusy = false;
        const d = res.data || {};
        this.toast.success(`Updated ${d.updated_count || 0} user(s).`);
        if (Array.isArray(d.skipped_reasons) && d.skipped_reasons.length) {
          this.toast.warning(d.skipped_reasons[0]);
        }
        this.clearSelection();
        this.loadUsers();
        this.usersChanged.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.bulkBusy = false;
        this.toast.error(err?.error?.message || 'Bulk action failed.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Detail Modal ───────────────────────────────────────────────────────────
  openUserDetail(user: any): void {
    this.detailLoading = true;
    this.detailSummary = { user, counts: null, recent_audit: [] };
    this.api.get<any>('/admin/users/' + user.id + '/summary').subscribe({
      next: res => {
        this.detailSummary = res.data;
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.detailLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeDetail(): void {
    this.detailSummary = null;
  }

  // ── Create / Edit User ─────────────────────────────────────────────────────
  private emptyUser() {
    const defaultRoleId = this.roles.find(r => r.name === 'viewer')?.id ?? this.roles[0]?.id ?? null;
    return {
      role_id: defaultRoleId,
      username: '',
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      department: '',
      job_title: '',
      phone: '',
      is_active: true,
    };
  }

  openUserModal(user?: any): void {
    this.editingUser = user ?? null;
    this.userForm = user
      ? { ...user, role_id: user.role?.id ?? user.role_id, password: '' }
      : this.emptyUser();
    this.userFormError = '';
    this.showUserPwd = false;
    this.showUserModal = true;
    this.cdr.markForCheck();
  }

  generateUserPassword(): void {
    this.userForm = { ...this.userForm, password: generateStrongPassword() };
    this.showUserPwd = true;
  }

  generateResetPassword(): void {
    this.newPassword = generateStrongPassword();
    this.showResetPwd = true;
  }

  async copyGeneratedPassword(pwd: string): Promise<void> {
    if (!pwd) return;
    try {
      await navigator.clipboard.writeText(pwd);
      this.toast.success('Password copied to clipboard.');
    } catch {
      this.toast.warning('Unable to copy automatically.');
    }
  }

  saveUser(): void {
    this.userFormError = '';
    if (!this.userForm.first_name?.trim() || !this.userForm.last_name?.trim()) {
      this.userFormError = 'First name and last name are required.';
      return;
    }
    if (!this.userForm.username?.trim() || !this.userForm.email?.trim()) {
      this.userFormError = 'Username and email address are required.';
      return;
    }
    if (!this.userForm.role_id) {
      this.userFormError = 'Select a role for this user.';
      return;
    }
    if (!this.editingUser || this.userForm.password) {
      const strength = evaluatePasswordStrength(this.userForm.password);
      if (!strength.valid) {
        this.userFormError = 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';
        return;
      }
    }

    this.saving = true;
    const payload = { ...this.userForm };
    if (!payload.password) delete payload.password;

    const req$ = this.editingUser
      ? this.api.put<any>('/admin/users/' + this.editingUser.id, payload)
      : this.api.post<any>('/admin/users', payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showUserModal = false;
        this.toast.success(this.editingUser ? 'User updated.' : 'User created.');
        this.loadUsers();
        this.usersChanged.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.userFormError = err?.error?.message || 'Failed to save user.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleUserActive(user: any): void {
    if (this.isSelf(user)) {
      this.toast.warning('You cannot deactivate your own account.');
      return;
    }
    this.api.patch<any>('/admin/users/' + user.id + '/toggle', {}).subscribe({
      next: () => {
        this.toast.success(user.is_active ? 'User deactivated.' : 'User activated.');
        this.loadUsers();
        this.usersChanged.emit();
      },
      error: (err: any) => {
        this.toast.error(err?.error?.message || 'Unable to change user status.');
      }
    });
  }

  async deleteUser(user: any): Promise<void> {
    if (this.isSelf(user)) {
      this.toast.warning('You cannot delete your own account.');
      return;
    }
    const ok = await this.confirm.confirm(
      `Delete user "${user.username}"? This cannot be undone.`,
      'Delete User'
    );
    if (!ok) return;
    this.api.delete<any>('/admin/users/' + user.id).subscribe({
      next: () => {
        this.toast.success('User deleted.');
        this.loadUsers();
        this.usersChanged.emit();
      },
      error: (err: any) => this.toast.error(err?.error?.message || 'Failed to delete user.')
    });
  }

  openResetModal(user: any): void {
    this.resetTargetUser = user;
    this.newPassword = '';
    this.resetError = '';
    this.showResetPwd = false;
    this.showResetModal = true;
    this.cdr.markForCheck();
  }

  resetPassword(): void {
    this.resetError = '';
    const strength = evaluatePasswordStrength(this.newPassword);
    if (!strength.valid) {
      this.resetError = 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';
      return;
    }
    this.saving = true;
    this.api.patch<any>('/admin/users/' + this.resetTargetUser.id + '/reset-password', {
      new_password: this.newPassword,
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showResetModal = false;
        this.toast.success('Password reset successfully.');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.resetError = err?.error?.message || 'Password reset failed.';
        this.cdr.markForCheck();
      }
    });
  }
}
