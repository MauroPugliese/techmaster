import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface UiFieldPreference {
  field_key: string;
  label?: string | null;
  is_visible?: boolean | number | string | null;
  display_order?: number;
}

export interface UiSectionPreferences {
  section_key: string;
  table: UiFieldPreference[];
  form: UiFieldPreference[];
  defaults?: { table: string[]; form: string[] };
}

@Injectable({ providedIn: 'root' })
export class UiCustomizationService {
  private cache = new Map<string, UiSectionPreferences>();

  constructor(private api: ApiService) {}

  load(sectionKey: string, force = true): Observable<UiSectionPreferences> {
    if (!force && this.cache.has(sectionKey)) {
      return of(this.cache.get(sectionKey) as UiSectionPreferences);
    }

    return this.api.get<any>('/ui/sections/' + sectionKey + '/preferences').pipe(
      map(res => res?.data || { section_key: sectionKey, table: [], form: [] }),
      tap((prefs: UiSectionPreferences) => this.cache.set(sectionKey, prefs)),
      catchError(() => of({ section_key: sectionKey, table: [], form: [], defaults: { table: [], form: [] } }))
    );
  }

  isVisible(prefs: UiSectionPreferences | null, scope: 'table' | 'form', fieldKey: string, fallback = true): boolean {
    if (!prefs) return fallback;
    const list = scope === 'table' ? prefs.table : prefs.form;
    const found = list.find(f => f.field_key === fieldKey);
    if (!found) return fallback;
    if (found.is_visible === undefined || found.is_visible === null) return fallback;
    return !(found.is_visible === false || found.is_visible === 0 || found.is_visible === '0');
  }

  getLabel(prefs: UiSectionPreferences | null, scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    if (!prefs) return fallback;
    const list = scope === 'table' ? prefs.table : prefs.form;
    const found = list.find(f => f.field_key === fieldKey);
    return (found?.label || '').trim() || fallback;
  }
}
