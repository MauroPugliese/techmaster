// =============================================================================
// controllers/planned-maintenance.controller.js
// Full CRUD + recurrence expansion for calendar & date endpoints
// =============================================================================
const { Op } = require('sequelize');
const {
  buildOccurrenceDateTime,
  normalizeMasterTask,
  taskOccursOnDate,
  loadSeriesAndInstances,
  resolveOccurrencesForDate,
  buildMonthRange
} = require('../services/planned-recurrence.service');

const ALLOWED_SORT_COLUMNS = new Set([
  'id',
  'system',
  'subsystem',
  'task',
  'operation_date_start',
  'operation_date_end',
  'repeat_task_type',
  'repeat_task_number',
  'recurrence_end_date',
  'status',
  'created_at'
]);

function normalizeTaskPayload(body) {
  const payload = {};

  const map = {
    system: body.system,
    subsystem: body.subsystem,
    task: body.task,
    reference: body.reference,
    operation_date_start: body.operation_date_start ?? body.operationDateStart,
    operation_date_end: body.operation_date_end ?? body.operationDateEnd,
    repeat_task_type: body.repeat_task_type ?? body.repeatTaskType,
    repeat_task_number: body.repeat_task_number ?? body.repeatTaskNumber,
    recurrence_end_date: body.recurrence_end_date ?? body.recurrenceEndDate,
    report_template: body.report_template ?? body.reportTemplate,
    status: body.status,
    optional: body.optional
  };

  Object.entries(map).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  return payload;
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

    if (system) where.system = system;
    if (subsystem) where.subsystem = subsystem;
    if (status) where.status = status;
    if (repeat_task_type) where.repeat_task_type = repeat_task_type;

    if (search) {
      where[Op.or] = [
        { system: { [Op.like]: `%${search}%` } },
        { subsystem: { [Op.like]: `%${search}%` } },
        { task: { [Op.like]: `%${search}%` } },
        { reference: { [Op.like]: `%${search}%` } }
      ];
    }

    const safeSortBy = ALLOWED_SORT_COLUMNS.has(sort_by) ? sort_by : 'operation_date_start';
    const safeSortDir = String(sort_dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const { count, rows } = await PlannedMaintenanceTask.findAndCountAll({
      where,
      limit: +limit,
      offset: (+page - 1) * +limit,
      order: [[safeSortBy, safeSortDir]]
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
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const { masters, instancesByKey, deletedKeys } = await loadSeriesAndInstances(date, date);
    const matchingTasks = resolveOccurrencesForDate(date, masters, instancesByKey, deletedKeys);

    res.json({ success: true, data: matchingTasks });
  } catch (err) { next(err); }
};

/**
 * GET /calendar/:year/:month — returns indicators for each day with recurring tasks
 */
const getCalendarIndicators = async (req, res, next) => {
  try {
    const { year, month } = req.params;

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ success: false, message: 'Invalid year or month.' });
    }

    const { start, end, endOfMonth, y: yearNum, m: monthNum } = buildMonthRange(year, month);
    const daysInMonth = endOfMonth.getUTCDate();
    const { masters, instancesByKey, deletedKeys } = await loadSeriesAndInstances(start, end);

    const COLOR_MAP = { DAY: '#0288D1', WEEK: '#F59E0B', MONTH: '#EF4444' };
    const COLOR_DONE = '#10B981';
    const indicators = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const tasks = resolveOccurrencesForDate(dateStr, masters, instancesByKey, deletedKeys);
      tasks.forEach((t) => {
        if (!indicators[day]) indicators[day] = {};
        const color = t.status === 'DONE' ? COLOR_DONE : (COLOR_MAP[t.repeatTaskType] || '#64748b');
        if (!indicators[day][color]) indicators[day][color] = 0;
        indicators[day][color]++;
      });
    }

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
      ...normalizeTaskPayload(req.body),
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
    await task.update(normalizeTaskPayload(req.body));
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
};

