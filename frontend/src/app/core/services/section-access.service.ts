import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap, timeout } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface NavSectionAccess {
  section_key: string;
  path: string;
  label: string;
  group: string;
  icon: string;
  is_visible?: boolean | number | string | null;
  source?: 'user' | 'role' | 'global' | 'default' | string;
}

const DEFAULT_SECTIONS: NavSectionAccess[] = [
  { section_key: 'dashboard', path: '/dashboard', label: 'Dashboard', group: 'Overview', icon: 'dashboard', is_visible: true, source: 'default' },
  { section_key: 'operations', path: '/operations', label: 'Operations & Sorties', group: 'Operations', icon: 'rocket_launch', is_visible: true, source: 'default' },
  { section_key: 'maintenance', path: '/maintenance', label: 'Maintenance', group: 'Operations', icon: 'build_circle', is_visible: true, source: 'default' },
  { section_key: 'warehouse', path: '/warehouse', label: 'Warehouse', group: 'Operations', icon: 'inventory_2', is_visible: true, source: 'default' },
  { section_key: 'shifts', path: '/shifts', label: 'Shifts', group: 'Operations', icon: 'schedule', is_visible: true, source: 'default' },
  { section_key: 'analytics', path: '/analytics', label: 'Analytics & Reports', group: 'Intelligence', icon: 'insights', is_visible: true, source: 'default' },
  { section_key: 'operations_analytics', path: '/analytics/operations', label: 'Operations Analytics', group: 'Intelligence', icon: 'analytics', is_visible: true, source: 'default' },
  { section_key: 'tasks', path: '/tasks', label: 'Task Manager', group: 'Intelligence', icon: 'task_alt', is_visible: true, source: 'default' },
  { section_key: 'wiki', path: '/wiki', label: 'Wiki & Docs', group: 'Knowledge', icon: 'menu_book', is_visible: true, source: 'default' },
  { section_key: 'admin', path: '/admin', label: 'Admin Settings', group: 'Administration', icon: 'admin_panel_settings', is_visible: true, source: 'default' }
];

@Injectable({ providedIn: 'root' })
export class SectionAccessService {
  private sectionsSubject = new BehaviorSubject<NavSectionAccess[]>(DEFAULT_SECTIONS);
  readonly sections$ = this.sectionsSubject.asObservable();

  private cache: NavSectionAccess[] | null = null;
  private pendingRequest$: Observable<NavSectionAccess[]> | null = null;

  constructor(private api: ApiService) {}

  load(force = false): Observable<NavSectionAccess[]> {
    if (!force && this.cache) {
      return of(this.cache);
    }

    if (!force && this.pendingRequest$) {
      return this.pendingRequest$;
    }

    const request$ = this.api.get<any>('/ui/navigation').pipe(
      timeout(5000),
      map(res => this.normalizeSections(res?.data?.sections)),
      tap((sections: NavSectionAccess[]) => {
        this.cache = sections;
        this.sectionsSubject.next(sections);
        this.pendingRequest$ = null;
      }),
      catchError(() => {
        const fallback = this.cloneDefaults();
        this.cache = fallback;
        this.sectionsSubject.next(fallback);
        this.pendingRequest$ = null;
        return of(fallback);
      }),
      shareReplay(1)
    );

    this.pendingRequest$ = request$;
    return request$;
  }

  refresh(): Observable<NavSectionAccess[]> {
    this.cache = null;
    this.pendingRequest$ = null;
    return this.load(true);
  }

  isVisible(section: NavSectionAccess | null | undefined): boolean {
    if (!section) return true;
    const value = section.is_visible;
    return !(value === false || value === 0 || value === '0');
  }

  canAccessSection(sectionKey: string): Observable<boolean> {
    return this.load(false).pipe(
      map(sections => {
        const section = sections.find(item => item.section_key === sectionKey);
        return !section || this.isVisible(section);
      }),
      catchError(() => of(true))
    );
  }

  getFirstVisiblePath(sections: NavSectionAccess[]): string {
    const visible = (sections || []).find(section => this.isVisible(section));
    return visible?.path || '/dashboard';
  }

  private normalizeSections(input: any): NavSectionAccess[] {
    const rows = Array.isArray(input) ? input : [];
    if (!rows.length) return this.cloneDefaults();

    const normalized = rows.map((row: any) => ({
      section_key: String(row?.section_key || ''),
      path: String(row?.path || ''),
      label: String(row?.label || row?.section_key || ''),
      group: String(row?.group || 'Other'),
      icon: String(row?.icon || 'apps'),
      is_visible: row?.is_visible,
      source: row?.source || 'default'
    })).filter((row: NavSectionAccess) => !!row.section_key && !!row.path);

    return normalized.length ? normalized : this.cloneDefaults();
  }

  private cloneDefaults(): NavSectionAccess[] {
    return DEFAULT_SECTIONS.map(section => ({ ...section }));
  }
}
