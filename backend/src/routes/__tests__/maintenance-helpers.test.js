const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRecordOverdue,
  sanitizePartsUsed,
  sanitizeMaintenancePayload,
  sanitizeAssetPayload,
  sanitizeBulkMaintenanceAction,
  buildMaintenanceSortOrder,
  summarizeMaintenanceRows,
  summarizePlannedMonth
} = require('../../services/maintenance-helpers.service');

test('isRecordOverdue detects open past-due records and ignores closed or future ones', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  assert.equal(isRecordOverdue({ status: 'SCHEDULED', scheduled_date: '2026-11-20T10:00:00Z' }, now), true);
  assert.equal(isRecordOverdue({ status: 'IN_PROGRESS', scheduled_date: '2026-11-23T11:59:00Z' }, now), true);
  assert.equal(isRecordOverdue({ status: 'DEFERRED', scheduled_date: '2026-11-01T00:00:00Z' }, now), true);
  assert.equal(isRecordOverdue({ status: 'COMPLETED', scheduled_date: '2026-11-01T00:00:00Z' }, now), false);
  assert.equal(isRecordOverdue({ status: 'FAILED', scheduled_date: '2026-11-01T00:00:00Z' }, now), false);
  assert.equal(isRecordOverdue({ status: 'SCHEDULED', scheduled_date: '2026-11-25T10:00:00Z' }, now), false);
});

test('sanitizeMaintenancePayload validates required fields, parts_used, and auto-completes completed_date', () => {
  const valid = sanitizeMaintenancePayload({
    asset_id: '3',
    title: '  UPS Battery Replacement  ',
    description: 'Replace depleted battery bank and run self-test.',
    type: 'corrective',
    status: 'completed',
    priority: 'high',
    scheduled_date: '2026-11-23T09:00:00Z',
    downtime_hours: '1.5',
    cost: '420.256',
    next_scheduled: '2027-05-23T09:00:00Z',
    parts_used: [{ item_id: '7', sku: 'BAT-12V', name: '12V Battery', quantity: '2', unit: 'pcs' }]
  }, { isCreate: true });

  assert.equal(valid.error, undefined);
  assert.equal(valid.data.asset_id, 3);
  assert.equal(valid.data.title, 'UPS Battery Replacement');
  assert.equal(valid.data.type, 'CORRECTIVE');
  assert.equal(valid.data.status, 'COMPLETED');
  assert.equal(valid.data.priority, 'HIGH');
  assert.equal(valid.data.downtime_hours, 1.5);
  assert.equal(valid.data.cost, 420.26);
  assert.ok(valid.data.completed_date instanceof Date);
  assert.deepEqual(valid.data.parts_used, [
    { item_id: 7, sku: 'BAT-12V', name: '12V Battery', quantity: 2, unit: 'pcs' }
  ]);

  const missingAsset = sanitizeMaintenancePayload({
    title: 'Test',
    description: 'Test',
    scheduled_date: '2026-11-23T09:00:00Z'
  }, { isCreate: true });
  assert.match(missingAsset.error, /asset_id/i);

  const negativeCost = sanitizeMaintenancePayload({ cost: -10 }, { isCreate: false });
  assert.match(negativeCost.error, /Cost/i);

  const badParts = sanitizePartsUsed([{ item_id: 1, quantity: 0 }]);
  assert.match(badParts.error, /positive integer/i);
});

test('sanitizeAssetPayload enforces required fields and normalizes optional attributes', () => {
  const valid = sanitizeAssetPayload({
    name: '  Core Switch A  ',
    category_id: '2',
    status: 'under_maintenance',
    serial_number: ' SN-9981 ',
    manufacturer: 'Cisco',
    model: 'Catalyst 9300',
    location: 'Server Room A',
    warranty_expiry: '2028-06-30T12:00:00Z'
  }, { isCreate: true });

  assert.equal(valid.error, undefined);
  assert.equal(valid.data.name, 'Core Switch A');
  assert.equal(valid.data.category_id, 2);
  assert.equal(valid.data.status, 'UNDER_MAINTENANCE');
  assert.equal(valid.data.serial_number, 'SN-9981');
  assert.equal(valid.data.warranty_expiry, '2028-06-30');

  const badStatus = sanitizeAssetPayload({ status: 'BROKEN' }, { isCreate: false });
  assert.match(badStatus.error, /Invalid asset status/i);
});

