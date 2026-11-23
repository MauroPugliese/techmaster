// =============================================================================
// services/shift-schedule.service.js — Pure shift normalization & compliance
// =============================================================================

const VALID_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABSENT',
  'SWAPPED',
  'ON_LEAVE',
];

const VALID_ENTRY_KINDS = ['WORK', 'CUSTOM', 'LEAVE'];
const VALID_LEAVE_TYPES = ['SICK', 'VACATION', 'HOLIDAY', 'PERSONAL', 'OTHER'];
const VALID_SHIFT_TYPE_CATEGORIES = ['WORK', 'LEAVE'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const SHIFT_CODE_RE = /^[A-Z0-9_-]{1,10}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const CODE_TO_LEAVE_TYPE = {
  SCK: 'SICK',
  VAC: 'VACATION',
  HOL: 'HOLIDAY',
  PRM: 'PERSONAL',
};

const MAX_BULK_DAYS = 62;
const MIN_REST_HOURS = 11.0;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function formatDurationHours(hours) {
  if (!Number.isFinite(hours)) return '0 min';
  const totalMins = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Normalizes a time input to 'HH:mm:ss'.
 * Returns null for empty/null values, and undefined when malformed.
 */
function normalizeTime(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match = TIME_RE.exec(raw);
  if (!match) return undefined;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3] ?? '0');

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
    return undefined;
  }

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isValidIsoDate(dateStr) {
  if (typeof dateStr !== 'string' || !ISO_DATE_RE.test(dateStr.trim())) {
    return false;
  }
  const clean = dateStr.trim();
  const parsed = new Date(`${clean}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === clean;
}

/**
 * Returns UTC start/end Date objects for a shift on dateStr, rolling past midnight when end <= start
 * (except 00:00:00 - 00:00:00 which represents a zero-duration placeholder).
 */
function getShiftInterval(dateStr, startTime, endTime) {
  const startNorm = normalizeTime(startTime) || '00:00:00';
  const endNorm = normalizeTime(endTime) || '00:00:00';
  const start = new Date(`${dateStr}T${startNorm}Z`);

  if (startNorm === '00:00:00' && endNorm === '00:00:00') {
    return { start, end: new Date(start.getTime()) };
  }

  let end = new Date(`${dateStr}T${endNorm}Z`);
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

/**
 * Calculates shift duration in hours rounded to 2 decimals.
 * Handles 00:00:00-00:00:00 as 0h and 00:00:00-23:59:59 as 24h.
 */
function calculateDurationHours(startTime, endTime) {
  const startNorm = normalizeTime(startTime);
  const endNorm = normalizeTime(endTime);
  if (!startNorm || !endNorm) return 0;
  if (startNorm === '00:00:00' && endNorm === '00:00:00') return 0;

  const { start, end } = getShiftInterval('2026-01-01', startNorm, endNorm);
  return round2((end.getTime() - start.getTime()) / (1000 * 60 * 60));
}

function inferLeaveType(shiftType, explicitLeaveType) {
  if (explicitLeaveType !== undefined && explicitLeaveType !== null && String(explicitLeaveType).trim() !== '') {
    const upper = String(explicitLeaveType).trim().toUpperCase();
    if (VALID_LEAVE_TYPES.includes(upper)) return upper;
  }

  const code = String(shiftType?.code || '').trim().toUpperCase();
  if (CODE_TO_LEAVE_TYPE[code]) {
    return CODE_TO_LEAVE_TYPE[code];
  }

  const name = String(shiftType?.name || '').toLowerCase();
  if (name.includes('sick') || name.includes('medical') || name.includes('malatt')) return 'SICK';
  if (name.includes('vac') || name.includes('ferie')) return 'VACATION';
  if (name.includes('hol') || name.includes('festiv')) return 'HOLIDAY';
  if (name.includes('pers') || name.includes('perm')) return 'PERSONAL';

  return 'OTHER';
}

function resolveEffectiveTiming(record, shiftTypeInput) {
  const shiftType = shiftTypeInput || record?.shiftType || {};
  const category = String(shiftType.category || 'WORK').toUpperCase();
  const isLeave =
    category === 'LEAVE' ||
    record?.entry_kind === 'LEAVE' ||
    record?.status === 'ON_LEAVE';

  if (isLeave) {
    return {
      isLeave: true,
      isCustom: false,
      entry_kind: 'LEAVE',
      leave_type: inferLeaveType(shiftType, record?.leave_type),
      effective_start_time: null,
      effective_end_time: null,
      standard_hours: 0,
      effective_hours: 0,
      delta_hours: 0,
    };
  }

  const standardStart = normalizeTime(shiftType.start_time) || '08:00:00';
  const standardEnd = normalizeTime(shiftType.end_time) || '16:00:00';
  const customStart = normalizeTime(record?.custom_start_time) || null;
  const customEnd = normalizeTime(record?.custom_end_time) || null;

  const effectiveStart = customStart || standardStart;
  const effectiveEnd = customEnd || standardEnd;
  const standardHours = calculateDurationHours(standardStart, standardEnd);
  const effectiveHours = calculateDurationHours(effectiveStart, effectiveEnd);
  const deltaHours = round2(effectiveHours - standardHours);

  const hasOverriddenTimes = Boolean(
    (customStart && customStart !== standardStart) ||
    (customEnd && customEnd !== standardEnd)
  );
  const isCustomType = String(shiftType.code || '').trim().toUpperCase() === 'CST';
  const isCustom = hasOverriddenTimes || isCustomType || record?.entry_kind === 'CUSTOM';

  return {
    isLeave: false,
    isCustom,
    entry_kind: isCustom ? 'CUSTOM' : 'WORK',
    leave_type: null,
    effective_start_time: effectiveStart,
    effective_end_time: effectiveEnd,
    standard_hours: standardHours,
    effective_hours: effectiveHours,
    delta_hours: deltaHours,
  };
}

function cleanOptionalText(value, maxLength) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function buildLeaveShiftPayload(base, body, merged, shiftType) {
  const leaveType = inferLeaveType(shiftType, merged.leave_type);
  const reason = cleanOptionalText(
    body.adjustment_reason !== undefined ? body.adjustment_reason : merged.adjustment_reason,
    120
  );

  const data = {
    ...base,
    entry_kind: 'LEAVE',
    leave_type: leaveType,
    status: 'ON_LEAVE',
    custom_start_time: null,
    custom_end_time: null,
    overtime_hours: 0,
    adjustment_reason: reason ?? null,
  };

  return {
    data,
    effective: {
      isLeave: true,
      isCustom: false,
      entry_kind: 'LEAVE',
      leave_type: leaveType,
      effective_start_time: null,
      effective_end_time: null,
      standard_hours: 0,
      effective_hours: 0,
      delta_hours: 0,
    },
  };
}

function sanitizeShiftPayload(body = {}, shiftType, options = {}) {
  if (!shiftType) {
    return { error: 'Invalid shift_type_id' };
  }

  const existingPlain = options.existing
    ? (typeof options.existing.get === 'function' ? options.existing.get({ plain: true }) : options.existing)
    : null;
  const merged = existingPlain ? { ...existingPlain, ...body } : { ...body };

  const userId = Number(merged.user_id);
  const shiftTypeId = Number(merged.shift_type_id);
  const dateStr = typeof merged.date === 'string' ? merged.date.trim().slice(0, 10) : '';

  if (!Number.isInteger(userId) || userId < 1) {
    return { error: 'Valid user_id is required' };
  }
  if (!Number.isInteger(shiftTypeId) || shiftTypeId < 1) {
    return { error: 'Valid shift_type_id is required' };
  }
  if (!isValidIsoDate(dateStr)) {
    return { error: 'Valid YYYY-MM-DD date is required' };
  }

  let supervisorId = null;
  if (merged.supervisor_id !== undefined && merged.supervisor_id !== null && merged.supervisor_id !== '') {
    const parsedSup = Number(merged.supervisor_id);
    if (!Number.isInteger(parsedSup) || parsedSup < 1) {
      return { error: 'Invalid supervisor_id' };
    }
    supervisorId = parsedSup;
  }

  const notes = cleanOptionalText(merged.notes);
  const base = {
    user_id: userId,
    shift_type_id: shiftTypeId,
    supervisor_id: supervisorId,
    date: dateStr,
    notes: notes ?? null,
  };

  const typeCategory = String(shiftType.category || 'WORK').toUpperCase();
  if (typeCategory === 'LEAVE') {
    return buildLeaveShiftPayload(base, body, merged, shiftType);
  }

  if (body.entry_kind && String(body.entry_kind).toUpperCase() === 'LEAVE') {
    return { error: 'Select a Leave shift type when recording leave, vacation, or sick days' };
  }

  let status = merged.status ? String(merged.status).trim().toUpperCase() : 'SCHEDULED';
  if (status === 'ON_LEAVE') status = 'SCHEDULED';
  if (!VALID_STATUSES.includes(status)) {
    return { error: `Invalid shift status: ${status}` };
  }

  const explicitWorkMode = body.entry_kind && String(body.entry_kind).toUpperCase() === 'WORK' &&
    body.custom_start_time === undefined && body.custom_end_time === undefined;

  const rawCustomStart = explicitWorkMode ? null : merged.custom_start_time;
  const rawCustomEnd = explicitWorkMode ? null : merged.custom_end_time;

  const parsedCustomStart = normalizeTime(rawCustomStart);
  if (parsedCustomStart === undefined) {
    return { error: 'Invalid custom_start_time (expected HH:mm or HH:mm:ss)' };
  }
  const parsedCustomEnd = normalizeTime(rawCustomEnd);
  if (parsedCustomEnd === undefined) {
    return { error: 'Invalid custom_end_time (expected HH:mm or HH:mm:ss)' };
  }

  const stdStart = normalizeTime(shiftType.start_time) || '08:00:00';
  const stdEnd = normalizeTime(shiftType.end_time) || '16:00:00';
  const isCstType = String(shiftType.code || '').trim().toUpperCase() === 'CST';
  const requestedCustomMode =
    String(merged.entry_kind || '').toUpperCase() === 'CUSTOM' ||
    isCstType ||
    Boolean(parsedCustomStart || parsedCustomEnd);

  let customStart = parsedCustomStart;
  let customEnd = parsedCustomEnd;

  if (customStart && !customEnd) customEnd = stdEnd;
  if (!customStart && customEnd) customStart = stdStart;
  if (!customStart && !customEnd && (isCstType || String(merged.entry_kind || '').toUpperCase() === 'CUSTOM')) {
    customStart = stdStart;
    customEnd = stdEnd;
  }

  const effStart = customStart || stdStart;
  const effEnd = customEnd || stdEnd;
  const matchesStandard = effStart === stdStart && effEnd === stdEnd;

  if (matchesStandard && !isCstType && String(body.entry_kind || '').toUpperCase() !== 'CUSTOM') {
    customStart = null;
    customEnd = null;
  }

  const entryKind =
    (requestedCustomMode && (!matchesStandard || isCstType || String(body.entry_kind || '').toUpperCase() === 'CUSTOM'))
      ? 'CUSTOM'
      : 'WORK';

  const standardHours = calculateDurationHours(stdStart, stdEnd);
  const effectiveHours = calculateDurationHours(effStart, effEnd);
  const deltaHours = round2(effectiveHours - standardHours);

  let overtimeHours = 0;
  const explicitOvertimeProvided =
    body.overtime_hours !== undefined &&
    body.overtime_hours !== null &&
    body.overtime_hours !== '';

  if (explicitOvertimeProvided && body.auto_overtime !== true) {
    const parsedOt = Number(body.overtime_hours);
    if (!Number.isFinite(parsedOt) || parsedOt < 0 || parsedOt > 24) {
      return { error: 'overtime_hours must be between 0 and 24' };
    }
    overtimeHours = round2(parsedOt);
  } else if (body.custom_start_time !== undefined || body.custom_end_time !== undefined || options.isCreate) {
    overtimeHours = deltaHours > 0 ? deltaHours : 0;
  } else if (existingPlain && existingPlain.overtime_hours !== undefined) {
    overtimeHours = round2(Number(existingPlain.overtime_hours) || 0);
  }

  let adjustmentReason = cleanOptionalText(
    body.adjustment_reason !== undefined ? body.adjustment_reason : merged.adjustment_reason,
    120
  ) ?? null;

  if (entryKind === 'CUSTOM' && !adjustmentReason) {
    if (deltaHours > 0) adjustmentReason = 'Overtime';
    else if (deltaHours < 0) adjustmentReason = 'Early Leave';
    else adjustmentReason = 'Custom Hours';
  }
  if (entryKind === 'WORK' && body.adjustment_reason === undefined && !overtimeHours) {
    adjustmentReason = null;
  }

  return {
    data: {
      ...base,
      entry_kind: entryKind,
      leave_type: null,
      status,
      custom_start_time: entryKind === 'CUSTOM' ? effStart : null,
      custom_end_time: entryKind === 'CUSTOM' ? effEnd : null,
      overtime_hours: overtimeHours,
      adjustment_reason: adjustmentReason,
    },
    effective: {
      isLeave: false,
      isCustom: entryKind === 'CUSTOM',
      entry_kind: entryKind,
      leave_type: null,
      effective_start_time: effStart,
      effective_end_time: effEnd,
      standard_hours: standardHours,
      effective_hours: effectiveHours,
      delta_hours: deltaHours,
    },
  };
}

function checkLaborLawCompliance(proposed, existingShifts = []) {
  if (!proposed || proposed.isLeave) {
    return { valid: true };
  }

  const pStartNorm = normalizeTime(proposed.start_time || proposed.effective_start_time);
  const pEndNorm = normalizeTime(proposed.end_time || proposed.effective_end_time);
  if (!pStartNorm || !pEndNorm) {
    return { valid: true };
  }

  const { start: pStart, end: pEnd } = getShiftInterval(proposed.date, pStartNorm, pEndNorm);

  for (const existing of existingShifts) {
    if (!existing) continue;
    if (
      existing.status === 'ABSENT' ||
      existing.status === 'ON_LEAVE' ||
      existing.entry_kind === 'LEAVE' ||
      existing.shiftType?.category === 'LEAVE'
    ) {
      continue;
    }

    const timing = resolveEffectiveTiming(existing, existing.shiftType);
    if (timing.isLeave || !timing.effective_start_time || !timing.effective_end_time) continue;

    const { start: eStart, end: eEnd } = getShiftInterval(
      existing.date,
      timing.effective_start_time,
      timing.effective_end_time
    );

    const existingLabel = `${existing.shiftType?.name || 'Shift'} (${timing.effective_start_time.slice(0, 5)}–${timing.effective_end_time.slice(0, 5)})`;

    if (pStart < eEnd && eStart < pEnd) {
      return {
        valid: false,
        message: `Labor Law Violation: Overlaps with existing "${existingLabel}" on ${existing.date}.`,
      };
    }

    const restAfter = (pStart.getTime() - eEnd.getTime()) / (1000 * 60 * 60);
    const restBefore = (eStart.getTime() - pEnd.getTime()) / (1000 * 60 * 60);

    if (pStart >= eEnd && restAfter < MIN_REST_HOURS) {
      return {
        valid: false,
        message: `Labor Law Violation: Insufficient rest period (${formatDurationHours(restAfter)} rest after ${existing.date} ${timing.effective_end_time.slice(0, 5)}). Minimum required is 11 hours.`,
      };
    }

    if (eStart >= pEnd && restBefore < MIN_REST_HOURS) {
      return {
        valid: false,
        message: `Labor Law Violation: Insufficient rest period (${formatDurationHours(restBefore)} rest before ${existing.date} ${timing.effective_start_time.slice(0, 5)}). Minimum required is 11 hours.`,
      };
    }
  }

  return { valid: true };
}

function sanitizeShiftTypePayload(body = {}, options = {}) {
  const isCreate = options.isCreate !== false;
  const existing = options.existing
    ? (typeof options.existing.get === 'function' ? options.existing.get({ plain: true }) : options.existing)
    : {};

  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const codeRaw = body.code !== undefined ? String(body.code).trim().toUpperCase() : existing.code;
  const category = (body.category !== undefined ? String(body.category).trim().toUpperCase() : existing.category) || 'WORK';
  const color = (body.color !== undefined ? String(body.color).trim() : existing.color) || '#1565C0';

  if (isCreate && !name) return { error: 'Shift type name is required' };
  if (name !== undefined && (!name || name.length > 80)) return { error: 'Shift type name must be 1–80 characters' };
  if (!codeRaw || !SHIFT_CODE_RE.test(codeRaw)) {
    return { error: 'Shift type code must be 1–10 uppercase alphanumeric/dash/underscore characters' };
  }
  if (!VALID_SHIFT_TYPE_CATEGORIES.includes(category)) {
    return { error: 'Invalid category (must be WORK or LEAVE)' };
  }
  if (!COLOR_HEX_RE.test(color)) {
    return { error: 'Invalid hex color (expected #RRGGBB)' };
  }

  const startRaw = body.start_time !== undefined ? body.start_time : (existing.start_time ?? (category === 'LEAVE' ? '00:00:00' : '08:00:00'));
  const endRaw = body.end_time !== undefined ? body.end_time : (existing.end_time ?? (category === 'LEAVE' ? '00:00:00' : '16:00:00'));

  const startNorm = normalizeTime(startRaw) || (category === 'LEAVE' && !startRaw ? '00:00:00' : undefined);
  const endNorm = normalizeTime(endRaw) || (category === 'LEAVE' && !endRaw ? '00:00:00' : undefined);

  if (!startNorm) return { error: 'Invalid start_time (expected HH:mm or HH:mm:ss)' };
  if (!endNorm) return { error: 'Invalid end_time (expected HH:mm or HH:mm:ss)' };

  const description = cleanOptionalText(
    body.description !== undefined ? body.description : existing.description
  );

  return {
    data: {
      name,
      code: codeRaw,
      category,
      color,
      start_time: startNorm,
      end_time: endNorm,
      description: description ?? null,
    },
  };
}

function expandDateSelection({ date, dates, start_date, end_date, skip_weekends = false } = {}) {
  const resultSet = new Set();

  if (Array.isArray(dates) && dates.length > 0) {
    for (const item of dates) {
      const clean = typeof item === 'string' ? item.trim().slice(0, 10) : '';
      if (!isValidIsoDate(clean)) {
        return { error: `Invalid date in selection: ${item}` };
      }
      if (skip_weekends) {
        const dow = new Date(`${clean}T00:00:00Z`).getUTCDay();
        if (dow === 0 || dow === 6) continue;
      }
      resultSet.add(clean);
    }
  } else if (start_date && end_date) {
    const fromClean = String(start_date).trim().slice(0, 10);
    const toClean = String(end_date).trim().slice(0, 10);
    if (!isValidIsoDate(fromClean) || !isValidIsoDate(toClean)) {
      return { error: 'Valid start_date and end_date (YYYY-MM-DD) are required' };
    }
    const start = new Date(`${fromClean}T00:00:00Z`);
    const end = new Date(`${toClean}T00:00:00Z`);
    if (end < start) {
      return { error: 'end_date cannot be earlier than start_date' };
    }
    const spanDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (spanDays > MAX_BULK_DAYS) {
      return { error: `Date range cannot exceed ${MAX_BULK_DAYS} days` };
    }
    for (let cursor = new Date(start.getTime()); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dow = cursor.getUTCDay();
      if (skip_weekends && (dow === 0 || dow === 6)) continue;
      resultSet.add(cursor.toISOString().slice(0, 10));
    }
  } else if (date) {
    const clean = String(date).trim().slice(0, 10);
    if (!isValidIsoDate(clean)) {
      return { error: 'Valid YYYY-MM-DD date is required' };
    }
    resultSet.add(clean);
  }

  const expanded = Array.from(resultSet).sort();
  if (expanded.length === 0) {
    return { error: 'No valid dates matched the selected range' };
  }
  if (expanded.length > MAX_BULK_DAYS) {
    return { error: `Cannot schedule more than ${MAX_BULK_DAYS} days at once` };
  }

  return { dates: expanded };
}

module.exports = {
  VALID_STATUSES,
  VALID_ENTRY_KINDS,
  VALID_LEAVE_TYPES,
  VALID_SHIFT_TYPE_CATEGORIES,
  MIN_REST_HOURS,
  MAX_BULK_DAYS,
  formatDurationHours,
  normalizeTime,
  isValidIsoDate,
  getShiftInterval,
  calculateDurationHours,
  inferLeaveType,
  resolveEffectiveTiming,
  sanitizeShiftPayload,
  checkLaborLawCompliance,
  sanitizeShiftTypePayload,
  expandDateSelection,
};
