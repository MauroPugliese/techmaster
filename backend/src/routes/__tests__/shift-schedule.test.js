// =============================================================================
// routes/__tests__/shift-schedule.test.js — Shifts, Custom Hours & Leave Tests
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatDurationHours,
  normalizeTime,
  calculateDurationHours,
  sanitizeShiftPayload,
  checkLaborLawCompliance,
  sanitizeShiftTypePayload,
  expandDateSelection,
} = require('../../services/shift-schedule.service');

const MORNING = { id: 1, name: 'Morning', code: 'MOR', start_time: '06:00:00', end_time: '14:00:00', color: '#1565C0', category: 'WORK' };
const NIGHT = { id: 3, name: 'Night', code: 'NGT', start_time: '22:00:00', end_time: '06:00:00', color: '#01579B', category: 'WORK' };
const ON_CALL = { id: 4, name: 'On-Call', code: 'ONC', start_time: '00:00:00', end_time: '23:59:59', color: '#37474F', category: 'WORK' };
const CUSTOM = { id: 5, name: 'Custom Shift', code: 'CST', start_time: '08:00:00', end_time: '16:00:00', color: '#7C3AED', category: 'WORK' };
const VACATION = { id: 7, name: 'Vacation', code: 'VAC', start_time: '00:00:00', end_time: '00:00:00', color: '#10B981', category: 'LEAVE' };
const SICK = { id: 6, name: 'Sick Leave', code: 'SCK', start_time: '00:00:00', end_time: '00:00:00', color: '#EF4444', category: 'LEAVE' };

test('normalizeTime and calculateDurationHours handle standard, overnight, extended, early leave, and leave', () => {
  assert.equal(normalizeTime('6:30'), '06:30:00');
  assert.equal(normalizeTime('14:45:10'), '14:45:10');
  assert.equal(normalizeTime(''), null);
  assert.equal(normalizeTime('25:00'), undefined);
  assert.equal(normalizeTime('not-a-time'), undefined);

  assert.equal(calculateDurationHours('06:00:00', '14:00:00'), 8);
  assert.equal(calculateDurationHours('22:00:00', '06:00:00'), 8);
  assert.equal(calculateDurationHours('06:00:00', '16:30:00'), 10.5);
  assert.equal(calculateDurationHours('06:00:00', '12:00:00'), 6);
  assert.equal(calculateDurationHours('00:00:00', '00:00:00'), 0);
  assert.equal(calculateDurationHours('00:00:00', '23:59:59'), 24);
});

test('sanitizeShiftPayload supports standard, overtime, early leave, CST, and leave shifts', () => {
  const std = sanitizeShiftPayload({ user_id: 2, shift_type_id: 1, date: '2026-11-24' }, MORNING, { isCreate: true });
  assert.equal(std.error, undefined);
  assert.equal(std.data.entry_kind, 'WORK');
  assert.equal(std.data.overtime_hours, 0);
  assert.equal(std.data.custom_start_time, null);
  assert.equal(std.effective.effective_hours, 8);

  const overtime = sanitizeShiftPayload(
    { user_id: 2, shift_type_id: 1, date: '2026-11-24', custom_start_time: '06:00', custom_end_time: '16:30' },
    MORNING,
    { isCreate: true }
  );
  assert.equal(overtime.error, undefined);
  assert.equal(overtime.data.entry_kind, 'CUSTOM');
  assert.equal(overtime.data.custom_end_time, '16:30:00');
  assert.equal(overtime.data.overtime_hours, 2.5);
  assert.equal(overtime.data.adjustment_reason, 'Overtime');

  const earlyLeave = sanitizeShiftPayload(
    { user_id: 2, shift_type_id: 1, date: '2026-11-24', custom_end_time: '12:00' },
    MORNING,
    { isCreate: true }
  );
  assert.equal(earlyLeave.error, undefined);
  assert.equal(earlyLeave.data.entry_kind, 'CUSTOM');
  assert.equal(earlyLeave.data.custom_start_time, '06:00:00');
  assert.equal(earlyLeave.data.custom_end_time, '12:00:00');
  assert.equal(earlyLeave.data.overtime_hours, 0);
  assert.equal(earlyLeave.data.adjustment_reason, 'Early Leave');
  assert.equal(earlyLeave.effective.delta_hours, -2);

  const customShift = sanitizeShiftPayload(
    { user_id: 2, shift_type_id: 5, date: '2026-11-25', custom_start_time: '08:00', custom_end_time: '16:00' },
    CUSTOM,
    { isCreate: true }
  );
  assert.equal(customShift.data.entry_kind, 'CUSTOM');
  assert.equal(customShift.data.adjustment_reason, 'Custom Hours');

  const leaveShift = sanitizeShiftPayload(
    { user_id: 2, shift_type_id: 6, date: '2026-11-26', custom_start_time: '09:00', overtime_hours: 3 },
    SICK,
    { isCreate: true }
  );
  assert.equal(leaveShift.data.entry_kind, 'LEAVE');
  assert.equal(leaveShift.data.status, 'ON_LEAVE');
  assert.equal(leaveShift.data.leave_type, 'SICK');
  assert.equal(leaveShift.data.custom_start_time, null);
  assert.equal(leaveShift.data.overtime_hours, 0);
});

