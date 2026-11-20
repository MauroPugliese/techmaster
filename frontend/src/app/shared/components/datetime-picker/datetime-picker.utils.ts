// =============================================================================
// datetime-picker.utils.ts — Pure immutable date/time helpers for picker UI
// =============================================================================

export type DateTimePickerMode = 'datetime' | 'date';

export interface CalendarDay {
  date: Date;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  key: string;
}

export const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const;

export const HOURS_24: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

/** Zero-pad a non-negative integer to 2 digits. */
export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Format a local calendar Date as YYYY-MM-DD without UTC timezone drift. */
export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse Date | YYYY-MM-DD | ISO string into a defensive Date clone, or null. */
export function parseIncomingDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]) - 1;
    const day = Number(ymd[3]);
    const local = new Date(year, month, day, 0, 0, 0, 0);
    if (local.getFullYear() === year && local.getMonth() === month && local.getDate() === day) {
      return local;
    }
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Resolve initial fallback hours & minutes from 'now' or 'HH:MM'. */
export function parseDefaultTime(defaultTime: string): { hours: number; minutes: number } {
  const raw = String(defaultTime || 'now').trim().toLowerCase();
  if (!raw || raw === 'now') {
    const now = new Date();
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }

  const match = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (match) {
    return {
      hours: clampInt(match[1], 0, 23, 9),
      minutes: clampInt(match[2], 0, 59, 0)
    };
  }

  return { hours: 9, minutes: 0 };
}

/** Build minute steps (default 5: 00, 05, ..., 55). */
export function buildMinuteOptions(step = 5): number[] {
  const safeStep = clampInt(step, 1, 30, 5);
  const out: number[] = [];
  for (let m = 0; m < 60; m += safeStep) {
    out.push(m);
  }
  return out;
}

/** Clamp parsed numeric text into [min, max], returning fallback if invalid. */
export function clampInt(raw: string | number, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Check whether two Date values fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalDayTs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/** Return a new Date keeping existing (or fallback) time while setting local Y/M/D. */
export function withDatePart(
  base: Date | null,
  year: number,
  month: number,
  day: number,
  fallbackTime: { hours: number; minutes: number }
): Date {
  const hours = base ? base.getHours() : fallbackTime.hours;
  const minutes = base ? base.getMinutes() : fallbackTime.minutes;
  return new Date(year, month, day, hours, minutes, 0, 0);
}

/** Return a new Date keeping existing (or today's) date while setting local HH:MM. */
export function withTimePart(base: Date | null, hours: number, minutes: number): Date {
  const ref = base || new Date();
  return new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate(),
    clampInt(hours, 0, 23, 0),
    clampInt(minutes, 0, 59, 0),
    0,
    0
  );
}

/** Build a 6-row (42-cell) Monday-first calendar grid for viewYear/viewMonth. */
export function buildCalendarGrid(
  viewYear: number,
  viewMonth: number,
  selected: Date | null,
  minDate: Date | null,
  maxDate: Date | null
): CalendarDay[] {
  const firstOfMonth = new Date(viewYear, viewMonth, 1, 0, 0, 0, 0);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const today = new Date();
  const minTs = minDate ? startOfLocalDayTs(minDate) : null;
  const maxTs = maxDate ? startOfLocalDayTs(maxDate) : null;

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(viewYear, viewMonth, 1 - startOffset + i, 0, 0, 0, 0);
    const cellTs = cellDate.getTime();
    const isDisabled =
      (minTs !== null && cellTs < minTs) ||
      (maxTs !== null && cellTs > maxTs);

    days.push({
      date: cellDate,
      day: cellDate.getDate(),
      inCurrentMonth: cellDate.getFullYear() === viewYear && cellDate.getMonth() === viewMonth,
      isToday: isSameLocalDay(cellDate, today),
      isSelected: selected ? isSameLocalDay(cellDate, selected) : false,
      isDisabled,
      key: formatLocalYmd(cellDate)
    });
  }
  return days;
}

/** Format compact display label shown in the picker trigger input. */
export function formatDisplayDate(d: Date | null, mode: DateTimePickerMode): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const datePart = `${pad2(d.getDate())} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  if (mode === 'date') return datePart;
  return `${datePart}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
