// =============================================================================
// shell.component.ts — App Shell with Sidebar + Header
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router, RouterModule, NavigationEnd, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { AuthService, ApiService, DateFilterService, SocketService } from '../../../core/services/services';
import { User, Notification, ApiResponse } from '../../../core/models/interfaces';
import { ToastComponent }   from '../toast/toast.component';
import { ConfirmComponent } from '../confirm/confirm.component';

interface NavPage {
  path: string;
  title: string;
  subtitle: string;
}

const PAGE_MAP: Record<string, NavPage> = {
  '/admin':       { path: '/admin',       title: 'Admin Settings',           subtitle: 'Platform configuration and user management' },
  '/dashboard':   { path: '/dashboard',   title: 'Dashboard',                subtitle: 'Real-time overview of operations' },
  '/operations':  { path: '/operations',  title: 'Operations & Sorties',     subtitle: 'Manage deployments and tech activities' },
  '/maintenance': { path: '/maintenance', title: 'Maintenance',              subtitle: 'Track hardware and software maintenance' },
  '/warehouse':   { path: '/warehouse',   title: 'Warehouse & Inventory',    subtitle: 'Asset tracking and stock management' },
  '/shifts':      { path: '/shifts',      title: 'Shift Management',         subtitle: 'Employee scheduling and rotations' },
  '/analytics':   { path: '/analytics',   title: 'Analytics & Reports',      subtitle: 'Data visualization and insights' },
  '/tasks':       { path: '/tasks',       title: 'Task Manager',             subtitle: 'Recursive task management by interval' },
  '/wiki':        { path: '/wiki',        title: 'Wiki & Documentation',     subtitle: 'Internal knowledge base and SOPs' },
};

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule, MatNativeDateModule, ToastComponent, ConfirmComponent],
  templateUrl: './shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShellComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  sidebarCollapsed   = false;
  showDatePicker     = false;
  showNotifications  = false;

  currentUser!: User;
  pageTitle    = 'Dashboard';
  pageSubtitle = '';
  dateLabel    = 'All time';
  hasDateFilter = false;
  activePreset: string | null = null;
  pickerFrom: Date | null = null;
  pickerTo: Date | null = null;

  // KPI badges from dashboard
  activeOpsCount   = 0;
  pendingMaintCount = 0;
  lowStockCount    = 0;
  openTasksCount   = 0;
  notifications: Notification[] = [];
  unreadNotifications = 0;

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private socketService: SocketService,
    private dateFilter: DateFilterService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Track current user
    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (!user) return;

      this.currentUser = user;
      this.loadNotifications();

      const token = this.auth.getAccessToken();
      if (token) {
        this.socketService.connect(token);
      }

      this.cdr.markForCheck();
    });

    this.socketService.notifications$.pipe(takeUntil(this.destroy$)).subscribe((notif) => {
      this.notifications = [{ ...notif, is_read: false }, ...this.notifications].slice(0, 50);
      this.unreadNotifications = this.notifications.filter(n => !n.is_read).length;
      this.cdr.markForCheck();
    });

    // Update page title on navigation
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((e: any) => {
      const base = '/' + e.urlAfterRedirects.split('/')[1];
      const page = PAGE_MAP[base];
      if (page) { this.pageTitle = page.title; this.pageSubtitle = page.subtitle; }
      this.cdr.markForCheck();
    });

    // Track date filter changes
    this.dateFilter.range$.pipe(takeUntil(this.destroy$)).subscribe(range => {
      this.hasDateFilter = !!(range.from || range.to);
      this.dateLabel = this.dateFilter.getLabel();
      this.cdr.markForCheck();
    });
  }

  get fullName(): string {
    return this.currentUser ? `${this.currentUser.first_name} ${this.currentUser.last_name}` : '';
  }

  get initials(): string {
    if (!this.currentUser) return '?';
    return `${this.currentUser.first_name[0]}${this.currentUser.last_name[0]}`.toUpperCase();
  }

  toggleSidebar(): void { this.sidebarCollapsed = !this.sidebarCollapsed; }

  setPreset(preset: 'today' | 'week' | 'month' | 'quarter' | 'year'): void {
    this.activePreset = preset;
    this.dateFilter.setPreset(preset);
  }

  openDatePicker(): void {
    const r = this.dateFilter.currentRange;
    this.pickerFrom = r.from || null;
    this.pickerTo   = r.to || null;
    this.showDatePicker = true;
  }

  closeDatePicker(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showDatePicker = false;
    }
  }

  applyDatePicker(): void {
    this.dateFilter.setRange({
      from: this.pickerFrom,
      to:   this.pickerTo
    });
    this.activePreset = null;
    this.showDatePicker = false;
  }

  clearDate(): void {
    this.dateFilter.clearRange();
    this.activePreset = null;
    this.showDatePicker = false;
  }

  toggleNotifications(event?: MouseEvent): void {
    event?.stopPropagation();
    this.showNotifications = !this.showNotifications;
  }

  markAsRead(notification: Notification, event?: MouseEvent): void {
    event?.stopPropagation();
    if (notification.is_read) return;

    this.api.put<ApiResponse<Notification>>(`/notifications/${notification.id}/read`, {}).subscribe({
      next: () => {
        notification.is_read = true;
        this.unreadNotifications = this.notifications.filter(n => !n.is_read).length;
        this.cdr.markForCheck();
      }
    });
  }

  markAllAsRead(event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.unreadNotifications) return;

    this.api.put<ApiResponse<unknown>>('/notifications/read-all', {}).subscribe({
      next: () => {
        this.notifications = this.notifications.map(n => ({ ...n, is_read: true }));
        this.unreadNotifications = 0;
        this.cdr.markForCheck();
      }
    });
  }

  openNotification(notification: Notification, event?: MouseEvent): void {
    event?.stopPropagation();
    this.markAsRead(notification);
    this.showNotifications = false;

    if (notification.link) {
      this.router.navigateByUrl(notification.link);
    }
  }

  closeNotifications(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('app-shell')) {
      this.showNotifications = false;
    }
  }

  trackByNotificationId(_: number, item: Notification): number {
    return item.id;
  }

  private loadNotifications(): void {
    this.api.get<ApiResponse<Notification[]>>('/notifications').subscribe({
      next: (res) => {
        this.notifications = res.data || [];
        this.unreadNotifications = this.notifications.filter(n => !n.is_read).length;
        this.cdr.markForCheck();
      }
    });
  }

  logout(): void { this.auth.logout(); }

  ngOnDestroy(): void {
    this.socketService.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
