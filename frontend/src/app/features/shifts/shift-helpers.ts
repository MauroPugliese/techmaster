// =============================================================================
// shift-helpers.ts — Pure helper utilities for Shifts & Roster management
// =============================================================================
import {
  Shift,
  ShiftEmployee,
  ShiftEntryKind,
  ShiftLeaveType,
  ShiftStatus,
  ShiftType,
} from '../../core/models/interfaces';
import { formatLocalYmd } from '../../shared/components/datetime-picker/datetime-picker.utils';

export interface ShiftEffectiveInfo {
  isLeave: boolean;
  isCustom: boolean;
  entryKind: ShiftEntryKind;
  leaveType: ShiftLeaveType | null;
  start: string | null;
  end: string | null;
  standardStart: string;
  standardEnd: string;
  standardHours: number;
  effectiveHours: number;
  deltaHours: number;
  color: string;
  code: string;
  name: string;
}

export interface ShiftStatusMeta {
  label: string;
  badgeClass: string;
  color: string;
  icon: string;
}

export interface LeaveTypeMeta {
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
}

const MIN_REST_HOURS = 11.0;

/**
 * Computes the Monday (00:00:00 local) for the week containing `referenceDate`,
 * shifted by `weekOffset` weeks. Correctly handles Sunday (`getDay() === 0` -> -6).
 */
export function getMondayOfWeek(referenceDate: Date = new Date(), weekOffset = 0): Date {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function buildWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatTimeShort(time?: string | null): string {
  if (!time) return '';
  const trimmed = String(time).trim();
  if (/^\d{1}:\d{2}/.test(trimmed)) return `0${trimmed.slice(0, 4)}`;
  return trimmed.slice(0, 5);
}

export function toHms(time?: string | null): string | null {
  if (!time) return null;
  const trimmed = String(time).trim();
  if (!trimmed) return null;
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d:\d{2}$/.test(trimmed)) return `0${trimmed}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

export function shiftTimeByMinutes(timeHm: string, deltaMinutes: number): string {
  const norm = formatTimeShort(timeHm) || '08:00';
  const [hStr, mStr] = norm.split(':');
  const total = ((Number(hStr) * 60 + Number(mStr) + deltaMinutes) % 1440 + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function calculateShiftHours(start?: string | null, end?: string | null): number {
  const startHms = toHms(start);
  const endHms = toHms(end);
  if (!startHms || !endHms) return 0;
  if (startHms === '00:00:00' && endHms === '00:00:00') return 0;

  const sDate = new Date(`2026-01-01T${startHms}Z`);
  let eDate = new Date(`2026-01-01T${endHms}Z`);
  if (eDate <= sDate) {
    eDate = new Date(eDate.getTime() + 24 * 60 * 60 * 1000);
  }
  return Math.round(((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60)) * 100) / 100;
}

export interface DurationFormatOptions {
  signed?: boolean;
  zeroLabel?: string;
}

export function formatDurationMinutes(totalMinutes: number, options?: DurationFormatOptions): string {
  if (!Number.isFinite(totalMinutes)) return options?.zeroLabel ?? '0 min';
  const roundedMins = Math.round(totalMinutes);
  if (roundedMins === 0) return options?.zeroLabel ?? '0 min';

  const sign = roundedMins < 0 ? '-' : options?.signed ? '+' : '';
  const absMins = Math.abs(roundedMins);
  const hours = Math.floor(absMins / 60);
  const mins = absMins % 60;

  if (hours === 0) return `${sign}${mins} min`;
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${mins}m`;
}

export function formatHours(hours: number, options?: DurationFormatOptions): string {
  if (!Number.isFinite(hours)) return options?.zeroLabel ?? '0 min';
  return formatDurationMinutes(Math.round(hours * 60), options);
}

export function splitHoursToHm(hours: number): { hours: number; minutes: number } {
  const totalMins = Math.max(0, Math.round((Number(hours) || 0) * 60));
  return {
    hours: Math.floor(totalMins / 60),
    minutes: totalMins % 60,
  };
}

export function combineHmToHours(hours: number, minutes: number): number {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  const totalMins = Math.min(24 * 60, h * 60 + m);
  return Math.round((totalMins / 60) * 100) / 100;
}

