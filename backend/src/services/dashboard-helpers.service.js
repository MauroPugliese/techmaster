// =============================================================================
// services/dashboard-helpers.service.js — Pure Operational Command Center Logic
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 180;

/**
 * Parse requested trend window in days (7 | 30 | 90, default 30).
 */
function parseTrendDays(rawDays) {
  const num = Number(rawDays);
  if (num === 7 || num === 30 || num === 90) return num;
  return 30;
}

/**
 * Format a Date (or valid date input) as UTC YYYY-MM-DD.
 */
function toDateKey(input) {
  if (!input) return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) {
    return input.slice(0, 10);
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve inclusive UTC day window for trend queries.
 * Uses `dateRange` when `from` or `to` is supplied (clamped to MAX_WINDOW_DAYS),
 * otherwise spans the last `trendDays` ending today.
 */
function resolveTrendWindow(dateRange, trendDays, now = new Date()) {
  const safeDays = parseTrendDays(trendDays);
  const nowKey = toDateKey(now) || new Date().toISOString().slice(0, 10);
  const todayUtc = new Date(`${nowKey}T00:00:00.000Z`);

  const hasFrom = Boolean(dateRange?.from && !Number.isNaN(new Date(dateRange.from).getTime()));
  const hasTo = Boolean(dateRange?.to && !Number.isNaN(new Date(dateRange.to).getTime()));

  let startDay;
  let endDay;

  if (hasFrom || hasTo) {
    endDay = hasTo
      ? new Date(`${toDateKey(dateRange.to)}T00:00:00.000Z`)
      : new Date(todayUtc.getTime());

    if (hasFrom) {
      startDay = new Date(`${toDateKey(dateRange.from)}T00:00:00.000Z`);
    } else {
      startDay = new Date(endDay.getTime() - (safeDays - 1) * DAY_MS);
    }

    if (startDay > endDay) {
      const tmp = startDay;
      startDay = endDay;
      endDay = tmp;
    }

    const spanDays = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_WINDOW_DAYS) {
      startDay = new Date(endDay.getTime() - (MAX_WINDOW_DAYS - 1) * DAY_MS);
    }
  } else {
    endDay = new Date(todayUtc.getTime());
    startDay = new Date(endDay.getTime() - (safeDays - 1) * DAY_MS);
  }

  const startDateStr = startDay.toISOString().slice(0, 10);
  const endDateStr = endDay.toISOString().slice(0, 10);
  const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
  const endDate = new Date(`${endDateStr}T23:59:59.999Z`);
  const daysCount = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;

  return { startDate, endDate, startDateStr, endDateStr, daysCount };
}

/**
 * Aggregate raw `{ date, count }` rows into a map keyed by `YYYY-MM-DD`.
 */
function indexDailyCounts(rows = []) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = toDateKey(row?.date);
    if (!key) continue;
    const prev = counts.get(key) || 0;
    counts.set(key, prev + (Number(row?.count) || 0));
  }
  return counts;
}

/**
 * Build continuous daily trend arrays (zero-filling days with no records)
 * between `startDateStr` and `endDateStr` inclusive.
 */
