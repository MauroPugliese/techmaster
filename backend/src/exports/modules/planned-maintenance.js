// =============================================================================
// exports/modules/planned-maintenance.js — Preventive Schedule Booklet (CAE-PM-06)
// Blueprint:
//   P1 Cover -> P2 Preventive Compliance Dashboard (3 Gauges + System Scorecards + Brief)
//   -> P3 Cadence Mix & System Coverage (ChartPair: Freq Bar + System Lollipop + Gauge KPIs + Alerts)
//   -> P4+ Master Preventive Schedule -> P5+ Calendar Exceptions & Overrides
// =============================================================================
const { Op } = require('sequelize');
const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance, User } = require('../../models');
const { expandOccurrencesInRange } = require('../../services/planned-recurrence.service');
const {
  fmtDateTime, fmtDate, fmtNumber, fmtPercent, fullName, dash,
  parseRange, rangeLabel, cleanText, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

module.exports = {
  key: 'planned-maintenance',
  docCode: 'CAE-PM-06',
  theme: 'planned-maintenance',
  title: 'Planned Maintenance Report',
  subtitle: 'Recurring preventive schedules, system coverage and calendar occurrences',
  category: 'PLANNED MAINTENANCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, repeat_task_type, system, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (repeat_task_type) where.repeat_task_type = repeat_task_type;
    if (system && String(system).trim()) where.system = String(system).trim();
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [
        { system: { [Op.like]: q } },
        { subsystem: { [Op.like]: q } },
        { task: { [Op.like]: q } },
        { reference: { [Op.like]: q } }
      ];
    }

    const tasks = await PlannedMaintenanceTask.findAll({
      where,
      include: [{ model: User, as: 'creator', attributes: ['first_name', 'last_name'] }],
      order: [['operation_date_start', 'ASC']]
    });

    const instanceWhere = {};
    if (range.from || range.to) {
      instanceWhere.occurrence_date = {};
      if (range.from) instanceWhere.occurrence_date[Op.gte] = range.from.toISOString().slice(0, 10);
      if (range.to) instanceWhere.occurrence_date[Op.lte] = range.to.toISOString().slice(0, 10);
    }

    const occurrences = await PlannedMaintenanceTaskInstance.findAll({
      where: instanceWhere,
      include: [{ model: PlannedMaintenanceTask, as: 'master', attributes: ['system', 'subsystem'] }],
      order: [['occurrence_date', 'ASC']]
    });

    let expandedInPeriod = [];
    if (range.from && range.to) {
      expandedInPeriod = await expandOccurrencesInRange(
        range.from.toISOString().slice(0, 10),
        range.to.toISOString().slice(0, 10),
        366,
        where
      );
    }

    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'DONE').length;
    const todo = total - done;
    const completion = pct(done, total);

    const byType = { DAY: 0, WEEK: 0, MONTH: 0 };
    const bySystem = {};
    const sysCompliance = {};
    tasks.forEach((t) => {
      if (t.repeat_task_type) byType[t.repeat_task_type] = (byType[t.repeat_task_type] || 0) + 1;
      bySystem[t.system] = (bySystem[t.system] || 0) + 1;
    });

    const complianceSource = expandedInPeriod.length ? expandedInPeriod : tasks;
    complianceSource.forEach((item) => {
      const sys = item.system || 'General';
      if (!sysCompliance[sys]) sysCompliance[sys] = { total: 0, done: 0 };
      sysCompliance[sys].total += 1;
      if (item.status === 'DONE') sysCompliance[sys].done += 1;
    });

    const systemScoreItems = Object.entries(sysCompliance)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 7)
      .map(([sys, st]) => {
        const rate = pct(st.done, st.total);
        return {
          label: sys,
          valueLabel: `${fmtPercent(rate, 1)} (${st.done}/${st.total})`,
          percent: rate,
          tone: rate >= 80 ? 'success' : (rate >= 50 ? 'warning' : 'danger'),
          detail: expandedInPeriod.length ? 'Projected window occurrences closed' : 'Master routine series marked DONE'
        };
      });

    const overrideCount = occurrences.filter((o) => o.exception_type === 'OVERRIDE').length;
    const deletedCount = occurrences.filter((o) => o.exception_type === 'DELETED').length;
    const systemTop = topEntries(bySystem, 7);

    const effRate = expandedInPeriod.length
      ? pct(expandedInPeriod.filter((o) => o.status === 'DONE').length, expandedInPeriod.length)
      : completion;
    const weeklyShare = pct(byType.WEEK || 0, total);
    const activeSeriesPct = expandedInPeriod.length > 0
      ? Math.max(0, Math.min(100, pct(expandedInPeriod.length, expandedInPeriod.length + deletedCount)))
      : Math.max(0, Math.min(100, pct(Math.max(0, total - deletedCount), Math.max(total, 1))));

    const insights = [];
    if (todo > 0) {
      insights.push({
        severity: 'info',
        title: `${todo} Active Recurring Series Pending (TODO)`,
        detail: `Schedule comprises ${byType.DAY || 0} daily, ${byType.WEEK || 0} weekly and ${byType.MONTH || 0} monthly routines.`
      });
    }
    if (deletedCount > 0 || overrideCount > 0) {
      insights.push({
        severity: deletedCount > 3 ? 'warning' : 'primary',
        title: `${overrideCount} Schedule Overrides · ${deletedCount} Skipped Occurrences`,
        detail: 'Per-date calendar instance exceptions logged without altering master definitions.'
      });
    }
    if (expandedInPeriod.length > 0) {
      const doneOcc = expandedInPeriod.filter((o) => o.status === 'DONE').length;
      insights.push({
        severity: 'success',
        title: `${expandedInPeriod.length} Total Occurrences Projected in Period`,
        detail: `${doneOcc} marked DONE (${fmtPercent(pct(doneOcc, expandedInPeriod.length), 1)} compliance rate).`
      });
    }

    const masterTable = {
      name: 'Master Preventive Schedule',
      note: 'Recurring preventive templates (full reference and timestamps available in Excel).',
      columns: [
        { header: 'System', key: 'system', width: 17 },
        { header: 'Subsystem', key: 'subsystem', width: 17 },
        { header: 'Task', key: 'task', width: 32 },
        { header: 'Ref', key: 'reference', width: 13, printHidden: true },
        { header: 'Start', key: 'start', width: 15 },
        { header: 'End', key: 'end', width: 15, printHidden: true },
        { header: 'Repeat', key: 'repeat', width: 14 },
        { header: 'Status', key: 'status', width: 10, type: 'badge' },
        { header: 'Opt.', key: 'optional', width: 8, align: 'center', printHidden: true },
        { header: 'Created by', key: 'creator', width: 16, printHidden: true }
      ],
      rows: tasks.map((t) => ({
        system: t.system,
        subsystem: t.subsystem,
        task: cleanText(t.task),
        reference: dash(t.reference),
        start: fmtDateTime(t.operation_date_start),
        end: fmtDateTime(t.operation_date_end),
        repeat: `Every ${t.repeat_task_number} ${t.repeat_task_type}`,
        status: t.status,
        optional: t.optional ? 'Yes' : 'No',
        creator: fullName(t.creator),
        _badgeTone: t.status === 'DONE' ? 'success' : 'info',
        _flag: t.status === 'DONE' ? 'success' : undefined
      }))
    };

    const exceptionsTable = {
      name: 'Calendar Exceptions & Overrides',
      note: 'Per-date overrides and deleted occurrences logged against master routines.',
      columns: [
        { header: 'Date', key: 'date', width: 13 },
        { header: 'System', key: 'system', width: 18 },
        { header: 'Subsystem', key: 'subsystem', width: 18, printHidden: true },
        { header: 'Exception', key: 'exception', width: 13, type: 'badge' },
        { header: 'Task', key: 'task', width: 36 },
        { header: 'Status', key: 'status', width: 11, type: 'badge' }
      ],
      rows: occurrences.map((o) => ({
        date: fmtDate(o.occurrence_date),
        system: o.system || o.master?.system || '—',
        subsystem: o.subsystem || o.master?.subsystem || '—',
        exception: o.exception_type,
        task: cleanText(o.task) || '—',
        status: o.status || '—',
        _badgeTone: o.exception_type === 'DELETED' ? 'danger' : (o.status === 'DONE' ? 'success' : 'warning'),
        _flag: o.exception_type === 'DELETED' ? 'danger' : (o.status === 'DONE' ? 'success' : undefined)
      }))
    };

    const brief = `Preventive maintenance compliance for ${rangeLabel(range)}: ${fmtNumber(total)} recurring series (${byType.DAY || 0} daily, ${byType.WEEK || 0} weekly, ${byType.MONTH || 0} monthly) span ${Object.keys(bySystem).length} systems with ${overrideCount} date overrides and ${deletedCount} skipped occurrences.`;

    const pages = [
      {
        eyebrow: 'SECTION 01 · PREVENTIVE COMPLIANCE',
        title: 'System Preventive Compliance Dashboard',
        subtitle: 'Overall compliance rates and infrastructure system adherence meters',
        blocks: [
          {
            type: 'gaugeBand',
            items: [
              { label: 'Compliance Rate', valueLabel: fmtPercent(effRate, 0), percent: effRate, sublabel: `${done}/${total} master DONE`, tone: effRate >= 75 ? 'success' : 'warning' },
              { label: 'Weekly Cadence', valueLabel: fmtPercent(weeklyShare, 0), percent: weeklyShare, sublabel: `${byType.WEEK || 0} weekly series`, tone: 'info' },
              { label: 'Schedule Integrity', valueLabel: fmtPercent(activeSeriesPct, 0), percent: activeSeriesPct, sublabel: `${deletedCount} deletions logged`, tone: deletedCount > 3 ? 'warning' : 'success' }
            ]
          },
          ...(systemScoreItems.length ? [{ type: 'scorecard', title: 'Preventive Adherence by System', subtitle: 'Percentage of completed routines/occurrences per system', items: systemScoreItems }] : []),
          { type: 'brief', title: 'Schedule Coverage Summary', text: brief }
        ]
      },
      {
        eyebrow: 'SECTION 02 · CADENCE & EXCEPTIONS',
        title: 'Recurrence Cadence & Exception Activity',
        subtitle: 'Frequency balance, system coverage density and calendar overrides',
        blocks: [
          {
            type: 'chartPair',
            height: 200,
            left: {
              type: 'bar',
              title: 'Schedules by Frequency',
              labels: ['DAY', 'WEEK', 'MONTH'],
              values: [byType.DAY || 0, byType.WEEK || 0, byType.MONTH || 0],
              colors: [COLORS.accent, COLORS.teal, COLORS.amber]
            },
            right: {
              type: 'lollipop',
              title: 'Planned Tasks by System',
              labels: systemTop.map(([k]) => k),
              values: systemTop.map(([, v]) => v)
            }
          },
          {
            type: 'kpis',
            variant: 'gauges',
            items: [
              { label: 'Master Schedules', value: fmtNumber(total), rawValue: total, numFmt: '#,##0', sublabel: `${todo} TODO`, percent: completion, tone: 'info' },
              { label: 'Compliance Rate', value: fmtPercent(effRate, 1), rawValue: effRate, numFmt: '0.0"%"', sublabel: 'Current period', tone: effRate >= 75 ? 'success' : 'warning' },
              { label: 'Date Overrides', value: fmtNumber(overrideCount), rawValue: overrideCount, numFmt: '#,##0', sublabel: `${deletedCount} skipped`, percent: pct(overrideCount, Math.max(total, overrideCount, 1)), tone: 'primary' },
              { label: expandedInPeriod.length ? 'Window Occurrences' : 'Daily Series', value: fmtNumber(expandedInPeriod.length || (byType.DAY || 0)), rawValue: expandedInPeriod.length || (byType.DAY || 0), numFmt: '#,##0', sublabel: expandedInPeriod.length ? 'Projected calendar events' : 'High-frequency checks', percent: expandedInPeriod.length ? 85 : pct(byType.DAY || 0, total), tone: 'info' }
            ]
          },
          ...(insights.length ? [{ type: 'alerts', items: insights }] : [])
        ]
      },
      {
        eyebrow: 'SECTION 03 · MASTER SCHEDULE',
        title: 'Master Preventive Schedule',
        subtitle: `${fmtNumber(total)} recurring preventive definitions`,
        blocks: [
          { type: 'table', showHeading: false, table: masterTable }
        ]
      },
      {
        eyebrow: 'SECTION 04 · CALENDAR EXCEPTIONS',
        title: 'Calendar Exceptions & Overrides',
        subtitle: `Logged instance changes within ${rangeLabel(range)}`,
        blocks: [
          { type: 'table', showHeading: false, table: exceptionsTable }
        ]
      }
    ];

    return {
      moduleKey: 'planned-maintenance',
      docCode: 'CAE-PM-06',
      theme: 'planned-maintenance',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Master Series', value: fmtNumber(total) },
        { label: 'Compliance Rate', value: fmtPercent(effRate, 1) },
        { label: 'Calendar Exceptions', value: fmtNumber(occurrences.length) }
      ],
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        ...(system ? [{ label: 'System', value: system }] : []),
        { label: 'Status', value: status || 'All' },
        ...(repeat_task_type ? [{ label: 'Recurrence', value: repeat_task_type }] : []),
        ...(search ? [{ label: 'Search', value: search }] : []),
        { label: 'Master Schedules', value: fmtNumber(total) }
      ],
      pages
    };
  }
};
