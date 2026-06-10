// =============================================================================
// controllers/planned-maintenance.controller.js
// Full CRUD + recurrence expansion for calendar & date endpoints
// =============================================================================
const { Op } = require('sequelize');

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function buildOccurrenceDateTime(occurrenceDate, baseDateTime) {
  const base = new Date(baseDateTime);
  if (Number.isNaN(base.getTime())) return null;

  const [y, m, d] = occurrenceDate.split('-').map(Number);
  return new Date(Date.UTC(
    y, m - 1, d,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  ));
}

function addDuration(startDate, durationMs) {
  return new Date(startDate.getTime() + durationMs);
}

function normalizeMasterTask(task) {
  return {
    id: task.id,
    system: task.system,
    subsystem: task.subsystem,
    task: task.task,
    reference: task.reference ?? '',
    operationDateStart: task.operation_date_start ?? task.operationDateStart ?? '',
    operationDateEnd: task.operation_date_end ?? task.operationDateEnd ?? '',
    repeatTaskType: task.repeat_task_type ?? task.repeatTaskType ?? 'WEEK',
    repeatTaskNumber: task.repeat_task_number ?? task.repeatTaskNumber ?? 1,
    recurrenceEndDate: task.recurrence_end_date ?? task.recurrenceEndDate ?? null,
    reportTemplate: task.report_template ?? task.reportTemplate ?? '',
    status: task.status ?? 'TODO',
    optional: task.optional ?? false,
    createdBy: task.created_by ?? task.createdBy ?? null,
    isOccurrence: false,
    masterId: task.id,
    instanceId: null,
    occurrenceDate: null,
    exceptionType: null
  };
}

function normalizeOccurrence(master, occurrenceDate, instance) {
  if (instance && instance.exception_type === 'DELETED') return null;

  const source = instance || master;
  const baseStart = new Date(source.operation_date_start ?? master.operation_date_start);
  const baseEnd = new Date(source.operation_date_end ?? master.operation_date_end);
  if (Number.isNaN(baseStart.getTime()) || Number.isNaN(baseEnd.getTime())) return null;

  const occurrenceStart = source.operation_date_start
    ? new Date(source.operation_date_start)
    : buildOccurrenceDateTime(occurrenceDate, master.operation_date_start);

  if (!occurrenceStart || Number.isNaN(occurrenceStart.getTime())) return null;

  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const occurrenceEnd = source.operation_date_end
    ? new Date(source.operation_date_end)
    : addDuration(occurrenceStart, durationMs);

  const serialized = {
    ...normalizeMasterTask(master),
    id: source.id ?? master.id,
    masterId: master.id,
    instanceId: instance ? instance.id : null,
    isOccurrence: !!instance,
    occurrenceDate,
    exceptionType: instance ? instance.exception_type : null,
    system: source.system ?? master.system,
    subsystem: source.subsystem ?? master.subsystem,
    task: source.task ?? master.task,
    reference: source.reference ?? master.reference ?? '',
    operationDateStart: occurrenceStart.toISOString(),
    operationDateEnd: occurrenceEnd.toISOString(),
    repeatTaskType: source.repeat_task_type ?? master.repeat_task_type ?? 'WEEK',
    repeatTaskNumber: source.repeat_task_number ?? master.repeat_task_number ?? 1,
    recurrenceEndDate: source.recurrence_end_date ?? master.recurrence_end_date ?? null,
    reportTemplate: source.report_template ?? master.report_template ?? '',
    status: source.status ?? master.status ?? 'TODO',
    optional: source.optional ?? master.optional ?? false
  };

  return serialized;
}

function buildMonthRange(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = formatDateOnly(endDate);
  return { y, m, start, end, endOfMonth: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
}

// ─── Recurrence Engine ───────────────────────────────────────────────────────

/**
 * Check if a task occurs on a given date, considering its repeat settings.
 * @param {object} task - the task row
 * @param {Date} targetDate - the date to check
 * @returns {boolean}
 */
function taskOccursOnDate(task, targetDate) {
  try {
    const start = new Date(task.operation_date_start ?? task.operationDateStart);
    if (Number.isNaN(start.getTime())) return false;
    const startDay = toUtcDateOnly(start);
    const target = toUtcDateOnly(targetDate);
    if (!startDay || !target) return false;

    const recurrenceEnd = task.recurrence_end_date ?? task.recurrenceEndDate;
    if (recurrenceEnd) {
      const end = toUtcDateOnly(recurrenceEnd);
      if (end && target > end) return false;
    }

    // Task can't occur before its start
    if (target < startDay) return false;

    const diffDays = Math.round((target.getTime() - startDay.getTime()) / DAY_MS);

    const type = task.repeat_task_type ?? task.repeatTaskType;
    const interval = task.repeat_task_number ?? task.repeatTaskNumber ?? 1;

    if (type === 'DAY') {
      return diffDays % interval === 0;
    }

    if (type === 'WEEK') {
      // Same weekday and correct week interval
      if (start.getUTCDay() !== target.getUTCDay()) return false;
      const diffWeeks = Math.floor(diffDays / 7);
      return diffWeeks % interval === 0;
    }

    if (type === 'MONTH') {
      // Same day of month and correct month interval
      if (start.getUTCDate() !== target.getUTCDate()) return false;
      const diffMonths = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + (target.getUTCMonth() - start.getUTCMonth());
      return diffMonths >= 0 && diffMonths % interval === 0;
    }

    return false;
  } catch {
    return false;
  }
}

async function loadSeriesAndInstances(startDate, endDate) {
  const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('../models');

  const masters = await PlannedMaintenanceTask.findAll({
    where: {
      operation_date_start: { [Op.lte]: endDate }
    },
    order: [['operation_date_start', 'ASC']]
  });

  const instances = await PlannedMaintenanceTaskInstance.findAll({
    where: {
      occurrence_date: { [Op.between]: [startDate, endDate] }
    },
    order: [['occurrence_date', 'ASC'], ['updated_at', 'DESC']]
  });

  const instancesByKey = new Map();
  const deletedKeys = new Set();

  for (const instance of instances) {
    const key = `${instance.planned_task_id}|${instance.occurrence_date}`;
    if (instance.exception_type === 'DELETED') {
      deletedKeys.add(key);
      continue;
    }
    if (!instancesByKey.has(key)) instancesByKey.set(key, instance);
  }

  return { masters, instancesByKey, deletedKeys };
}

function resolveOccurrencesForDate(dateStr, masters, instancesByKey, deletedKeys) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d));
  const results = [];
  const seen = new Set();

  for (const master of masters) {
    const key = `${master.id}|${dateStr}`;
    const instance = instancesByKey.get(key);

    if (deletedKeys.has(key)) continue;
    if (!taskOccursOnDate(master, targetDate) && !instance) continue;

    const occurrence = normalizeOccurrence(master, dateStr, instance);
    if (!occurrence) continue;

    results.push(occurrence);
    seen.add(key);
  }

  for (const [key, instance] of instancesByKey.entries()) {
    if (seen.has(key)) continue;
    if (deletedKeys.has(key)) continue;
    const master = masters.find((m) => m.id === instance.planned_task_id);
    if (!master) continue;
    const occurrence = normalizeOccurrence(master, instance.occurrence_date, instance);
    if (occurrence) results.push(occurrence);
  }

  results.sort((a, b) => new Date(a.operationDateStart) - new Date(b.operationDateStart));
  return results;
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

    // For each day of the month, check which tasks occur
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
