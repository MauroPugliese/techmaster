// =============================================================================
// exports/modules/dashboard.js — Executive Board Command Briefing (CAE-EXEC-01)
// Blueprint:
//   P1 Cover -> P2 Situational Command Center (3 Radial Gauges + Brief + 6-Pillar Scorecard)
//   -> P3 Priority Escalations & Actions (AOG Simulators, Critical Maint, AOG Stockouts, Overdue Tasks)
//   -> P4 Operational Pulse & Volumetric Scorecard (ChartPair + KPI Scorecard Table incl. FFS/TP/IOS)
// =============================================================================
const { Op, fn, col, literal } = require('sequelize');
const {
  Operation, MaintenanceRecord, Task, InventoryItem, Asset, Shift, User, WikiArticle,
  Simulator, SimulatorQtgRecord, SimulatorDailyLog, SimulatorDailyShift, SimulatorShiftEntry
} = require('../../models');
const { computeTestingDurationMinutes } = require('../../services/simulator-helpers.service');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtPercent, parseRange, rangeLabel, toNumber, pct, fullName
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

module.exports = {
  key: 'dashboard',
  docCode: 'CAE-EXEC-01',
  theme: 'dashboard',
  title: 'Executive Dashboard Snapshot',
  subtitle: 'Cross-domain simulator fleet readiness, TP/IOS utilization, MEL & urgent risk radar',
  category: 'EXECUTIVE OVERVIEW',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const todayStr = new Date().toISOString().slice(0, 10);

    const opsWhere = {};
    const maintWhere = {};
    const taskWhere = {};
    if (range.from || range.to) {
      opsWhere.start_date = {};
      maintWhere.scheduled_date = {};
      taskWhere.created_at = {};
      if (range.from) {
        opsWhere.start_date[Op.gte] = range.from;
        maintWhere.scheduled_date[Op.gte] = range.from;
        taskWhere.created_at[Op.gte] = range.from;
      }
      if (range.to) {
        opsWhere.start_date[Op.lte] = range.to;
        maintWhere.scheduled_date[Op.lte] = range.to;
        taskWhere.created_at[Op.lte] = range.to;
      }
    }

    const countGrouped = (Model, column, where = {}) =>
      Model.findAll({
        where,
        attributes: [[col(column), 'label'], [fn('COUNT', literal('*')), 'count']],
        group: [col(column)],
        raw: true
      });

    const [
      opsByStatus,
      maintByStatus,
      tasksByStatus,
      totalAssets,
      activeAssets,
      maintAssets,
      itemsTotal,
      lowStock,
      outOfStockCount,
      aogLowSparesCount,
      shiftsToday,
      usersActive,
      wikiPublished,
      overdueTasks,
      criticalMaint,
      outOfStockItems,
      allSimulators,
      allQtg,
      todayLogs
    ] = await Promise.all([
      countGrouped(Operation, 'status', opsWhere),
      countGrouped(MaintenanceRecord, 'status', maintWhere),
      countGrouped(Task, 'status', taskWhere),
      Asset.count({ where: { status: { [Op.ne]: 'RETIRED' } } }),
      Asset.count({ where: { status: 'ACTIVE' } }),
      Asset.count({ where: { status: 'UNDER_MAINTENANCE' } }),
      InventoryItem.count({ where: { is_active: true } }),
      InventoryItem.count({ where: { is_active: true, [Op.and]: literal('quantity <= reorder_point') } }),
      InventoryItem.count({ where: { is_active: true, quantity: { [Op.lte]: 0 } } }),
      InventoryItem.count({ where: { is_active: true, aog_critical: true, [Op.and]: literal('quantity <= reorder_point') } }),
      Shift.count({ where: { date: todayStr } }),
      User.count({ where: { is_active: true } }),
      WikiArticle.count({ where: { status: 'PUBLISHED' } }),
      Task.findAll({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] },
          [Op.or]: [{ due_date: { [Op.lt]: new Date() } }, { priority: 'CRITICAL' }]
        },
        limit: 8,
        order: [['due_date', 'ASC']],
        include: [{ model: User, as: 'assignee', attributes: ['first_name', 'last_name'] }]
      }),
      MaintenanceRecord.findAll({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'FAILED', 'DEFERRED'] },
          [Op.or]: [
            { priority: { [Op.in]: ['HIGH', 'CRITICAL'] } },
            { severity: 'AOG' }
          ]
        },
        limit: 8,
        order: [['scheduled_date', 'ASC']],
        include: [
          { model: Asset, as: 'asset', attributes: ['name', 'serial_number'], required: false },
          { model: Simulator, as: 'simulator', attributes: ['bay_code', 'name', 'station_kind'], required: false }
        ]
      }),
      InventoryItem.findAll({
        where: { is_active: true, quantity: { [Op.lte]: 0 } },
        limit: 8,
        order: [['aog_critical', 'DESC'], ['name', 'ASC']]
      }),
      Simulator.findAll({ order: [['sort_order', 'ASC'], ['bay_code', 'ASC']] }),
      SimulatorQtgRecord.findAll({ attributes: ['id', 'simulator_id', 'status'] }),
      SimulatorDailyLog.findAll({
        where: { log_date: todayStr },
        include: [{
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [{ model: SimulatorShiftEntry, as: 'entries' }]
        }]
      })
    ]);

    const sumRows = (arr) => arr.reduce((a, r) => a + toNumber(r.count, 0), 0);
    const getCount = (arr, label) => toNumber(arr.find((r) => r.label === label)?.count, 0);

    const opsTotal = sumRows(opsByStatus);
    const opsActive = getCount(opsByStatus, 'IN_PROGRESS');
    const opsPlanned = getCount(opsByStatus, 'PLANNED');
    const opsCompleted = getCount(opsByStatus, 'COMPLETED');
    const maintTotal = sumRows(maintByStatus);
    const maintCompleted = getCount(maintByStatus, 'COMPLETED');
    const maintOpen = getCount(maintByStatus, 'SCHEDULED') + getCount(maintByStatus, 'IN_PROGRESS') + getCount(maintByStatus, 'DEFERRED');
    const maintFailed = getCount(maintByStatus, 'FAILED');
    const tasksTotal = sumRows(tasksByStatus);
    const tasksCompleted = getCount(tasksByStatus, 'DONE');
    const tasksOpen = getCount(tasksByStatus, 'TODO') + getCount(tasksByStatus, 'IN_PROGRESS') + getCount(tasksByStatus, 'REVIEW');
    const readiness = totalAssets > 0 ? pct(activeAssets, totalAssets) : 100;
    const healthyItems = Math.max(0, itemsTotal - lowStock);

    // Simulator Fleet Split: FFS Bays vs Test Places vs IOS Consoles
    const ffsList = allSimulators.filter(s => (s.station_kind || 'FFS_BAY') === 'FFS_BAY');
    const tpList = allSimulators.filter(s => s.station_kind === 'TEST_PLACE');
    const iosList = allSimulators.filter(s => s.station_kind === 'IOS_CONSOLE');
    const ffsMetric = ffsList.length > 0 ? ffsList : allSimulators;
    const ffsOperational = ffsMetric.filter(s => ['READY', 'IN_SORTIE', 'PRE_FLIGHT'].includes(s.status)).length;
    const ffsAog = allSimulators.filter(s => s.status === 'AOG');
    const simReadinessPct = ffsMetric.length > 0 ? pct(ffsOperational, ffsMetric.length) : 100;

    const qtgPass = allQtg.filter(q => q.status === 'PASSED' || q.status === 'TOLERANCE_WARN').length;
    const qtgCompliancePct = allQtg.length > 0 ? pct(qtgPass, allQtg.length) : 100;

    let tpShiftMin = 0;
    let iosShiftMin = 0;
    let tpNa = 0;
    let iosNa = 0;
    const tpStatusBySim = new Map(tpList.map(s => [Number(s.id), 'READY']));
    const iosStatusBySim = new Map(iosList.map(s => [Number(s.id), 'READY']));
    for (const log of todayLogs) {
      const sorted = [...(log.shifts || [])].sort((a, b) => (a.shift_number || 0) - (b.shift_number || 0));
      sorted.forEach((sh) => {
        for (const e of (sh.entries || [])) {
          const m = computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end);
          const sid = Number(e.simulator_id);
          if (log.station_kind === 'TEST_PLACE') {
            tpShiftMin += m;
            if (tpStatusBySim.has(sid)) {
              if (e.usage_status === 'NA' || e.usage_status === 'IN_USE') tpStatusBySim.set(sid, e.usage_status);
              else if (e.usage_status === 'READY' && tpStatusBySim.get(sid) === 'NA') tpStatusBySim.set(sid, 'READY');
            }
          } else if (log.station_kind === 'IOS_CONSOLE') {
            iosShiftMin += m;
            if (iosStatusBySim.has(sid)) {
              if (e.usage_status === 'NA' || e.usage_status === 'IN_USE') iosStatusBySim.set(sid, e.usage_status);
              else if (e.usage_status === 'READY' && iosStatusBySim.get(sid) === 'NA') iosStatusBySim.set(sid, 'READY');
            }
          }
        }
      });
    }
    for (const st of tpStatusBySim.values()) if (st === 'NA') tpNa += 1;
    for (const st of iosStatusBySim.values()) if (st === 'NA') iosNa += 1;
    const tpShiftHrs = Number((tpShiftMin / 60).toFixed(1));
    const iosShiftHrs = Number((iosShiftMin / 60).toFixed(1));

    const urgentTotal = ffsAog.length + overdueTasks.length + criticalMaint.length + outOfStockItems.length;
    const opsCompPct = opsTotal > 0 ? pct(opsCompleted, opsTotal) : 100;
    const maintCompPct = maintTotal > 0 ? pct(maintCompleted, maintTotal) : 100;
    const stockHealthyPct = itemsTotal > 0 ? pct(healthyItems, itemsTotal) : 100;
    const taskCompPct = tasksTotal > 0 ? pct(tasksCompleted, tasksTotal) : 100;

    const brief = `Command briefing for ${rangeLabel(range)}: FFS fleet readiness stands at ${fmtPercent(simReadinessPct, 1)} (${ffsOperational}/${ffsMetric.length} bays operational · ${ffsAog.length} AOG · QTG ${fmtPercent(qtgCompliancePct, 0)}). Today's daily stations logged ${tpShiftHrs} h on Test Places (${tpList.length} total, ${tpNa} NA) and ${iosShiftHrs} h on IOS Consoles (${iosList.length} total, ${iosNa} NA). Across support operations: ${opsActive} active sorties, ${maintOpen} open work orders, ${aogLowSparesCount} AOG-critical low spares, and ${overdueTasks.length} overdue tasks.`;

    const insights = [];
    if (ffsAog.length > 0 || aogLowSparesCount > 0) {
      insights.push({
        severity: 'danger',
        title: `AOG Exposure: ${ffsAog.length} Grounded Bay(s) · ${aogLowSparesCount} AOG-Critical Low Spares`,
        detail: ffsAog.length > 0
          ? `Grounded units: ${ffsAog.map(s => `${s.bay_code} (${s.name})`).join(', ')}. Immediate maintenance triage required.`
          : 'Replenish AOG-critical warehouse buffers to prevent simulator grounding.'
      });
    }
    if (urgentTotal > 0) {
      insights.push({
        severity: 'warning',
        title: `Immediate Escalations: ${criticalMaint.length} Critical/AOG WOs · ${overdueTasks.length} Overdue Tasks · ${outOfStockItems.length} Stockouts`,
        detail: 'High-priority interventions listed below for same-day supervisor triage.'
      });
    }
    insights.push({
      severity: simReadinessPct >= 85 ? 'success' : 'warning',
      title: `Simulator Readiness ${fmtPercent(simReadinessPct, 1)} · QTG ${fmtPercent(qtgCompliancePct, 1)} · Facility Assets ${fmtPercent(readiness, 1)}`,
      detail: `Test Places: ${tpList.length - tpNa}/${tpList.length} OK (${tpShiftHrs}h today) · IOS Consoles: ${iosList.length - iosNa}/${iosList.length} OK (${iosShiftHrs}h today) · ${shiftsToday} staff shifts today.`
    });

    const urgentRows = [
      ...ffsAog.map((s) => ({
        domain: 'SIM AOG',
        item: `${s.bay_code} · ${s.name} (${s.aircraft_type})`,
        priority: 'AOG',
        dueOrQty: s.station_kind || 'FFS_BAY',
        ownerOrAsset: s.limitations_mel || 'Grounded — troubleshooting',
        status: 'AOG',
        _badgeTone: 'danger',
        _flag: 'danger'
      })),
      ...criticalMaint.map((m) => ({
        domain: 'MAINT',
        item: m.title,
        priority: m.severity === 'AOG' ? 'AOG' : m.priority,
        dueOrQty: fmtDateTime(m.scheduled_date),
        ownerOrAsset: m.simulator ? `${m.simulator.bay_code} · ${m.simulator.name}` : (m.asset?.name || 'Facility'),
        status: m.status,
        _badgeTone: m.severity === 'AOG' || m.status === 'FAILED' ? 'danger' : 'warning',
        _flag: m.severity === 'AOG' || m.status === 'FAILED' ? 'danger' : 'warning'
      })),
      ...outOfStockItems.map((i) => ({
        domain: i.aog_critical ? 'AOG STK' : 'STOCK',
        item: `${i.name} (${i.sku})`,
        priority: i.aog_critical ? 'AOG CRIT' : 'CRITICAL',
        dueOrQty: `Qty: ${i.quantity} (Min ${i.min_stock})`,
        ownerOrAsset: i.supplier || '—',
        status: 'OUT OF STOCK',
        _badgeTone: 'danger',
        _flag: 'danger'
      })),
      ...overdueTasks.map((t) => ({
        domain: 'TASK',
        item: t.title,
        priority: t.priority,
        dueOrQty: fmtDateTime(t.due_date),
        ownerOrAsset: fullName(t.assignee, 'Unassigned'),
        status: t.status,
        _badgeTone: 'danger',
        _flag: 'danger'
      }))
    ];

    const urgentTable = {
      name: 'Priority Urgent Action Items',
      priority: 'high',
      note: 'Cross-module escalations including AOG Simulators, Critical Maintenance, AOG Stockouts & Overdue Tasks.',
      columns: [
        { header: 'Domain', key: 'domain', width: 12, type: 'badge' },
        { header: 'Item / Title', key: 'item', width: 32 },
        { header: 'Priority', key: 'priority', width: 11 },
        { header: 'Due / Level', key: 'dueOrQty', width: 16, printHidden: true },
        { header: 'Bay / Owner / Asset', key: 'ownerOrAsset', width: 22 },
        { header: 'Status', key: 'status', width: 14, type: 'badge' }
      ],
      rows: urgentRows
    };

    const kpiRow = (domain, metric, value, flag) => ({ domain, metric, value, _badgeTone: flag || 'info', _flag: flag });
    const scorecardTable = {
      name: 'Platform KPI Scorecard',
      note: 'Consolidated cross-module volumetric telemetry including FFS, Test Places & IOS Consoles.',
      columns: [
        { header: 'Module', key: 'domain', width: 18, type: 'badge' },
        { header: 'Metric', key: 'metric', width: 52 },
        { header: 'Value', key: 'value', width: 16, type: 'number', align: 'right' }
      ],
      rows: [
        kpiRow('SIMULATORS', 'FFS Bays — Operational / Ready', ffsOperational, ffsAog.length > 0 ? 'warning' : 'success'),
        kpiRow('SIMULATORS', 'Test Places — Total / NA Today', tpList.length, tpNa > 0 ? 'warning' : 'info'),
        kpiRow('SIMULATORS', 'IOS Consoles — Total / NA Today', iosList.length, iosNa > 0 ? 'warning' : 'info'),
        kpiRow('OPERATIONS', 'Sorties & Operations — Total in period', opsTotal, 'info'),
        kpiRow('OPERATIONS', 'Sorties & Operations — In Progress', opsActive, 'primary'),
        kpiRow('MAINTENANCE', 'Maintenance & Snags — Open / Pending', maintOpen, maintOpen > 0 ? 'warning' : 'success'),
        kpiRow('WAREHOUSE', 'Warehouse — AOG Critical Low Spares', aogLowSparesCount, aogLowSparesCount > 0 ? 'danger' : 'success'),
        kpiRow('WAREHOUSE', 'Warehouse — Out of Stock SKUs', outOfStockCount, outOfStockCount > 0 ? 'danger' : 'success'),
        kpiRow('ASSETS', 'Facility Assets — Active units', activeAssets, readiness >= 85 ? 'success' : 'warning'),
        kpiRow('TASKS', 'Tasks — Open (TODO / In Progress / Review)', tasksOpen, 'primary'),
        kpiRow('SHIFTS', 'Workforce Shifts — Scheduled today', shiftsToday, 'info'),
        kpiRow('USERS', 'Users — Active accounts', usersActive, 'success'),
        kpiRow('WIKI', 'Wiki — Published SOP articles', wikiPublished, 'info')
      ]
    };

    const kpiCards = [
      { label: 'FFS Ready', value: `${ffsOperational}/${ffsMetric.length}`, rawValue: ffsOperational, sublabel: `${ffsAog.length} AOG · QTG ${fmtPercent(qtgCompliancePct, 0)}`, tone: ffsAog.length > 0 ? 'danger' : 'success' },
      { label: 'TP / IOS Hrs', value: `${(tpShiftHrs + iosShiftHrs).toFixed(1)} h`, rawValue: Number((tpShiftHrs + iosShiftHrs).toFixed(1)), sublabel: `TP ${tpNa} NA · IOS ${iosNa} NA`, tone: (tpNa + iosNa) > 0 ? 'warning' : 'info' },
      { label: 'Open Maint.', value: fmtNumber(maintOpen), rawValue: maintOpen, numFmt: '#,##0', sublabel: `${criticalMaint.length} critical/AOG`, tone: criticalMaint.length > 0 ? 'warning' : 'success' },
      { label: 'Stock Alerts', value: fmtNumber(lowStock), rawValue: lowStock, numFmt: '#,##0', sublabel: `${aogLowSparesCount} AOG critical low`, tone: aogLowSparesCount > 0 || outOfStockCount > 0 ? 'danger' : (lowStock > 0 ? 'warning' : 'success') }
    ];

    const pages = [
      {
        eyebrow: 'SECTION 01 · COMMAND CENTER',
        title: 'Situational Command Center',
        subtitle: 'Simulator fleet readiness, QTG compliance, warehouse buffers & strategic scorecard',
        blocks: [
          {
            type: 'gaugeBand',
            items: [
              { label: 'FFS Readiness', valueLabel: fmtPercent(simReadinessPct, 0), percent: simReadinessPct, sublabel: `${ffsOperational}/${ffsMetric.length} bays ready`, tone: simReadinessPct >= 85 ? 'success' : 'danger' },
              { label: 'QTG Compliance', valueLabel: fmtPercent(qtgCompliancePct, 0), percent: qtgCompliancePct, sublabel: `${qtgPass}/${allQtg.length} tests passed`, tone: qtgCompliancePct >= 85 ? 'info' : 'warning' },
              { label: 'Warehouse Health', valueLabel: fmtPercent(stockHealthyPct, 0), percent: stockHealthyPct, sublabel: `${aogLowSparesCount} AOG spares low`, tone: aogLowSparesCount > 0 ? 'danger' : (stockHealthyPct >= 85 ? 'success' : 'warning') }
            ]
          },
          { type: 'brief', title: 'Executive Situation Brief', text: brief },
          {
            type: 'scorecard',
            title: '6-Pillar Domain Health Scorecard',
            subtitle: 'Normalized operational completion and availability benchmarks',
            items: [
              { label: 'FFS Simulator Fleet Availability', valueLabel: fmtPercent(simReadinessPct, 1), percent: simReadinessPct, tone: simReadinessPct >= 90 ? 'success' : 'warning', detail: `${ffsOperational}/${ffsMetric.length} operational · ${ffsAog.length} AOG` },
              { label: 'Test Places & IOS Consoles Readiness', valueLabel: fmtPercent(pct((tpList.length + iosList.length) - (tpNa + iosNa), Math.max(1, tpList.length + iosList.length)), 1), percent: pct((tpList.length + iosList.length) - (tpNa + iosNa), Math.max(1, tpList.length + iosList.length)), tone: (tpNa + iosNa) === 0 ? 'success' : 'warning', detail: `TP ${tpList.length - tpNa}/${tpList.length} (${tpShiftHrs}h) · IOS ${iosList.length - iosNa}/${iosList.length} (${iosShiftHrs}h)` },
              { label: 'FSTD Quarterly QTG Compliance', valueLabel: fmtPercent(qtgCompliancePct, 1), percent: qtgCompliancePct, tone: qtgCompliancePct >= 85 ? 'info' : 'warning', detail: `${qtgPass}/${allQtg.length} QTG test records passed` },
              { label: 'Warehouse Spare Parts Buffers', valueLabel: fmtPercent(stockHealthyPct, 1), percent: stockHealthyPct, tone: aogLowSparesCount > 0 ? 'danger' : (stockHealthyPct >= 85 ? 'success' : 'warning'), detail: `${healthyItems}/${itemsTotal} SKUs healthy · ${aogLowSparesCount} AOG-critical low` },
              { label: 'Maintenance Closure Rate', valueLabel: fmtPercent(maintCompPct, 1), percent: maintCompPct, tone: maintCompPct >= 80 ? 'success' : 'warning', detail: `${maintCompleted} closed · ${maintFailed} failed` },
              { label: 'Sorties & Task Deliverable SLA', valueLabel: fmtPercent((opsCompPct + taskCompPct) / 2, 1), percent: (opsCompPct + taskCompPct) / 2, tone: opsCompPct >= 75 ? 'info' : 'warning', detail: `${opsCompleted}/${opsTotal} sorties · ${tasksCompleted}/${tasksTotal} tasks` }
            ]
          }
        ]
      },
      {
        eyebrow: 'SECTION 02 · RISK & ESCALATION',
        title: 'Priority Escalations & Immediate Actions',
        subtitle: 'AOG grounded bays, critical/AOG work orders, zero-stock spares & overdue tasks',
        blocks: [
          { type: 'alerts', items: insights },
          { type: 'kpis', variant: 'compact-row', items: kpiCards },
          ...(urgentRows.length ? [{ type: 'table', table: urgentTable }] : [])
        ]
      },
      {
        eyebrow: 'SECTION 03 · TELEMETRY & VOLUMES',
        title: 'Operational Pulse & Volumetric Scorecard',
        subtitle: 'Execution balance and cross-module activity ledger',
        blocks: [
          {
            type: 'chartPair',
            height: 196,
            left: {
              type: 'donut',
              title: 'Operations Status Mix',
              labels: opsByStatus.map((r) => r.label),
              values: opsByStatus.map((r) => toNumber(r.count, 0))
            },
            right: {
              type: 'groupedBar',
              title: 'Completed vs Active Workload',
              labels: ['Operations', 'Maint.', 'Tasks'],
              series: [
                { name: 'Done', data: [opsCompleted, maintCompleted, tasksCompleted], color: COLORS.teal },
                { name: 'Open', data: [opsActive + opsPlanned, maintOpen, tasksOpen], color: COLORS.accent }
              ]
            }
          },
          { type: 'table', table: scorecardTable }
        ]
      }
    ];

    return {
      moduleKey: 'dashboard',
      docCode: 'CAE-EXEC-01',
      theme: 'dashboard',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'FFS Readiness / QTG', value: `${fmtPercent(simReadinessPct, 0)} / ${fmtPercent(qtgCompliancePct, 0)}` },
        { label: 'Urgent Escalations', value: fmtNumber(urgentTotal) },
        { label: 'TP / IOS Today Hrs', value: `${(tpShiftHrs + iosShiftHrs).toFixed(1)} h` }
      ],
      filters: [
        { label: 'Snapshot Date', value: fmtDate(new Date()) },
        { label: 'Period Scope', value: rangeLabel(range) }
      ],
      pages
    };
  }
};
