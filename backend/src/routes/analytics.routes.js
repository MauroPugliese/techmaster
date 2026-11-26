const router = require('express').Router();
const { sequelize } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const {
  parseGranularity,
  resolveAnalyticsWindow,
  computePeriodDelta,
  aggregateMaintenanceSummary,
  aggregateTaskCadence,
  fillContinuousBuckets,
  formatPeakHour,
  buildExecutiveInsights,
  toDateKey
} = require('../services/analytics-helpers.service');
const { computeTestingDurationMinutes } = require('../services/simulator-helpers.service');
const { computeReliabilityMetrics } = require('../services/maintenance-helpers.service');

function buildSqlDateRange(col, from, to, prefix, replacements) {
  let sql = '';
  if (from) {
    replacements[`${prefix}From`] = from;
    sql += ` AND ${col} >= :${prefix}From`;
  }
  if (to) {
    replacements[`${prefix}To`] = to;
    sql += ` AND ${col} <= :${prefix}To`;
  }
  return sql;
}

async function fetchWindowSnapshotKpis(from, to) {
  const replacements = {};
  const opsRange = buildSqlDateRange('start_date', from, to, 'ops', replacements);
  const maintRange = buildSqlDateRange('scheduled_date', from, to, 'maint', replacements);
  const stockRange = buildSqlDateRange('movement_date', from, to, 'stock', replacements);
  const taskRange = buildSqlDateRange('created_at', from, to, 'task', replacements);
  const shiftRange = buildSqlDateRange('s.date', from, to, 'shift', replacements);

  const [[opsRows], [maintRows], [stockRows], [taskRows], [shiftRows], [assetRows]] = await Promise.all([
    sequelize.query(
      `SELECT
         COUNT(*) AS totalOps,
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedOps,
         SUM(CASE WHEN status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD') AND end_date IS NOT NULL AND end_date < NOW() THEN 1 ELSE 0 END) AS overdueOps
       FROM operations WHERE 1=1 ${opsRange}`,
      { replacements }
    ),
    sequelize.query(
      `SELECT
         COUNT(*) AS totalRecords,
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedRecords,
         COALESCE(SUM(cost), 0) AS totalCost,
         COALESCE(SUM(downtime_hours), 0) AS totalDowntime,
         COALESCE(AVG(downtime_hours), 0) AS avgDowntime
       FROM maintenance_records WHERE deleted_at IS NULL ${maintRange}`,
      { replacements }
    ),
    sequelize.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('IN', 'RETURN') THEN quantity ELSE 0 END), 0) AS stockIn,
         COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) AS stockOut,
         COUNT(*) AS totalMoves
       FROM stock_movements WHERE 1=1 ${stockRange}`,
      { replacements }
    ),
    sequelize.query(
      `SELECT
         COUNT(*) AS totalTasks,
         SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS completedTasks,
         SUM(CASE WHEN status IN ('TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE') AND due_date IS NOT NULL AND due_date < NOW() THEN 1 ELSE 0 END) AS overdueTasks
       FROM tasks WHERE 1=1 ${taskRange}`,
      { replacements }
    ),
    sequelize.query(
      `SELECT
         COUNT(s.id) AS totalShifts,
         SUM(CASE WHEN s.status != 'ON_LEAVE' AND COALESCE(st.category, 'WORK') = 'WORK' THEN 1 ELSE 0 END) AS workShifts,
         SUM(CASE WHEN s.status = 'ABSENT' THEN 1 ELSE 0 END) AS totalAbsences
       FROM shifts s
       LEFT JOIN shift_types st ON s.shift_type_id = st.id
       WHERE s.deleted_at IS NULL ${shiftRange}`,
      { replacements }
    ),
    sequelize.query(
      `SELECT
         COUNT(*) AS totalAssets,
         SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS activeAssets,
         SUM(CASE WHEN status = 'UNDER_MAINTENANCE' THEN 1 ELSE 0 END) AS maintAssets
       FROM assets WHERE status != 'RETIRED'`
    )
  ]);

  const ops = opsRows[0] || {};
  const maint = maintRows[0] || {};
  const stock = stockRows[0] || {};
  const task = taskRows[0] || {};
  const shift = shiftRows[0] || {};
  const asset = assetRows[0] || {};

  const totalOperations = Number(ops.totalOps) || 0;
  const completedOperations = Number(ops.completedOps) || 0;
  const overdueOperations = Number(ops.overdueOps) || 0;

  const totalTasks = Number(task.totalTasks) || 0;
  const completedTasks = Number(task.completedTasks) || 0;
  const overdueTasks = Number(task.overdueTasks) || 0;

  const workShifts = Number(shift.workShifts ?? shift.totalShifts) || 0;
  const totalAbsences = Number(shift.totalAbsences) || 0;

  const totalAssets = Number(asset.totalAssets) || 0;
  const activeAssets = Number(asset.activeAssets) || 0;

  const stockIn = Number(stock.stockIn) || 0;
  const stockOut = Number(stock.stockOut) || 0;

  return {
    totalOperations,
    completedOperations,
    overdueOperations,
    operationCompletionRate: totalOperations > 0 ? Math.round((completedOperations / totalOperations) * 100) : 0,
    totalMaintenanceRecords: Number(maint.totalRecords) || 0,
    completedMaintenanceRecords: Number(maint.completedRecords) || 0,
    totalMaintenanceCost: Number(maint.totalCost) || 0,
    totalDowntimeHours: Math.round((Number(maint.totalDowntime) || 0) * 10) / 10,
    avgDowntimeHours: Math.round((Number(maint.avgDowntime) || 0) * 10) / 10,
    totalAssets,
    activeAssets,
    fleetReadinessPct: totalAssets > 0 ? Math.round((activeAssets / totalAssets) * 100) : 100,
    stockIn,
    stockOut,
    totalMovements: Number(stock.totalMoves) || 0,
    netStockFlow: stockIn - stockOut,
    totalTasks,
    completedTasks,
    overdueTasks,
    taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    workShifts,
    totalAbsences,
    shiftAttendanceRate: workShifts > 0 ? Math.round(((workShifts - totalAbsences) / workShifts) * 100) : 100
  };
}

// ── Consolidated Operational Intelligence Overview ──────────────────────────
router.get('/overview', parseDateFilter, async (req, res, next) => {
  try {
    const now = new Date();
    const granularity = parseGranularity(req.query.granularity);
    const window = resolveAnalyticsWindow(req.dateRange, req.query.period, now);

    const replacements = {
      seriesStart: window.seriesStartDate,
      seriesEnd: window.seriesEndDate,
      seriesStartStr: window.seriesStartStr,
      seriesEndStr: window.seriesEndStr
    };

    const opsJoinCond = [];
    if (window.from) {
      replacements.winFrom = window.from;
      opsJoinCond.push('o.start_date >= :winFrom');
    }
    if (window.to) {
      replacements.winTo = window.to;
      opsJoinCond.push('o.start_date <= :winTo');
    }
    const opsJoinSql = opsJoinCond.length ? `AND ${opsJoinCond.join(' AND ')}` : '';
    const opsWhereSql = buildSqlDateRange('o.start_date', window.from, window.to, 'oWin', replacements);
    const maintWhereSql = buildSqlDateRange('scheduled_date', window.from, window.to, 'mWin', replacements);
    const topAssetWhereSql = buildSqlDateRange('mr.scheduled_date', window.from, window.to, 'taWin', replacements);
    const stockWhereSql = buildSqlDateRange('movement_date', window.from, window.to, 'stWin', replacements);
    const taskWhereSql = buildSqlDateRange('created_at', window.from, window.to, 'tkWin', replacements);

    const [
      kpis,
      prevKpis,
      [opsByType],
      [opsByStatus],
      [maintRawRows],
      [topAssetsRaw],
      [opsSeriesRows],
      [maintSeriesRows],
      [taskSeriesRows],
      [stockDailyRows],
      [stockByTypeRows],
      [taskCadenceRows],
      [shiftCoverageRows],
      [peakRows]
    ] = await Promise.all([
      fetchWindowSnapshotKpis(window.from, window.to),
      window.hasComparison ? fetchWindowSnapshotKpis(window.prevFrom, window.prevTo) : Promise.resolve(null),

      sequelize.query(
        `SELECT
           ot.id AS type_id,
           ot.name AS type,
           COALESCE(ot.color, '#1565C0') AS color,
           COUNT(o.id) AS count,
           SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN o.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN o.status = 'PLANNED' THEN 1 ELSE 0 END) AS planned,
           COALESCE(SUM(CASE WHEN COALESCE(o.actual_end_date, o.end_date) IS NOT NULL
             THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, o.start_date, COALESCE(o.actual_end_date, o.end_date)))
             ELSE 0 END), 0) AS total_minutes
         FROM operation_types ot
         LEFT JOIN operations o ON o.type_id = ot.id ${opsJoinSql}
         GROUP BY ot.id, ot.name, ot.color
         ORDER BY count DESC`,
        { replacements }
      ),
      sequelize.query(
        `SELECT o.status, COUNT(*) AS count
         FROM operations o
         WHERE 1=1 ${opsWhereSql}
         GROUP BY o.status`,
        { replacements }
      ),
      sequelize.query(
        `SELECT
           type,
           status,
           COUNT(*) AS count,
           COALESCE(SUM(downtime_hours), 0) AS total_downtime,
           COALESCE(AVG(downtime_hours), 0) AS avg_downtime,
           COALESCE(SUM(cost), 0) AS total_cost
         FROM maintenance_records
         WHERE deleted_at IS NULL ${maintWhereSql}
         GROUP BY type, status
         ORDER BY count DESC`,
        { replacements }
      ),
      sequelize.query(
        `SELECT
           a.id,
           a.name,
           a.serial_number,
           ac.name AS category_name,
           COUNT(mr.id) AS records_count,
           COALESCE(SUM(mr.cost), 0) AS total_cost,
           COALESCE(SUM(mr.downtime_hours), 0) AS total_downtime
         FROM maintenance_records mr
         JOIN assets a ON mr.asset_id = a.id
         LEFT JOIN asset_categories ac ON a.category_id = ac.id
         WHERE mr.deleted_at IS NULL ${topAssetWhereSql}
         GROUP BY a.id, a.name, a.serial_number, ac.name
         ORDER BY total_cost DESC, total_downtime DESC
         LIMIT 6`,
        { replacements }
      ),

      sequelize.query(
        `SELECT DATE(start_date) AS date, COUNT(*) AS count
         FROM operations
         WHERE start_date BETWEEN :seriesStart AND :seriesEnd
         GROUP BY DATE(start_date)
         ORDER BY date ASC`,
        { replacements }
      ),
      sequelize.query(
        `SELECT DATE(scheduled_date) AS date, COUNT(*) AS count
         FROM maintenance_records
         WHERE deleted_at IS NULL AND scheduled_date BETWEEN :seriesStart AND :seriesEnd
         GROUP BY DATE(scheduled_date)
         ORDER BY date ASC`,
        { replacements }
      ),
      sequelize.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM tasks
         WHERE created_at BETWEEN :seriesStart AND :seriesEnd
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        { replacements }
      ),

      sequelize.query(
        `SELECT DATE(movement_date) AS date, type, COALESCE(SUM(quantity), 0) AS total_qty, COUNT(*) AS count
         FROM stock_movements
         WHERE movement_date BETWEEN :seriesStart AND :seriesEnd
         GROUP BY DATE(movement_date), type
         ORDER BY date ASC`,
        { replacements }
      ),
      sequelize.query(
        `SELECT type, COUNT(*) AS moves, COALESCE(SUM(quantity), 0) AS total_qty
         FROM stock_movements
         WHERE 1=1 ${stockWhereSql}
         GROUP BY type`,
        { replacements }
      ),

      sequelize.query(
        `SELECT
           interval_type,
           status,
           COUNT(*) AS count,
           COALESCE(AVG(CASE WHEN completed_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, completed_at) ELSE NULL END), 0) AS avg_completion_hours
         FROM tasks
         WHERE 1=1 ${taskWhereSql}
         GROUP BY interval_type, status
         ORDER BY interval_type`,
        { replacements }
      ),

      sequelize.query(
        `SELECT
           s.date,
           st.name AS shift_name,
           COALESCE(st.color, '#1565C0') AS color,
           COUNT(s.id) AS employees,
           SUM(CASE WHEN s.status = 'ABSENT' THEN 1 ELSE 0 END) AS absences
         FROM shifts s
         JOIN shift_types st ON s.shift_type_id = st.id
         WHERE s.deleted_at IS NULL
           AND s.status != 'ON_LEAVE'
           AND COALESCE(st.category, 'WORK') = 'WORK'
           AND s.date BETWEEN :seriesStartStr AND :seriesEndStr
         GROUP BY s.date, st.id, st.name, st.color
         ORDER BY s.date ASC`,
        { replacements }
      ),

      sequelize.query(
        `SELECT DAYNAME(o.start_date) AS dayName, HOUR(o.start_date) AS hour, COUNT(*) AS count
         FROM operations o
         WHERE 1=1 ${opsWhereSql}
         GROUP BY DAYNAME(o.start_date), HOUR(o.start_date)
         ORDER BY count DESC
         LIMIT 1`,
        { replacements }
      )
    ]);

    const deltas = prevKpis ? {
      totalOperations: computePeriodDelta(kpis.totalOperations, prevKpis.totalOperations),
      operationCompletionRate: kpis.operationCompletionRate - prevKpis.operationCompletionRate,
      totalMaintenanceCost: computePeriodDelta(kpis.totalMaintenanceCost, prevKpis.totalMaintenanceCost),
      totalDowntimeHours: computePeriodDelta(kpis.totalDowntimeHours, prevKpis.totalDowntimeHours),
      netStockFlow: computePeriodDelta(kpis.netStockFlow, prevKpis.netStockFlow),
      taskCompletionRate: kpis.taskCompletionRate - prevKpis.taskCompletionRate,
      shiftAttendanceRate: kpis.shiftAttendanceRate - prevKpis.shiftAttendanceRate
    } : null;

    const opsBuckets = fillContinuousBuckets(window.seriesStartStr, window.seriesEndStr, opsSeriesRows);
    const maintBuckets = fillContinuousBuckets(window.seriesStartStr, window.seriesEndStr, maintSeriesRows);
    const taskBuckets = fillContinuousBuckets(window.seriesStartStr, window.seriesEndStr, taskSeriesRows);

    const stockInFilled = fillContinuousBuckets(
      window.seriesStartStr,
      window.seriesEndStr,
      stockDailyRows.filter((r) => r.type === 'IN' || r.type === 'RETURN'),
      (r) => Number(r.total_qty) || 0
    );
    const stockOutFilled = fillContinuousBuckets(
      window.seriesStartStr,
      window.seriesEndStr,
      stockDailyRows.filter((r) => r.type === 'OUT'),
      (r) => Number(r.total_qty) || 0
    );

    const shiftTypeMeta = new Map();
    for (const r of shiftCoverageRows) {
      if (r.shift_name && !shiftTypeMeta.has(r.shift_name)) {
        shiftTypeMeta.set(r.shift_name, r.color || '#1565C0');
      }
    }
    const shiftSeries = Array.from(shiftTypeMeta.entries()).map(([name, color]) => {
      const filled = fillContinuousBuckets(
        window.seriesStartStr,
        window.seriesEndStr,
        shiftCoverageRows.filter((r) => r.shift_name === name),
        (r) => Number(r.employees) || 0
      );
      return { name, color, data: filled.values };
    });
    const shiftAbsenceFilled = fillContinuousBuckets(
      window.seriesStartStr,
      window.seriesEndStr,
      shiftCoverageRows,
      (r) => Number(r.absences) || 0
    );

    const maintSummary = aggregateMaintenanceSummary(maintRawRows);
    const taskCadence = aggregateTaskCadence(taskCadenceRows);
    const topAssets = topAssetsRaw.map((a) => ({
      id: a.id,
      name: a.name,
      serial_number: a.serial_number,
      category_name: a.category_name || null,
      records_count: Number(a.records_count) || 0,
      total_cost: Math.round((Number(a.total_cost) || 0) * 100) / 100,
      total_downtime: Math.round((Number(a.total_downtime) || 0) * 100) / 100
    }));

    const peakData = peakRows[0] || {};
    const peak = {
      dayName: peakData.dayName || 'N/A',
      hour: peakData.hour !== undefined && peakData.hour !== null ? Number(peakData.hour) : null,
      peakHourFormatted: formatPeakHour(peakData.hour),
      count: Number(peakData.count) || 0
    };

    const insights = buildExecutiveInsights({
      opsByType,
      maintSummary,
      topAssets,
      kpis,
      peak
    });

    res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        period: window.period,
        granularity,
        hasComparison: window.hasComparison,
        seriesStartDate: window.seriesStartStr,
        seriesEndDate: window.seriesEndStr,
        kpis,
        deltas,
        insights,
        opsByType: opsByType.map((r) => ({
          type_id: r.type_id,
          type: r.type,
          color: r.color,
          count: Number(r.count) || 0,
          completed: Number(r.completed) || 0,
          in_progress: Number(r.in_progress) || 0,
          planned: Number(r.planned) || 0,
          total_minutes: Number(r.total_minutes) || 0
        })),
        opsByStatus: opsByStatus.map((r) => ({
          status: r.status,
          count: Number(r.count) || 0
        })),
        activityTrend: {
          dates: opsBuckets.dates,
          operations: opsBuckets.values,
          maintenance: maintBuckets.values,
          tasks: taskBuckets.values
        },
        maintSummary,
        topAssets,
        stockFlow: {
          dates: stockInFilled.dates,
          in: stockInFilled.values,
          out: stockOutFilled.values
        },
        stockByType: stockByTypeRows.map((r) => ({
          type: r.type,
          moves: Number(r.moves) || 0,
          total_qty: Number(r.total_qty) || 0
        })),
        shiftCoverage: {
          dates: shiftAbsenceFilled.dates,
          series: shiftSeries,
          absences: shiftAbsenceFilled.values
        },
        taskCadence,
        peak
      }
    });
  } catch (err) { next(err); }
});

// ── Detailed Operations Metrics (Used by Operations Deep-Dive) ──────────────
router.get('/operations-metrics', parseDateFilter, async (req, res, next) => {
  try {
    const now = new Date();
    const granularity = parseGranularity(req.query.granularity);
    const window = resolveAnalyticsWindow(req.dateRange, req.query.period, now);

    const replacements = {};
    const dateFilter = buildSqlDateRange('o.start_date', window.from, window.to, 'op', replacements);

    const durationExpr = `GREATEST(0, TIMESTAMPDIFF(MINUTE, o.start_date, COALESCE(o.actual_end_date, o.end_date)))`;
    const hasEndExpr = `COALESCE(o.actual_end_date, o.end_date) IS NOT NULL`;

    const metricsQuery = `
      SELECT
        COUNT(*) AS totalOperations,
        COALESCE(SUM(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE 0 END), 0) AS totalMinutes,
        COALESCE(AVG(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE NULL END), 0) AS avgDuration,
        COALESCE(MAX(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE NULL END), 0) AS maxDuration,
        COALESCE(MIN(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE NULL END), 0) AS minDuration,
        SUM(CASE WHEN o.status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD') AND o.end_date IS NOT NULL AND o.end_date < NOW() THEN 1 ELSE 0 END) AS overdueCount,
        CASE WHEN COUNT(*) > 0
          THEN ROUND((SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 1)
          ELSE 0
        END AS completionRate
      FROM operations o
      WHERE 1=1 ${dateFilter}
    `;

    let selectExpr = 'DATE(o.start_date)';
    let groupExpr = 'DATE(o.start_date)';

    if (granularity === 'hour') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-%d %H:00:00')";
      groupExpr = "DATE_FORMAT(o.start_date, '%Y-%m-%d %H:00:00')";
    } else if (granularity === 'week') {
      selectExpr = "DATE_FORMAT(DATE_SUB(o.start_date, INTERVAL WEEKDAY(o.start_date) DAY), '%Y-%m-%d')";
      groupExpr = 'YEARWEEK(o.start_date, 1)';
    } else if (granularity === 'month') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-01')";
      groupExpr = "DATE_FORMAT(o.start_date, '%Y-%m')";
    }

    const trendQuery = `
      SELECT
        ${selectExpr} AS date,
        COUNT(*) AS count,
        COALESCE(AVG(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE NULL END), 0) AS avgDuration
      FROM operations o
      WHERE 1=1 ${dateFilter}
      GROUP BY ${groupExpr}
      ORDER BY date ASC
    `;

    const timeDistQuery = `
      SELECT
        ot.name AS type,
        COALESCE(ot.color, '#1565C0') AS color,
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN ${hasEndExpr} THEN ${durationExpr} ELSE 0 END), 0) AS totalMinutes
      FROM operations o
      JOIN operation_types ot ON o.type_id = ot.id
      WHERE 1=1 ${dateFilter}
      GROUP BY ot.id, ot.name, ot.color
      ORDER BY totalMinutes DESC, count DESC
    `;

    const statusQuery = `
      SELECT o.status, COUNT(*) AS count
      FROM operations o
      WHERE 1=1 ${dateFilter}
      GROUP BY o.status
    `;

    const peakQuery = `
      SELECT DAYNAME(o.start_date) AS dayName, HOUR(o.start_date) AS hour, COUNT(*) AS count
      FROM operations o
      WHERE 1=1 ${dateFilter}
      GROUP BY DAYNAME(o.start_date), HOUR(o.start_date)
      ORDER BY count DESC
      LIMIT 1
    `;

    const [[metricsRows], [rawTrendRows], [timeDistRows], [statusRows], [peakRows]] = await Promise.all([
      sequelize.query(metricsQuery, { replacements }),
      sequelize.query(trendQuery, { replacements }),
      sequelize.query(timeDistQuery, { replacements }),
      sequelize.query(statusQuery, { replacements }),
      sequelize.query(peakQuery, { replacements })
    ]);

    const m = metricsRows[0] || {};
    const totalOps = Number(m.totalOperations) || 0;
    const overdueCount = Number(m.overdueCount) || 0;
    const totalMinutes = Number(m.totalMinutes) || 0;

    const metrics = {
      totalOperations: totalOps,
      totalMinutes,
      totalHours: Math.floor(totalMinutes / 60),
      remainingMinutes: totalMinutes % 60,
      avgDuration: Math.round(Number(m.avgDuration) || 0),
      maxDuration: Math.round(Number(m.maxDuration) || 0),
      minDuration: Math.round(Number(m.minDuration) || 0),
      overdueCount,
      overdueRate: totalOps > 0 ? Math.round((overdueCount / totalOps) * 100) : 0,
      completionRate: Number(m.completionRate) || 0
    };

    // For day granularity over a bounded period, fill gaps continuously
    let trend = rawTrendRows.map((r) => ({
      date: r.date instanceof Date ? toDateKey(r.date) : String(r.date),
      count: Number(r.count) || 0,
      avgDuration: Math.round(Number(r.avgDuration) || 0)
    }));

    if (granularity === 'day' && window.period !== 'all') {
      const countFill = fillContinuousBuckets(window.seriesStartStr, window.seriesEndStr, rawTrendRows, (r) => Number(r.count) || 0);
      const avgFill = fillContinuousBuckets(window.seriesStartStr, window.seriesEndStr, rawTrendRows, (r) => Number(r.avgDuration) || 0);
      trend = countFill.dates.map((d, idx) => ({
        date: d,
        count: countFill.values[idx],
        avgDuration: Math.round(avgFill.values[idx])
      }));
    }

    const peakData = peakRows[0] || {};
    const peakHourVal = peakData.hour !== undefined && peakData.hour !== null ? Number(peakData.hour) : null;

    const simScorecardQuery = `
      SELECT
        s.id AS simulator_id,
        s.code AS simulator_code,
        s.bay_code,
        s.station_kind,
        s.aircraft_type,
        s.status AS bay_status,
        s.daily_available_hours,
        COUNT(o.id) AS sortie_count,
        COALESCE(SUM(COALESCE(o.scheduled_hours, CASE WHEN ${hasEndExpr} THEN ${durationExpr} / 60 ELSE 0 END)), 0) AS scheduled_hours,
        COALESCE(SUM(COALESCE(o.actual_flight_hours, CASE WHEN o.status = 'COMPLETED' AND ${hasEndExpr} THEN ${durationExpr} / 60 ELSE 0 END)), 0) AS actual_hours,
        COALESCE(SUM(COALESCE(o.lost_training_minutes, 0)), 0) AS lost_minutes
      FROM simulators s
      LEFT JOIN operations o ON o.simulator_id = s.id AND o.status != 'CANCELLED' ${dateFilter}
      GROUP BY s.id, s.code, s.bay_code, s.station_kind, s.aircraft_type, s.status, s.daily_available_hours
      ORDER BY s.sort_order ASC, s.bay_code ASC
    `;

    const shiftRangeCond = buildSqlDateRange('dl.log_date', window.from ? toDateKey(window.from) : null, window.to ? toDateKey(window.to) : null, 'sh', replacements);
    const shiftEntriesQuery = `
      SELECT e.simulator_id, e.sim_testing_start, e.sim_testing_end, e.usage_status
      FROM simulator_shift_entries e
      JOIN simulator_daily_shifts ds ON e.shift_id = ds.id
      JOIN simulator_daily_logs dl ON ds.daily_log_id = dl.id
      WHERE 1=1 ${shiftRangeCond}
    `;

    const maintRelCond = buildSqlDateRange('scheduled_date', window.from, window.to, 'mrRel', replacements);
    const maintReliabilityQuery = `
      SELECT id, type, status, severity, is_snag, subsystem_code, downtime_hours, lost_training_hours, mel_category, mel_expiry_date
      FROM maintenance_records
      WHERE deleted_at IS NULL ${maintRelCond}
    `;

    const snagsBySubsystemQuery = `
      SELECT
        COALESCE(subsystem_code, 'GENERAL') AS subsystem,
        COUNT(*) AS count,
        SUM(CASE WHEN severity = 'AOG' THEN 1 ELSE 0 END) AS aog_count,
        COALESCE(SUM(COALESCE(lost_training_hours, 0)), 0) AS lost_hours
      FROM maintenance_records
      WHERE deleted_at IS NULL AND (simulator_id IS NOT NULL OR is_snag = 1) ${maintRelCond}
      GROUP BY COALESCE(subsystem_code, 'GENERAL')
      ORDER BY count DESC
      LIMIT 8
    `;

    const hoursByCustomerQuery = `
      SELECT
        COALESCE(NULLIF(TRIM(o.customer_operator), ''), 'Internal / Unassigned') AS customer,
        COUNT(*) AS sorties,
        COALESCE(SUM(COALESCE(o.scheduled_hours, CASE WHEN ${hasEndExpr} THEN ${durationExpr} / 60 ELSE 0 END)), 0) AS scheduled_hours,
        COALESCE(SUM(COALESCE(o.lost_training_minutes, 0)), 0) AS lost_minutes
      FROM operations o
      WHERE o.status != 'CANCELLED' ${dateFilter}
      GROUP BY COALESCE(NULLIF(TRIM(o.customer_operator), ''), 'Internal / Unassigned')
      ORDER BY scheduled_hours DESC, sorties DESC
      LIMIT 8
    `;

    const [[simScorecardRows], [snagSubRows], [custRows], [shiftEntriesRows], [maintRelRows]] = await Promise.all([
      sequelize.query(simScorecardQuery, { replacements }).catch(() => [[]]),
      sequelize.query(snagsBySubsystemQuery, { replacements }).catch(() => [[]]),
      sequelize.query(hoursByCustomerQuery, { replacements }).catch(() => [[]]),
      sequelize.query(shiftEntriesQuery, { replacements }).catch(() => [[]]),
      sequelize.query(maintReliabilityQuery, { replacements }).catch(() => [[]])
    ]);

    const shiftMinBySim = new Map();
    let totalShiftMin = 0;
    for (const se of shiftEntriesRows) {
      const dur = computeTestingDurationMinutes(se.sim_testing_start, se.sim_testing_end);
      totalShiftMin += dur;
      const sid = Number(se.simulator_id);
      if (sid && dur > 0) {
        shiftMinBySim.set(sid, (shiftMinBySim.get(sid) || 0) + dur);
      }
    }

    const bySimulator = simScorecardRows.map((r) => {
      const simId = Number(r.simulator_id);
      const schedH = Math.round((Number(r.scheduled_hours) || 0) * 10) / 10;
      const actualH = Math.round((Number(r.actual_hours) || 0) * 10) / 10;
      const shiftH = Math.round(((shiftMinBySim.get(simId) || 0) / 60) * 10) / 10;
      const lostMin = Math.max(0, Number(r.lost_minutes) || 0);
      const schedMin = schedH * 60;
      const reliabilityPct = schedMin > 0
        ? Math.max(0, Math.min(100, Math.round(((schedMin - lostMin) / schedMin) * 1000) / 10))
        : 100;
      return {
        simulator_id: simId,
        simulator_code: r.simulator_code,
        bay_code: r.bay_code,
        station_kind: r.station_kind || 'FFS_BAY',
        aircraft_type: r.aircraft_type,
        bay_status: r.bay_status,
        sortie_count: Number(r.sortie_count) || 0,
        scheduled_hours: schedH,
        actual_hours: actualH,
        shift_hours: shiftH,
        lost_minutes: lostMin,
        reliability_pct: reliabilityPct
      };
    });

    const totalOperatingHours = Number(((totalMinutes + totalShiftMin) / 60).toFixed(1));
    const reliability = computeReliabilityMetrics(maintRelRows, totalOperatingHours, now);

    res.json({
      success: true,
      data: {
        period: window.period,
        granularity,
        dateRange: { from: window.from, to: window.to },
        metrics,
        charts: {
          trend,
          timeDistribution: timeDistRows.map((r) => ({
            type: r.type,
            color: r.color,
            count: Number(r.count) || 0,
            totalMinutes: Number(r.totalMinutes) || 0
          })),
          statusBreakdown: statusRows.map((r) => ({
            status: r.status,
            count: Number(r.count) || 0
          }))
        },
        insights: {
          peakDay: peakData.dayName || 'N/A',
          peakHour: peakHourVal,
          peakHourFormatted: formatPeakHour(peakHourVal),
          mostActiveType: timeDistRows[0]?.type || 'N/A'
        },
        simulatorMetrics: {
          bySimulator,
          totalShiftHours: Number((totalShiftMin / 60).toFixed(1)),
          reliability,
          snagsBySubsystem: snagSubRows.map((r) => ({
            subsystem: r.subsystem,
            count: Number(r.count) || 0,
            aog_count: Number(r.aog_count) || 0,
            lost_hours: Math.round((Number(r.lost_hours) || 0) * 10) / 10
          })),
          hoursByCustomer: custRows.map((r) => ({
            customer: r.customer,
            sorties: Number(r.sorties) || 0,
            scheduled_hours: Math.round((Number(r.scheduled_hours) || 0) * 10) / 10,
            lost_minutes: Number(r.lost_minutes) || 0
          }))
        }
      }
    });
  } catch (err) { next(err); }
});

// ── Cross-Module KPIs (Backwards-Compatible Endpoint) ───────────────────────
router.get('/kpis', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    const kpis = await fetchWindowSnapshotKpis(from || null, to || null);
    res.json({
      success: true,
      data: {
        totalOperations: kpis.totalOperations,
        operationCompletionRate: kpis.operationCompletionRate,
        totalMaintenanceCost: kpis.totalMaintenanceCost,
        totalDowntimeHours: kpis.totalDowntimeHours,
        avgDowntimeHours: kpis.avgDowntimeHours,
        netStockFlow: kpis.netStockFlow,
        taskCompletionRate: kpis.taskCompletionRate,
        shiftAttendanceRate: kpis.shiftAttendanceRate
      }
    });
  } catch (err) { next(err); }
});

// ── Operations by Type (Volume, Completion, Categories) ─────────────────────
router.get('/operations-by-type', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    let query = `
      SELECT
        ot.id AS type_id,
        ot.name AS type,
        COALESCE(ot.color, '#1565C0') AS color,
        COUNT(o.id) AS count,
        SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN o.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN o.status = 'PLANNED' THEN 1 ELSE 0 END) AS planned
      FROM operation_types ot
      LEFT JOIN operations o ON o.type_id = ot.id`;
    const replacements = {};
    const conds = [];

    if (from) {
      conds.push('o.start_date >= :startDate');
      replacements.startDate = from;
    }
    if (to) {
      conds.push('o.start_date <= :endDate');
      replacements.endDate = to;
    }
    if (conds.length) query += ` AND ${conds.join(' AND ')}`;
    query += ' GROUP BY ot.id, ot.name, ot.color ORDER BY count DESC';

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Operations Status Breakdown ─────────────────────────────────────────────
router.get('/operations-by-status', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    const replacements = {};
    const cond = buildSqlDateRange('start_date', from, to, 'op', replacements);
    const [rows] = await sequelize.query(
      `SELECT status, COUNT(*) AS count FROM operations WHERE 1=1 ${cond} GROUP BY status`,
      { replacements }
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Maintenance Overview ────────────────────────────────────────────────────
router.get('/maintenance-overview', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    const replacements = {};
    const cond = buildSqlDateRange('scheduled_date', from, to, 'm', replacements);
    const [rows] = await sequelize.query(
      `SELECT
         type,
         status,
         COUNT(*) AS count,
         COALESCE(SUM(downtime_hours), 0) AS total_downtime,
         COALESCE(AVG(downtime_hours), 0) AS avg_downtime,
         COALESCE(SUM(cost), 0) AS total_cost
       FROM maintenance_records
       WHERE deleted_at IS NULL ${cond}
       GROUP BY type, status
       ORDER BY count DESC`,
      { replacements }
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Stock Movements (IN vs OUT flow) ────────────────────────────────────────
router.get('/stock-movements', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    let query = `
      SELECT DATE(movement_date) AS date, type, SUM(quantity) AS total_qty, COUNT(*) AS count
      FROM stock_movements WHERE 1=1`;
    const replacements = {};

    if (from) {
      query += ' AND movement_date >= :startDate';
      replacements.startDate = from;
    } else {
      query += ' AND movement_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }
    if (to) {
      query += ' AND movement_date <= :endDate';
      replacements.endDate = to;
    }
    query += ' GROUP BY DATE(movement_date), type ORDER BY date ASC';

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Task Completion Performance ─────────────────────────────────────────────
router.get('/task-completion', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    const replacements = {};
    const cond = buildSqlDateRange('created_at', from, to, 'tk', replacements);
    const [rows] = await sequelize.query(
      `SELECT
         interval_type,
         status,
         COUNT(*) AS count,
         COALESCE(AVG(CASE WHEN completed_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, completed_at) ELSE NULL END), 0) AS avg_completion_hours
       FROM tasks
       WHERE 1=1 ${cond}
       GROUP BY interval_type, status
       ORDER BY interval_type`,
      { replacements }
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Shift Workforce & Coverage ──────────────────────────────────────────────
router.get('/shift-coverage', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    let query = `
      SELECT
        s.date,
        st.name AS shift_name,
        COALESCE(st.color, '#1565C0') AS color,
        COUNT(s.id) AS employees,
        SUM(CASE WHEN s.status = 'ABSENT' THEN 1 ELSE 0 END) AS absences
      FROM shifts s
      JOIN shift_types st ON s.shift_type_id = st.id
      WHERE s.deleted_at IS NULL AND s.status != 'ON_LEAVE' AND COALESCE(st.category, 'WORK') = 'WORK'`;
    const replacements = {};

    if (from) {
      query += ' AND s.date >= :startDate';
      replacements.startDate = from;
    } else {
      query += ' AND s.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }
    if (to) {
      query += ' AND s.date <= :endDate';
      replacements.endDate = to;
    }
    query += ' GROUP BY s.date, st.id, st.name, st.color ORDER BY s.date ASC';

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
