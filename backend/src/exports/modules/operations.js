// =============================================================================
// exports/modules/operations.js — Mission & Sortie Operations Dossier (CAE-OPS-03)
// Blueprint:
//   P1 Cover -> P2 Mission Profile (Hero-Split KPIs + Status Donut + Priority Table)
//   -> P3 Site Activity & Sortie Spotlights (Locations Lollipop + CardList Top Sorties + Alerts)
//   -> P4+ Operations Sorties Ledger (Curated 6-Col A4 Portrait Table)
// =============================================================================
const { Op } = require('sequelize');
const { Operation, OperationType, User } = require('../../models');
const {
  fmtDateTime, fmtNumber, fmtPercent, fmtDurationMin, fullName, dash,
  parseRange, rangeLabel, cleanText, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  COMPLETED:   'success',
  IN_PROGRESS: 'info',
  PLANNED:     'neutral',
  ON_HOLD:     'warning',
  CANCELLED:   'danger'
};

const STATUS_COLORS = {
  COMPLETED:   COLORS.successAccent,
  IN_PROGRESS: COLORS.accent,
  PLANNED:     COLORS.muted,
  ON_HOLD:     COLORS.amber,
  CANCELLED:   COLORS.coral
};

module.exports = {
  key: 'operations',
  docCode: 'CAE-OPS-03',
  theme: 'operations',
  title: 'Operations & Sorties Report',
  subtitle: 'Operational lifecycle, duration analysis and priority execution',
  category: 'OPERATIONS INTELLIGENCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, search } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.start_date = {};
      if (range.from) where.start_date[Op.gte] = range.from;
      if (range.to) where.start_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { description: { [Op.like]: q } },
        { location: { [Op.like]: q } }
      ];
    }

    const ops = await Operation.findAll({
      where,
      include: [
        { model: OperationType, as: 'type' },
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] }
      ],
      order: [['start_date', 'DESC']]
    });

    const byStatus = {};
    const byPriority = {};
    const byLocation = {};
    let totalMinutes = 0;
    let criticalOpen = 0;
    let onHoldCount = 0;
    let longestOp = null;
    let longestMin = 0;

    const enriched = ops.map((o) => {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      const typeName = o.type?.name || 'Other';
      const locName = o.location && String(o.location).trim() ? String(o.location).trim() : 'Unspecified Site';
      byLocation[locName] = (byLocation[locName] || 0) + 1;

      const endRef = o.actual_end_date || o.end_date;
      let durationMin = null;
      if (o.start_date && endRef) {
        const diff = Math.round((new Date(endRef).getTime() - new Date(o.start_date).getTime()) / 60000);
        if (Number.isFinite(diff) && diff >= 0) {
          durationMin = diff;
          totalMinutes += diff;
          if (diff > longestMin) {
            longestMin = diff;
            longestOp = o;
          }
        }
      }

      const prioKey = o.priority || 'MEDIUM';
      if (!byPriority[prioKey]) byPriority[prioKey] = { total: 0, completed: 0, minutes: 0 };
      byPriority[prioKey].total += 1;
      if (o.status === 'COMPLETED') byPriority[prioKey].completed += 1;
      byPriority[prioKey].minutes += durationMin || 0;

      if (o.priority === 'CRITICAL' && o.status !== 'COMPLETED' && o.status !== 'CANCELLED') criticalOpen += 1;
      if (o.status === 'ON_HOLD') onHoldCount += 1;

      return { o, durationMin, typeName, locName };
    });

    const total = ops.length;
    const completed = byStatus.COMPLETED || 0;
    const active = byStatus.IN_PROGRESS || 0;
    const completionRate = pct(completed, total);
    const totalHours = totalMinutes / 60;
    const avgMin = total > 0 ? Math.round(totalMinutes / total) : 0;

    const locationTop = topEntries(byLocation, 7);
    const statusKeys = Object.keys(byStatus);

    const spotlightSorties = [...enriched]
      .sort((a, b) => (b.o.priority === 'CRITICAL' ? 100000 : 0) + (b.durationMin || 0) - ((a.o.priority === 'CRITICAL' ? 100000 : 0) + (a.durationMin || 0)))
      .slice(0, 4)
      .map(({ o, durationMin, typeName, locName }) => ({
        badge: o.status,
        badgeTone: STATUS_TONE[o.status] || 'neutral',
        title: cleanText(o.title),
        metric: durationMin !== null ? fmtDurationMin(durationMin) : 'Ongoing',
        meta: `${typeName} · ${locName} · Priority: ${o.priority} · Lead: ${fullName(o.creator)}`,
        detail: o.description ? cleanText(o.description).slice(0, 140) : `Started ${fmtDateTime(o.start_date)}`
      }));

    const insights = [];
    if (criticalOpen > 0) {
      insights.push({
        severity: 'danger',
        title: `${criticalOpen} Critical Open Operation${criticalOpen > 1 ? 's' : ''}`,
        detail: 'Active or planned critical-priority sorties require immediate supervisory review.'
      });
    }
    if (onHoldCount > 0) {
      insights.push({
        severity: 'warning',
        title: `${onHoldCount} Operation${onHoldCount > 1 ? 's' : ''} Currently On Hold`,
        detail: 'Inspect resource blockers and scheduling dependencies to resume execution.'
      });
    }
    if (longestOp) {
      insights.push({
        severity: 'info',
        title: `Longest Sortie: "${cleanText(longestOp.title)}"`,
        detail: `Logged ${fmtDurationMin(longestMin)} (${longestOp.type?.name || 'General'} · ${longestOp.status}).`
      });
    }

    const priorityRows = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
      .filter((p) => byPriority[p])
      .map((p) => {
        const d = byPriority[p];
        return {
          priority: p,
          total: d.total,
          completed: d.completed,
          share: Number(pct(d.total, total).toFixed(1)),
          minutes: d.minutes,
          _badgeTone: p === 'CRITICAL' ? 'danger' : (p === 'HIGH' ? 'warning' : (p === 'LOW' ? 'success' : 'info'))
        };
      });

    const priorityTable = {
      name: 'Priority Distribution Summary',
      columns: [
        { header: 'Priority', key: 'priority', width: 16, type: 'badge' },
        { header: 'Sorties', key: 'total', width: 14, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Completed', key: 'completed', width: 14, type: 'number', align: 'right', total: 'sum' },
        { header: 'Share (%)', key: 'share', width: 14, type: 'percent', decimals: 1, align: 'right' },
        { header: 'Logged (min)', key: 'minutes', width: 16, type: 'number', align: 'right', total: 'sum' }
      ],
      rows: priorityRows
    };

    const ledgerTable = {
      name: 'Operations Ledger',
      note: 'Chronological register of operational sorties (site, end date & creator included in Excel).',
      columns: [
        { header: '#', key: 'id', width: 7, type: 'mono', align: 'right', printHidden: true },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Type', key: 'type', width: 16 },
        { header: 'Status', key: 'status', width: 14, type: 'badge' },
        { header: 'Priority', key: 'priority', width: 11 },
        { header: 'Location', key: 'location', width: 16, printHidden: true },
        { header: 'Start', key: 'start', width: 16 },
        { header: 'End', key: 'end', width: 16, printHidden: true },
        { header: 'Dur. (min)', key: 'duration', width: 11, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Created by', key: 'creator', width: 16, printHidden: true }
      ],
      rows: enriched.map(({ o, durationMin, typeName }) => ({
        id: o.id,
        title: cleanText(o.title),
        type: typeName,
        status: o.status,
        priority: o.priority,
        location: dash(o.location),
        start: fmtDateTime(o.start_date),
        end: fmtDateTime(o.actual_end_date || o.end_date),
        duration: durationMin,
        creator: fullName(o.creator),
        _badgeTone: STATUS_TONE[o.status] || 'neutral',
        _flag: o.priority === 'CRITICAL' && o.status !== 'COMPLETED' ? 'danger' : STATUS_TONE[o.status]
      }))
    };

    const pages = [
      {
        eyebrow: 'SECTION 01 · MISSION PROFILE',
        title: 'Mission Profile & Priority Mix',
        subtitle: 'Execution volume, lifecycle distribution and urgency tier breakdown',
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Total Operations', value: fmtNumber(total), rawValue: total, numFmt: '#,##0', sublabel: `${completed} closed · ${fmtDurationMin(avgMin)} avg duration`, tone: 'info' },
              { label: 'Completion Rate', value: fmtPercent(completionRate, 1), rawValue: completionRate, numFmt: '0.0"%"', sublabel: `${active} active right now`, tone: completionRate >= 75 ? 'success' : 'warning' },
              { label: 'Total Logged', value: `${totalHours.toFixed(1)} h`, rawValue: Number(totalHours.toFixed(1)), numFmt: '#,##0.0" h"', sublabel: 'Cumulative runtime', tone: 'primary' },
              { label: 'Critical Open', value: fmtNumber(criticalOpen), rawValue: criticalOpen, numFmt: '#,##0', sublabel: `${onHoldCount} on hold`, tone: criticalOpen > 0 ? 'danger' : 'success' },
              { label: 'Active / Planned', value: `${active} / ${byStatus.PLANNED || 0}`, sublabel: 'Live pipeline', tone: 'info' }
            ]
          },
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'donut',
              title: 'Operations by Lifecycle Status',
              subtitle: 'Share across execution states',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', table: priorityTable }
        ]
      },
      {
        eyebrow: 'SECTION 02 · SITE FOOTPRINT & MISSIONS',
        title: 'Site Concentration & Key Sortie Spotlights',
        subtitle: 'Geographic/bay activity ranking paired with flagship & critical sorties',
        blocks: [
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'lollipop',
              title: 'Top Operating Sites by Sortie Count',
              subtitle: 'Concentration of mission volume per location',
              labels: locationTop.map(([k]) => k),
              values: locationTop.map(([, v]) => v)
            }
          },
          ...(spotlightSorties.length ? [{ type: 'cardList', title: 'Featured & Critical Sorties', items: spotlightSorties }] : []),
          ...(insights.length ? [{ type: 'alerts', items: insights }] : [])
        ]
      },
      {
        eyebrow: 'SECTION 03 · OPERATIONS LEDGER',
        title: 'Operations Ledger',
        subtitle: `Full sortie log for ${rangeLabel(range)}`,
        blocks: [
          { type: 'table', showHeading: false, table: ledgerTable }
        ]
      }
    ];

    return {
      moduleKey: 'operations',
      docCode: 'CAE-OPS-03',
      theme: 'operations',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Total Sorties', value: fmtNumber(total) },
        { label: 'Completion Rate', value: fmtPercent(completionRate, 1) },
        { label: 'Hours Logged', value: `${totalHours.toFixed(1)} h` }
      ],
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Priority', value: priority || 'All' },
        ...(search ? [{ label: 'Search', value: search }] : []),
        { label: 'Total Records', value: fmtNumber(total) }
      ],
      pages
    };
  }
};
