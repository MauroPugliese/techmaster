const router = require('express').Router();
const { Op, col, fn, where } = require('sequelize');
const {
  Simulator,
  Operation,
  MaintenanceRecord,
  Asset,
  InventoryItem,
  Task,
  WikiArticle,
  Notification
} = require('../models');
const {
  MIN_QUERY_LENGTH,
  normalizeSearchQuery,
  escapeLikePattern,
  normalizeNavBadges,
  buildSearchGroups
} = require('../services/search-helpers.service');
const { getTasksForDate } = require('../services/planned-recurrence.service');

// GET /api/search?q=...
router.get('/', async (req, res, next) => {
  try {
    const query = normalizeSearchQuery(req.query.q);
    if (query.length < MIN_QUERY_LENGTH) {
      return res.json({
        success: true,
        data: { query, total: 0, groups: [] }
      });
    }

    const pattern = `%${escapeLikePattern(query)}%`;
    const limit = 5;

    const [simulators, operations, maintenance, assets, inventory, tasks, wiki] = await Promise.all([
      Simulator.findAll({
        where: {
          [Op.or]: [
            { code: { [Op.like]: pattern } },
            { name: { [Op.like]: pattern } },
            { bay_code: { [Op.like]: pattern } },
            { aircraft_type: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'code', 'name', 'bay_code', 'aircraft_type', 'qualification_level', 'status'],
        order: [['bay_code', 'ASC']],
        limit
      }),
      Operation.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { sortie_code: { [Op.like]: pattern } },
            { customer_operator: { [Op.like]: pattern } },
            { location: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'sortie_code', 'title', 'customer_operator', 'status', 'priority', 'location'],
        order: [['updated_at', 'DESC']],
        limit
      }),
      MaintenanceRecord.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } }
          ]
        },
        include: [{ model: Asset, as: 'asset', attributes: ['id', 'name'], required: false }],
        attributes: ['id', 'title', 'status', 'priority', 'type'],
        order: [['updated_at', 'DESC']],
        limit
      }),
      Asset.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.like]: pattern } },
            { serial_number: { [Op.like]: pattern } },
            { location: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'name', 'serial_number', 'location', 'status'],
        order: [['updated_at', 'DESC']],
        limit
      }),
      InventoryItem.findAll({
        where: {
          is_active: true,
          [Op.or]: [
            { name: { [Op.like]: pattern } },
            { sku: { [Op.like]: pattern } },
            { part_number: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'name', 'sku', 'part_number', 'quantity', 'unit', 'reorder_point'],
        order: [['updated_at', 'DESC']],
        limit
      }),
      Task.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'title', 'status', 'priority', 'interval_type'],
        order: [['updated_at', 'DESC']],
        limit
      }),
      WikiArticle.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { slug: { [Op.like]: pattern } },
            { excerpt: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'title', 'slug', 'excerpt', 'status'],
        order: [['updated_at', 'DESC']],
        limit
      })
    ]);

    const groups = buildSearchGroups({
      simulators: simulators.map((r) => r.get({ plain: true })),
      operations: operations.map((r) => r.get({ plain: true })),
      maintenance: maintenance.map((r) => r.get({ plain: true })),
      assets: assets.map((r) => r.get({ plain: true })),
      inventory: inventory.map((r) => r.get({ plain: true })),
      tasks: tasks.map((r) => r.get({ plain: true })),
      wiki: wiki.map((r) => r.get({ plain: true }))
    });

    const total = groups.reduce((acc, g) => acc + g.items.length, 0);

    res.json({
      success: true,
      data: { query, total, groups }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/search/nav-badges
router.get('/nav-badges', async (req, res, next) => {
  try {
    const rawDate = String(req.query.date || '').trim();
    const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

    const [simulators, operations, maintenance, plannedTodayTasks, warehouse, tasks, notifications] = await Promise.all([
      Simulator.count({
        where: { status: { [Op.in]: ['AOG', 'DEGRADED'] } }
      }),
      Operation.count({
        where: { status: { [Op.in]: ['PLANNED', 'IN_PROGRESS'] } }
      }),
      MaintenanceRecord.count({
        where: { status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] } }
      }),
      getTasksForDate(todayStr).catch(() => []),
      InventoryItem.count({
        where: {
          is_active: true,
          [Op.and]: [where(col('quantity'), '<=', fn('COALESCE', col('reorder_point'), 0))]
        }
      }),
      Task.count({
        where: { status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] } }
      }),
      Notification.count({
        where: { user_id: req.user.id, is_read: false }
      })
    ]);

    const plannedMaintenance = (plannedTodayTasks || []).filter(
      (occ) => String(occ.status || 'TODO').toUpperCase() !== 'DONE'
    ).length;

    res.json({
      success: true,
      data: normalizeNavBadges({
        simulators,
        operations,
        maintenance,
        plannedMaintenance,
        warehouse,
        tasks,
        notifications
      })
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
