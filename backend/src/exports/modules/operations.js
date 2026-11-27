// =============================================================================
// exports/modules/operations.js — Mission & Sortie Operations Dossier (CAE-OPS-03)
// Blueprint:
//   P1 Cover -> P2 Mission Profile (Hero-Split KPIs + Outcome/Status ChartPair + Priority Table)
//   -> P3 Bay Scorecards, Customer Share, TP/IOS Shift Hours & Sortie Spotlights
//   -> P4+ Enriched Operations & Sorties Ledger
// =============================================================================
const { Op } = require('sequelize');
const {
  Operation,
  OperationType,
  Simulator,
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  User
} = require('../../models');
const { computeTestingDurationMinutes } = require('../../services/simulator-helpers.service');
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

const OUTCOME_TONE = {
  CLEAN: 'success',
  COMPLETED_WITH_SNAGS: 'warning',
  INTERRUPTED_TECH: 'danger',
  NO_SHOW: 'neutral',
  CANCELLED: 'danger',
  PENDING: 'neutral'
};

const STATUS_COLORS = {
  COMPLETED:   COLORS.successAccent,
  IN_PROGRESS: COLORS.accent,
  PLANNED:     COLORS.muted,
  ON_HOLD:     COLORS.amber,
  CANCELLED:   COLORS.coral
};

const OUTCOME_COLORS = {
  CLEAN: COLORS.teal,
  COMPLETED_WITH_SNAGS: COLORS.amber,
  INTERRUPTED_TECH: COLORS.coral,
  NO_SHOW: COLORS.muted,
  CANCELLED: COLORS.magenta,
  PENDING: COLORS.accent
};

