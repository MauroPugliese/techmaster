const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTrendDays,
  resolveTrendWindow,
  buildContinuousDailySeries,
  computeFleetReadiness,
  isShiftActiveNow,
  summarizeWarehouseHealth,
  buildUrgentAlertCounts
} = require('../../services/dashboard-helpers.service');

test('parseTrendDays accepts 7, 30, 90 and defaults to 30', () => {
  assert.equal(parseTrendDays(7), 7);
  assert.equal(parseTrendDays('30'), 30);
  assert.equal(parseTrendDays('90'), 90);
  assert.equal(parseTrendDays('14'), 30);
  assert.equal(parseTrendDays(undefined), 30);
});

test('resolveTrendWindow uses trendDays by default and clamps wide date filters to 180 days', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const win7 = resolveTrendWindow(null, 7, now);
  assert.equal(win7.startDateStr, '2026-11-18');
  assert.equal(win7.endDateStr, '2026-11-24');
  assert.equal(win7.daysCount, 7);

  const wide = resolveTrendWindow({ from: '2025-01-01T00:00:00Z', to: '2026-11-24T23:59:59Z' }, 30, now);
  assert.equal(wide.endDateStr, '2026-11-24');
  assert.equal(wide.daysCount, 180);
});

test('buildContinuousDailySeries fills missing days with zero and sums duplicate day rows', () => {
  const series = buildContinuousDailySeries(
    '2026-11-20',
    '2026-11-23',
    [{ date: '2026-11-20', count: 2 }, { date: '2026-11-20', count: 1 }, { date: '2026-11-22', count: 4 }],
    [{ date: new Date('2026-11-21T00:00:00Z'), count: 3 }],
    [{ date: '2026-11-23', count: 5 }]
  );

  assert.deepEqual(series.dates, ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(series.operations, [3, 0, 4, 0]);
  assert.deepEqual(series.maintenance, [0, 3, 0, 0]);
  assert.deepEqual(series.tasks, [0, 0, 0, 5]);
  assert.deepEqual(series.totals, { operations: 7, maintenance: 3, tasks: 5 });
});

test('computeFleetReadiness classifies OPTIMAL, ATTENTION, CRITICAL and handles zero assets', () => {
  const optimal = computeFleetReadiness({ totalAssets: 20, activeAssets: 18, maintenanceAssets: 2 });
  assert.equal(optimal.readinessPct, 90);
  assert.equal(optimal.inactiveAssets, 0);
  assert.equal(optimal.status, 'OPTIMAL');

  const attention = computeFleetReadiness({ totalAssets: 10, activeAssets: 7, maintenanceAssets: 2 });
  assert.equal(attention.readinessPct, 70);
  assert.equal(attention.inactiveAssets, 1);
  assert.equal(attention.status, 'ATTENTION');

  const critical = computeFleetReadiness({ totalAssets: 10, activeAssets: 5, maintenanceAssets: 4 });
  assert.equal(critical.status, 'CRITICAL');

  const empty = computeFleetReadiness({ totalAssets: 0, activeAssets: 0, maintenanceAssets: 0 });
  assert.equal(empty.readinessPct, 100);
  assert.equal(empty.status, 'OPTIMAL');
});

test('isShiftActiveNow handles daytime shifts, overnight shifts, and leave/completed exclusions', () => {
  const dayNow = new Date(2026, 10, 24, 10, 30, 0);
  assert.equal(isShiftActiveNow({
    status: 'CONFIRMED',
    entry_kind: 'WORK',
    shiftType: { start_time: '08:00:00', end_time: '16:00:00' }
  }, dayNow), true);

  assert.equal(isShiftActiveNow({
    status: 'COMPLETED',
    entry_kind: 'WORK',
    shiftType: { start_time: '08:00:00', end_time: '16:00:00' }
  }, dayNow), false);

  assert.equal(isShiftActiveNow({
    status: 'CONFIRMED',
    entry_kind: 'LEAVE',
    shiftType: { start_time: '08:00:00', end_time: '16:00:00' }
  }, dayNow), false);

  const nightNow = new Date(2026, 10, 24, 23, 15, 0);
  assert.equal(isShiftActiveNow({
    status: 'SCHEDULED',
    entry_kind: 'WORK',
    shiftType: { start_time: '22:00', end_time: '06:00' }
  }, nightNow), true);
});

test('summarizeWarehouseHealth calculates real totals, value, and prioritizes depleted items first', () => {
  const summary = summarizeWarehouseHealth([
    { id: 1, sku: 'OK-1', name: 'Healthy Bolt', quantity: 50, reorder_point: 10, unit_cost: 2 },
    { id: 2, sku: 'LOW-1', name: 'Low Cable', quantity: 5, reorder_point: 10, unit_cost: 10 },
    { id: 3, sku: 'OUT-1', name: 'Empty Sensor', quantity: 0, reorder_point: 4, unit_cost: 100 }
  ], 14);

  assert.equal(summary.totalSkus, 3);
  assert.equal(summary.healthySkus, 1);
  assert.equal(summary.lowStockCount, 2);
  assert.equal(summary.outOfStockCount, 1);
  assert.equal(summary.totalValue, 150);
  assert.equal(summary.movements7d, 14);
  assert.equal(summary.criticalItems.length, 2);
  assert.equal(summary.criticalItems[0].sku, 'OUT-1');
  assert.equal(summary.criticalItems[0].deficit, 4);
  assert.equal(summary.criticalItems[1].sku, 'LOW-1');
});

test('buildUrgentAlertCounts totals all four alert buckets', () => {
  const counts = buildUrgentAlertCounts({
    overdueOperations: [{ id: 1 }],
    criticalMaintenance: [{ id: 2 }, { id: 3 }],
    overdueTasks: [{ id: 4 }],
    outOfStock: []
  });
  assert.deepEqual(counts, {
    overdueOperations: 1,
    criticalMaintenance: 2,
    overdueTasks: 1,
    outOfStock: 0,
    total: 4
  });
});
