const { Op, col } = require('sequelize');
const { sequelize, Operation, MaintenanceRecord, InventoryItem, Shift, Task, User, OperationType } = require('../models');

exports.getKPIs = async (req, res, next) => {
  try {
    const { from, to } = req.dateRange || {};
    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = from;
      if (to)   where.created_at[Op.lte] = to;
    }

    const [totalOps, activeOps, pendingMaint, lowStockCount, openTasks, activeUsers] = await Promise.all([
      Operation.count({ where }),
      Operation.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      MaintenanceRecord.count({ where: { ...where, status: ['SCHEDULED','IN_PROGRESS'] } }),
      InventoryItem.count({ where: { quantity: { [Op.lte]: col('reorder_point') }, is_active: true } }),
      Task.count({ where: { ...where, status: ['TODO','IN_PROGRESS'] } }),
      User.count({ where: { is_active: true } })
    ]);

    const [opsTrend] = await sequelize.query(`
      SELECT DATE(start_date) as date, COUNT(*) as count, status
      FROM operations WHERE start_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(start_date), status ORDER BY date`);

    const [taskStats] = await sequelize.query(`
      SELECT interval_type, status, COUNT(*) as count
      FROM tasks WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY interval_type, status`);

    res.json({
      success: true,
      data: { kpis: { totalOps, activeOps, pendingMaint, lowStockCount, openTasks, activeUsers }, opsTrend, taskStats }
    });
  } catch (err) { next(err); }
};

exports.getRecentActivity = async (req, res, next) => {
  try {
    const [ops, maintenance, tasks] = await Promise.all([
      Operation.findAll({ limit: 5, order: [['created_at','DESC']], include: [{ model: OperationType, as: 'type' }] }),
      MaintenanceRecord.findAll({ limit: 5, order: [['created_at','DESC']] }),
      Task.findAll({ limit: 5, order: [['updated_at','DESC']] })
    ]);
    res.json({ success: true, data: { operations: ops, maintenance, tasks } });
  } catch (err) { next(err); }
};
