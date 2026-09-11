const router = require('express').Router();
const { sequelize } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');

router.get('/operations-metrics', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const period = req.query.period || 'all';

    // Calculate date ranges based on period
    let dateFilter = '';
    const replacements = {};

    if (period === 'daily') {
      dateFilter = `AND DATE(o.start_date) = CURDATE()`;
    } else if (period === 'weekly') {
      dateFilter = `AND YEARWEEK(o.start_date, 1) = YEARWEEK(CURDATE(), 1)`;
    } else if (period === 'monthly') {
      dateFilter = `AND YEAR(o.start_date) = YEAR(CURDATE()) AND MONTH(o.start_date) = MONTH(CURDATE())`;
    } else if (period === 'yearly') {
      dateFilter = `AND YEAR(o.start_date) = YEAR(CURDATE())`;
    } else if (from && to) {
      dateFilter = `AND o.start_date >= :startDate AND o.start_date <= :endDate`;
      replacements.startDate = from;
      replacements.endDate = to;
    }

    // Main metrics query
    const metricsQuery = `
      SELECT
        COUNT(*) as totalOperations,
        COALESCE(SUM(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE 0 END), 0) as totalMinutes,
        COALESCE(AVG(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as avgDuration,
        COALESCE(MAX(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as maxDuration,
        COALESCE(MIN(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as minDuration,
        ROUND((SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as completionRate
      FROM operations o
      WHERE 1=1 ${dateFilter}
    `;

    // Trend data for charts with dynamic granularity
    const granularity = req.query.granularity || 'day';
    let selectExpr = 'DATE(o.start_date)';
    let groupExpr = 'DATE(o.start_date)';

    if (granularity === 'hour') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-%d %H:00:00')";
      groupExpr = "DATE_FORMAT(o.start_date, '%Y-%m-%d %H:00:00')";
    } else if (granularity === 'week') {
      selectExpr = "DATE_FORMAT(DATE_SUB(o.start_date, INTERVAL WEEKDAY(o.start_date) DAY), '%Y-%m-%d')";
      groupExpr = "YEARWEEK(o.start_date, 1)";
    } else if (granularity === 'month') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-01')";
      groupExpr = "DATE_FORMAT(o.start_date, '%Y-%m')";
    }

    const trendQuery = `
      SELECT
        ${selectExpr} as date,
        COUNT(*) as count,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as avgDuration
      FROM operations o
      WHERE o.end_date IS NOT NULL ${dateFilter}
      GROUP BY ${groupExpr}
      ORDER BY date
    `;

    // Time distribution by operation type
    const timeDistQuery = `
      SELECT
        ot.name as type,
        ot.color,
        COUNT(*) as count,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as totalMinutes
      FROM operations o
      JOIN operation_types ot ON o.type_id = ot.id
      WHERE o.end_date IS NOT NULL ${dateFilter}
      GROUP BY ot.id, ot.name, ot.color
      ORDER BY totalMinutes DESC
    `;

    // Status breakdown
    const statusQuery = `
      SELECT
        o.status,
        COUNT(*) as count
      FROM operations o
      WHERE 1=1 ${dateFilter}
      GROUP BY o.status
    `;

    const [metricsRows] = await sequelize.query(metricsQuery, { replacements });
    const [trendRows] = await sequelize.query(trendQuery, { replacements });
    const [timeDistRows] = await sequelize.query(timeDistQuery, { replacements });
    const [statusRows] = await sequelize.query(statusQuery, { replacements });

    const metrics = metricsRows[0] || {};

    // Calculate hours from minutes
    metrics.totalHours = Math.floor(metrics.totalMinutes / 60);
    metrics.remainingMinutes = metrics.totalMinutes % 60;

    // Peak analysis
    const peakQuery = `
      SELECT
        DAYNAME(o.start_date) as dayName,
        HOUR(o.start_date) as hour,
        COUNT(*) as count
      FROM operations o
      WHERE 1=1 ${dateFilter}
      GROUP BY DAYNAME(o.start_date), HOUR(o.start_date)
      ORDER BY count DESC
      LIMIT 1
    `;

    const [peakRows] = await sequelize.query(peakQuery, { replacements });
    const peakData = peakRows[0] || {};

    res.json({
      success: true,
      data: {
        period,
        dateRange: { from, to },
        metrics,
        charts: {
          trend: trendRows,
          timeDistribution: timeDistRows,
          statusBreakdown: statusRows
        },
        insights: {
          peakDay: peakData.dayName || 'N/A',
          peakHour: peakData.hour || 'N/A',
          mostActiveType: timeDistRows[0]?.type || 'N/A'
        }
      }
    });
  } catch (err) { next(err); }
});