function buildContinuousDailySeries(startDateStr, endDateStr, opsRows = [], maintRows = [], taskRows = []) {
  const start = new Date(`${startDateStr}T00:00:00.000Z`);
  const end = new Date(`${endDateStr}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return {
      dates: [],
      operations: [],
      maintenance: [],
      tasks: [],
      totals: { operations: 0, maintenance: 0, tasks: 0 }
    };
  }

  const opsMap = indexDailyCounts(opsRows);
  const maintMap = indexDailyCounts(maintRows);
  const taskMap = indexDailyCounts(taskRows);

  const dates = [];
  const operations = [];
  const maintenance = [];
  const tasks = [];

  let opsTotal = 0;
  let maintTotal = 0;
  let taskTotal = 0;

  const spanDays = Math.min(MAX_WINDOW_DAYS, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  for (let i = 0; i < spanDays; i += 1) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);

    const o = opsMap.get(key) || 0;
    const m = maintMap.get(key) || 0;
    const t = taskMap.get(key) || 0;

    dates.push(key);
    operations.push(o);
    maintenance.push(m);
    tasks.push(t);

    opsTotal += o;
    maintTotal += m;
    taskTotal += t;
  }

  return {
    dates,
    operations,
    maintenance,
    tasks,
    totals: {
      operations: opsTotal,
      maintenance: maintTotal,
      tasks: taskTotal
    }
  };
}

/**
 * Compute fleet & equipment readiness metrics cleanly without negatives.
 */
function computeFleetReadiness({ totalAssets = 0, activeAssets = 0, maintenanceAssets = 0 } = {}) {
  const total = Math.max(0, Number(totalAssets) || 0);
  const active = Math.max(0, Number(activeAssets) || 0);
  const maintenance = Math.max(0, Number(maintenanceAssets) || 0);
  const inactiveAssets = Math.max(0, total - active - maintenance);
  const readinessPct = total > 0 ? Math.round((active / total) * 100) : 100;

  let status = 'CRITICAL';
  if (readinessPct >= 85) {
    status = 'OPTIMAL';
  } else if (readinessPct >= 70) {
    status = 'ATTENTION';
  }

  return {
    totalAssets: total,
    activeAssets: active,
    maintenanceAssets: maintenance,
    inactiveAssets,
    readinessPct,
    status
  };
}

/**
 * Parse HH:mm or HH:mm:ss string into minutes since midnight [0..1439].
 */
function parseTimeMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

/**
 * Determine whether a scheduled shift is currently live at `now`.
 * Handles overnight shifts (where end_time < start_time) and excludes leave/closed shifts.
 */
function isShiftActiveNow(shift, now = new Date()) {
  if (!shift) return false;
  if (shift.entry_kind === 'LEAVE') return false;
  if (['ABSENT', 'ON_LEAVE', 'COMPLETED'].includes(shift.status)) return false;

  const startStr = shift.custom_start_time || shift.shiftType?.start_time;
  const endStr = shift.custom_end_time || shift.shiftType?.end_time;
  const startMin = parseTimeMinutes(startStr);
  const endMin = parseTimeMinutes(endStr);

  if (startMin === null || endMin === null || startMin === endMin) {
    return shift.status === 'IN_PROGRESS';
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (endMin > startMin) {
    return nowMin >= startMin && nowMin < endMin;
  }

  // Overnight shift spanning midnight
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * Summarize real warehouse health and rank low-stock/depleted items by urgency.
 */
function summarizeWarehouseHealth(items = [], movements7d = 0) {
  const activeItems = Array.isArray(items) ? items : [];
  let totalSkus = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;
  let totalValue = 0;
  const criticalCandidates = [];

  for (const raw of activeItems) {
    totalSkus += 1;
    const qty = Number(raw?.quantity) || 0;
    const reorderPoint = Math.max(0, Number(raw?.reorder_point) || 0);
    const unitCost = Number(raw?.unit_cost) || 0;

    if (qty > 0 && unitCost > 0) {
      totalValue += qty * unitCost;
    }

    if (qty <= 0) {
      outOfStockCount += 1;
    }

    if (qty <= reorderPoint) {
      lowStockCount += 1;
      const deficit = Math.max(0, reorderPoint - qty);
      const stockRatioPct = reorderPoint > 0
        ? Math.max(0, Math.min(100, Math.round((qty / reorderPoint) * 100)))
        : (qty <= 0 ? 0 : 100);

      criticalCandidates.push({
        id: raw.id,
        sku: raw.sku,
        name: raw.name,
        unit: raw.unit || 'pcs',
        quantity: qty,
        reorder_point: reorderPoint,
        min_stock: Number(raw.min_stock) || 0,
        unit_cost: unitCost,
        supplier: raw.supplier || null,
        location: raw.location ? { id: raw.location.id, code: raw.location.code, name: raw.location.name } : null,
        category: raw.category ? { id: raw.category.id, name: raw.category.name, color: raw.category.color } : null,
        deficit,
        stockRatioPct
      });
    }
  }

  criticalCandidates.sort((a, b) => {
    const aOut = a.quantity <= 0 ? 0 : 1;
    const bOut = b.quantity <= 0 ? 0 : 1;
    if (aOut !== bOut) return aOut - bOut;

    const aRatio = a.reorder_point > 0 ? a.quantity / a.reorder_point : (a.quantity <= 0 ? -1 : 1);
    const bRatio = b.reorder_point > 0 ? b.quantity / b.reorder_point : (b.quantity <= 0 ? -1 : 1);
    if (aRatio !== bRatio) return aRatio - bRatio;

    return a.quantity - b.quantity;
  });

  const healthySkus = Math.max(0, totalSkus - lowStockCount);

  return {
    totalSkus,
    healthySkus,
    lowStockCount,
    outOfStockCount,
    totalValue: Math.round(totalValue * 100) / 100,
    movements7d: Math.max(0, Number(movements7d) || 0),
    criticalItems: criticalCandidates.slice(0, 6)
  };
}

/**
 * Count urgent alert buckets consistently.
 */
function buildUrgentAlertCounts(alerts = {}) {
  const overdueOperations = Array.isArray(alerts?.overdueOperations) ? alerts.overdueOperations.length : 0;
  const criticalMaintenance = Array.isArray(alerts?.criticalMaintenance) ? alerts.criticalMaintenance.length : 0;
  const overdueTasks = Array.isArray(alerts?.overdueTasks) ? alerts.overdueTasks.length : 0;
  const outOfStock = Array.isArray(alerts?.outOfStock) ? alerts.outOfStock.length : 0;

  return {
    overdueOperations,
    criticalMaintenance,
    overdueTasks,
    outOfStock,
    total: overdueOperations + criticalMaintenance + overdueTasks + outOfStock
  };
}

module.exports = {
  DAY_MS,
  MAX_WINDOW_DAYS,
  parseTrendDays,
  toDateKey,
  resolveTrendWindow,
  buildContinuousDailySeries,
  computeFleetReadiness,
  parseTimeMinutes,
  isShiftActiveNow,
  summarizeWarehouseHealth,
  buildUrgentAlertCounts
};