export function inferLeaveType(shiftType?: ShiftType | null, explicit?: string | null): ShiftLeaveType {
  const upper = (explicit || '').trim().toUpperCase();
  if (upper === 'SICK' || upper === 'VACATION' || upper === 'HOLIDAY' || upper === 'PERSONAL' || upper === 'OTHER') {
    return upper;
  }
  const code = (shiftType?.code || '').toUpperCase();
  if (code === 'SCK') return 'SICK';
  if (code === 'VAC') return 'VACATION';
  if (code === 'HOL') return 'HOLIDAY';
  if (code === 'PRM') return 'PERSONAL';

  const name = (shiftType?.name || '').toLowerCase();
  if (name.includes('sick') || name.includes('medical') || name.includes('malatt')) return 'SICK';
  if (name.includes('vac') || name.includes('ferie')) return 'VACATION';
  if (name.includes('hol') || name.includes('festiv')) return 'HOLIDAY';
  if (name.includes('pers') || name.includes('perm')) return 'PERSONAL';
  return 'OTHER';
}

export function getShiftEffectiveInfo(shift: Shift, shiftTypes: ShiftType[]): ShiftEffectiveInfo {
  const matchedType = shift.shiftType || shiftTypes.find(st => st.id === shift.shift_type_id);
  const color = matchedType?.color || '#1565C0';
  const code = matchedType?.code || '?';
  const name = matchedType?.name || 'Shift';

  const isLeave =
    matchedType?.category === 'LEAVE' ||
    shift.entry_kind === 'LEAVE' ||
    shift.status === 'ON_LEAVE';

  if (isLeave) {
    return {
      isLeave: true,
      isCustom: false,
      entryKind: 'LEAVE',
      leaveType: inferLeaveType(matchedType, shift.leave_type),
      start: null,
      end: null,
      standardStart: '00:00',
      standardEnd: '00:00',
      standardHours: 0,
      effectiveHours: 0,
      deltaHours: 0,
      color,
      code,
      name,
    };
  }

  const stdStart = formatTimeShort(matchedType?.start_time) || '08:00';
  const stdEnd = formatTimeShort(matchedType?.end_time) || '16:00';
  const customStart = formatTimeShort(shift.custom_start_time) || null;
  const customEnd = formatTimeShort(shift.custom_end_time) || null;

  const effStart = customStart || stdStart;
  const effEnd = customEnd || stdEnd;
  const standardHours = calculateShiftHours(stdStart, stdEnd);
  const effectiveHours = calculateShiftHours(effStart, effEnd);
  const deltaHours = Math.round((effectiveHours - standardHours) * 100) / 100;

  const hasTimeOverride = Boolean((customStart && customStart !== stdStart) || (customEnd && customEnd !== stdEnd));
  const isCustom = hasTimeOverride || shift.entry_kind === 'CUSTOM' || code.toUpperCase() === 'CST';

  return {
    isLeave: false,
    isCustom,
    entryKind: isCustom ? 'CUSTOM' : 'WORK',
    leaveType: null,
    start: effStart,
    end: effEnd,
    standardStart: stdStart,
    standardEnd: stdEnd,
    standardHours,
    effectiveHours,
    deltaHours,
    color,
    code,
    name,
  };
}

export function getStatusMeta(status: ShiftStatus): ShiftStatusMeta {
  switch (status) {
    case 'CONFIRMED':
      return { label: 'Confirmed', badgeClass: 'badge-scheduled', color: '#059669', icon: 'check_circle' };
    case 'IN_PROGRESS':
      return { label: 'In Progress', badgeClass: 'badge-in-progress', color: '#0284C7', icon: 'play_circle' };
    case 'COMPLETED':
      return { label: 'Completed', badgeClass: 'badge-completed', color: '#15803D', icon: 'task_alt' };
    case 'ABSENT':
      return { label: 'Absent', badgeClass: 'badge-failed', color: '#DC2626', icon: 'person_off' };
    case 'SWAPPED':
      return { label: 'Swapped', badgeClass: 'badge-planned', color: '#7C3AED', icon: 'swap_horiz' };
    case 'ON_LEAVE':
      return { label: 'On Leave', badgeClass: 'badge-on-hold', color: '#0D9488', icon: 'beach_access' };
    case 'SCHEDULED':
    default:
      return { label: 'Scheduled', badgeClass: 'badge-planned', color: '#4338CA', icon: 'event' };
  }
}

