import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { DateRange } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class DateFilterService {
  private rangeSubject = new BehaviorSubject<DateRange>({ from: null, to: null });
  range$ = this.rangeSubject.asObservable();

  get currentRange(): DateRange { return this.rangeSubject.value; }

  setRange(range: DateRange): void {
    this.rangeSubject.next(range);
  }

  setPreset(preset: 'today' | 'week' | 'month' | 'quarter' | 'year'): void {
    const now  = new Date();
    const from = new Date();
    switch (preset) {
      case 'today':   from.setHours(0, 0, 0, 0); break;
      case 'week':    from.setDate(now.getDate() - 7); break;
      case 'month':   from.setMonth(now.getMonth() - 1); break;
      case 'quarter': from.setMonth(now.getMonth() - 3); break;
      case 'year':    from.setFullYear(now.getFullYear() - 1); break;
    }
    this.rangeSubject.next({ from, to: now });
  }

  clearRange(): void { this.rangeSubject.next({ from: null, to: null }); }

  getLabel(): string {
    const { from, to } = this.currentRange;
    if (!from && !to) return 'All time';
    const hasExplicitTime =
      (from && (from.getHours() !== 0 || from.getMinutes() !== 0)) ||
      (to && !((to.getHours() === 23 && to.getMinutes() === 59) || (to.getHours() === 0 && to.getMinutes() === 0)));
    const fmt = (d: Date) => hasExplicitTime
      ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (from && to) return `${fmt(from)} – ${fmt(to)}`;
    if (from)       return `From ${fmt(from)}`;
    return `Until ${fmt(to!)}`;
  }
}
