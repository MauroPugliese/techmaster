// =============================================================================
// routes/dashboard.routes.js  — FIXED:
//   • lowStockCount: replaced broken col('reorder_point') with literal()
// =============================================================================
const router = require('express').Router();
const { parseDateFilter } = require('../middleware/error.middleware');
const { sequelize, Operation, MaintenanceRecord, InventoryItem, Task, User, OperationType } = require('../models');
const { Op, literal } = require('sequelize');   // ← literal replaces col

router.get('/kpis', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = from;
      if (to)   where.created_at[Op.lte] = to;
    }

    const [totalOps, activeOps, pendingMaint, lowStockCount, openTasks, activeUsers] = await Promise.all([
      Operation.count({ where }),
      Operation.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      MaintenanceRecord.count({ where: { ...where, status: { [Op.in]: ['SCHEDULED','IN_PROGRESS'] } } }),
      // FIXED: literal() for column-to-column comparison — col() crashes here
      InventoryItem.count({
        where: {
          is_active: true,
          [Op.and]: literal('quantity <= reorder_point')
        }
      }),
      Task.count({ where: { ...where, status: { [Op.in]: ['TODO','IN_PROGRESS'] } } }),
      User.count({ where: { is_active: true } })
    ]);

    const [opsTrend] = await sequelize.query(`
      SELECT DATE(start_date) as date, COUNT(*) as count, status
      FROM operations
      WHERE start_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(start_date), status
      ORDER BY date`);

    const [taskTrend] = await sequelize.query(`
      SELECT DATE(due_date) as date, COUNT(*) as count, status
      FROM tasks
      WHERE due_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(due_date), status
      ORDER BY date`);

    const [maintenanceTrend] = await sequelize.query(`
      SELECT DATE(scheduled_date) as date, COUNT(*) as count, status
      FROM maintenance_records
      WHERE scheduled_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(scheduled_date), status
      ORDER BY date`);

    res.json({
      success: true,
      data: {
        kpis: { totalOps, activeOps, pendingMaint, lowStockCount, openTasks, activeUsers },
        opsTrend,
        taskTrend,
        maintenanceTrend
      }
    });
  } catch (err) { next(err); }
});

router.get('/recent-activity', async (req, res, next) => {
  try {
    const ops   = await Operation.findAll({
      limit: 5, order: [['created_at','DESC']],
      include: [{ model: OperationType, as: 'type' }]
    });
    const maint = await MaintenanceRecord.findAll({ limit: 5, order: [['created_at','DESC']] });
    const tasks = await Task.findAll({ limit: 5, order: [['updated_at','DESC']] });
    res.json({ success: true, data: { operations: ops, maintenance: maint, tasks } });
  } catch (err) { next(err); }
});

module.exports = router;
