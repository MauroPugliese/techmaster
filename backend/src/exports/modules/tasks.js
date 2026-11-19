// =============================================================================
// exports/modules/tasks.js — Team Workload & SLA Delivery Dossier (CAE-TSK-09)
// Blueprint:
//   P1 Cover -> P2 SLA Risk & Team Capacity (Alerts + Gauge KPIs + Assignee Lollipop)
//   -> P3 Assignee Accountability & Priority Mix (ChartPair: Priority HBar + Recurrence Bar + Assignee Table)
//   -> P4+ Tasks Deliverable Register (Curated 6-Col A4 Portrait Table)
// =============================================================================
const { Op } = require('sequelize');
const { Task, User } = require('../../models');
const {
  fmtDate, fmtNumber, fmtHours, fmtPercent, fullName, dash,
  parseRange, rangeLabel, cleanText, toNumber, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  DONE:        'success',
  REVIEW:      'teal',
  IN_PROGRESS: 'info',
  TODO:        'neutral',
  OVERDUE:     'danger',
  CANCELLED:   'danger'
};

const PRIORITY_COLORS = {
  CRITICAL: COLORS.coral,
  HIGH:     COLORS.amber,
  MEDIUM:   COLORS.accent,
  LOW:      COLORS.teal
};

function buildTaskAlerts(overdueCount, criticalOpen, unassignedCount, totalEst, totalActual) {
  const alerts = [];
  if (overdueCount > 0) {
    alerts.push({
      severity: 'danger',
      title: `${fmtNumber(overdueCount)} Task${overdueCount > 1 ? 's' : ''} Exceeded SLA Due Date`,
      detail: 'Past-due items remain unresolved. Immediate re-prioritization or owner reallocation advised.'
    });
  }
  if (criticalOpen > 0) {
    alerts.push({
      severity: 'warning',
      title: `${fmtNumber(criticalOpen)} Critical Priority Deliverable${criticalOpen > 1 ? 's' : ''} Active`,
      detail: 'Unclosed CRITICAL work items pose execution risk against committed milestone targets.'
    });
  }
  if (unassignedCount > 0) {
    alerts.push({
      severity: 'info',
      title: `${fmtNumber(unassignedCount)} Unassigned Task${unassignedCount > 1 ? 's' : ''} in Backlog`,
      detail: 'Orphaned work items without a named assignee risk silent SLA slippage.'
    });
  }
  if (totalEst > 0 && totalActual > totalEst * 1.15) {
    alerts.push({
      severity: 'warning',
      title: `Effort Overrun: ${fmtHours(totalActual)} Actual vs ${fmtHours(totalEst)} Estimated`,
      detail: 'Logged execution hours exceed planned effort by >15%; recalibrate task sizing.'
    });
  }
  if (!alerts.length) {
    alerts.push({
      severity: 'success',
      title: 'Backlog Delivery On Track — Zero SLA Breaches',
      detail: 'All open deliverables carry assigned owners and remain within committed deadlines.'
    });
  }
  return alerts;
}

