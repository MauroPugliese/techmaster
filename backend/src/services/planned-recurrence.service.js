// =============================================================================
// services/planned-recurrence.service.js — Shared Planned Maintenance Recurrence
// -----------------------------------------------------------------------------
// Single source of truth for recurring schedule math, occurrence projection,
// and override/deletion resolution used by PlannedMaintenanceController,
// Daily Template exports, and Planned Maintenance aggregate exports.
// =============================================================================

const { Op } = require('sequelize');

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function buildOccurrenceDateTime(occurrenceDate, baseDateTime) {
  const base = new Date(baseDateTime);
  if (Number.isNaN(base.getTime())) return null;

  const [y, m, d] = String(occurrenceDate).split('-').map(Number);
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
  const simId = task.simulator_id ?? task.simulatorId ?? null;
  return {
    id: task.id,
    simulator_id: simId,
    simulatorId: simId,
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
    optional: Boolean(task.optional ?? false),
    createdBy: task.created_by ?? task.createdBy ?? null,
    isOccurrence: false,
    masterId: task.id,
    instanceId: null,
    occurrenceDate: null,
    exceptionType: null
  };
}

/**
 * Project a master task onto `occurrenceDate`, applying an instance override if
 * present or returning null when that date is marked DELETED.
 */
function normalizeOccurrence(master, occurrenceDate, instance) {
  if (instance && instance.exception_type === 'DELETED') return null;

  const source = instance || master;
  const masterStart = new Date(master.operation_date_start ?? master.operationDateStart);
  const masterEnd = new Date(master.operation_date_end ?? master.operationDateEnd);
  if (Number.isNaN(masterStart.getTime()) || Number.isNaN(masterEnd.getTime())) return null;

  const baseDurationMs = Math.max(0, masterEnd.getTime() - masterStart.getTime());

  const occurrenceStart = (instance && instance.operation_date_start)
    ? new Date(instance.operation_date_start)
    : buildOccurrenceDateTime(occurrenceDate, masterStart);

  if (!occurrenceStart || Number.isNaN(occurrenceStart.getTime())) return null;

  const occurrenceEnd = (instance && instance.operation_date_end)
    ? new Date(instance.operation_date_end)
    : addDuration(occurrenceStart, baseDurationMs);

  return {
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
    optional: Boolean(source.optional ?? master.optional ?? false)
  };
}

/**
 * Check if a master task recurs on `targetDate` (UTC day comparison).
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

    if (target < startDay) return false;

    const diffDays = Math.round((target.getTime() - startDay.getTime()) / DAY_MS);
    const type = task.repeat_task_type ?? task.repeatTaskType;
    const interval = Math.max(1, Number(task.repeat_task_number ?? task.repeatTaskNumber ?? 1));

    if (type === 'DAY') {
      return diffDays % interval === 0;
    }

    if (type === 'WEEK') {
      if (start.getUTCDay() !== target.getUTCDay()) return false;
      const diffWeeks = Math.floor(diffDays / 7);
      return diffWeeks % interval === 0;
    }

    if (type === 'MONTH') {
      const lastDayOfTargetMonth = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
      ).getUTCDate();
      const expectedDay = Math.min(start.getUTCDate(), lastDayOfTargetMonth);
      if (target.getUTCDate() !== expectedDay) return false;
      const diffMonths = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (target.getUTCMonth() - start.getUTCMonth());
      return diffMonths >= 0 && diffMonths % interval === 0;
    }

    return false;
  } catch {
    return false;
  }
}

async function loadSeriesAndInstances(startDate, endDate, masterWhere = {}) {
  const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('../models');

  const queryEnd = `${endDate}T23:59:59.999Z`;

  const masters = await PlannedMaintenanceTask.findAll({
    where: {
      ...masterWhere,
      operation_date_start: { [Op.lte]: queryEnd }
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
    if (seen.has(key) || deletedKeys.has(key)) continue;
    if (instance.occurrence_date !== dateStr) continue;
    const master = masters.find((m) => m.id === instance.planned_task_id);
    if (!master) continue;
    const occurrence = normalizeOccurrence(master, instance.occurrence_date, instance);
    if (occurrence) results.push(occurrence);
  }

  results.sort((a, b) => new Date(a.operationDateStart) - new Date(b.operationDateStart));
  return results;
}

async function getTasksForDate(dateStr) {
  const { masters, instancesByKey, deletedKeys } = await loadSeriesAndInstances(dateStr, dateStr);
  return resolveOccurrencesForDate(dateStr, masters, instancesByKey, deletedKeys);
}

/**
 * Expand all recurring occurrences within an inclusive [startDate, endDate]
 * range (capped safely at `maxDays` to prevent unbounded expansions).
 */
async function expandOccurrencesInRange(startDateStr, endDateStr, maxDays = 93, masterWhere = {}) {
  const start = toUtcDateOnly(startDateStr);
  const end = toUtcDateOnly(endDateStr);
  if (!start || !end || end < start) return [];

  const diffDays = Math.min(maxDays - 1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const clampedEnd = new Date(start.getTime() + diffDays * DAY_MS);
  const clampedEndStr = formatDateOnly(clampedEnd);

  const { masters, instancesByKey, deletedKeys } = await loadSeriesAndInstances(startDateStr, clampedEndStr, masterWhere);
  const expanded = [];

  for (let i = 0; i <= diffDays; i += 1) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const dateStr = formatDateOnly(d);
    const dayTasks = resolveOccurrencesForDate(dateStr, masters, instancesByKey, deletedKeys);
    expanded.push(...dayTasks);
  }

  return expanded;
}

function buildMonthRange(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = formatDateOnly(endDate);
  return { y, m, start, end, endOfMonth: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
}

module.exports = {
  DAY_MS,
  toUtcDateOnly,
  formatDateOnly,
  buildOccurrenceDateTime,
  addDuration,
  normalizeMasterTask,
  normalizeOccurrence,
  taskOccursOnDate,
  loadSeriesAndInstances,
  resolveOccurrencesForDate,
  getTasksForDate,
  expandOccurrencesInRange,
  buildMonthRange
};
