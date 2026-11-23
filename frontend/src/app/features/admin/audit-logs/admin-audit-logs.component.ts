// =============================================================================
// features/admin/audit-logs/admin-audit-logs.component.ts
// =============================================================================
import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/services';
import { ToastService } from '../../../core/services/toast.service';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { getHttpStatusBadgeStyle, getMethodBadgeStyle } from '../admin-helpers';

@Component({
  selector: 'app-admin-audit-logs',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, DecimalPipe,
    ExportMenuComponent, DropdownComponent, DropdownOptionComponent, DateTimePickerComponent
  ],
  templateUrl: './admin-audit-logs.component.html',
  styleUrls: ['./admin-audit-logs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditLogsComponent implements OnInit, OnDestroy {
  Math = Math;

  private destroy$ = new Subject<void>();
  private searchTrigger$ = new Subject<void>();

  logs: any[] = [];
  users: any[] = [];
  summary = {
    total: 0,
    ok_count: 0,
    warn_4xx: 0,
    err_5xx: 0,
    auth_failures: 0,
  };

  loading = false;
  page = 1;
  pageSize = 25;
  readonly pageSizeOptions = [25, 50, 100];
  total = 0;

  search = '';
  method = '';
  statusGroup = '';
  userId: number | null = null;
  fromDate: Date | null = null;
  toDate: Date | null = null;

  selectedLog: any = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  getMethodBadgeStyle = getMethodBadgeStyle;
  getHttpStatusBadgeStyle = getHttpStatusBadgeStyle;

  ngOnInit(): void {
    this.searchTrigger$
      .pipe(debounceTime(280), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadLogs();
      });

    this.loadUsersForFilter();
    this.loadLogs();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private toIsoDateOnly(val: Date | null): string {
    if (!val || !(val instanceof Date) || Number.isNaN(val.getTime())) return '';
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  get exportParams(): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    if (this.method) out['method'] = this.method;
    if (this.userId) out['user_id'] = this.userId;
    if (this.search.trim()) out['action'] = this.search.trim();
    return out;
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.search.trim() || this.method || this.statusGroup || this.userId || this.fromDate || this.toDate);
  }

  loadUsersForFilter(): void {
    this.api.get<any>('/admin/users', { page: 1, limit: 250 }).subscribe({
      next: res => {
        this.users = res.data?.items || [];
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  loadLogs(): void {
    this.loading = true;
    const params: Record<string, any> = {
      page: this.page,
      limit: this.pageSize,
    };
    if (this.search.trim()) params['search'] = this.search.trim();
    if (this.method) params['method'] = this.method;
    if (this.statusGroup) params['status_group'] = this.statusGroup;
    if (this.userId) params['user_id'] = this.userId;
    const fromStr = this.toIsoDateOnly(this.fromDate);
    const toStr = this.toIsoDateOnly(this.toDate);
    if (fromStr) params['from'] = fromStr;
    if (toStr) params['to'] = toStr;

    this.api.get<any>('/admin/audit-logs', params).subscribe({
      next: res => {
        const d = res.data || {};
        this.logs = d.items || [];
        this.total = Number(d.total) || 0;
        this.summary = d.summary || {
          total: this.total,
          ok_count: 0,
          warn_4xx: 0,
          err_5xx: 0,
          auth_failures: 0,
        };
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load audit logs.');
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput(): void {
    this.searchTrigger$.next();
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadLogs();
  }

  clearFilters(): void {
    this.search = '';
    this.method = '';
    this.statusGroup = '';
    this.userId = null;
    this.fromDate = null;
    this.toDate = null;
    this.page = 1;
    this.loadLogs();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages) return;
    this.page = nextPage;
    this.loadLogs();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadLogs();
  }

  openLogDetail(log: any): void {
    this.selectedLog = log;
    this.cdr.markForCheck();
  }

  formatDetailsJson(log: any): string {
    if (!log?.details) return '{}';
    try {
      const obj = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(log.details);
    }
  }

  async copyDetailsJson(log: any): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.formatDetailsJson(log));
      this.toast.success('Event details copied to clipboard.');
    } catch {
      this.toast.warning('Unable to access clipboard.');
    }
  }
}