module.exports = {
  key: 'tasks',
  docCode: 'CAE-TSK-09',
  theme: 'tasks',
  title: 'Tasks & Team Workload Report',
  subtitle: 'Deliverable pipeline, SLA adherence, priority distribution and assignee capacity',
  category: 'TASK & SLA GOVERNANCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, interval_type, assigned_to, search } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.created_at = {};
      if (range.from) where.created_at[Op.gte] = range.from;
      if (range.to) where.created_at[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (interval_type) where.interval_type = interval_type;
    if (assigned_to) where.assigned_to = assigned_to;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [{ title: { [Op.like]: q } }, { description: { [Op.like]: q } }];
    }

    const tasks = await Task.findAll({
      where,
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name'] },
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] }
      ],
      order: [['due_date', 'ASC'], ['id', 'DESC']]
    });

    const now = Date.now();
    const byStatus = {};
    const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const byInterval = { ONCE: 0, DAILY: 0, WEEKLY: 0, MONTHLY: 0, YEARLY: 0 };
    const assigneeStats = {};

    let totalEstHours = 0;
    let totalActualHours = 0;
    let overdueCount = 0;
    let criticalTotal = 0;
    let criticalDone = 0;
    let criticalOpen = 0;
    let assignedCount = 0;
    let unassignedCount = 0;

    const taskRows = tasks.map((t) => {
      const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
      const isClosed = t.status === 'DONE' || t.status === 'CANCELLED';
      const isLate = !isClosed && (t.status === 'OVERDUE' || (dueMs && dueMs < now));
      const effStatus = isLate ? 'OVERDUE' : t.status;
      byStatus[effStatus] = (byStatus[effStatus] || 0) + 1;

      const prio = t.priority || 'MEDIUM';
      byPriority[prio] = (byPriority[prio] || 0) + 1;
      const interval = t.interval_type || 'ONCE';
      byInterval[interval] = (byInterval[interval] || 0) + 1;

      const est = toNumber(t.estimated_hours, 0);
      const act = toNumber(t.actual_hours, 0);
      totalEstHours += est;
      totalActualHours += act;

      if (isLate) overdueCount += 1;
      if (prio === 'CRITICAL') {
        criticalTotal += 1;
        if (t.status === 'DONE') criticalDone += 1;
        else if (!isClosed) criticalOpen += 1;
      }

      const ownerName = t.assignee ? fullName(t.assignee) : 'Unassigned';
      if (t.assignee) assignedCount += 1;
      else unassignedCount += 1;

      if (!assigneeStats[ownerName]) {
        assigneeStats[ownerName] = { name: ownerName, total: 0, done: 0, overdue: 0, estHours: 0, actHours: 0 };
      }
      assigneeStats[ownerName].total += 1;
      if (t.status === 'DONE') assigneeStats[ownerName].done += 1;
      if (isLate) assigneeStats[ownerName].overdue += 1;
      assigneeStats[ownerName].estHours += est;
      assigneeStats[ownerName].actHours += act;

      return {
        title: cleanText(t.title, 48),
        priority: prio,
        priority_tone: prio === 'CRITICAL' ? 'danger' : (prio === 'HIGH' ? 'warning' : 'info'),
        status: effStatus,
        status_tone: STATUS_TONE[effStatus] || 'neutral',
        assignee: ownerName,
        due_date: t.due_date ? fmtDate(t.due_date) : '—',
        estimated_hours: est,
        actual_hours: act,
        interval_type: interval,
        creator: fullName(t.creator),
        completed_at: t.completed_at ? fmtDate(t.completed_at) : '—',
        description: cleanText(t.description, 56),
        _flag: isLate ? 'danger' : (prio === 'CRITICAL' && !isClosed ? 'warning' : null)
      };
    });

    const total = tasks.length;
    const doneCount = byStatus.DONE || 0;
    const completionRate = pct(doneCount, total);
    const criticalResolutionRate = criticalTotal ? pct(criticalDone, criticalTotal) : 100;
    const assignedRate = total ? pct(assignedCount, total) : 100;

    const assigneeRows = Object.values(assigneeStats)
      .sort((a, b) => (b.total - a.total) || (b.estHours - a.estHours))
      .map((a) => ({
        name: a.name,
        total: a.total,
        done: a.done,
        overdue: a.overdue,
        completion_pct: pct(a.done, a.total),
        est_hours: a.estHours,
        act_hours: a.actHours,
        _flag: a.overdue > 0 ? 'warning' : null
      }));

    const topAssignees = assigneeRows.slice(0, 7);
    const priorityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].filter((p) => byPriority[p] > 0 || tasks.length === 0);
    const intervalOrder = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].filter((k) => byInterval[k] > 0 || k === 'ONCE');

    const assigneeTable = {
      name: 'Assignee Workload Summary',
      note: 'Individual backlog ownership, completion percentage, overdue exposure and planned effort.',
      columns: [
        { header: 'Assignee', key: 'name', width: 130 },
        { header: 'Assigned', key: 'total', width: 58, type: 'number', align: 'right', total: 'sum' },
        { header: 'Done', key: 'done', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Overdue', key: 'overdue', width: 58, type: 'number', align: 'right', total: 'sum' },
        { header: 'Completion %', key: 'completion_pct', width: 78, type: 'percent', decimals: 1, align: 'right', total: 'avg', dataBar: true },
        { header: 'Est. Hours', key: 'est_hours', width: 66, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Act. Hours', key: 'act_hours', width: 66, type: 'number', decimals: 1, align: 'right', total: 'sum', printHidden: true }
      ],
      rows: assigneeRows
    };

    const tasksTable = {
      name: 'Tasks Deliverable Register',
      priority: true,
      note: 'Curated A4 register prioritizing deliverable, priority, status, assignee and due date.',
      columns: [
        { header: 'Task / Deliverable', key: 'title', width: 148 },
        { header: 'Priority', key: 'priority', width: 68, type: 'badge', align: 'center' },
        { header: 'Status', key: 'status', width: 78, type: 'badge', align: 'center' },
        { header: 'Assignee', key: 'assignee', width: 92 },
        { header: 'Due Date', key: 'due_date', width: 68, type: 'date' },
        { header: 'Est. (h)', key: 'estimated_hours', width: 52, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Act. (h)', key: 'actual_hours', width: 52, type: 'number', decimals: 1, align: 'right', total: 'sum', printHidden: true },
        { header: 'Recurrence', key: 'interval_type', width: 72, printHidden: true },
        { header: 'Created By', key: 'creator', width: 90, printHidden: true },
        { header: 'Completed', key: 'completed_at', width: 70, printHidden: true },
        { header: 'Description', key: 'description', width: 160, printHidden: true }
      ],
      rows: taskRows
    };

    const filters = { 'Creation Window': rangeLabel(range) };
    if (status) filters.Status = status;
    if (priority) filters.Priority = priority;
    if (interval_type) filters.Recurrence = interval_type;
    if (assigned_to) filters['Assignee ID'] = assigned_to;
    if (search) filters.Search = search;

    const pages = [
      {
        title: 'SLA Risk & Team Capacity',
        subtitle: `${fmtNumber(total)} deliverables tracking ${fmtHours(totalEstHours)} estimated effort`,
        blocks: [
          { type: 'alerts', title: 'SLA Breach & Backlog Advisories', items: buildTaskAlerts(overdueCount, criticalOpen, unassignedCount, totalEstHours, totalActualHours) },
          {
            type: 'kpis',
            variant: 'gauges',
            items: [
              { label: 'Task Completion Rate', value: fmtPercent(completionRate, 1), rawValue: completionRate, percent: completionRate, numFmt: '0.0"%"', sublabel: `${fmtNumber(doneCount)}/${fmtNumber(total)} closed`, tone: completionRate >= 70 ? 'success' : 'warning' },
              { label: 'Critical Closure', value: fmtPercent(criticalResolutionRate, 1), rawValue: criticalResolutionRate, percent: criticalResolutionRate, numFmt: '0.0"%"', sublabel: `${fmtNumber(criticalOpen)} open critical`, tone: criticalOpen > 0 ? 'danger' : 'success' },
              { label: 'Owner Assignment', value: fmtPercent(assignedRate, 1), rawValue: assignedRate, percent: assignedRate, numFmt: '0.0"%"', sublabel: `${fmtNumber(unassignedCount)} unassigned`, tone: unassignedCount > 0 ? 'warning' : 'info' },
              { label: 'Planned Effort', value: fmtHours(totalEstHours), rawValue: totalEstHours, percent: totalEstHours > 0 ? Math.min(100, pct(totalActualHours, totalEstHours)) : 0, sublabel: `${fmtHours(totalActualHours)} logged`, tone: 'primary' }
            ]
          },
          {
            type: 'chart',
            height: 204,
            chart: {
              type: 'lollipop',
              title: 'Backlog Load by Assignee',
              subtitle: 'Total assigned tasks across top contributors',
              valueFormat: 'number',
              labels: topAssignees.map((a) => cleanText(a.name, 18)),
              values: topAssignees.map((a) => a.total)
            }
          }
        ]
      },
      {
        title: 'Assignee Accountability & Priority Mix',
        subtitle: 'Priority urgency, recurrence cadence and contributor closure scores',
        blocks: [
          {
            type: 'chartPair',
            height: 196,
            left: {
              type: 'hbar',
              title: 'Backlog by Priority',
              subtitle: 'CRITICAL to LOW urgency split',
              valueFormat: 'number',
              labels: priorityOrder,
              values: priorityOrder.map((p) => byPriority[p]),
              colors: priorityOrder.map((p) => PRIORITY_COLORS[p] || COLORS.accent)
            },
            right: {
              type: 'bar',
              title: 'Recurrence Cadence',
              subtitle: 'One-off vs recurring tasks',
              valueFormat: 'number',
              labels: intervalOrder,
              values: intervalOrder.map((k) => byInterval[k])
            }
          },
          { type: 'table', showHeading: true, table: { ...assigneeTable, rows: assigneeRows.slice(0, 14) } }
        ]
      },
      {
        title: 'Tasks Deliverable Register',
        subtitle: `Full filtered task register (${fmtNumber(taskRows.length)} items)`,
        blocks: [{ type: 'table', showHeading: false, table: tasksTable }]
      }
    ];

    return {
      moduleKey: 'tasks',
      docCode: 'CAE-TSK-09',
      theme: 'tasks',
      title: 'Tasks & Team Workload Report',
      subtitle: 'Deliverable pipeline, SLA adherence, priority distribution and assignee capacity',
      category: 'TASK & SLA GOVERNANCE',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Completion Rate', value: fmtPercent(completionRate, 1) },
        { label: 'SLA Overdue Tasks', value: fmtNumber(overdueCount) },
        { label: 'Estimated Effort', value: fmtHours(totalEstHours) }
      ],
      filters,
      pages,
      tables: [tasksTable, assigneeTable]
    };
  }
};
