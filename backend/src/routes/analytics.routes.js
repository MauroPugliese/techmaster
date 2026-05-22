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
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as totalMinutes,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as avgDuration,
        COALESCE(MAX(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as maxDuration,
        COALESCE(MIN(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as minDuration,
        ROUND((SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as completionRate
      FROM operations o
      WHERE o.end_date IS NOT NULL ${dateFilter}
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

router.get('/maintenance-overview', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT type, status, COUNT(*) as count, AVG(downtime_hours) as avg_downtime, SUM(cost) as total_cost
      FROM maintenance_records WHERE 1=1`;
    const replacements = {};
    
    if (from) {
      query += ` AND scheduled_date >= :startDate`;
      replacements.startDate = from;
    }
    if (to) {
      query += ` AND scheduled_date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY type, status`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

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
    }
    if (to) {
      query += ` AND movement_date <= :endDate`;
      replacements.endDate = to;
    }
    query += ` GROUP BY DATE(movement_date), type ORDER BY date`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.get('/task-completion', parseDateFilter, async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT interval_type, status, COUNT(*) as count,
             AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avg_completion_hours
      FROM tasks WHERE completed_at IS NOT NULL
      GROUP BY interval_type, status`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.get('/shift-coverage', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    let query = `
      SELECT s.date, st.name as shift_name, st.color, COUNT(s.id) as employees,
             SUM(CASE WHEN s.status='ABSENT' THEN 1 ELSE 0 END) as absences
      FROM shifts s JOIN shift_types st ON s.shift_type_id = st.id
      WHERE 1=1`;
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
    query += ` GROUP BY s.date, st.id, st.name, st.color ORDER BY s.date`;
    
    const [rows] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
