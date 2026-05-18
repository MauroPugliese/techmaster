// =============================================================================
// maintenance-calendar.component.ts — Interactive monthly calendar
// =============================================================================
import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarIndicators, CalendarIndicator } from '../../../../core/models/interfaces';

@Component({
  selector: 'app-maintenance-calendar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './maintenance-calendar.component.html',
  styleUrls: ['./maintenance-calendar.component.scss']
})
export class MaintenanceCalendarComponent implements OnChanges {

  @Input() indicators: CalendarIndicators = {};
  @Input() selectedDate = '';
  @Output() dateSelected = new EventEmitter<string>();
  @Output() monthChanged = new EventEmitter<{ year: number; month: number }>();

  year  = new Date().getFullYear();
  month = new Date().getMonth() + 1;

  weeks: (number | null)[][] = [];
  weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  get monthLabel(): string {
    const names = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${names[this.month]} ${this.year}`;
  }

  get selectedDay(): number {
    if (!this.selectedDate) return 0;
    const parts = this.selectedDate.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (y === this.year && m === this.month) return d;
    return 0;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedDate'] && this.selectedDate) {
      const parts = this.selectedDate.split('-');
      this.year = parseInt(parts[0], 10);
      this.month = parseInt(parts[1], 10);
    }
    this.buildCalendar();
  }

  prevMonth(): void {
    this.month--;
    if (this.month < 1) { this.month = 12; this.year--; }
    this.buildCalendar();
    this.monthChanged.emit({ year: this.year, month: this.month });
  }

  nextMonth(): void {
    this.month++;
    if (this.month > 12) { this.month = 1; this.year++; }
    this.buildCalendar();
    this.monthChanged.emit({ year: this.year, month: this.month });
  }

  selectDay(day: number | null): void {
    if (!day) return;
    const m = String(this.month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    this.dateSelected.emit(`${this.year}-${m}-${d}`);
  }

  getIndicators(day: number | null): CalendarIndicator[] {
    if (!day || !this.indicators[day]) return [];
    return this.indicators[day];
  }

  isToday(day: number | null): boolean {
    if (!day) return false;
    const now = new Date();
    return now.getFullYear() === this.year && (now.getMonth() + 1) === this.month && now.getDate() === day;
  }

  private buildCalendar(): void {
    const firstDay = new Date(this.year, this.month - 1, 1).getDay();
    const daysInMonth = new Date(this.year, this.month, 0).getDate();

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    this.weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      this.weeks.push(cells.slice(i, i + 7));
    }
  }
}
