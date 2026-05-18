// =============================================================================
// controllers/planned-maintenance.controller.js
// Full CRUD + calendar indicators endpoint
// =============================================================================
const { Op } = require('sequelize');

const getAll = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const {
      system, subsystem, status, repeat_task_type,
      search, page = 1, limit = 20,
      sort_by = 'operation_date_start', sort_dir = 'ASC'
    } = req.query;

    const where = {};

    if (system)           where.system = system;
    if (subsystem)        where.subsystem = subsystem;
    if (status)           where.status = status;
    if (repeat_task_type) where.repeat_task_type = repeat_task_type;

    if (search) {
      where[Op.or] = [
        { system:    { [Op.like]: `%${search}%` } },
        { subsystem: { [Op.like]: `%${search}%` } },
        { task:      { [Op.like]: `%${search}%` } },
        { reference: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await PlannedMaintenanceTask.findAndCountAll({
      where,
      limit: +limit,
      offset: (+page - 1) * +limit,
      order: [[sort_by, sort_dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC']]
    });

    res.json({
      success: true,
      data: {
        items: rows,
        total: count,
        page: +page,
        limit: +limit
      }
    });
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const task = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Planned task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
};

const getByDate = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const { date } = req.params; // format: YYYY-MM-DD

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay   = new Date(`${date}T23:59:59.999Z`);

    const tasks = await PlannedMaintenanceTask.findAll({
      where: {
        operation_date_start: { [Op.between]: [startOfDay, endOfDay] }
      },
      order: [['operation_date_start', 'ASC']]
    });

    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
};

const getCalendarIndicators = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const { year, month } = req.params;

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ success: false, message: 'Invalid year or month.' });
    }

    const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
    const endOfMonth   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const tasks = await PlannedMaintenanceTask.findAll({
      where: {
        operation_date_start: { [Op.between]: [startOfMonth, endOfMonth] }
      }
    });

    // Build indicators: { day: [ { count, color } ] }
    const indicators = {};
    const COLOR_MAP = {
      DAY: '#0288D1',
      WEEK: '#F59E0B',
      MONTH: '#EF4444'
    };
    const COLOR_DONE = '#10B981';

    tasks.forEach(t => {
      const day = new Date(t.operation_date_start).getUTCDate();
      if (!indicators[day]) indicators[day] = {};

      const color = t.status === 'DONE' ? COLOR_DONE : (COLOR_MAP[t.repeat_task_type] || '#64748b');
      if (!indicators[day][color]) indicators[day][color] = 0;
      indicators[day][color]++;
    });

    // Transform to array format
    const result = {};
    Object.keys(indicators).forEach(day => {
      result[day] = Object.entries(indicators[day]).map(([color, count]) => ({ color, count }));
    });

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const task = await PlannedMaintenanceTask.create({
      ...req.body,
      created_by: req.user.id
    });
    res.status(201).json({ success: true, data: task });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const task = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Planned task not found' });
    await task.update(req.body);
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const task = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Planned task not found' });
    await task.destroy();
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getById,
  getByDate,
  getCalendarIndicators,
  create,
  update,
  remove
};