const updateOccurrence = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('../models');
    const master = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!master) return res.status(404).json({ success: false, message: 'Planned task not found' });

    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const [y, m, d] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const existingRecord = await PlannedMaintenanceTaskInstance.findOne({
      where: {
        planned_task_id: master.id,
        occurrence_date: date
      }
    });
    const canOverride = taskOccursOnDate(master, targetDate) || !!existingRecord;

    if (!canOverride) {
      return res.status(400).json({ success: false, message: 'This date is not a valid occurrence for the selected task.' });
    }

    const payload = normalizeTaskPayload(req.body);
    const masterData = normalizeMasterTask(master);
    const currentStart = existingRecord?.operation_date_start ?? master.operation_date_start;
    const currentEnd = existingRecord?.operation_date_end ?? master.operation_date_end;

    const occurrenceStart = payload.operation_date_start
      ? new Date(payload.operation_date_start)
      : buildOccurrenceDateTime(date, currentStart);
    const occurrenceEnd = payload.operation_date_end
      ? new Date(payload.operation_date_end)
      : buildOccurrenceDateTime(date, currentEnd);

    const instancePayload = {
      planned_task_id: master.id,
      occurrence_date: date,
      exception_type: 'OVERRIDE',
      system: payload.system ?? existingRecord?.system ?? masterData.system,
      subsystem: payload.subsystem ?? existingRecord?.subsystem ?? masterData.subsystem,
      task: payload.task ?? existingRecord?.task ?? masterData.task,
      reference: payload.reference ?? existingRecord?.reference ?? masterData.reference,
      operation_date_start: occurrenceStart?.toISOString?.() || existingRecord?.operation_date_start || master.operation_date_start,
      operation_date_end: occurrenceEnd?.toISOString?.() || existingRecord?.operation_date_end || master.operation_date_end,
      repeat_task_type: payload.repeat_task_type ?? existingRecord?.repeat_task_type ?? masterData.repeatTaskType,
      repeat_task_number: payload.repeat_task_number ?? existingRecord?.repeat_task_number ?? masterData.repeatTaskNumber,
      recurrence_end_date: payload.recurrence_end_date ?? existingRecord?.recurrence_end_date ?? masterData.recurrenceEndDate,
      report_template: payload.report_template ?? existingRecord?.report_template ?? masterData.reportTemplate,
      status: payload.status ?? existingRecord?.status ?? masterData.status,
      optional: payload.optional ?? existingRecord?.optional ?? masterData.optional,
      created_by: req.user.id
    };

    let instance = existingRecord;
    if (instance) {
      await instance.update(instancePayload);
    } else {
      instance = await PlannedMaintenanceTaskInstance.create(instancePayload);
    }

    res.json({ success: true, data: instance });
  } catch (err) { next(err); }
};

const deleteOccurrence = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('../models');
    const master = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!master) return res.status(404).json({ success: false, message: 'Planned task not found' });

    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const [y, m, d] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const existingRecord = await PlannedMaintenanceTaskInstance.findOne({
      where: {
        planned_task_id: master.id,
        occurrence_date: date
      }
    });

    if (!taskOccursOnDate(master, targetDate) && !existingRecord) {
      return res.status(400).json({ success: false, message: 'This date is not a valid occurrence for the selected task.' });
    }

    if (existingRecord) {
      await existingRecord.update({
        exception_type: 'DELETED',
        system: existingRecord.system,
        subsystem: existingRecord.subsystem,
        task: existingRecord.task,
        reference: existingRecord.reference,
        operation_date_start: existingRecord.operation_date_start,
        operation_date_end: existingRecord.operation_date_end,
        repeat_task_type: existingRecord.repeat_task_type,
        repeat_task_number: existingRecord.repeat_task_number,
        recurrence_end_date: existingRecord.recurrence_end_date,
        report_template: existingRecord.report_template,
        status: existingRecord.status,
        optional: existingRecord.optional
      });
    } else {
      await PlannedMaintenanceTaskInstance.create({
        planned_task_id: master.id,
        occurrence_date: date,
        exception_type: 'DELETED',
        created_by: req.user.id
      });
    }

    res.json({ success: true, data: { planned_task_id: master.id, occurrence_date: date, exception_type: 'DELETED' } });
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
  updateOccurrence,
  deleteOccurrence,
  remove
};
