// =============================================================================
// exports/modules/tasks.js — Tasks report
// =============================================================================
const { Op } = require('sequelize');
const { Task, User } = require('../../models');
const { fmtDateTime, fullName, dash, parseRange, rangeLabel, cleanText } = require('../core/helpers');

const STATUS_FLAG = { DONE: 'success', OVERDUE: 'danger', CANCELLED: 'muted', IN_PROGRESS: 'success', REVIEW: 'warning' };

module.exports = {
  key: 'tasks',
  title: 'Tasks Report',
  subtitle: 'Assigned work items, ownership and progress',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, assigned_to } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.due_date = {};
      if (range.from) where.due_date[Op.gte] = range.from;
      if (range.to) where.due_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assigned_to) where.assigned_to = assigned_to;

    const tasks = await Task.findAll({
      where,
      include: [
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] },
        { model: User, as: 'assignee', attributes: ['first_name', 'last_name'] }
      ],
      order: [['due_date', 'ASC']]
    });

    const byStatus = tasks.reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Period (due)', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Priority', value: priority || 'All' },
        { label: 'Total tasks', value: tasks.length }
      ],
      tables: [{
        name: 'Tasks',
        summary: [
          { label: 'Total tasks', value: tasks.length },
          { label: 'Done', value: byStatus.DONE || 0 },
          { label: 'In progress', value: byStatus.IN_PROGRESS || 0 },
          { label: 'Overdue', value: byStatus.OVERDUE || 0 }
        ],
        columns: [
          { header: '#', key: 'id', width: 7, align: 'right' },
          { header: 'Title', key: 'title', width: 34 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Priority', key: 'priority', width: 12 },
          { header: 'Recurrence', key: 'interval', width: 12 },
          { header: 'Due', key: 'due', width: 17 },
          { header: 'Completed', key: 'completed', width: 17 },
          { header: 'Est. (h)', key: 'estimated', width: 9, align: 'right' },
          { header: 'Assignee', key: 'assignee', width: 18 },
          { header: 'Created by', key: 'creator', width: 18 }
        ],
        rows: tasks.map((t) => ({
          id: t.id,
          title: cleanText(t.title),
          status: t.status,
          priority: t.priority,
          interval: t.interval_type,
          due: fmtDateTime(t.due_date),
          completed: fmtDateTime(t.completed_at),
          estimated: dash(t.estimated_hours),
          assignee: fullName(t.assignee, 'Unassigned'),
          creator: fullName(t.creator),
          _flag: t.priority === 'CRITICAL' && t.status !== 'DONE' ? 'danger' : STATUS_FLAG[t.status]
        }))
      }]
    };
  }
};