test('checkLaborLawCompliance evaluates effective custom times and ignores leave or absent records', () => {
  // Overnight shift ending 2026-11-24 06:00 + standard rest until Afternoon (14:00) = only 8h -> violation
  const nightExisting = [{ date: '2026-11-23', status: 'SCHEDULED', entry_kind: 'WORK', shiftType: NIGHT }];
  const afternoonMorningAfter = checkLaborLawCompliance(
    { date: '2026-11-24', start_time: '14:00:00', end_time: '22:00:00', isLeave: false },
    nightExisting
  );
  assert.equal(afternoonMorningAfter.valid, false);
  assert.match(afternoonMorningAfter.message, /Insufficient rest period/i);

  // Overtime extending Morning end to 19:30 violates 11h rest before next day's 06:00 Morning (10.5h rest)
  const overtimeDay1 = [{
    date: '2026-11-23',
    status: 'SCHEDULED',
    entry_kind: 'CUSTOM',
    custom_start_time: '06:00:00',
    custom_end_time: '19:30:00',
    shiftType: MORNING,
  }];
  const day2Violation = checkLaborLawCompliance(
    { date: '2026-11-24', start_time: '06:00:00', end_time: '14:00:00', isLeave: false },
    overtimeDay1
  );
  assert.equal(day2Violation.valid, false);
  assert.match(day2Violation.message, /10h 30m rest/);
  assert.equal(formatDurationHours(10 / 60), '10 min');
  assert.equal(formatDurationHours(1.5), '1h 30m');

  // Night shift with early leave at 03:00 leaves 11h before 14:00 shift -> valid!
  const earlyNight = [{
    date: '2026-11-23',
    status: 'COMPLETED',
    entry_kind: 'CUSTOM',
    custom_start_time: '22:00:00',
    custom_end_time: '03:00:00',
    shiftType: NIGHT,
  }];
  const validNextAfternoon = checkLaborLawCompliance(
    { date: '2026-11-24', start_time: '14:00:00', end_time: '22:00:00', isLeave: false },
    earlyNight
  );
  assert.equal(validNextAfternoon.valid, true);

  // Leave proposed over On-Call neighbor is always compliant with labor-law rest checks
  const leaveOk = checkLaborLawCompliance(
    { date: '2026-11-24', start_time: null, end_time: null, isLeave: true },
    [{ date: '2026-11-23', status: 'SCHEDULED', entry_kind: 'WORK', shiftType: ON_CALL }]
  );
  assert.equal(leaveOk.valid, true);

  // Existing ON_LEAVE / ABSENT entries do not block next day's work shift
  const workAfterLeaveOk = checkLaborLawCompliance(
    { date: '2026-11-24', start_time: '06:00:00', end_time: '14:00:00', isLeave: false },
    [
      { date: '2026-11-23', status: 'ON_LEAVE', entry_kind: 'LEAVE', shiftType: VACATION },
      { date: '2026-11-23', status: 'ABSENT', entry_kind: 'WORK', shiftType: NIGHT },
    ]
  );
  assert.equal(workAfterLeaveOk.valid, true);
});

test('sanitizeShiftTypePayload validates and normalizes shift type definitions', () => {
  const valid = sanitizeShiftTypePayload({
    name: 'Weekend Cover',
    code: ' wkd ',
    category: 'work',
    color: '#0D9488',
    start_time: '09:00',
    end_time: '17:00',
  }, { isCreate: true });
  assert.equal(valid.error, undefined);
  assert.equal(valid.data.code, 'WKD');
  assert.equal(valid.data.category, 'WORK');
  assert.equal(valid.data.start_time, '09:00:00');

  assert.ok(sanitizeShiftTypePayload({ name: 'Bad', code: 'TOO_LONG_CODE_123', color: '#1565C0' }).error);
  assert.ok(sanitizeShiftTypePayload({ name: 'Bad', code: 'BAD', color: 'red' }).error);
});

test('expandDateSelection handles discrete dates, ranges, and weekend skipping', () => {
  const explicit = expandDateSelection({ dates: ['2026-11-25', '2026-11-23', '2026-11-23'] });
  assert.deepEqual(explicit.dates, ['2026-11-23', '2026-11-25']);

  // 2026-11-27 Fri, 28 Sat, 29 Sun, 30 Mon
  const weekdayRange = expandDateSelection({
    start_date: '2026-11-27',
    end_date: '2026-11-30',
    skip_weekends: true,
  });
  assert.deepEqual(weekdayRange.dates, ['2026-11-27', '2026-11-30']);

  assert.ok(expandDateSelection({ start_date: '2026-11-30', end_date: '2026-11-27' }).error);
});