// ── Cross-Module KPIs for Analytics Dashboard ──────────────────────────────
router.get('/kpis', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const dateCond = (col) => {
      let cond = '';
      if (from) cond += ` AND ${col} >= :startDate`;
      if (to) cond += ` AND ${col} <= :endDate`;
      return cond;
    };
    const replacements = {};
    if (from) replacements.startDate = from;
    if (to) replacements.endDate = to;

    const [opsKpis] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalOps,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completedOps
      FROM operations WHERE 1=1 ${dateCond('start_date')}`, { replacements });

    const [maintKpis] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(cost), 0) as totalCost,
        COALESCE(SUM(downtime_hours), 0) as totalDowntime,
        COALESCE(AVG(downtime_hours), 0) as avgDowntime
      FROM maintenance_records WHERE deleted_at IS NULL ${dateCond('scheduled_date')}`, { replacements });

    const [stockKpis] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) as stockIn,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) as stockOut
      FROM stock_movements WHERE 1=1 ${dateCond('movement_date')}`, { replacements });

    const [taskKpis] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalTasks,
        SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as completedTasks
      FROM tasks WHERE 1=1 ${dateCond('created_at')}`, { replacements });

    const [shiftKpis] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalShifts,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as totalAbsences
      FROM shifts WHERE deleted_at IS NULL ${dateCond('date')}`, { replacements });

    const ops = opsKpis[0] || {};
    const maint = maintKpis[0] || {};
    const stock = stockKpis[0] || {};
    const task = taskKpis[0] || {};
    const shift = shiftKpis[0] || {};

    const opsTotal = Number(ops.totalOps) || 0;
    const opsComp = Number(ops.completedOps) || 0;
    const tasksTotal = Number(task.totalTasks) || 0;
    const tasksComp = Number(task.completedTasks) || 0;
    const shiftsTotal = Number(shift.totalShifts) || 0;
    const shiftsAbs = Number(shift.totalAbsences) || 0;

    res.json({
      success: true,
      data: {
        totalOperations: opsTotal,
        operationCompletionRate: opsTotal > 0 ? Math.round((opsComp / opsTotal) * 100) : 0,
        totalMaintenanceCost: Number(maint.totalCost) || 0,
        totalDowntimeHours: Number(Number(maint.totalDowntime).toFixed(1)) || 0,
        avgDowntimeHours: Number(Number(maint.avgDowntime).toFixed(1)) || 0,
        netStockFlow: (Number(stock.stockIn) || 0) - (Number(stock.stockOut) || 0),
        taskCompletionRate: tasksTotal > 0 ? Math.round((tasksComp / tasksTotal) * 100) : 0,
        shiftAttendanceRate: shiftsTotal > 0 ? Math.round(((shiftsTotal - shiftsAbs) / shiftsTotal) * 100) : 100
      }
    });
  } catch (err) { next(err); }
});

// ── Operations by Type (Volume, Completion, Categories) ─────────────────────
router.get('/operations-by-type', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT 
        ot.id as type_id,
        ot.name as type,
        COALESCE(ot.color, '#1565C0') as color,
        COUNT(o.id) as count,
        SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN o.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN o.status = 'PLANNED' THEN 1 ELSE 0 END) as planned
      FROM operation_types ot
      LEFT JOIN operations o ON o.type_id = ot.id`;
    const replacements = {};
    const conditions = [];

    if (from) {
      conditions.push(`o.start_date >= :startDate`);
      replacements.startDate = from;
    }
    if (to) {
      conditions.push(`o.start_date <= :endDate`);
      replacements.endDate = to;
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(' AND ')}`;
    }
    query += ` GROUP BY ot.id, ot.name, ot.color ORDER BY count DESC`;

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Operations Status Breakdown ─────────────────────────────────────────────
router.get('/operations-by-status', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT status, COUNT(*) as count
      FROM operations WHERE 1=1`;
    const replacements = {};

    if (from) {
      query += ` AND start_date >= :startDate`;
      replacements.startDate = from;
    }
    if (to) {
      query += ` AND start_date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY status`;

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Maintenance Overview ────────────────────────────────────────────────────
router.get('/maintenance-overview', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT 
        type, 
        status, 
        COUNT(*) as count, 
        COALESCE(AVG(downtime_hours), 0) as avg_downtime, 
        COALESCE(SUM(cost), 0) as total_cost
      FROM maintenance_records 
      WHERE deleted_at IS NULL`;
    const replacements = {};
    
    if (from) {
      query += ` AND scheduled_date >= :startDate`;
      replacements.startDate = from;
    }
    if (to) {
      query += ` AND scheduled_date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY type, status ORDER BY count DESC`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Stock Movements (IN vs OUT flow) ────────────────────────────────────────
router.get('/stock-movements', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT DATE(movement_date) as date, type, SUM(quantity) as total_qty, COUNT(*) as count
      FROM stock_movements WHERE 1=1`;
    const replacements = {};
    
    if (from) {
      query += ` AND movement_date >= :startDate`;
      replacements.startDate = from;
    } else {
      query += ` AND movement_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    }
    if (to) {
      query += ` AND movement_date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY DATE(movement_date), type ORDER BY date ASC`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Task Completion Performance ─────────────────────────────────────────────
router.get('/task-completion', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT 
        interval_type, 
        status, 
        COUNT(*) as count,
        COALESCE(AVG(CASE WHEN completed_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, completed_at) ELSE NULL END), 0) as avg_completion_hours
      FROM tasks 
      WHERE 1=1`;
    const replacements = {};

    if (from) {
      query += ` AND created_at >= :startDate`;
      replacements.startDate = from;
    }
    if (to) {
      query += ` AND created_at <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY interval_type, status ORDER BY interval_type`;

    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── Shift Workforce & Coverage ──────────────────────────────────────────────
router.get('/shift-coverage', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT 
        s.date, 
        st.name as shift_name, 
        COALESCE(st.color, '#1565C0') as color, 
        COUNT(s.id) as employees,
        SUM(CASE WHEN s.status = 'ABSENT' THEN 1 ELSE 0 END) as absences
      FROM shifts s 
      JOIN shift_types st ON s.shift_type_id = st.id
      WHERE s.deleted_at IS NULL`;
    const replacements = {};
    
    if (from) {
      query += ` AND s.date >= :startDate`;
      replacements.startDate = from;
    } else {
      query += ` AND s.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    }
    
    if (to) {
      query += ` AND s.date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY s.date, st.id, st.name, st.color ORDER BY s.date ASC`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
