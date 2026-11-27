const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isOperationOverdue,
  calculateDurationMinutes,
  sanitizeMembersInput,
  sanitizeOperationPayload,
  sanitizeBulkOperationAction,
  sanitizeOperationLogPayload,
  buildOperationSortOrder,
  summarizeOperationRows
} = require('../../services/operation-helpers.service');

test('isOperationOverdue identifies open operations past end_date', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  assert.equal(isOperationOverdue({ status: 'PLANNED', end_date: '2026-11-23T14:00:00Z' }, now), true);
  assert.equal(isOperationOverdue({ status: 'IN_PROGRESS', end_date: '2026-11-23T10:00:00Z' }, now), true);
  assert.equal(isOperationOverdue({ status: 'ON_HOLD', end_date: '2026-11-20T10:00:00Z' }, now), true);
  assert.equal(isOperationOverdue({ status: 'COMPLETED', end_date: '2026-11-20T10:00:00Z' }, now), false);
  assert.equal(isOperationOverdue({ status: 'CANCELLED', end_date: '2026-11-20T10:00:00Z' }, now), false);
  assert.equal(isOperationOverdue({ status: 'IN_PROGRESS', end_date: null }, now), false);
  assert.equal(isOperationOverdue({ status: 'IN_PROGRESS', end_date: '2026-11-24T10:00:00Z' }, now), false);
});

test('calculateDurationMinutes computes integer minutes and guards inverted ranges', () => {
  assert.equal(calculateDurationMinutes('2026-11-23T08:00:00Z', '2026-11-23T10:30:00Z'), 150);
  assert.equal(calculateDurationMinutes('2026-11-23T08:00:00Z', '2026-11-23T07:00:00Z'), null);
  assert.equal(calculateDurationMinutes('2026-11-23T08:00:00Z', null), null);
});

test('sanitizeMembersInput deduplicates user IDs and trims roles', () => {
  const res = sanitizeMembersInput([
    { user_id: '2', role_in_op: '  Mission Lead ' },
    { user_id: 2, role_in_op: 'Pilot' },
    { user_id: 5, role_in_op: '' }
  ]);
  assert.equal(res.provided, true);
  assert.deepEqual(res.data, [
    { user_id: 2, role_in_op: 'Pilot' },
    { user_id: 5, role_in_op: null }
  ]);

  const invalid = sanitizeMembersInput([{ user_id: -1, role_in_op: 'Lead' }]);
  assert.match(invalid.error, /user_id/i);
});

test('sanitizeOperationPayload validates dates, enums, and auto-sets actual_end_date on COMPLETED', () => {
  const valid = sanitizeOperationPayload({
    title: '  Night Sortie Alpha  ',
    type_id: '3',
    status: 'completed',
    priority: 'critical',
    location: 'Hangar 2',
    start_date: '2026-11-23T08:00:00Z',
    end_date: '2026-11-23T12:00:00Z',
    description: 'Telemetry verification flight'
  }, { isCreate: true });

  assert.equal(valid.error, undefined);
  assert.equal(valid.data.title, 'Night Sortie Alpha');
  assert.equal(valid.data.type_id, 3);
  assert.equal(valid.data.status, 'COMPLETED');
  assert.equal(valid.data.priority, 'CRITICAL');
  assert.ok(valid.data.actual_end_date instanceof Date);

  const withExternalCrew = sanitizeOperationPayload({
    title: 'LOFT Session',
    type_id: 1,
    start_date: '2026-11-23T08:00:00Z',
    end_date: '2026-11-23T12:00:00Z',
    mission_name: '  LOFT-04 CAT IIIB ',
    instructor_name: ' Capt. Rossi ',
    pilot_name: ' FO Bianchi ',
    copilot_name: '   '
  }, { isCreate: true });
  assert.equal(withExternalCrew.error, undefined);
  assert.equal(withExternalCrew.data.mission_name, 'LOFT-04 CAT IIIB');
  assert.equal(withExternalCrew.data.instructor_name, 'Capt. Rossi');
  assert.equal(withExternalCrew.data.pilot_name, 'FO Bianchi');
  assert.equal(withExternalCrew.data.copilot_name, null);

  const invertedDates = sanitizeOperationPayload({
    title: 'Bad Window',
    type_id: 1,
    start_date: '2026-11-23T12:00:00Z',
    end_date: '2026-11-23T10:00:00Z'
  }, { isCreate: true });
  assert.match(invertedDates.error, /End date must be on or after start date/i);

  const missingType = sanitizeOperationPayload({
    title: 'No Type',
    start_date: '2026-11-23T12:00:00Z'
  }, { isCreate: true });
  assert.match(missingType.error, /type/i);
});

test('sanitizeBulkOperationAction and sanitizeOperationLogPayload validate inputs safely', () => {
  const bulk = sanitizeBulkOperationAction({ ids: [10, 11, 10], action: 'status', value: 'on_hold' });
  assert.deepEqual(bulk.data, { ids: [10, 11], action: 'status', value: 'ON_HOLD' });

  const badBulk = sanitizeBulkOperationAction({ ids: [1], action: 'status', value: 'UNKNOWN' });
  assert.match(badBulk.error, /Invalid target operation status/i);

  const log = sanitizeOperationLogPayload({ action: '  Preflight Passed ', details: ' All systems nominal ' });
  assert.deepEqual(log.data, { action: 'Preflight Passed', details: 'All systems nominal' });

  const emptyLog = sanitizeOperationLogPayload({ action: '   ' });
  assert.match(emptyLog.error, /Log action is required/i);
});

test('buildOperationSortOrder uses allowlisted fields and falls back safely', () => {
  const OperationType = { name: 'OperationType' };
  const User = { name: 'User' };

  assert.deepEqual(
    buildOperationSortOrder('title', 'asc', { OperationType, User }),
    [['title', 'ASC'], ['id', 'DESC']]
  );
  assert.deepEqual(
    buildOperationSortOrder('type', 'asc', { OperationType, User }),
    [[{ model: OperationType, as: 'type' }, 'name', 'ASC'], ['start_date', 'DESC']]
  );
  assert.deepEqual(
    buildOperationSortOrder('bogus; DROP TABLE', 'asc', { OperationType, User }),
    [['start_date', 'DESC'], ['id', 'DESC']]
  );
});

test('summarizeOperationRows aggregates statuses, overdue count, completion rate, and avg duration', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  const summary = summarizeOperationRows([
    { status: 'PLANNED', start_date: '2026-11-24T08:00:00Z', end_date: '2026-11-24T10:00:00Z' }, // 120m
    { status: 'IN_PROGRESS', start_date: '2026-11-23T08:00:00Z', end_date: '2026-11-23T11:00:00Z' }, // overdue, 180m
    { status: 'ON_HOLD', start_date: '2026-11-23T16:00:00Z', end_date: '2026-11-23T18:00:00Z' }, // 120m
    { status: 'COMPLETED', start_date: '2026-11-22T08:00:00Z', end_date: '2026-11-22T10:00:00Z', actual_end_date: '2026-11-22T09:00:00Z' }, // 60m
    { status: 'CANCELLED', start_date: '2026-11-21T08:00:00Z', end_date: null }
  ], now);

  assert.deepEqual(summary, {
    total: 5,
    planned_count: 1,
    in_progress_count: 1,
    on_hold_count: 1,
    completed_count: 1,
    cancelled_count: 1,
    overdue_count: 1,
    completion_rate: 25,
    avg_duration_minutes: 120
  });
});
