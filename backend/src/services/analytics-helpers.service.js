// =============================================================================
// services/analytics-helpers.service.js — Pure Operational Intelligence Logic
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIES_DAYS = 180;

const VALID_GRANULARITIES = ['hour', 'day', 'week', 'month'];
const VALID_PERIODS = ['all', '7d', '30d', '90d', 'ytd', 'daily', 'weekly', 'monthly', 'yearly'];
const CANONICAL_TASK_INTERVALS = [
  { key: 'DAILY', label: 'Daily' },
  { key: 'WEEKLY', label: 'Weekly' },
  { key: 'MONTHLY', label: 'Monthly' },
  { key: 'YEARLY', label: 'Yearly' },
  { key: 'ONCE', label: 'One-time' }
];

function parseGranularity(raw) {
  const val = String(raw || '').trim().toLowerCase();
  return VALID_GRANULARITIES.includes(val) ? val : 'day';
}

function parsePeriod(raw) {
  const val = String(raw || '').trim().toLowerCase();
  return VALID_PERIODS.includes(val) ? val : 'all';
}

function toDateKey(input) {
  if (!input) return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) {
    return input.slice(0, 10);
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function clampSeriesRange(startDate, endDate, fallbackEndDate, defaultDays = 30) {
  const endBase = endDate || fallbackEndDate;
  const endKey = toDateKey(endBase);
  const endDay = new Date(`${endKey}T00:00:00.000Z`);

  let startDay;
  if (startDate) {
    startDay = new Date(`${toDateKey(startDate)}T00:00:00.000Z`);
    if (startDay > endDay) startDay = new Date(endDay.getTime());
    const spanDays = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_SERIES_DAYS) {
      startDay = new Date(endDay.getTime() - (MAX_SERIES_DAYS - 1) * DAY_MS);
    }
  } else {
    startDay = new Date(endDay.getTime() - (defaultDays - 1) * DAY_MS);
  }

  return {
    seriesStartStr: startDay.toISOString().slice(0, 10),
    seriesEndStr: endDay.toISOString().slice(0, 10)
  };
}

/**
 * Resolve current analytics window + previous comparison period + bounded daily
 * series bounds for continuous charts.
 */
function resolveAnalyticsWindow(dateRange, rawPeriod, now = new Date()) {
  const period = parsePeriod(rawPeriod);
  const nowKey = toDateKey(now) || new Date().toISOString().slice(0, 10);
  const todayStart = new Date(`${nowKey}T00:00:00.000Z`);
  const todayEnd = new Date(`${nowKey}T23:59:59.999Z`);

  const hasCustomFrom = Boolean(dateRange?.from && !Number.isNaN(new Date(dateRange.from).getTime()));
  const hasCustomTo = Boolean(dateRange?.to && !Number.isNaN(new Date(dateRange.to).getTime()));

  let from = null;
  let to = null;
  let prevFrom = null;
  let prevTo = null;
  let hasComparison = false;
  let resolvedPeriod = period;

  if (hasCustomFrom || hasCustomTo) {
    resolvedPeriod = 'custom';
    from = hasCustomFrom ? new Date(dateRange.from) : null;
    to = hasCustomTo ? new Date(dateRange.to) : null;
    if (from && to && from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    if (from && to) {
      const spanMs = Math.max(DAY_MS, to.getTime() - from.getTime());
      prevTo = new Date(from.getTime() - 1);
      prevFrom = new Date(prevTo.getTime() - spanMs);
      hasComparison = true;
    }
  } else if (period === '7d' || period === '30d' || period === '90d') {
    const days = parseInt(period, 10);
    from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
    to = new Date(todayEnd.getTime());
    prevTo = new Date(from.getTime() - 1);
    prevFrom = new Date(from.getTime() - days * DAY_MS);
    hasComparison = true;
  } else if (period === 'ytd' || period === 'yearly') {
    const year = todayStart.getUTCFullYear();
    from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    to = new Date(todayEnd.getTime());
    const spanMs = Math.max(DAY_MS, to.getTime() - from.getTime());
    prevTo = new Date(from.getTime() - 1);
    prevFrom = new Date(prevTo.getTime() - spanMs);
    hasComparison = true;
  } else if (period === 'daily') {
    from = new Date(todayStart.getTime());
    to = new Date(todayEnd.getTime());
    prevFrom = new Date(todayStart.getTime() - DAY_MS);
    prevTo = new Date(todayStart.getTime() - 1);
    hasComparison = true;
  } else if (period === 'weekly') {
    const utcDay = todayStart.getUTCDay();
    const diffToMon = (utcDay + 6) % 7;
    from = new Date(todayStart.getTime() - diffToMon * DAY_MS);
    to = new Date(todayEnd.getTime());
    prevTo = new Date(from.getTime() - 1);
    prevFrom = new Date(from.getTime() - 7 * DAY_MS);
    hasComparison = true;
  } else if (period === 'monthly') {
    from = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1, 0, 0, 0, 0));
    to = new Date(todayEnd.getTime());
    const spanMs = Math.max(DAY_MS, to.getTime() - from.getTime());
    prevTo = new Date(from.getTime() - 1);
    prevFrom = new Date(prevTo.getTime() - spanMs);
    hasComparison = true;
  }

  const defaultChartDays = period === '7d' ? 7 : (period === '90d' ? 90 : 30);
  const { seriesStartStr, seriesEndStr } = clampSeriesRange(from, to, todayEnd, defaultChartDays);

  return {
    period: resolvedPeriod,
    from,
    to,
    prevFrom,
    prevTo,
    hasComparison,
    seriesStartStr,
    seriesEndStr,
    seriesStartDate: new Date(`${seriesStartStr}T00:00:00.000Z`),
    seriesEndDate: new Date(`${seriesEndStr}T23:59:59.999Z`)
  };
}

