// =============================================================================
// shell.component.ts — App Shell with Sidebar + Contextual Header + Palette
// =============================================================================
import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, interval } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { AuthService, ApiService, DateFilterService, SocketService, SectionAccessService, NavSectionAccess } from '../../../core/services/services';
import { User, Notification, ApiResponse } from '../../../core/models/interfaces';
import { ToastComponent } from '../toast/toast.component';
import { ConfirmComponent } from '../confirm/confirm.component';
import { DateTimePickerComponent } from '../datetime-picker/datetime-picker.component';
import { CommandPaletteComponent } from '../command-palette/command-palette.component';

interface NavPage {
  path: string;
  group: string;
  title: string;
  subtitle: string;
}

const SIDEBAR_STORAGE_KEY = 'smart_sidebar_collapsed';

const PAGE_MAP: Record<string, NavPage> = {
  '/admin':                 { path: '/admin',                 group: 'Administration', title: 'Admin Settings',       subtitle: 'Platform configuration and user management' },
  '/dashboard':             { path: '/dashboard',             group: 'Overview',       title: 'Dashboard',            subtitle: 'Real-time operational overview' },
  '/operations':            { path: '/operations',            group: 'Operations',     title: 'Operations & Sorties', subtitle: 'Deployments, sorties and team rosters' },
  '/maintenance/planned':   { path: '/maintenance/planned',   group: 'Operations',     title: 'Planned Maintenance',  subtitle: 'Recurring preventive calendar' },
  '/maintenance':           { path: '/maintenance',           group: 'Operations',     title: 'Maintenance & Assets', subtitle: 'Work orders and hardware registry' },
  '/warehouse':             { path: '/warehouse',             group: 'Operations',     title: 'Warehouse',            subtitle: 'Inventory control and stock movements' },
  '/shifts':                { path: '/shifts',                group: 'Operations',     title: 'Shifts & Roster',      subtitle: 'Employee scheduling and rotations' },
  '/analytics/operations':  { path: '/analytics/operations',  group: 'Intelligence',   title: 'Operations Analytics', subtitle: 'Mission tempo and efficiency deep dive' },
  '/analytics':             { path: '/analytics',             group: 'Intelligence',   title: 'Analytics & Reports',  subtitle: 'Executive reporting and data visualization' },
  '/tasks':                 { path: '/tasks',                 group: 'Intelligence',   title: 'Task Manager',         subtitle: 'Recurring tasks and execution queues' },
  '/wiki':                  { path: '/wiki',                  group: 'Knowledge',      title: 'Wiki & Docs',          subtitle: 'Internal knowledge base and SOPs' },
  '/profile':               { path: '/profile',               group: 'Account',        title: 'My Profile',           subtitle: 'Personal info, password and active sessions' },
};

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    DateTimePickerComponent,
    ToastComponent,
    ConfirmComponent,
    CommandPaletteComponent
  ],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShellComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  sidebarCollapsed = false;
  mobileSidebarOpen = false;
  showDatePicker = false;
  showNotifications = false;
  commandPaletteOpen = false;
  notifFilter: 'all' | 'unread' = 'all';

  currentUser!: User;
  pageGroup = 'Overview';
  pageTitle = 'Dashboard';
  pageSubtitle = '';
  dateLabel = 'All time';
  hasDateFilter = false;
  activePreset: string | null = null;
  pickerFrom: Date | null = null;
  pickerTo: Date | null = null;

  activeOpsCount = 0;
  pendingMaintCount = 0;
  lowStockCount = 0;
  openTasksCount = 0;
  notifications: Notification[] = [];
  unreadNotifications = 0;
  navSections: NavSectionAccess[] = [];

  readonly isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private socketService: SocketService,
    private dateFilter: DateFilterService,
    private sectionAccess: SectionAccessService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    try {
      this.sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
    } catch {
      this.sidebarCollapsed = false;
    }

    this.resolvePageFromUrl(this.router.url);

    this.sectionAccess.sections$.pipe(takeUntil(this.destroy$)).subscribe(sections => {
      this.navSections = sections;
      this.cdr.markForCheck();
    });

    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (!user) return;

      this.currentUser = user;
      this.loadNotifications();
      this.loadNavBadges();
      this.sectionAccess.load(true).subscribe();

      const token = this.auth.getAccessToken();
      if (token) {
        this.socketService.connect(token);
      }

      this.cdr.markForCheck();
    });

    this.socketService.notifications$.pipe(takeUntil(this.destroy$)).subscribe((notif) => {
      this.notifications = [{ ...notif, is_read: false }, ...this.notifications].slice(0, 50);
      this.unreadNotifications = this.notifications.filter(n => !n.is_read).length;
      this.loadNavBadges();
      this.cdr.markForCheck();
    });

    interval(60_000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.currentUser) {
        this.loadNavBadges();
      }
    });

    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((e: any) => {
      this.resolvePageFromUrl(e.urlAfterRedirects || e.url || '');
      this.mobileSidebarOpen = false;
      this.showNotifications = false;
      this.cdr.markForCheck();
    });

    this.dateFilter.range$.pipe(takeUntil(this.destroy$)).subscribe(range => {
      this.hasDateFilter = !!(range.from || range.to);
      this.dateLabel = this.dateFilter.getLabel();
      this.cdr.markForCheck();
    });
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.showNotifications = false;
      this.mobileSidebarOpen = false;
      this.commandPaletteOpen = !this.commandPaletteOpen;
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'Escape') {
      let changed = false;
      if (this.showNotifications) {
        this.showNotifications = false;
        changed = true;
      }
      if (this.mobileSidebarOpen) {
        this.mobileSidebarOpen = false;
        changed = true;
      }
      if (changed) this.cdr.markForCheck();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showNotifications) return;
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.notif-anchor')) {
      this.showNotifications = false;
      this.cdr.markForCheck();
    }
  }

  get fullName(): string {
    const firstName = this.currentUser?.first_name || '';
    const lastName = this.currentUser?.last_name || '';
    return `${firstName} ${lastName}`.trim();
  }

  get initials(): string {
    if (!this.currentUser) return '?';
    const first = this.currentUser.first_name?.[0] || this.currentUser.username?.[0] || '?';
    const last = this.currentUser.last_name?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }

  get filteredNotifications(): Notification[] {
    if (this.notifFilter === 'unread') {
      return this.notifications.filter(n => !n.is_read);
    }
    return this.notifications;
  }

  openCommandPalette(): void {
    this.showNotifications = false;
    this.mobileSidebarOpen = false;
    this.commandPaletteOpen = true;
  }

  closeCommandPalette(): void {
    this.commandPaletteOpen = false;
  }

  toggleSidebar(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 960) {
      this.mobileSidebarOpen = !this.mobileSidebarOpen;
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, this.sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage failure
    }
  }

  closeMobileSidebar(): void {
    this.mobileSidebarOpen = false;
  }

  showNavSection(sectionKey: string): boolean {
    const section = this.navSections.find(item => item.section_key === sectionKey);
    if (!section && sectionKey === 'dashboard') return true;
    return this.sectionAccess.isVisible(section);
  }

  showAnyNavSection(sectionKeys: string[]): boolean {
    return sectionKeys.some(sectionKey => this.showNavSection(sectionKey));
  }

  setPreset(preset: 'today' | 'week' | 'month' | 'quarter' | 'year'): void {
    this.activePreset = preset;
    this.dateFilter.setPreset(preset);
  }

  openDatePicker(): void {
    const r = this.dateFilter.currentRange;
    this.pickerFrom = r.from || null;
    this.pickerTo = r.to || null;
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
      to: this.pickerTo
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

  setNotifFilter(mode: 'all' | 'unread'): void {
    this.notifFilter = mode;
  }

  markAsRead(notification: Notification, event?: MouseEvent): void {
    event?.stopPropagation();
    if (notification.is_read) return;

    this.api.put<ApiResponse<Notification>>(`/notifications/${notification.id}/read`, {}).subscribe({
      next: () => {
        this.notifications = this.notifications.map(n =>
          n.id === notification.id ? { ...n, is_read: true } : n
        );
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

  trackByNotificationId(_: number, item: Notification): number {
    return item.id;
  }

  private resolvePageFromUrl(rawUrl: string): void {
    const cleanPath = (rawUrl || '/dashboard').split('?')[0].split('#')[0];
    const parts = cleanPath.split('/').filter(Boolean);
    const twoSeg = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : '';
    const oneSeg = parts.length >= 1 ? `/${parts[0]}` : '/dashboard';
    const page = PAGE_MAP[twoSeg] || PAGE_MAP[oneSeg];
    if (page) {
      this.pageGroup = page.group;
      this.pageTitle = page.title;
      this.pageSubtitle = page.subtitle;
    }
  }

  private loadNotifications(): void {
    this.api.get<ApiResponse<Notification[]>>('/notifications').subscribe({
      next: (res) => {
        this.notifications = res.data || [];
        this.unreadNotifications = this.notifications.filter(n => !n.is_read).length;
        this.cdr.markForCheck();
      },
      error: () => {
        this.notifications = [];
        this.unreadNotifications = 0;
        this.cdr.markForCheck();
      }
    });
  }

  private loadNavBadges(): void {
    this.api.get<any>('/search/nav-badges').subscribe({
      next: (res) => {
        const d = res?.data;
        if (!d) return;
        this.activeOpsCount = Number(d.operations) || 0;
        this.pendingMaintCount = Number(d.maintenance) || 0;
        this.lowStockCount = Number(d.warehouse) || 0;
        this.openTasksCount = Number(d.tasks) || 0;
        this.cdr.markForCheck();
      },
      error: () => {
        // Keep previous counts on transient network errors
      }
    });
  }

  logout(): void {
    this.auth.logout();
  }

  ngOnDestroy(): void {
    this.socketService.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
