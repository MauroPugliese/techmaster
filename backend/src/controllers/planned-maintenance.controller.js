// =============================================================================
// controllers/planned-maintenance.controller.js
// Full CRUD + recurrence expansion for calendar & date endpoints
// =============================================================================
const { Op } = require('sequelize');

// ─── Recurrence Engine ───────────────────────────────────────────────────────

/**
 * Check if a task occurs on a given date, considering its repeat settings.
 * @param {object} task - the task row
 * @param {Date} targetDate - the date to check
 * @returns {boolean}
 */
function taskOccursOnDate(task, targetDate) {
  const start = new Date(task.operation_date_start);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  // Task can't occur before its start
  if (target < startDay) return false;

  const diffMs = target.getTime() - startDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const type = task.repeat_task_type;
  const interval = task.repeat_task_number || 1;

  if (type === 'DAY') {
    return diffDays % interval === 0;
  }

  if (type === 'WEEK') {
    // Same weekday and correct week interval
    if (start.getDay() !== targetDate.getDay()) return false;
    const diffWeeks = Math.round(diffDays / 7);
    return diffWeeks % interval === 0;
  }

  if (type === 'MONTH') {
    // Same day of month and correct month interval
    if (start.getDate() !== targetDate.getDate()) return false;
    const diffMonths = (targetDate.getFullYear() - start.getFullYear()) * 12 + (targetDate.getMonth() - start.getMonth());
    return diffMonths >= 0 && diffMonths % interval === 0;
  }

  return false;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

const getAll = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const {
      system, subsystem, status, repeat_task_type,
      search, page = 1, limit = 200,
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

/**
 * GET /date/:date — returns ALL tasks that recur on this date (expanded)
 */
const getByDate = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const targetDate = new Date(date + 'T00:00:00');

    // Get all tasks that started on or before this date
    const allTasks = await PlannedMaintenanceTask.findAll({
      where: {
        operation_date_start: { [Op.lte]: new Date(date + 'T23:59:59') }
      },
      order: [['operation_date_start', 'ASC']]
    });

    // Filter by recurrence
    const matchingTasks = allTasks.filter(t => taskOccursOnDate(t, targetDate));

    res.json({ success: true, data: matchingTasks });
  } catch (err) { next(err); }
};

/**
 * GET /calendar/:year/:month — returns indicators for each day with recurring tasks
 */
const getCalendarIndicators = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const { year, month } = req.params;

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ success: false, message: 'Invalid year or month.' });
    }

    const endOfMonth = new Date(Date.UTC(y, m, 0)); // last day of month
    const daysInMonth = endOfMonth.getUTCDate();

    // Get all tasks that started on or before end of this month
    const allTasks = await PlannedMaintenanceTask.findAll({
      where: {
        operation_date_start: { [Op.lte]: endOfMonth }
      }
    });

    // For each day of the month, check which tasks occur
    const COLOR_MAP = { DAY: '#0288D1', WEEK: '#F59E0B', MONTH: '#EF4444' };
    const COLOR_DONE = '#10B981';
    const indicators = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const targetDate = new Date(y, m - 1, day);

      allTasks.forEach(t => {
        if (!taskOccursOnDate(t, targetDate)) return;

        if (!indicators[day]) indicators[day] = {};
        const color = t.status === 'DONE' ? COLOR_DONE : (COLOR_MAP[t.repeat_task_type] || '#64748b');
        if (!indicators[day][color]) indicators[day][color] = 0;
        indicators[day][color]++;
      });
    }

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