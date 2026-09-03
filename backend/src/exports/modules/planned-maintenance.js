// =============================================================================
// exports/modules/planned-maintenance.js — Planned maintenance (master + occurrences)
// =============================================================================
const { Op } = require('sequelize');
const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance, User } = require('../../models');
const { fmtDateTime, fmtDate, fullName, dash, parseRange, rangeLabel, cleanText } = require('../core/helpers');

module.exports = {
  key: 'planned-maintenance',
  title: 'Planned Maintenance Report',
  subtitle: 'Recurring maintenance master schedule and generated occurrences',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { status } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.operation_date_start = {};
      if (range.from) where.operation_date_start[Op.gte] = range.from;
      if (range.to) where.operation_date_start[Op.lte] = range.to;
    }
    if (status) where.status = status;

    const tasks = await PlannedMaintenanceTask.findAll({
      where,
      include: [{ model: User, as: 'creator', attributes: ['first_name', 'last_name'] }],
      order: [['operation_date_start', 'ASC']]
    });

    const occurrences = await PlannedMaintenanceTaskInstance.findAll({
      include: [{ model: PlannedMaintenanceTask, as: 'master', attributes: ['system', 'subsystem'] }],
      order: [['occurrence_date', 'ASC']]
    });

    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'DONE').length;
    const completion = total ? ((done / total) * 100).toFixed(1) : '0.0';
    const byType = tasks.reduce((a, t) => { const k = t.repeat_task_type || '—'; a[k] = (a[k] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Master tasks', value: total },
        { label: 'Occurrences (overrides)', value: occurrences.length }
      ],
      tables: [
        {
          name: 'Master Schedule',
          summary: [
            { label: 'Total master tasks', value: total },
            { label: 'Completed (DONE)', value: done },
            { label: 'Open (TODO)', value: total - done },
            { label: 'Completion rate', value: `${completion}%` },
            { label: 'Recurrence mix', value: `DAY ${byType.DAY || 0} · WEEK ${byType.WEEK || 0} · MONTH ${byType.MONTH || 0}` }
          ],
          columns: [
            { header: 'System', key: 'system', width: 18 },
            { header: 'Subsystem', key: 'subsystem', width: 18 },
            { header: 'Task', key: 'task', width: 36 },
            { header: 'Reference', key: 'reference', width: 16 },
            { header: 'Start', key: 'start', width: 17 },
            { header: 'End', key: 'end', width: 17 },
            { header: 'Repeat', key: 'repeat', width: 14 },
            { header: 'Status', key: 'status', width: 11 },
            { header: 'Optional', key: 'optional', width: 10 },
            { header: 'Created by', key: 'creator', width: 18 }
          ],
          rows: tasks.map((t) => ({
            system: t.system,
            subsystem: t.subsystem,
            task: cleanText(t.task),
            reference: dash(t.reference),
            start: fmtDateTime(t.operation_date_start),
            end: fmtDateTime(t.operation_date_end),
            repeat: `every ${t.repeat_task_number} ${t.repeat_task_type}`,
            status: t.status,
            optional: t.optional ? 'Yes' : 'No',
            creator: fullName(t.creator),
            _flag: t.status === 'DONE' ? 'success' : undefined
          }))
        },
        {
          name: 'Occurrences',
          note: 'Per-date overrides and exceptions generated from the master schedule.',
          columns: [
            { header: 'Date', key: 'date', width: 14 },
            { header: 'System', key: 'system', width: 18 },
            { header: 'Subsystem', key: 'subsystem', width: 18 },
            { header: 'Exception', key: 'exception', width: 14 },
            { header: 'Task', key: 'task', width: 38 },
            { header: 'Status', key: 'status', width: 11 }
          ],
          rows: occurrences.map((o) => ({
            date: fmtDate(o.occurrence_date),
            system: o.system || o.master?.system || '—',
            subsystem: o.subsystem || o.master?.subsystem || '—',
            exception: o.exception_type,
            task: cleanText(o.task) || '—',
            status: o.status || '—',
            _flag: o.exception_type === 'DELETED' ? 'danger' : (o.status === 'DONE' ? 'success' : undefined)
          }))
        }
      ]
    };
  }
};
