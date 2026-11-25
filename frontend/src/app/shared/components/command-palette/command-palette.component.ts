import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnInit,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, takeUntil } from 'rxjs/operators';
import { ApiService, SectionAccessService, NavSectionAccess } from '../../../core/services/services';

export interface PaletteItem {
  key: string;
  title: string;
  subtitle?: string;
  icon: string;
  badge?: string;
  badgeTone?: 'info' | 'warning' | 'success' | 'danger' | 'neutral';
  route: string;
  queryParams?: Record<string, any>;
  sectionKey?: string;
  groupLabel: string;
}

const STATIC_ACTIONS: PaletteItem[] = [
  { key: 'act-sim', title: 'Add Flight Simulator', subtitle: 'Register a new FSTD bay & scaffold subsystems', icon: 'flight_takeoff', route: '/simulators', queryParams: { action: 'new' }, sectionKey: 'simulators', groupLabel: 'Quick Actions' },
  { key: 'act-op', title: 'Schedule Flight Sortie', subtitle: 'Book a simulator slot or training sortie', icon: 'add_circle_outline', route: '/operations', queryParams: { action: 'new' }, sectionKey: 'operations', groupLabel: 'Quick Actions' },
  { key: 'act-wo', title: 'Log Work Order', subtitle: 'Create a maintenance intervention or DR', icon: 'build', route: '/maintenance', queryParams: { action: 'new' }, sectionKey: 'maintenance', groupLabel: 'Quick Actions' },
  { key: 'act-sku', title: 'Add Inventory Item', subtitle: 'Register spare part or LRU SKU', icon: 'add_box', route: '/warehouse', queryParams: { action: 'new' }, sectionKey: 'warehouse', groupLabel: 'Quick Actions' },
  { key: 'act-task', title: 'New Task', subtitle: 'Assign or schedule a recurring engineering task', icon: 'add_task', route: '/tasks', queryParams: { action: 'new' }, sectionKey: 'tasks', groupLabel: 'Quick Actions' },
  { key: 'act-wiki', title: 'New Wiki Article', subtitle: 'Author SOP or technical documentation', icon: 'note_add', route: '/wiki', queryParams: { action: 'new' }, sectionKey: 'wiki', groupLabel: 'Quick Actions' }
];

const STATIC_ROUTES: PaletteItem[] = [
  { key: 'nav-dash', title: 'Control Room', subtitle: 'Operational overview & bay telemetry', icon: 'dashboard', route: '/dashboard', sectionKey: 'dashboard', groupLabel: 'Navigate' },
  { key: 'nav-sims', title: 'Flight Simulators', subtitle: 'FSTD fleet bays, subsystems & QTG qualification', icon: 'flight_takeoff', route: '/simulators', sectionKey: 'simulators', groupLabel: 'Navigate' },
  { key: 'nav-ops', title: 'Sorties & Dispatch', subtitle: '24h Bay Timeline & simulator sorties', icon: 'rocket_launch', route: '/operations', sectionKey: 'operations', groupLabel: 'Navigate' },
  { key: 'nav-maint', title: 'Maintenance & QTG', subtitle: 'Work orders, snags & QTG compliance', icon: 'build_circle', route: '/maintenance', sectionKey: 'maintenance', groupLabel: 'Navigate' },
  { key: 'nav-pm', title: 'Planned Maintenance', subtitle: 'Recurring preventive calendar', icon: 'event_repeat', route: '/maintenance/planned', sectionKey: 'maintenance', groupLabel: 'Navigate' },
  { key: 'nav-wh', title: 'Warehouse & Inventory', subtitle: 'Stock levels, LRUs, AOG spares & reorder', icon: 'inventory_2', route: '/warehouse', sectionKey: 'warehouse', groupLabel: 'Navigate' },
  { key: 'nav-sh', title: 'Shifts & Roster', subtitle: 'Certified engineers, rotations & handovers', icon: 'schedule', route: '/shifts', sectionKey: 'shifts', groupLabel: 'Navigate' },
  { key: 'nav-an', title: 'Analytics & Reports', subtitle: 'Cross-platform insights & exports', icon: 'insights', route: '/analytics', sectionKey: 'analytics', groupLabel: 'Navigate' },
  { key: 'nav-oa', title: 'Sorties Analytics', subtitle: 'Simulator utilization, dispatch & snag Pareto', icon: 'analytics', route: '/analytics/operations', sectionKey: 'operations_analytics', groupLabel: 'Navigate' },
  { key: 'nav-tasks', title: 'Task Manager', subtitle: 'Kanban, table & recurring checklists', icon: 'task_alt', route: '/tasks', sectionKey: 'tasks', groupLabel: 'Navigate' },
  { key: 'nav-wiki', title: 'Wiki & Docs', subtitle: 'Internal knowledge base and CAE SOPs', icon: 'menu_book', route: '/wiki', sectionKey: 'wiki', groupLabel: 'Navigate' },
  { key: 'nav-admin', title: 'Admin Settings', subtitle: 'Users, permissions, audit & health', icon: 'admin_panel_settings', route: '/admin', sectionKey: 'admin', groupLabel: 'Navigate' },
  { key: 'nav-profile', title: 'My Profile & Security', subtitle: 'Personal info, password & active sessions', icon: 'manage_accounts', route: '/profile', groupLabel: 'Navigate' }
];

