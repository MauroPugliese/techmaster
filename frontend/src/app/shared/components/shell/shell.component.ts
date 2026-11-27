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
import { AuthService, ApiService, DateFilterService, SocketService, SectionAccessService, NavSectionAccess, ToastService } from '../../../core/services/services';
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
  showDateFilter?: boolean;
}

const SIDEBAR_STORAGE_KEY = 'smart_sidebar_collapsed';

const PAGE_MAP: Record<string, NavPage> = {
  '/admin':                 { path: '/admin',                 group: 'Administration',    title: 'Admin Settings',       subtitle: 'Platform configuration and user management',      showDateFilter: false },
  '/dashboard':             { path: '/dashboard',             group: 'Overview',          title: 'Control Room',         subtitle: 'Live simulator bays, sorties & center health',    showDateFilter: true  },
  '/simulators':            { path: '/simulators',            group: 'Simulator Center',  title: 'Flight Simulators',    subtitle: 'FSTD bays, subsystems, QTG & airworthiness',      showDateFilter: false },
  '/operations':            { path: '/operations',            group: 'Simulator Center',  title: 'Sorties & Dispatch',   subtitle: '24h bay timeline, sorties & crew dispatch',       showDateFilter: true  },
  '/maintenance/planned':   { path: '/maintenance/planned',   group: 'Engineering',       title: 'Planned Maintenance',  subtitle: 'Recurring preventive calendar',                   showDateFilter: false },
  '/maintenance':           { path: '/maintenance',           group: 'Engineering',       title: 'Maintenance & QTG',    subtitle: 'Work orders, snags (DR), QTG & assets',           showDateFilter: true  },
  '/warehouse':             { path: '/warehouse',             group: 'Logistics',         title: 'Warehouse & Spares',   subtitle: 'Aviation LRUs, AOG stock & movements',            showDateFilter: true  },
  '/shifts':                { path: '/shifts',                group: 'Workforce',         title: 'Shifts & Roster',      subtitle: 'Certified sim engineers & handover log',          showDateFilter: false },
  '/analytics/operations':  { path: '/analytics/operations',  group: 'Intelligence',      title: 'Sorties Analytics',    subtitle: 'Dispatch reliability, bay utilization & snags',   showDateFilter: true  },
  '/analytics':             { path: '/analytics',             group: 'Intelligence',      title: 'Analytics & Reports',  subtitle: 'Executive reporting and data visualization',      showDateFilter: true  },
  '/tasks':                 { path: '/tasks',                 group: 'Intelligence',      title: 'Task Manager',         subtitle: 'Engineering tasks and recurring checklists',      showDateFilter: true  },
  '/wiki':                  { path: '/wiki',                  group: 'Knowledge',         title: 'Wiki & Docs',          subtitle: 'SOPs, QTG runbooks & LOTO guides',                showDateFilter: false },
  '/profile':               { path: '/profile',               group: 'Account',           title: 'My Profile',           subtitle: 'Personal info, password and active sessions',     showDateFilter: false },
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
  showGlobalDateFilter = true;
  dateLabel = 'All time';
  hasDateFilter = false;
  activePreset: string | null = null;
  pickerFrom: Date | null = null;
  pickerTo: Date | null = null;

  simulatorsAlertCount = 0;
  activeOpsCount = 0;
  pendingMaintCount = 0;
  pendingPlannedMaintCount = 0;
  lowStockCount = 0;
  openTasksCount = 0;
  utcClock = '';
  localClock = '';
  notifications: Notification[] = [];
  unreadNotifications = 0;
  navSections: NavSectionAccess[] = [];

  readonly isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
  private lastUserInitKey = '';

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private socketService: SocketService,
    private dateFilter: DateFilterService,
    private sectionAccess: SectionAccessService,
    private toast: ToastService,
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
      if (!user) {
        this.lastUserInitKey = '';
        return;
      }

      this.currentUser = user;
      const userKey = `${user.id}:${user.role?.name || user.role?.id || ''}`;
      if (userKey !== this.lastUserInitKey) {
        this.lastUserInitKey = userKey;
        this.loadNotifications();
        this.loadNavBadges();
        this.sectionAccess.load(true).pipe(takeUntil(this.destroy$)).subscribe();

        const token = this.auth.getAccessToken();
        if (token) {
          this.socketService.connect(token);
        }
      }

      this.cdr.markForCheck();
    });

    this.socketService.notifications$.pipe(takeUntil(this.destroy$)).subscribe((notif) => {
      if (notif?.id && this.notifications.some(n => n.id === notif.id)) {
        return;
      }
      this.notifications = [{ ...notif, is_read: false }, ...this.notifications].slice(0, 50);
      this.unreadNotifications = Math.max(this.unreadNotifications + 1, this.notifications.filter(n => !n.is_read).length);
      const alertType = String((notif as any)?.type || '').toUpperCase();
      if (alertType === 'SIMULATOR_AOG' || alertType === 'STATION_NA' || alertType === 'SORTIE_INTERRUPTED') {
        const msg = notif?.title || notif?.body || 'Critical simulator alert';
        if (alertType === 'SIMULATOR_AOG' || alertType === 'STATION_NA') {
          this.toast.error(msg);
        } else {
          this.toast.warning(msg);
        }
      }
      this.loadNavBadges();
      this.cdr.markForCheck();
    });

    this.updateAviationClocks();
    interval(15_000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.updateAviationClocks();
    });

    interval(60_000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.currentUser) {
        this.loadNavBadges();
      }
    });

    this.api.navBadgesRefresh$.pipe(takeUntil(this.destroy$)).subscribe(() => {
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
      if (this.currentUser) {
        this.loadNavBadges();
      }
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
      if (this.showDatePicker) {
        this.showDatePicker = false;
        changed = true;
      }
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

  selectQuickPreset(preset: 'today' | 'week' | 'month' | 'quarter' | 'year'): void {
    this.setPreset(preset);
    this.showDatePicker = false;
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
    let from = this.pickerFrom;
    let to = this.pickerTo;
    if (from && to && from.getTime() > to.getTime()) {
      const swap = from;
      from = to;
      to = swap;
      this.pickerFrom = from;
      this.pickerTo = to;
    }
    this.dateFilter.setRange({ from, to });
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
    if (this.showNotifications && this.currentUser) {
      this.loadNotifications();
    }
  }

  setNotifFilter(mode: 'all' | 'unread'): void {
    this.notifFilter = mode;
  }

  markAsRead(notification: Notification, event?: MouseEvent): void {
    event?.stopPropagation();
    if (notification.is_read) return;

    this.api.put<ApiResponse<Notification>>(`/notifications/${notification.id}/read`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notifications = this.notifications.map(n =>
            n.id === notification.id ? { ...n, is_read: true } : n
          );
          this.unreadNotifications = Math.max(0, this.unreadNotifications - 1);
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadNotifications();
        }
      });
  }

  markAllAsRead(event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.unreadNotifications) return;

    this.api.put<ApiResponse<unknown>>('/notifications/read-all', {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notifications = this.notifications.map(n => ({ ...n, is_read: true }));
          this.unreadNotifications = 0;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadNotifications();
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
      this.showGlobalDateFilter = page.showDateFilter !== false;
      this.dateFilter.setRouteEnabled(this.showGlobalDateFilter);
    }
  }

  private loadNotifications(): void {
    this.api.get<ApiResponse<Notification[]>>('/notifications').pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.notifications = res.data || [];
        const localUnread = this.notifications.filter(n => !n.is_read).length;
        // Preserve authoritative DB count when there are more than 50 notifications
        this.unreadNotifications = this.notifications.length >= 50
          ? Math.max(this.unreadNotifications, localUnread)
          : localUnread;
        this.cdr.markForCheck();
      },
      error: () => {
        this.notifications = [];
        this.cdr.markForCheck();
      }
    });
  }

  private updateAviationClocks(): void {
    const now = new Date();
    this.utcClock = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    this.localClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.cdr.markForCheck();
  }

  private localTodayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private loadNavBadges(): void {
    this.api.get<any>('/search/nav-badges', { date: this.localTodayIso() }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const d = res?.data;
        if (!d) return;
        this.simulatorsAlertCount = Number(d.simulators) || 0;
        this.activeOpsCount = Number(d.operations) || 0;
        this.pendingMaintCount = Number(d.maintenance) || 0;
        this.pendingPlannedMaintCount = Number(d.plannedMaintenance) || 0;
        this.lowStockCount = Number(d.warehouse) || 0;
        this.openTasksCount = Number(d.tasks) || 0;
        if (d.notifications !== undefined) {
          this.unreadNotifications = Number(d.notifications) || 0;
        }
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