/**
 * Compute integer percentage change between current and previous periods.
 */
function computePeriodDelta(current, previous) {
  if (previous === null || previous === undefined) return null;
  const currNum = Number(current) || 0;
  const prevNum = Number(previous) || 0;
  if (prevNum === 0 && currNum === 0) return 0;
  if (prevNum === 0 && currNum > 0) return 100;
  if (prevNum === 0 && currNum < 0) return -100;
  return Math.round(((currNum - prevNum) / Math.abs(prevNum)) * 100);
}

/**
 * Group maintenance `(type, status, count, total_downtime, avg_downtime, total_cost)`
 * rows by `type` using TRUE record-weighted average downtime.
 */
function aggregateMaintenanceSummary(rows = []) {
  const byType = new Map();

  for (const r of rows || []) {
    const type = r?.type || 'OTHER';
    const count = Math.max(0, Number(r?.count) || 0);
    const totalCost = Number(r?.total_cost) || 0;
    const totalDowntime = r?.total_downtime !== undefined && r?.total_downtime !== null
      ? Number(r.total_downtime) || 0
      : (Number(r?.avg_downtime) || 0) * count;

    const bucket = byType.get(type) || {
      type,
      count: 0,
      completed_count: 0,
      open_count: 0,
      total_downtime: 0,
      total_cost: 0
    };

    bucket.count += count;
    if (r?.status === 'COMPLETED') {
      bucket.completed_count += count;
    } else if (r?.status === 'SCHEDULED' || r?.status === 'IN_PROGRESS') {
      bucket.open_count += count;
    }
    bucket.total_downtime += totalDowntime;
    bucket.total_cost += totalCost;
    byType.set(type, bucket);
  }

  return Array.from(byType.values())
    .map((b) => {
      const avgDowntime = b.count > 0 ? b.total_downtime / b.count : 0;
      const completionRate = b.count > 0 ? (b.completed_count / b.count) * 100 : 0;
      return {
        type: b.type,
        count: b.count,
        completed_count: b.completed_count,
        open_count: b.open_count,
        total_downtime: Math.round(b.total_downtime * 100) / 100,
        avg_downtime: Math.round(avgDowntime * 100) / 100,
        total_cost: Math.round(b.total_cost * 100) / 100,
        completion_rate: Math.round(completionRate * 10) / 10
      };
    })
    .sort((a, b) => (b.total_cost - a.total_cost) || (b.count - a.count));
}

/**
 * Aggregate raw `(interval_type, status, count, total_completion_hours, avg_completion_hours)`
 * rows into complete buckets across ALL open statuses (TODO, IN_PROGRESS, REVIEW, OVERDUE).
 */
function aggregateTaskCadence(rows = []) {
  const buckets = new Map();
  for (const def of CANONICAL_TASK_INTERVALS) {
    buckets.set(def.key, {
      interval_type: def.key,
      label: def.label,
      total: 0,
      completed: 0,
      pending: 0,
      cancelled: 0,
      weightedHoursSum: 0,
      completedWithHours: 0
    });
  }

  for (const r of rows || []) {
    const key = CANONICAL_TASK_INTERVALS.some((d) => d.key === r?.interval_type)
      ? r.interval_type
      : 'ONCE';
    const b = buckets.get(key);
    const count = Math.max(0, Number(r?.count) || 0);
    const status = String(r?.status || '').toUpperCase();

    b.total += count;
    if (status === 'DONE') {
      b.completed += count;
      const hrs = Number(r?.avg_completion_hours) || 0;
      if (hrs > 0 && count > 0) {
        b.weightedHoursSum += hrs * count;
        b.completedWithHours += count;
      }
    } else if (status === 'CANCELLED') {
      b.cancelled += count;
    } else {
      b.pending += count;
    }
  }

  return Array.from(buckets.values()).map((b) => {
    const actionable = b.completed + b.pending;
    const avgHours = b.completedWithHours > 0 ? b.weightedHoursSum / b.completedWithHours : 0;
    return {
      interval_type: b.interval_type,
      label: b.label,
      total: b.total,
      completed: b.completed,
      pending: b.pending,
      cancelled: b.cancelled,
      completion_rate: actionable > 0 ? Math.round((b.completed / actionable) * 100) : 0,
      avg_completion_hours: Math.round(avgHours * 10) / 10
    };
  });
}