export function getLeaveMeta(leaveType?: string | null, shiftType?: ShiftType): LeaveTypeMeta {
  const resolved = inferLeaveType(shiftType, leaveType);
  switch (resolved) {
    case 'SICK':
      return { label: 'Sick Leave', shortLabel: 'Sick', icon: 'medical_services', color: '#EF4444' };
    case 'VACATION':
      return { label: 'Vacation', shortLabel: 'Vacation', icon: 'beach_access', color: '#10B981' };
    case 'HOLIDAY':
      return { label: 'Public Holiday', shortLabel: 'Holiday', icon: 'celebration', color: '#F59E0B' };
    case 'PERSONAL':
      return { label: 'Personal Leave', shortLabel: 'Personal', icon: 'event_busy', color: '#8B5CF6' };
    case 'OTHER':
    default:
      return { label: shiftType?.name || 'Leave', shortLabel: 'Leave', icon: 'event_busy', color: '#0D9488' };
  }
}

function getIntervalUtc(dateStr: string, startTime: string, endTime: string): { start: Date; end: Date } {
  const sHms = toHms(startTime) || '00:00:00';
  const eHms = toHms(endTime) || '00:00:00';
  const start = new Date(`${dateStr}T${sHms}Z`);
  if (sHms === '00:00:00' && eHms === '00:00:00') {
    return { start, end: new Date(start.getTime()) };
  }
  let end = new Date(`${dateStr}T${eHms}Z`);
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

/**
 * Checks whether any loaded working shift for `userId` conflicts with proposed dates/times
 * under the 11-hour minimum rest / no-overlap rule. Advisory only (authoritative check runs on server).
 */
export function checkClientLaborLawAdvisory(
  params: {
    userId: number;
    dates: string[];
    startTime: string | null;
    endTime: string | null;
    isLeave: boolean;
    excludeShiftId?: number | null;
  },
  loadedShifts: Shift[],
  shiftTypes: ShiftType[]
): string | null {
  if (params.isLeave || !params.startTime || !params.endTime || !params.dates.length) {
    return null;
  }

  const userShifts = loadedShifts.filter(s =>
    s.user_id === params.userId &&
    s.id !== params.excludeShiftId &&
    s.status !== 'ABSENT' &&
    s.status !== 'ON_LEAVE' &&
    s.entry_kind !== 'LEAVE'
  );

  for (const dateStr of params.dates) {
    const proposed = getIntervalUtc(dateStr, params.startTime, params.endTime);

    for (const existing of userShifts) {
      if (params.dates.includes(existing.date)) continue; // same-day replace/existing handled separately
      const info = getShiftEffectiveInfo(existing, shiftTypes);
      if (info.isLeave || !info.start || !info.end) continue;

      const existingInt = getIntervalUtc(existing.date, info.start, info.end);

      if (proposed.start < existingInt.end && existingInt.start < proposed.end) {
        return `Schedule overlap on ${dateStr} with ${info.name} (${existing.date} ${info.start}–${info.end}).`;
      }

      const restAfter = (proposed.start.getTime() - existingInt.end.getTime()) / (1000 * 60 * 60);
      const restBefore = (existingInt.start.getTime() - proposed.end.getTime()) / (1000 * 60 * 60);

      if (proposed.start >= existingInt.end && restAfter < MIN_REST_HOURS) {
        return `Rest rule warning: only ${formatHours(restAfter)} rest after ${existing.date} shift ending ${info.end} (min 11h required).`;
      }
      if (existingInt.start >= proposed.end && restBefore < MIN_REST_HOURS) {
        return `Rest rule warning: only ${formatHours(restBefore)} rest before ${existing.date} shift starting ${info.start} (min 11h required).`;
      }
    }
  }

  return null;
}

export function buildDateRangeYmd(start: Date | null, end: Date | null, skipWeekends = false): string[] {
  if (!start || !end) return [];
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (e < s) return [];

  const result: string[] = [];
  const cursor = new Date(s.getTime());
  while (cursor <= e && result.length < 62) {
    const dow = cursor.getDay();
    if (!skipWeekends || (dow !== 0 && dow !== 6)) {
      result.push(formatLocalYmd(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export interface EmployeeWeekSummary {
  workedHours: number;
  shiftCount: number;
  overtimeHours: number;
  leaveDays: number;
}

export interface DayCoverageSummary {
  onDutyCount: number;
  leaveCount: number;
  absentCount: number;
  codeCounts: Array<{ code: string; count: number; color: string }>;
}

export interface ShiftWeekKpis {
  workShiftsCount: number;
  totalPlannedHours: number;
  confirmedOrDoneCount: number;
  inProgressCount: number;
  leaveAndAbsentCount: number;
  sickCount: number;
  vacationCount: number;
  holidayCount: number;
  absentCount: number;
  totalOvertimeHours: number;
  customAdjustedCount: number;
}

export function emptyShiftKpis(): ShiftWeekKpis {
  return {
    workShiftsCount: 0,
    totalPlannedHours: 0,
    confirmedOrDoneCount: 0,
    inProgressCount: 0,
    leaveAndAbsentCount: 0,
    sickCount: 0,
    vacationCount: 0,
    holidayCount: 0,
    absentCount: 0,
    totalOvertimeHours: 0,
    customAdjustedCount: 0,
  };
}

export function computeWeekKpis(weekShifts: Shift[], shiftTypes: ShiftType[]): ShiftWeekKpis {
  const next = emptyShiftKpis();

  for (const shift of weekShifts) {
    const info = getShiftEffectiveInfo(shift, shiftTypes);
    if (info.isLeave) {
      next.leaveAndAbsentCount += 1;
      if (info.leaveType === 'SICK') next.sickCount += 1;
      else if (info.leaveType === 'VACATION') next.vacationCount += 1;
      else if (info.leaveType === 'HOLIDAY') next.holidayCount += 1;
      continue;
    }

    if (shift.status === 'ABSENT') {
      next.absentCount += 1;
      next.leaveAndAbsentCount += 1;
    } else {
      next.workShiftsCount += 1;
      next.totalPlannedHours += info.effectiveHours;
    }

    if (shift.status === 'CONFIRMED' || shift.status === 'COMPLETED') next.confirmedOrDoneCount += 1;
    if (shift.status === 'IN_PROGRESS') next.inProgressCount += 1;
    if (info.isCustom) next.customAdjustedCount += 1;
    next.totalOvertimeHours += Number(shift.overtime_hours) || 0;
  }

  next.totalPlannedHours = Math.round(next.totalPlannedHours * 10) / 10;
  next.totalOvertimeHours = Math.round(next.totalOvertimeHours * 10) / 10;
  return next;
}

export function computeEmployeeSummaries(
  employees: ShiftEmployee[],
  weekDays: Date[],
  lookup: Map<string, Shift>,
  shiftTypes: ShiftType[]
): Map<number, EmployeeWeekSummary> {
  const map = new Map<number, EmployeeWeekSummary>();

  for (const emp of employees) {
    let workedHours = 0;
    let shiftCount = 0;
    let overtimeHours = 0;
    let leaveDays = 0;

    for (const day of weekDays) {
      const shift = lookup.get(`${emp.id}_${formatLocalYmd(day)}`);
      if (!shift) continue;
      const info = getShiftEffectiveInfo(shift, shiftTypes);
      if (info.isLeave) {
        leaveDays += 1;
      } else if (shift.status !== 'ABSENT') {
        shiftCount += 1;
        workedHours += info.effectiveHours;
        overtimeHours += Number(shift.overtime_hours) || 0;
      }
    }

    map.set(emp.id, {
      workedHours: Math.round(workedHours * 10) / 10,
      shiftCount,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
      leaveDays,
    });
  }

  return map;
}

export function computeDayCoverage(
  day: Date,
  employees: ShiftEmployee[],
  lookup: Map<string, Shift>,
  shiftTypes: ShiftType[]
): DayCoverageSummary {
  const ymd = formatLocalYmd(day);
  let onDutyCount = 0;
  let leaveCount = 0;
  let absentCount = 0;
  const byCode = new Map<string, { code: string; count: number; color: string }>();

  for (const emp of employees) {
    const shift = lookup.get(`${emp.id}_${ymd}`);
    if (!shift) continue;
    const info = getShiftEffectiveInfo(shift, shiftTypes);
    if (info.isLeave) {
      leaveCount += 1;
    } else if (shift.status === 'ABSENT') {
      absentCount += 1;
    } else {
      onDutyCount += 1;
      const entry = byCode.get(info.code) || { code: info.code, count: 0, color: info.color };
      entry.count += 1;
      byCode.set(info.code, entry);
    }
  }

  return {
    onDutyCount,
    leaveCount,
    absentCount,
    codeCounts: Array.from(byCode.values()),
  };
}