module.exports = {
  key: 'operations',
  docCode: 'CAE-OPS-03',
  theme: 'operations',
  title: 'Operations & Sorties Report',
  subtitle: 'Simulator dispatch reliability, sortie outcomes, lost training time & station shift hours',
  category: 'OPERATIONS INTELLIGENCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, search, simulator_id, outcome, type_id } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.start_date = {};
      if (range.from) where.start_date[Op.gte] = range.from;
      if (range.to) where.start_date[Op.lte] = range.to;
    }
    if (status === 'OVERDUE') {
      where.status = { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] };
      where.end_date = { [Op.lt]: new Date() };
    } else if (status) {
      where.status = status;
    }
    if (priority) where.priority = priority;
    if (simulator_id && Number(simulator_id) > 0) where.simulator_id = Number(simulator_id);
    if (outcome && String(outcome).trim()) where.outcome = String(outcome).trim().toUpperCase();
    if (type_id && Number(type_id) > 0) where.type_id = Number(type_id);
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { sortie_code: { [Op.like]: q } },
        { customer_operator: { [Op.like]: q } },
        { description: { [Op.like]: q } },
        { location: { [Op.like]: q } }
      ];
    }

    const logWhere = {};
    if (range.from || range.to) {
      logWhere.log_date = {};
      if (range.from) logWhere.log_date[Op.gte] = new Date(range.from).toISOString().slice(0, 10);
      if (range.to) logWhere.log_date[Op.lte] = new Date(range.to).toISOString().slice(0, 10);
    }

    const [ops, dailyLogs] = await Promise.all([
      Operation.findAll({
        where,
        include: [
          { model: OperationType, as: 'type' },
          { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'bay_code', 'name', 'aircraft_type', 'station_kind'], required: false },
          { model: User, as: 'creator', attributes: ['first_name', 'last_name'] }
        ],
        order: [['start_date', 'DESC']]
      }),
      SimulatorDailyLog.findAll({
        where: logWhere,
        include: [{
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [{ model: SimulatorShiftEntry, as: 'entries' }]
        }]
      })
    ]);

    const byStatus = {};
    const byOutcome = {};
    const byPriority = {};
    const byCustomer = {};
    const bayMap = new Map();
    let totalMinutes = 0;
    let totalScheduledHours = 0;
    let totalActualHours = 0;
    let totalLostMinutes = 0;
    let techDisruptedCount = 0;
    let criticalOpen = 0;
    let onHoldCount = 0;
    let longestOp = null;
    let longestMin = 0;

    const enriched = ops.map((o) => {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      const outKey = o.outcome || (o.status === 'COMPLETED' ? 'CLEAN' : 'PENDING');
      if (o.outcome) byOutcome[o.outcome] = (byOutcome[o.outcome] || 0) + 1;

      const typeName = o.type?.name || 'Training Sortie';
      const bayLabel = o.simulator ? `${o.simulator.bay_code} · ${o.simulator.name}` : (o.location || 'Unassigned Bay');
      const customer = o.customer_operator && String(o.customer_operator).trim() ? String(o.customer_operator).trim() : 'Internal / Unassigned';
      byCustomer[customer] = (byCustomer[customer] || 0) + 1;

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

      const schedH = Number(o.scheduled_hours) || (durationMin ? Number((durationMin / 60).toFixed(2)) : 0);
      const actualH = o.actual_flight_hours != null ? Number(o.actual_flight_hours) : (o.status === 'COMPLETED' ? schedH : 0);
      const lostM = Number(o.lost_training_minutes) || 0;
      totalScheduledHours += schedH;
      totalActualHours += actualH;
      totalLostMinutes += lostM;

      const isTechDisrupted = o.outcome === 'INTERRUPTED_TECH' || o.outcome === 'COMPLETED_WITH_SNAGS' || lostM > 0;
      if (isTechDisrupted) techDisruptedCount += 1;

      const bayRow = bayMap.get(bayLabel) || { bay: bayLabel, sorties: 0, sched_h: 0, actual_h: 0, lost_min: 0, disrupted: 0 };
      bayRow.sorties += 1;
      bayRow.sched_h += schedH;
      bayRow.actual_h += actualH;
      bayRow.lost_min += lostM;
      if (isTechDisrupted) bayRow.disrupted += 1;
      bayMap.set(bayLabel, bayRow);

      const prioKey = o.priority || 'MEDIUM';
      if (!byPriority[prioKey]) byPriority[prioKey] = { total: 0, completed: 0, minutes: 0 };
      byPriority[prioKey].total += 1;
      if (o.status === 'COMPLETED') byPriority[prioKey].completed += 1;
      byPriority[prioKey].minutes += durationMin || 0;

      if (o.priority === 'CRITICAL' && o.status !== 'COMPLETED' && o.status !== 'CANCELLED') criticalOpen += 1;
      if (o.status === 'ON_HOLD') onHoldCount += 1;

      return { o, durationMin, typeName, bayLabel, customer, schedH, actualH, lostM, outKey };
    });

    // Aggregate Test Places & IOS Consoles shift session hours for the same period
    let tpShiftMin = 0;
    let iosShiftMin = 0;
    let tpNaEntries = 0;
    let iosNaEntries = 0;
    for (const log of dailyLogs) {
      for (const sh of (log.shifts || [])) {
        for (const e of (sh.entries || [])) {
          const m = computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end);
          if (log.station_kind === 'TEST_PLACE') {
            tpShiftMin += m;
            if (e.usage_status === 'NA') tpNaEntries += 1;
          } else if (log.station_kind === 'IOS_CONSOLE') {
            iosShiftMin += m;
            if (e.usage_status === 'NA') iosNaEntries += 1;
          }
        }
      }
    }
    const tpShiftHours = Number((tpShiftMin / 60).toFixed(1));
    const iosShiftHours = Number((iosShiftMin / 60).toFixed(1));

    const total = ops.length;
    const completed = byStatus.COMPLETED || 0;
    const active = byStatus.IN_PROGRESS || 0;
    const completionRate = pct(completed, total);
    const dispatchRelPct = total > 0 ? Math.round(((total - techDisruptedCount) / total) * 1000) / 10 : 100;
    const totalHours = totalMinutes / 60;
    const avgMin = total > 0 ? Math.round(totalMinutes / total) : 0;

    const customerTop = topEntries(byCustomer, 7);
    const statusKeys = Object.keys(byStatus);
    const outcomeKeys = Object.keys(byOutcome);

    const bayScorecardRows = [...bayMap.values()]
      .map(b => {
        const rel = b.sorties > 0 ? Number((((b.sorties - b.disrupted) / b.sorties) * 100).toFixed(1)) : 100;
        return {
          bay: b.bay,
          sorties: b.sorties,
          sched_h: Number(b.sched_h.toFixed(1)),
          actual_h: Number(b.actual_h.toFixed(1)),
          lost_min: b.lost_min,
          rel_pct: rel,
          _flag: rel < 95 ? 'danger' : (b.lost_min > 0 ? 'warning' : undefined)
        };
      })
      .sort((a, b) => b.sorties - a.sorties || b.lost_min - a.lost_min);

    const spotlightSorties = [...enriched]
      .sort((a, b) => {
        const scoreA = (a.lostM > 0 ? 500000 : 0) + (a.o.priority === 'CRITICAL' ? 100000 : 0) + (a.durationMin || 0);
        const scoreB = (b.lostM > 0 ? 500000 : 0) + (b.o.priority === 'CRITICAL' ? 100000 : 0) + (b.durationMin || 0);
        return scoreB - scoreA;
      })
      .slice(0, 4)
      .map(({ o, durationMin, bayLabel, customer, lostM }) => ({
        badge: o.outcome || o.status,
        badgeTone: OUTCOME_TONE[o.outcome] || STATUS_TONE[o.status] || 'neutral',
        title: `${o.sortie_code ? `[${o.sortie_code}] ` : ''}${cleanText(o.title)}`,
        metric: lostM > 0 ? `-${lostM} min lost` : (durationMin !== null ? fmtDurationMin(durationMin) : 'Ongoing'),
        meta: `${bayLabel} · ${customer} · Lead: ${fullName(o.creator)}`,
        detail: o.snag_summary ? `Snag: ${cleanText(o.snag_summary, 140)}` : (o.description ? cleanText(o.description, 140) : `Started ${fmtDateTime(o.start_date)}`)
      }));

    const insights = [];
    if (totalLostMinutes > 0 || techDisruptedCount > 0) {
      insights.push({
        severity: 'danger',
        title: `${techDisruptedCount} Technically Disrupted Sortie(s) · ${fmtNumber(totalLostMinutes)} Lost Training Minutes`,
        detail: `Dispatch reliability stands at ${fmtPercent(dispatchRelPct, 1)}. Review snag summaries and bay maintenance schedules.`
      });
    }
    if (criticalOpen > 0) {
      insights.push({
        severity: 'warning',
        title: `${criticalOpen} Critical Open Operation${criticalOpen > 1 ? 's' : ''}`,
        detail: 'Active or planned critical-priority sorties require immediate supervisory oversight.'
      });
    }
    if (tpShiftHours > 0 || iosShiftHours > 0) {
      insights.push({
        severity: 'info',
        title: `Station Shift Utilization: ${tpShiftHours} h Test Places · ${iosShiftHours} h IOS Consoles`,
        detail: `Captured across ${dailyLogs.length} daily station log(s) in period (${tpNaEntries} TP NA / ${iosNaEntries} IOS NA shift entries).`
      });
    }
    if (longestOp) {
      insights.push({
        severity: 'info',
        title: `Longest Sortie: "${cleanText(longestOp.title)}"`,
        detail: `Logged ${fmtDurationMin(longestMin)} (${longestOp.simulator?.bay_code || longestOp.location || 'Bay'} · ${longestOp.status}).`
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

    const bayScorecardTable = {
      name: 'Simulator Bay Dispatch Scorecard',
      note: 'Scheduled vs actual training hours, lost minutes and dispatch reliability per simulator bay.',
      columns: [
        { header: 'Simulator Bay', key: 'bay', width: 145 },
        { header: 'Sorties', key: 'sorties', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Sched (h)', key: 'sched_h', width: 62, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Actual (h)', key: 'actual_h', width: 62, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Lost (min)', key: 'lost_min', width: 62, type: 'number', align: 'right', total: 'sum' },
        { header: 'Reliability', key: 'rel_pct', width: 64, type: 'percent', decimals: 1, align: 'right', total: 'avg' }
      ],
      rows: bayScorecardRows
    };

    const ledgerTable = {
      name: 'Operations & Sorties Ledger',
      note: 'Complete sortie log including Bay, Customer Operator, Outcome, Lost Minutes and Snag Summary.',
      columns: [
        { header: 'Code', key: 'code', width: 58, type: 'mono' },
        { header: 'Bay / Station', key: 'bay', width: 88 },
        { header: 'Customer', key: 'customer', width: 76 },
        { header: 'Title', key: 'title', width: 112 },
        { header: 'Mission', key: 'mission', width: 90, printHidden: true },
        { header: 'Instructor', key: 'instructor', width: 84, printHidden: true },
        { header: 'Pilot(s)', key: 'pilot', width: 92, printHidden: true },
        { header: 'Status', key: 'status', width: 66, type: 'badge', align: 'center' },
        { header: 'Outcome', key: 'outcome', width: 82, type: 'badge', align: 'center', printHidden: true },
        { header: 'Start', key: 'start', width: 74 },
        { header: 'End', key: 'end', width: 74, printHidden: true },
        { header: 'Actual (h)', key: 'actual_h', width: 48, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Lost (m)', key: 'lost_min', width: 46, type: 'number', align: 'right', total: 'sum' },
        { header: 'Snag Summary', key: 'snag', width: 130, printHidden: true },
        { header: 'Lead', key: 'creator', width: 80, printHidden: true }
      ],
      rows: enriched.map(({ o, bayLabel, customer, actualH, lostM }) => ({
        code: o.sortie_code || `OP-${o.id}`,
        bay: cleanText(bayLabel, 32),
        customer: cleanText(customer, 26),
        title: cleanText(o.title, 44),
        mission: o.mission_name ? cleanText(o.mission_name, 40) : '—',
        instructor: o.instructor_name ? cleanText(o.instructor_name, 36) : '—',
        pilot: [o.pilot_name, o.copilot_name].filter(Boolean).map(v => cleanText(v, 32)).join(' / ') || '—',
        status: o.status,
        status_tone: STATUS_TONE[o.status] || 'neutral',
        outcome: o.outcome || '—',
        outcome_tone: OUTCOME_TONE[o.outcome] || 'neutral',
        start: fmtDateTime(o.start_date),
        end: fmtDateTime(o.actual_end_date || o.end_date),
        actual_h: Number(actualH.toFixed(1)),
        lost_min: lostM,
        snag: o.snag_summary ? cleanText(o.snag_summary, 110) : '—',
        creator: fullName(o.creator),
        _flag: lostM > 0 || o.outcome === 'INTERRUPTED_TECH' || o.outcome === 'CANCELLED' ? 'danger' : STATUS_TONE[o.status]
      }))
    };

    const pages = [
      {
        eyebrow: 'SECTION 01 · DISPATCH RELIABILITY & PROFILE',
        title: 'Sortie Dispatch Reliability & Mission Profile',
        subtitle: 'Execution volume, technical dispatch SLA, scheduled vs actual hours & station shifts',
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Dispatch Reliability', value: fmtPercent(dispatchRelPct, 1), rawValue: dispatchRelPct, numFmt: '0.0"%"', sublabel: `${techDisruptedCount} tech disrupted · ${totalLostMinutes}m lost`, tone: dispatchRelPct >= 97 ? 'success' : 'warning' },
              { label: 'Total Sorties', value: fmtNumber(total), rawValue: total, numFmt: '#,##0', sublabel: `${completed} completed · ${active} live`, tone: 'info' },
              { label: 'Sched / Actual Hrs', value: `${totalScheduledHours.toFixed(1)} / ${totalActualHours.toFixed(1)} h`, rawValue: Number(totalActualHours.toFixed(1)), numFmt: '#,##0.0" h"', sublabel: `${fmtDurationMin(avgMin)} avg sortie`, tone: 'primary' },
              { label: 'Lost Training Time', value: `${fmtNumber(totalLostMinutes)} min`, rawValue: totalLostMinutes, numFmt: '#,##0" min"', sublabel: `${(totalLostMinutes / 60).toFixed(1)} h SLA loss`, tone: totalLostMinutes > 0 ? 'danger' : 'success' },
              { label: 'TP / IOS Shift Hrs', value: `${(tpShiftHours + iosShiftHours).toFixed(1)} h`, rawValue: Number((tpShiftHours + iosShiftHours).toFixed(1)), sublabel: `TP ${tpShiftHours}h · IOS ${iosShiftHours}h`, tone: 'info' }
            ]
          },
          {
            type: 'chartPair',
            height: 196,
            left: {
              type: 'donut',
              title: 'Sorties by Lifecycle Status',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            },
            right: outcomeKeys.length > 0 ? {
              type: 'donut',
              title: 'Sorties by Technical Outcome',
              labels: outcomeKeys,
              values: outcomeKeys.map((k) => byOutcome[k]),
              colors: outcomeKeys.map((k) => OUTCOME_COLORS[k] || COLORS.accent)
            } : {
              type: 'lollipop',
              title: 'Top Customer Operators',
              labels: customerTop.map(([k]) => k),
              values: customerTop.map(([, v]) => v)
            }
          },
          { type: 'table', table: priorityTable }
        ]
      },
      {
        eyebrow: 'SECTION 02 · BAY SCORECARDS & CUSTOMER SHARE',
        title: 'Bay Utilization, Customer Footprint & Spotlights',
        subtitle: 'Per-simulator dispatch reliability, customer volume and critical/interrupted sorties',
        blocks: [
          ...(bayScorecardRows.length ? [{ type: 'table', showHeading: true, table: bayScorecardTable }] : []),
          {
            type: 'chart',
            height: 190,
            chart: {
              type: 'lollipop',
              title: 'Top Customer Operators by Sortie Count',
              labels: customerTop.map(([k]) => k),
              values: customerTop.map(([, v]) => v)
            }
          },
          ...(spotlightSorties.length ? [{ type: 'cardList', title: 'Disrupted & Featured Sorties', items: spotlightSorties }] : []),
          ...(insights.length ? [{ type: 'alerts', items: insights }] : [])
        ]
      },
      {
        eyebrow: 'SECTION 03 · OPERATIONS & SORTIES LEDGER',
        title: 'Operations & Sorties Ledger',
        subtitle: `Full dispatch register for ${rangeLabel(range)}`,
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
        { label: 'Dispatch Reliability', value: fmtPercent(dispatchRelPct, 1) },
        { label: 'Sorties / Hours', value: `${fmtNumber(total)} / ${totalHours.toFixed(1)} h` },
        { label: 'Lost Training Time', value: `${fmtNumber(totalLostMinutes)} min` }
      ],
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Outcome', value: outcome || 'All' },
        { label: 'Priority', value: priority || 'All' },
        ...(simulator_id ? [{ label: 'Simulator ID', value: String(simulator_id) }] : []),
        ...(search ? [{ label: 'Search', value: search }] : []),
        { label: 'Total Records', value: fmtNumber(total) }
      ],
      pages
    };
  }
};