/**
 * Fill every calendar day in `[startDateStr, endDateStr]` cleanly with `0` defaults.
 */
function fillContinuousBuckets(startDateStr, endDateStr, rows = [], valueMapper = (r) => Number(r?.count) || 0) {
  const start = new Date(`${startDateStr}T00:00:00.000Z`);
  const end = new Date(`${endDateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return { dates: [], values: [] };
  }

  const map = new Map();
  for (const r of rows || []) {
    const key = toDateKey(r?.date);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + (Number(valueMapper(r)) || 0));
  }

  const dates = [];
  const values = [];
  const spanDays = Math.min(MAX_SERIES_DAYS, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  for (let i = 0; i < spanDays; i += 1) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    dates.push(key);
    values.push(map.get(key) || 0);
  }

  return { dates, values };
}

/**
 * Format peak hour cleanly (handles midnight 0 as '00:00' and null/empty as 'N/A').
 */
function formatPeakHour(hour) {
  if (hour === null || hour === undefined || hour === '') return 'N/A';
  const num = Number(hour);
  if (!Number.isFinite(num) || num < 0 || num > 23) return 'N/A';
  return `${String(Math.floor(num)).padStart(2, '0')}:00`;
}

/**
 * Build concise automated executive insights from aggregated operational metrics.
 */
function buildExecutiveInsights({
  opsByType = [],
  maintSummary = [],
  kpis = {},
  topAssets = [],
  peak = {}
} = {}) {
  const insights = [];

  const topOpType = (opsByType || []).find((o) => Number(o.count) > 0);
  insights.push({
    id: 'dominant_op',
    domain: 'Operations',
    title: 'Primary Sortie Category',
    value: topOpType ? topOpType.type : 'No activity',
    detail: topOpType
      ? `${topOpType.count} sorties · ${topOpType.completed || 0} completed`
      : 'No operations recorded in active window',
    tone: topOpType ? 'info' : 'neutral'
  });

  const topMaint = maintSummary?.[0];
  insights.push({
    id: 'top_maint_cost',
    domain: 'Maintenance',
    title: 'Highest Maintenance Spend',
    value: topMaint ? topMaint.type : 'Zero Spend',
    detail: topMaint
      ? `$${Math.round(topMaint.total_cost).toLocaleString('en-US')} across ${topMaint.count} work orders`
      : 'No maintenance expenditure in active window',
    tone: topMaint && topMaint.type === 'CORRECTIVE' ? 'warn' : 'info'
  });

  const costliestAsset = topAssets?.[0];
  insights.push({
    id: 'costliest_asset',
    domain: 'Assets',
    title: 'Top Cost / Downtime Asset',
    value: costliestAsset ? costliestAsset.name : 'All Nominal',
    detail: costliestAsset
      ? `$${Math.round(Number(costliestAsset.total_cost) || 0).toLocaleString('en-US')} · ${Number(costliestAsset.total_downtime || 0).toFixed(1)}h down`
      : 'No asset maintenance load recorded',
    tone: costliestAsset && Number(costliestAsset.total_downtime) > 24 ? 'danger' : 'ok'
  });

  const attendance = Number(kpis.shiftAttendanceRate ?? 100);
  const netStock = Number(kpis.netStockFlow ?? 0);
  const peakDay = peak?.dayName && peak.dayName !== 'N/A' ? `${peak.dayName} ${formatPeakHour(peak.hour)}` : null;
  insights.push({
    id: 'ops_rhythm',
    domain: 'Workforce & Stock',
    title: peakDay ? 'Peak Window & Roster' : 'Workforce & Stock Pulse',
    value: peakDay || `${attendance}% Attendance`,
    detail: `${attendance}% shift attendance · Net stock ${netStock >= 0 ? '+' : ''}${netStock}`,
    tone: attendance >= 90 && netStock >= 0 ? 'ok' : (attendance < 80 ? 'warn' : 'info')
  });

  return insights;
}

module.exports = {
  DAY_MS,
  MAX_SERIES_DAYS,
  CANONICAL_TASK_INTERVALS,
  parseGranularity,
  parsePeriod,
  toDateKey,
  resolveAnalyticsWindow,
  computePeriodDelta,
  aggregateMaintenanceSummary,
  aggregateTaskCadence,
  fillContinuousBuckets,
  formatPeakHour,
  buildExecutiveInsights
};