const KIND_ICONS: Record<string, string> = {
  simulator: 'flight_takeoff',
  operation: 'rocket_launch',
  maintenance: 'build_circle',
  asset: 'precision_manufacturing',
  inventory: 'inventory_2',
  task: 'task_alt',
  wiki: 'article'
};

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommandPaletteComponent implements OnInit, OnChanges, OnDestroy {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  query = '';
  loading = false;
  activeIndex = 0;

  private destroy$ = new Subject<void>();
  private searchTerms$ = new Subject<string>();
  private sections: NavSectionAccess[] = [];
  private apiGroups: Array<{ label: string; items: PaletteItem[] }> = [];

  visibleGroups: Array<{ label: string; items: PaletteItem[] }> = [];
  flatItems: PaletteItem[] = [];

  constructor(
    private api: ApiService,
    private router: Router,
    private sectionAccess: SectionAccessService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sectionAccess.sections$.pipe(takeUntil(this.destroy$)).subscribe((sections) => {
      this.sections = sections || [];
      this.rebuildVisibleList();
      this.cdr.markForCheck();
    });

    this.searchTerms$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((term) => {
        const trimmed = term.trim();
        if (trimmed.length < 2) {
          this.loading = false;
          this.apiGroups = [];
          this.rebuildVisibleList();
          this.cdr.markForCheck();
          return of(null);
        }

        this.loading = true;
        this.cdr.markForCheck();
        return this.api.get<any>('/search', { q: trimmed }).pipe(
          catchError(() => of({ data: { groups: [] } }))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe((res) => {
      if (res === null) return;
      this.loading = false;
      const rawGroups: any[] = res?.data?.groups || [];
      this.apiGroups = rawGroups
        .filter((g) => !g.sectionKey || this.isSectionVisible(g.sectionKey))
        .map((g) => ({
          label: g.label,
          items: (g.items || []).map((it: any) => ({
            key: `${g.key}-${it.id}`,
            title: it.title,
            subtitle: it.subtitle,
            icon: KIND_ICONS[it.kind] || 'search',
            badge: it.badge,
            badgeTone: it.badgeTone || 'neutral',
            route: it.route,
            queryParams: it.queryParams,
            sectionKey: g.sectionKey,
            groupLabel: g.label
          }))
        }))
        .filter((g) => g.items.length > 0);

      this.rebuildVisibleList();
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.query = '';
        this.apiGroups = [];
        this.loading = false;
        this.activeIndex = 0;
        this.rebuildVisibleList();
        setTimeout(() => {
          this.searchInput?.nativeElement?.focus();
        }, 10);
      }
    }
  }

  onQueryChange(val: string): void {
    this.query = val;
    this.activeIndex = 0;
    this.rebuildVisibleList();
    this.searchTerms$.next(val);
  }

  clearQuery(): void {
    this.onQueryChange('');
    this.searchInput?.nativeElement?.focus();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('cp-overlay')) {
      this.close();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (!this.flatItems.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.flatItems.length;
      this.scrollActiveIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + this.flatItems.length) % this.flatItems.length;
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = this.flatItems[this.activeIndex];
      if (target) this.selectItem(target);
    }
  }

  selectItem(item: PaletteItem): void {
    this.close();
    this.router.navigate([item.route], {
      queryParams: item.queryParams || undefined
    });
  }

  getItemFlatIndex(item: PaletteItem): number {
    return this.flatItems.findIndex((x) => x.key === item.key);
  }

  trackByKey(_: number, item: PaletteItem): string {
    return item.key;
  }

  trackByGroup(_: number, grp: { label: string }): string {
    return grp.label;
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      const el = document.querySelector('.cp-item.active');
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  private isSectionVisible(sectionKey?: string): boolean {
    if (!sectionKey) return true;
    const found = this.sections.find((s) => s.section_key === sectionKey);
    if (!found && sectionKey === 'dashboard') return true;
    return this.sectionAccess.isVisible(found);
  }

  private rebuildVisibleList(): void {
    const q = this.query.trim().toLowerCase();

    const matchingActions = STATIC_ACTIONS.filter((a) =>
      this.isSectionVisible(a.sectionKey) &&
      (!q || a.title.toLowerCase().includes(q) || (a.subtitle || '').toLowerCase().includes(q))
    );

    const matchingRoutes = STATIC_ROUTES.filter((r) =>
      this.isSectionVisible(r.sectionKey) &&
      (!q || r.title.toLowerCase().includes(q) || (r.subtitle || '').toLowerCase().includes(q))
    );

    const groups: Array<{ label: string; items: PaletteItem[] }> = [];
    for (const g of this.apiGroups) {
      groups.push(g);
    }
    if (matchingActions.length) {
      groups.push({ label: 'Quick Actions', items: matchingActions });
    }
    if (matchingRoutes.length) {
      groups.push({ label: 'Navigate', items: matchingRoutes });
    }

    this.visibleGroups = groups;
    this.flatItems = groups.flatMap((g) => g.items);
    if (this.activeIndex >= this.flatItems.length) {
      this.activeIndex = 0;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
