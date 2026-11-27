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
const { getHiddenSectionKeysForUser } = require('../middleware/section-access.middleware');

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

    const hiddenSections = await getHiddenSectionKeysForUser(req.user);
    const canSee = (key) => !hiddenSections.has(key);
    const isViewer = req.user?.role?.name === 'viewer';

    const pattern = `%${escapeLikePattern(query)}%`;
    const limit = 5;

    const [simulators, operations, maintenance, assets, inventory, tasks, wiki] = await Promise.all([
      canSee('simulators') ? Simulator.findAll({
        where: {
          [Op.or]: [
            { code: { [Op.like]: pattern } },
            { name: { [Op.like]: pattern } },
            { bay_code: { [Op.like]: pattern } },
            { aircraft_type: { [Op.like]: pattern } },
            { serial_number: { [Op.like]: pattern } },
            { certificate_code: { [Op.like]: pattern } },
            { scheduling_mode: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'code', 'name', 'bay_code', 'aircraft_type', 'qualification_level', 'scheduling_mode', 'status'],
        order: [['bay_code', 'ASC']],
        limit
      }) : Promise.resolve([]),
      canSee('operations') ? Operation.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { sortie_code: { [Op.like]: pattern } },
            { customer_operator: { [Op.like]: pattern } },
            { mission_name: { [Op.like]: pattern } },
            { instructor_name: { [Op.like]: pattern } },
            { pilot_name: { [Op.like]: pattern } },
            { copilot_name: { [Op.like]: pattern } },
            { scenario_code: { [Op.like]: pattern } },
            { location: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'sortie_code', 'title', 'customer_operator', 'mission_name', 'instructor_name', 'pilot_name', 'copilot_name', 'scenario_code', 'status', 'priority', 'location'],
        order: [['updated_at', 'DESC']],
        limit
      }) : Promise.resolve([]),
      canSee('maintenance') ? MaintenanceRecord.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } },
            { part_number: { [Op.like]: pattern } },
            { broken_serial_number: { [Op.like]: pattern } },
            { new_serial_number: { [Op.like]: pattern } }
          ]
        },
        include: [
          { model: Asset, as: 'asset', attributes: ['id', 'name'], required: false },
          { model: Simulator, as: 'simulator', attributes: ['id', 'bay_code', 'code'], required: false }
        ],
        attributes: ['id', 'title', 'status', 'priority', 'type', 'part_number', 'broken_serial_number', 'new_serial_number'],
        order: [['updated_at', 'DESC']],
        limit
      }) : Promise.resolve([]),
      canSee('maintenance') ? Asset.findAll({
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
      }) : Promise.resolve([]),
      canSee('warehouse') ? InventoryItem.findAll({
        where: {
          is_active: true,
          [Op.or]: [
            { name: { [Op.like]: pattern } },
            { sku: { [Op.like]: pattern } },
            { part_number: { [Op.like]: pattern } },
            { serial_number: { [Op.like]: pattern } },
            { rma_reference: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'name', 'sku', 'part_number', 'serial_number', 'quantity', 'unit', 'reorder_point'],
        order: [['updated_at', 'DESC']],
        limit
      }) : Promise.resolve([]),
      canSee('tasks') ? Task.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'title', 'status', 'priority', 'interval_type'],
        order: [['updated_at', 'DESC']],
        limit
      }) : Promise.resolve([]),
      canSee('wiki') ? WikiArticle.findAll({
        where: {
          ...(isViewer ? { status: 'PUBLISHED' } : {}),
          [Op.or]: [
            { title: { [Op.like]: pattern } },
            { slug: { [Op.like]: pattern } },
            { excerpt: { [Op.like]: pattern } }
          ]
        },
        attributes: ['id', 'title', 'slug', 'excerpt', 'status'],
        order: [['updated_at', 'DESC']],
        limit
      }) : Promise.resolve([])
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

    const hiddenSections = await getHiddenSectionKeysForUser(req.user);
    const canSee = (key) => !hiddenSections.has(key);

    const [simulators, operations, maintenance, plannedTodayTasks, warehouse, tasks, notifications] = await Promise.all([
      canSee('simulators') ? Simulator.count({
        where: { status: { [Op.in]: ['AOG', 'DEGRADED'] } }
      }) : Promise.resolve(0),
      canSee('operations') ? Operation.count({
        where: { status: { [Op.in]: ['PLANNED', 'IN_PROGRESS'] } }
      }) : Promise.resolve(0),
      canSee('maintenance') ? MaintenanceRecord.count({
        where: { status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] } }
      }) : Promise.resolve(0),
      canSee('maintenance') ? getTasksForDate(todayStr).catch(() => []) : Promise.resolve([]),
      canSee('warehouse') ? InventoryItem.count({
        where: {
          is_active: true,
          [Op.and]: [where(col('quantity'), '<=', fn('GREATEST', fn('COALESCE', col('reorder_point'), 0), fn('COALESCE', col('min_stock'), 0)))]
        }
      }) : Promise.resolve(0),
      canSee('tasks') ? Task.count({
        where: { status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] } }
      }) : Promise.resolve(0),
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
