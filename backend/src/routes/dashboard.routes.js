const router = require('express').Router();
const { parseDateFilter } = require('../middleware/error.middleware');
const { sequelize, Operation, MaintenanceRecord, InventoryItem, Task, User, OperationType, Asset, StockMovement } = require('../models');
const { Op, literal } = require('sequelize');

router.get('/kpis', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = from;
      if (to)   where.created_at[Op.lte] = to;
    }

    const [
      totalOps, activeOps, pendingMaint, lowStockCount, openTasks, activeUsers,
      totalAssets, activeAssets, maintenanceAssets, overdueTasks, criticalMaint
    ] = await Promise.all([
      Operation.count({ where }),
      Operation.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      MaintenanceRecord.count({ where: { ...where, status: { [Op.in]: ['SCHEDULED','IN_PROGRESS'] } } }),
      InventoryItem.count({
        where: {
          is_active: true,
          [Op.and]: literal('quantity <= reorder_point')
        }
      }),
      Task.count({ where: { ...where, status: { [Op.in]: ['TODO','IN_PROGRESS'] } } }),
      User.count({ where: { is_active: true } }),
      Asset.count({ where: { status: { [Op.ne]: 'RETIRED' } } }),
      Asset.count({ where: { status: 'ACTIVE' } }),
      Asset.count({ where: { status: 'UNDER_MAINTENANCE' } }),
      Task.count({
        where: {
          status: { [Op.in]: ['TODO','IN_PROGRESS'] },
          due_date: { [Op.lt]: new Date() }
        }
      }),
      MaintenanceRecord.count({
        where: {
          status: { [Op.in]: ['SCHEDULED','IN_PROGRESS'] },
          priority: { [Op.in]: ['HIGH','CRITICAL'] }
        }
      })
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
        kpis: {
          totalOps,
          activeOps,
          pendingMaint,
          lowStockCount,
          openTasks,
          activeUsers,
          totalAssets,
          activeAssets,
          maintenanceAssets,
          overdueTasks,
          criticalMaint
        },
        opsTrend,
        taskTrend,
        maintenanceTrend
      }
    });
  } catch (err) { next(err); }
});

router.get('/recent-activity', async (req, res, next) => {
  try {
    const [ops, maint, tasks, movements] = await Promise.all([
      Operation.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [{ model: OperationType, as: 'type' }]
      }),
      MaintenanceRecord.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [
          { model: Asset, as: 'asset', attributes: ['id', 'name', 'status'] },
          { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      Task.findAll({
        limit: 8,
        order: [['updated_at', 'DESC']],
        include: [
          { model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name', 'avatar_url'] }
        ]
      }),
      StockMovement.findAll({
        limit: 8,
        order: [['movement_date', 'DESC']],
        include: [
          { model: InventoryItem, as: 'item', attributes: ['id', 'name', 'sku', 'unit'] },
          { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }
        ]
      })
    ]);

    res.json({
      success: true,
      data: {
        operations: ops,
        maintenance: maint,
        tasks,
        movements
      }
    });
  } catch (err) { next(err); }
});

router.get('/urgent-alerts', async (req, res, next) => {
  try {
    const [overdueTasks, criticalMaint, outOfStock] = await Promise.all([
      Task.findAll({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS'] },
          [Op.or]: [
            { due_date: { [Op.lt]: new Date() } },
            { priority: 'CRITICAL' }
          ]
        },
        limit: 5,
        order: [['due_date', 'ASC']],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name'] }]
      }),
      MaintenanceRecord.findAll({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
          priority: { [Op.in]: ['HIGH', 'CRITICAL'] }
        },
        limit: 5,
        order: [['scheduled_date', 'ASC']],
        include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'serial_number'] }]
      }),
      InventoryItem.findAll({
        where: {
          is_active: true,
          quantity: { [Op.lte]: 0 }
        },
        limit: 5,
        order: [['quantity', 'ASC']]
      })
    ]);

    res.json({
      success: true,
      data: {
        overdueTasks,
        criticalMaintenance: criticalMaint,
        outOfStock
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