test('sanitizeBulkMaintenanceAction validates IDs and action values', () => {
  const statusRes = sanitizeBulkMaintenanceAction({ ids: [1, 2, 2], action: 'status', value: 'completed' });
  assert.deepEqual(statusRes.data, { ids: [1, 2], action: 'status', value: 'COMPLETED' });

  const badPriority = sanitizeBulkMaintenanceAction({ ids: [1], action: 'priority', value: 'SUPER' });
  assert.match(badPriority.error, /Invalid target priority/i);

  const delRes = sanitizeBulkMaintenanceAction({ ids: [4, 5], action: 'delete' });
  assert.deepEqual(delRes.data, { ids: [4, 5], action: 'delete', value: null });
});

test('buildMaintenanceSortOrder uses allowlist and falls back safely', () => {
  const Asset = { name: 'Asset' };
  const User = { name: 'User' };

  assert.deepEqual(
    buildMaintenanceSortOrder('cost', 'desc', { Asset, User }),
    [['cost', 'DESC'], ['id', 'ASC']]
  );
  assert.deepEqual(
    buildMaintenanceSortOrder('asset', 'asc', { Asset, User }),
    [[{ model: Asset, as: 'asset' }, 'name', 'ASC'], ['scheduled_date', 'ASC']]
  );
  assert.deepEqual(
    buildMaintenanceSortOrder('unknown_field', 'asc', { Asset, User }),
    [['scheduled_date', 'ASC'], ['id', 'DESC']]
  );
});

test('summarizeMaintenanceRows aggregates statuses, overdue count, cost, and downtime', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const summary = summarizeMaintenanceRows([
    { status: 'SCHEDULED', scheduled_date: '2026-11-20T10:00:00Z', cost: 100, downtime_hours: 1.5 },
    { status: 'IN_PROGRESS', scheduled_date: '2026-11-25T10:00:00Z', cost: '50.55', downtime_hours: 2 },
    { status: 'COMPLETED', scheduled_date: '2026-11-18T10:00:00Z', cost: 25, downtime_hours: 0.5 },
    { status: 'FAILED', scheduled_date: '2026-11-19T10:00:00Z', cost: null, downtime_hours: null },
    { status: 'DEFERRED', scheduled_date: '2026-11-30T10:00:00Z', cost: 0, downtime_hours: 0 }
  ], now);

  assert.deepEqual(summary, {
    total: 5,
    scheduled_count: 1,
    in_progress_count: 1,
    completed_count: 1,
    failed_count: 1,
    deferred_count: 1,
    overdue_count: 1,
    total_cost: 175.55,
    total_downtime_hours: 4
  });
});

test('summarizePlannedMonth computes active series, today count, and month completion pct', () => {
  const summary = summarizePlannedMonth({
    masters: [
      { id: 1, status: 'TODO', optional: false },
      { id: 2, status: 'DONE', optional: true },
      { id: 3, status: 'TODO', optional: false }
    ],
    expandedOccurrences: [
      { occurrenceDate: '2026-11-23', status: 'TODO' },
      { occurrenceDate: '2026-11-23', status: 'DONE' },
      { occurrenceDate: '2026-11-24', status: 'DONE' },
      { occurrenceDate: '2026-11-25', status: 'TODO' }
    ],
    todayStr: '2026-11-23'
  });

  assert.deepEqual(summary, {
    total_series: 3,
    active_series: 2,
    optional_series: 1,
    due_today_count: 2,
    due_today_todo: 1,
    month_total_occurrences: 4,
    month_done_occurrences: 2,
    month_completion_pct: 50
  });
});
