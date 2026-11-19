// =============================================================================
// exports/modules/dashboard.js — Executive Board Command Briefing (CAE-EXEC-01)
// Blueprint:
//   P1 Cover -> P2 Situational Command Center (3 Radial Gauges + Brief + 5-Pillar Scorecard)
//   -> P3 Priority Escalations & Actions (Alerts + Urgent Action Table + Compact Counters)
//   -> P4 Operational Pulse & Volumetric Scorecard (ChartPair + KPI Scorecard Table)
// =============================================================================
const { Op, fn, col, literal } = require('sequelize');
const {
  Operation, MaintenanceRecord, Task, InventoryItem, Asset, Shift, User, WikiArticle
} = require('../../models');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtPercent, parseRange, rangeLabel, toNumber, pct, fullName
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

module.exports = {
  key: 'dashboard',
  docCode: 'CAE-EXEC-01',
  theme: 'dashboard',
  title: 'Executive Dashboard Snapshot',
  subtitle: 'Cross-domain operational health, fleet readiness and urgent risk radar',
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
      shiftsToday,
      usersActive,
      wikiPublished,
      overdueTasks,
      criticalMaint,
      outOfStockItems
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
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'FAILED'] },
          priority: { [Op.in]: ['HIGH', 'CRITICAL'] }
        },
        limit: 8,
        order: [['scheduled_date', 'ASC']],
        include: [{ model: Asset, as: 'asset', attributes: ['name', 'serial_number'] }]
      }),
      InventoryItem.findAll({
        where: { is_active: true, quantity: { [Op.lte]: 0 } },
        limit: 8,
        order: [['name', 'ASC']]
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
    const urgentTotal = overdueTasks.length + criticalMaint.length + outOfStockItems.length;

    const opsCompPct = opsTotal > 0 ? pct(opsCompleted, opsTotal) : 100;
    const maintCompPct = maintTotal > 0 ? pct(maintCompleted, maintTotal) : 100;
    const stockHealthyPct = itemsTotal > 0 ? pct(healthyItems, itemsTotal) : 100;
    const taskCompPct = tasksTotal > 0 ? pct(tasksCompleted, tasksTotal) : 100;

    const brief = `Command briefing for ${rangeLabel(range)}: fleet readiness stands at ${fmtPercent(readiness, 1)} (${activeAssets}/${totalAssets} active units). Currently ${opsActive} operations are executing alongside ${maintOpen} open maintenance orders (${maintFailed} failed), ${outOfStockCount} stockout SKUs, and ${overdueTasks.length} overdue/critical tasks.`;

    const insights = [];
    if (urgentTotal > 0) {
      insights.push({
        severity: 'danger',
        title: `Immediate Escalations: ${overdueTasks.length} Overdue Tasks · ${criticalMaint.length} Critical Maint · ${outOfStockItems.length} Stockouts`,
        detail: 'High-priority interventions listed immediately below for same-day supervisor triage.'
      });
    }
    insights.push({
      severity: readiness >= 85 ? 'success' : 'warning',
      title: `Fleet Readiness at ${fmtPercent(readiness, 1)} (${activeAssets}/${totalAssets} Assets Active)`,
      detail: `${maintAssets} unit${maintAssets === 1 ? '' : 's'} currently in maintenance · ${shiftsToday} staff shift${shiftsToday === 1 ? '' : 's'} scheduled today.`
    });

    const urgentRows = [
      ...overdueTasks.map((t) => ({
        domain: 'TASK',
        item: t.title,
        priority: t.priority,
        dueOrQty: fmtDateTime(t.due_date),
        ownerOrAsset: fullName(t.assignee, 'Unassigned'),
        status: t.status,
        _badgeTone: 'danger',
        _flag: 'danger'
      })),
      ...criticalMaint.map((m) => ({
        domain: 'MAINT',
        item: m.title,
        priority: m.priority,
        dueOrQty: fmtDateTime(m.scheduled_date),
        ownerOrAsset: m.asset?.name || '—',
        status: m.status,
        _badgeTone: m.status === 'FAILED' ? 'danger' : 'warning',
        _flag: m.status === 'FAILED' ? 'danger' : 'warning'
      })),
      ...outOfStockItems.map((i) => ({
        domain: 'STOCK',
        item: `${i.name} (${i.sku})`,
        priority: 'CRITICAL',
        dueOrQty: `Qty: ${i.quantity} (Min ${i.min_stock})`,
        ownerOrAsset: i.supplier || '—',
        status: 'OUT OF STOCK',
        _badgeTone: 'danger',
        _flag: 'danger'
      }))
    ];

    const urgentTable = {
      name: 'Priority Urgent Action Items',
      priority: 'high',
      note: 'Cross-module escalations requiring immediate operational intervention.',
      columns: [
        { header: 'Domain', key: 'domain', width: 11, type: 'badge' },
        { header: 'Item / Title', key: 'item', width: 32 },
        { header: 'Priority', key: 'priority', width: 11 },
        { header: 'Due / Level', key: 'dueOrQty', width: 16, printHidden: true },
        { header: 'Owner / Asset', key: 'ownerOrAsset', width: 20 },
        { header: 'Status', key: 'status', width: 14, type: 'badge' }
      ],
      rows: urgentRows
    };

    const kpiRow = (domain, metric, value, flag) => ({ domain, metric, value, _badgeTone: flag || 'info', _flag: flag });
    const scorecardTable = {
      name: 'Platform KPI Scorecard',
      note: 'Consolidated cross-module volumetric telemetry.',
      columns: [
        { header: 'Module', key: 'domain', width: 18, type: 'badge' },
        { header: 'Metric', key: 'metric', width: 52 },
        { header: 'Value', key: 'value', width: 16, type: 'number', align: 'right', total: 'sum' }
      ],
      rows: [
        kpiRow('OPERATIONS', 'Operations — Total in period', opsTotal, 'info'),
        kpiRow('OPERATIONS', 'Operations — In Progress', opsActive, 'primary'),
        kpiRow('OPERATIONS', 'Operations — Planned', opsPlanned, 'neutral'),
        kpiRow('ASSETS', 'Assets — Active units', activeAssets, readiness >= 85 ? 'success' : 'warning'),
        kpiRow('MAINTENANCE', 'Maintenance — Total records', maintTotal, 'info'),
        kpiRow('MAINTENANCE', 'Maintenance — Open / Pending', maintOpen, maintOpen > 0 ? 'warning' : 'success'),
        kpiRow('TASKS', 'Tasks — Total in period', tasksTotal, 'info'),
        kpiRow('TASKS', 'Tasks — Open (TODO / In Progress / Review)', tasksOpen, 'primary'),
        kpiRow('TASKS', 'Tasks — Overdue & Critical alerts', overdueTasks.length, overdueTasks.length > 0 ? 'danger' : 'success'),
        kpiRow('WAREHOUSE', 'Warehouse — Active SKUs', itemsTotal, 'info'),
        kpiRow('WAREHOUSE', 'Warehouse — Low / Reorder point', lowStock, lowStock > 0 ? 'warning' : 'success'),
        kpiRow('WAREHOUSE', 'Warehouse — Out of Stock', outOfStockCount, outOfStockCount > 0 ? 'danger' : 'success'),
        kpiRow('SHIFTS', 'Shifts — Scheduled today', shiftsToday, 'info'),
        kpiRow('USERS', 'Users — Active accounts', usersActive, 'success'),
        kpiRow('WIKI', 'Wiki — Published SOP articles', wikiPublished, 'info')
      ]
    };

    const kpiCards = [
      { label: 'Active Ops', value: fmtNumber(opsActive), rawValue: opsActive, numFmt: '#,##0', sublabel: `${opsPlanned} planned`, tone: 'info' },
      { label: 'Open Maint.', value: fmtNumber(maintOpen), rawValue: maintOpen, numFmt: '#,##0', sublabel: `${criticalMaint.length} critical/high`, tone: criticalMaint.length > 0 ? 'warning' : 'success' },
      { label: 'Task Alerts', value: fmtNumber(overdueTasks.length), rawValue: overdueTasks.length, numFmt: '#,##0', sublabel: `${tasksOpen} open tasks`, tone: overdueTasks.length > 0 ? 'danger' : 'success' },
      { label: 'Stock Alerts', value: fmtNumber(lowStock), rawValue: lowStock, numFmt: '#,##0', sublabel: `${outOfStockCount} out of stock`, tone: outOfStockCount > 0 ? 'danger' : (lowStock > 0 ? 'warning' : 'success') }
    ];

    const pages = [
      {
        eyebrow: 'SECTION 01 · COMMAND CENTER',
        title: 'Situational Command Center',
        subtitle: 'Cross-domain readiness gauges and strategic operational health scorecard',
        blocks: [
          {
            type: 'gaugeBand',
            items: [
              { label: 'Fleet Readiness', valueLabel: fmtPercent(readiness, 0), percent: readiness, sublabel: `${activeAssets}/${totalAssets} active`, tone: readiness >= 85 ? 'success' : 'warning' },
              { label: 'Warehouse Health', valueLabel: fmtPercent(stockHealthyPct, 0), percent: stockHealthyPct, sublabel: `${healthyItems}/${itemsTotal} above reorder`, tone: stockHealthyPct >= 85 ? 'success' : 'danger' },
              { label: 'Maint. Closure', valueLabel: fmtPercent(maintCompPct, 0), percent: maintCompPct, sublabel: `${maintCompleted}/${maintTotal} completed`, tone: maintCompPct >= 80 ? 'info' : 'warning' }
            ]
          },
          { type: 'brief', title: 'Executive Situation Brief', text: brief },
          {
            type: 'scorecard',
            title: '5-Pillar Domain Health Scorecard',
            subtitle: 'Normalized operational completion and availability benchmarks',
            items: [
              { label: 'Asset Fleet Readiness', valueLabel: fmtPercent(readiness, 1), percent: readiness, tone: readiness >= 85 ? 'success' : 'warning', detail: `${activeAssets} operational · ${maintAssets} in maintenance` },
              { label: 'Warehouse Stock Availability', valueLabel: fmtPercent(stockHealthyPct, 1), percent: stockHealthyPct, tone: stockHealthyPct >= 85 ? 'success' : 'danger', detail: `${healthyItems}/${itemsTotal} SKUs above reorder trigger` },
              { label: 'Maintenance Completion Rate', valueLabel: fmtPercent(maintCompPct, 1), percent: maintCompPct, tone: maintCompPct >= 80 ? 'success' : 'warning', detail: `${maintCompleted} closed · ${maintFailed} failed` },
              { label: 'Operations Completion Rate', valueLabel: fmtPercent(opsCompPct, 1), percent: opsCompPct, tone: opsCompPct >= 75 ? 'info' : 'warning', detail: `${opsCompleted}/${opsTotal} sorties finalized` },
              { label: 'Task Deliverable SLA', valueLabel: fmtPercent(taskCompPct, 1), percent: taskCompPct, tone: taskCompPct >= 75 ? 'success' : 'warning', detail: `${tasksCompleted}/${tasksTotal} deliverables closed` }
            ]
          }
        ]
      },
      {
        eyebrow: 'SECTION 02 · RISK & ESCALATION',
        title: 'Priority Escalations & Immediate Actions',
        subtitle: 'Open critical tasks, failed maintenance records and zero-stock bottlenecks',
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
        { label: 'Fleet Readiness', value: fmtPercent(readiness, 1) },
        { label: 'Urgent Escalations', value: fmtNumber(urgentTotal) },
        { label: 'Active Staff / Assets', value: `${activeAssets} / ${usersActive}` }
      ],
      filters: [
        { label: 'Snapshot Date', value: fmtDate(new Date()) },
        { label: 'Period Scope', value: rangeLabel(range) }
      ],
      pages
    };
  }
};
