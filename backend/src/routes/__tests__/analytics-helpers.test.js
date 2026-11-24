const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGranularity,
  parsePeriod,
  resolveAnalyticsWindow,
  computePeriodDelta,
  aggregateMaintenanceSummary,
  aggregateTaskCadence,
  fillContinuousBuckets,
  formatPeakHour,
  buildExecutiveInsights
} = require('../../services/analytics-helpers.service');

test('parseGranularity and parsePeriod validate allowed values and fall back safely', () => {
  assert.equal(parseGranularity('WEEK'), 'week');
  assert.equal(parseGranularity('hour'), 'hour');
  assert.equal(parseGranularity('invalid'), 'day');

  assert.equal(parsePeriod('30D'), '30d');
  assert.equal(parsePeriod('ytd'), 'ytd');
  assert.equal(parsePeriod('unknown'), 'all');
});

test('resolveAnalyticsWindow builds trailing and comparison windows for presets and custom ranges', () => {
  const now = new Date('2026-11-24T12:00:00Z');

  const w7 = resolveAnalyticsWindow(null, '7d', now);
  assert.equal(w7.period, '7d');
  assert.equal(w7.hasComparison, true);
  assert.equal(w7.seriesStartStr, '2026-11-18');
  assert.equal(w7.seriesEndStr, '2026-11-24');
  assert.equal(w7.prevFrom.toISOString().slice(0, 10), '2026-11-11');
  assert.equal(w7.prevTo.toISOString().slice(0, 10), '2026-11-17');

  const wAll = resolveAnalyticsWindow(null, 'all', now);
  assert.equal(wAll.from, null);
  assert.equal(wAll.hasComparison, false);
  assert.equal(wAll.seriesStartStr, '2026-10-26');
  assert.equal(wAll.seriesEndStr, '2026-11-24');

  const wCustom = resolveAnalyticsWindow(
    { from: '2026-11-10T00:00:00Z', to: '2026-11-20T23:59:59Z' },
    'all',
    now
  );
  assert.equal(wCustom.period, 'custom');
  assert.equal(wCustom.hasComparison, true);
  assert.equal(wCustom.seriesStartStr, '2026-11-10');
  assert.equal(wCustom.seriesEndStr, '2026-11-20');
});

test('computePeriodDelta handles growth, decline, zero baselines, and missing comparison', () => {
  assert.equal(computePeriodDelta(10, null), null);
  assert.equal(computePeriodDelta(0, 0), 0);
  assert.equal(computePeriodDelta(5, 0), 100);
  assert.equal(computePeriodDelta(120, 100), 20);
  assert.equal(computePeriodDelta(75, 100), -25);
});

test('aggregateMaintenanceSummary computes record-weighted avg downtime instead of first row only', () => {
  const summary = aggregateMaintenanceSummary([
    // 1 record with 10h downtime + 3 records with 2h downtime => total 16h / 4 = 4.0h avg
    { type: 'CORRECTIVE', status: 'IN_PROGRESS', count: 1, total_downtime: 10, total_cost: 500 },
    { type: 'CORRECTIVE', status: 'COMPLETED', count: 3, total_downtime: 6, total_cost: 700 },
    { type: 'PREVENTIVE', status: 'COMPLETED', count: 4, total_downtime: 4, total_cost: 400 }
  ]);

  assert.equal(summary.length, 2);
  assert.equal(summary[0].type, 'CORRECTIVE');
  assert.equal(summary[0].count, 4);
  assert.equal(summary[0].total_downtime, 16);
  assert.equal(summary[0].avg_downtime, 4);
  assert.equal(summary[0].total_cost, 1200);
  assert.equal(summary[0].completion_rate, 75);
});

test('aggregateTaskCadence sums all non-DONE open statuses and excludes CANCELLED from pending', () => {
  const cadence = aggregateTaskCadence([
    { interval_type: 'DAILY', status: 'DONE', count: 5, avg_completion_hours: 2 },
    { interval_type: 'DAILY', status: 'TODO', count: 2, avg_completion_hours: 0 },
    { interval_type: 'DAILY', status: 'IN_PROGRESS', count: 1, avg_completion_hours: 0 },
    { interval_type: 'DAILY', status: 'OVERDUE', count: 2, avg_completion_hours: 0 },
    { interval_type: 'DAILY', status: 'CANCELLED', count: 1, avg_completion_hours: 0 }
  ]);

  const daily = cadence.find((c) => c.interval_type === 'DAILY');
  assert.ok(daily);
  assert.equal(daily.completed, 5);
  assert.equal(daily.pending, 5);
  assert.equal(daily.cancelled, 1);
  assert.equal(daily.completion_rate, 50);
  assert.equal(daily.avg_completion_hours, 2);
  assert.equal(cadence.length, 5);
});

test('fillContinuousBuckets fills missing dates with zero and sums same-day entries', () => {
  const filled = fillContinuousBuckets(
    '2026-11-20',
    '2026-11-23',
    [
      { date: '2026-11-20', total_qty: 12 },
      { date: '2026-11-20', total_qty: 8 },
      { date: '2026-11-22', total_qty: 5 }
    ],
    (r) => r.total_qty
  );

  assert.deepEqual(filled.dates, ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(filled.values, [20, 0, 5, 0]);
});

test('formatPeakHour formats midnight as 00:00 and invalid/null as N/A', () => {
  assert.equal(formatPeakHour(0), '00:00');
  assert.equal(formatPeakHour(9), '09:00');
  assert.equal(formatPeakHour(17), '17:00');
  assert.equal(formatPeakHour(null), 'N/A');
  assert.equal(formatPeakHour(undefined), 'N/A');
  assert.equal(formatPeakHour(''), 'N/A');
});

test('buildExecutiveInsights generates four coherent insight cards', () => {
  const insights = buildExecutiveInsights({
    opsByType: [{ type: 'Reconnaissance', count: 14, completed: 11 }],
    maintSummary: [{ type: 'CORRECTIVE', count: 4, total_cost: 3200 }],
    topAssets: [{ name: 'Generator Alpha', total_cost: 2100, total_downtime: 12.5 }],
    kpis: { shiftAttendanceRate: 94, netStockFlow: 18 },
    peak: { dayName: 'Tuesday', hour: 0 }
  });

  assert.equal(insights.length, 4);
  assert.equal(insights[0].value, 'Reconnaissance');
  assert.equal(insights[1].tone, 'warn');
  assert.equal(insights[3].value, 'Tuesday 00:00');
});
