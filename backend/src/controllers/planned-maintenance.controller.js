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
  expandOccurrencesInRange,
  buildMonthRange
} = require('../services/planned-recurrence.service');
const {
  sanitizeMaintenancePayload,
  summarizePlannedMonth
} = require('../services/maintenance-helpers.service');

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
  const rawSimId = body.simulator_id ?? body.simulatorId;
  let normalizedSimId;
  if (rawSimId !== undefined) {
    if (rawSimId === null || rawSimId === '') {
      normalizedSimId = null;
    } else {
      const parsedSim = Number(rawSimId);
      if (Number.isInteger(parsedSim) && parsedSim > 0) {
        normalizedSimId = parsedSim;
      }
    }
  }

  const map = {
    simulator_id: normalizedSimId,
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

const getSystems = async (req, res, next) => {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT DISTINCT TRIM(\`system\`) AS system_name
       FROM planned_maintenance_tasks
       WHERE deleted_at IS NULL AND \`system\` IS NOT NULL AND TRIM(\`system\`) <> ''
       ORDER BY system_name ASC`
    );
    res.json({ success: true, data: rows.map(r => r.system_name) });
  } catch (err) { next(err); }
};

const getSummary = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getUTCFullYear();
    const month = parseInt(req.query.month, 10) || (now.getUTCMonth() + 1);
    const { start, end } = buildMonthRange(year, month);
    const todayStr = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today)
      ? req.query.today
      : now.toISOString().slice(0, 10);

    const [masters, expandedOccurrences] = await Promise.all([
      PlannedMaintenanceTask.findAll({ attributes: ['id', 'status', 'optional'] }),
      expandOccurrencesInRange(start, end, 35)
    ]);

    res.json({
      success: true,
      data: summarizePlannedMonth({
        masters: masters.map(m => m.get({ plain: true })),
        expandedOccurrences,
        todayStr
      })
    });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask } = require('../models');
    const payload = normalizeTaskPayload(req.body);
    if (payload.operation_date_start && payload.operation_date_end) {
      if (new Date(payload.operation_date_end) < new Date(payload.operation_date_start)) {
        return res.status(400).json({ success: false, message: 'End date must be on or after start date.' });
      }
    }
    const task = await PlannedMaintenanceTask.create({
      ...payload,
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
    const payload = normalizeTaskPayload(req.body);
    const nextStart = payload.operation_date_start ?? task.operation_date_start;
    const nextEnd = payload.operation_date_end ?? task.operation_date_end;
    if (nextStart && nextEnd && new Date(nextEnd) < new Date(nextStart)) {
      return res.status(400).json({ success: false, message: 'End date must be on or after start date.' });
    }
    await task.update(payload);
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
};

const updateOccurrence = async (req, res, next) => {
  const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance, sequelize } = require('../models');
  const transaction = await sequelize.transaction();
  try {
    const master = await PlannedMaintenanceTask.findByPk(req.params.id, { transaction });
    if (!master) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Planned task not found' });
    }

    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const [y, m, d] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const existingRecord = await PlannedMaintenanceTaskInstance.findOne({
      where: {
        planned_task_id: master.id,
        occurrence_date: date
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const canOverride = taskOccursOnDate(master, targetDate) || !!existingRecord;

    if (!canOverride) {
      await transaction.rollback();
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
      await instance.update(instancePayload, { transaction });
    } else {
      instance = await PlannedMaintenanceTaskInstance.create(instancePayload, { transaction });
    }

    await transaction.commit();
    res.json({ success: true, data: instance });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

const deleteOccurrence = async (req, res, next) => {
  const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance, sequelize } = require('../models');
  const transaction = await sequelize.transaction();
  try {
    const master = await PlannedMaintenanceTask.findByPk(req.params.id, { transaction });
    if (!master) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Planned task not found' });
    }

    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const [y, m, d] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const existingRecord = await PlannedMaintenanceTaskInstance.findOne({
      where: {
        planned_task_id: master.id,
        occurrence_date: date
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!taskOccursOnDate(master, targetDate) && !existingRecord) {
      await transaction.rollback();
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
      }, { transaction });
    } else {
      await PlannedMaintenanceTaskInstance.create({
        planned_task_id: master.id,
        occurrence_date: date,
        exception_type: 'DELETED',
        created_by: req.user.id
      }, { transaction });
    }

    await transaction.commit();
    res.json({ success: true, data: { planned_task_id: master.id, occurrence_date: date, exception_type: 'DELETED' } });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
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

const createWorkOrder = async (req, res, next) => {
  try {
    const { PlannedMaintenanceTask, MaintenanceRecord, Asset, AssetCategory, Simulator, User } = require('../models');
    const planned = await PlannedMaintenanceTask.findByPk(req.params.id);
    if (!planned) return res.status(404).json({ success: false, message: 'Planned task not found' });

    const occDate = typeof req.body?.occurrence_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.occurrence_date)
      ? req.body.occurrence_date
      : null;

    const defaultScheduled = req.body?.scheduled_date
      || (occDate ? `${occDate}T09:00:00.000Z` : planned.operation_date_start);

    const resolvedSimulatorId = req.body?.simulator_id ?? planned.simulator_id ?? null;

    const candidateBody = {
      asset_id: req.body?.asset_id,
      simulator_id: resolvedSimulatorId,
      subsystem_code: req.body?.subsystem_code,
      type: req.body?.type || 'PREVENTIVE',
      priority: req.body?.priority || 'MEDIUM',
      status: req.body?.status || 'SCHEDULED',
      title: req.body?.title || `${planned.system}: ${String(planned.task || '').slice(0, 150)}`.slice(0, 200),
      description: req.body?.description || [
        `Generated from Planned Maintenance #${planned.id} (${planned.system} / ${planned.subsystem}).`,
        planned.reference ? `Reference: ${planned.reference}` : null,
        occDate ? `Scheduled Occurrence: ${occDate}` : null,
        '',
        planned.task
      ].filter(v => v !== null).join('\n'),
      scheduled_date: defaultScheduled
    };

    const { data, error } = sanitizeMaintenancePayload(candidateBody, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await MaintenanceRecord.create({
      ...data,
      performed_by: req.user.id
    });

    const full = await MaintenanceRecord.findByPk(created.id, {
      include: [
        { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }] },
        { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'bay_code', 'name', 'station_kind'] },
        { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name', 'username'] }
      ]
    });

    res.status(201).json({ success: true, data: full || created });
  } catch (err) { next(err); }
};

module.exports = {
  getAll,
  getSystems,
  getSummary,
  getById,
  getByDate,
  getCalendarIndicators,
  create,
  update,
  createWorkOrder,
  updateOccurrence,
  deleteOccurrence,
  remove
};
