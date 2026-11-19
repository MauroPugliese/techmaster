// =============================================================================
// exports/modules/maintenance.js — Reliability & Asset Cost Audit (CAE-MNT-05)
// Blueprint:
//   P1 Cover -> P2 Critical Failures & Cost Hotspots (Alerts FIRST + Hero KPIs + Top Asset Cost Lollipop)
//   -> P3 Asset Reliability Matrix & Discipline Spend (Asset Summary Table + Type Spend HBar + Spotlights)
//   -> P4+ Maintenance Work Orders Ledger
// =============================================================================
const { Op } = require('sequelize');
const { MaintenanceRecord, Asset, User } = require('../../models');
const {
  fmtDateTime, fmtNumber, fmtMoney, fmtPercent, fmtHours,
  fullName, parseRange, rangeLabel, cleanText, toNumber, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  COMPLETED:   'success',
  IN_PROGRESS: 'info',
  SCHEDULED:   'neutral',
  DEFERRED:    'warning',
  FAILED:      'danger'
};

const STATUS_COLORS = {
  COMPLETED:   COLORS.successAccent,
  IN_PROGRESS: COLORS.accent,
  SCHEDULED:   COLORS.muted,
  DEFERRED:    COLORS.amber,
  FAILED:      COLORS.coral
};

module.exports = {
  key: 'maintenance',
  docCode: 'CAE-MNT-05',
  theme: 'maintenance',
  title: 'Maintenance Records Report',
  subtitle: 'Corrective & preventive interventions, downtime impact and cost analysis',
  category: 'MAINTENANCE INTELLIGENCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, type, search } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.scheduled_date = {};
      if (range.from) where.scheduled_date[Op.gte] = range.from;
      if (range.to) where.scheduled_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { description: { [Op.like]: q } }
      ];
    }

    const records = await MaintenanceRecord.findAll({
      where,
      include: [
        { model: Asset, as: 'asset', attributes: ['name', 'serial_number'] },
        { model: User, as: 'technician', attributes: ['first_name', 'last_name'] }
      ],
      order: [['scheduled_date', 'DESC']]
    });

    let totalCost = 0;
    let totalDowntime = 0;
    let failedCount = 0;
    let criticalOpen = 0;
    const byStatus = {};
    const costByType = {};
    const assetStats = {};

    records.forEach((r) => {
      const cost = toNumber(r.cost, 0);
      const down = toNumber(r.downtime_hours, 0);
      totalCost += cost;
      totalDowntime += down;

      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      costByType[r.type] = (costByType[r.type] || 0) + cost;

      const assetName = r.asset?.name || 'Unassigned Asset';
      if (!assetStats[assetName]) {
        assetStats[assetName] = { asset: assetName, orders: 0, failed: 0, downtime: 0, cost: 0 };
      }
      assetStats[assetName].orders += 1;
      if (r.status === 'FAILED') assetStats[assetName].failed += 1;
      assetStats[assetName].downtime += down;
      assetStats[assetName].cost += cost;

      if (r.status === 'FAILED') failedCount += 1;
      if (r.priority === 'CRITICAL' && r.status !== 'COMPLETED') criticalOpen += 1;
    });

    const total = records.length;
    const completed = byStatus.COMPLETED || 0;
    const completionRate = pct(completed, total);
    const assetSummaryRows = Object.values(assetStats)
      .map((a) => ({
        ...a,
        downtime: Number(a.downtime.toFixed(2)),
        cost: Number(a.cost.toFixed(2)),
        _flag: a.failed > 0 ? 'danger' : (a.cost > 5000 ? 'warning' : undefined)
      }))
      .sort((a, b) => b.cost - a.cost || b.downtime - a.downtime);

    const topAsset = assetSummaryRows[0];
    const topCostAssets = assetSummaryRows.slice(0, 7);
    const typeTop = topEntries(costByType, 6);
    const statusKeys = Object.keys(byStatus);

    const insights = [];
    if (failedCount > 0 || criticalOpen > 0) {
      insights.push({
        severity: 'danger',
        title: `${failedCount} Failed · ${criticalOpen} Critical Pending Interventions`,
        detail: 'Immediate engineering review required to restore equipment reliability and clear SLA exposure.'
      });
    }
    if (topAsset && topAsset.cost > 0) {
      insights.push({
        severity: 'warning',
        title: `Highest Cost Driver: ${topAsset.asset}`,
        detail: `Accumulated ${fmtMoney(topAsset.cost)} (${fmtPercent(pct(topAsset.cost, totalCost), 1)} of period spend across ${topAsset.orders} interventions).`
      });
    }
    if (!insights.length) {
      insights.push({
        severity: total > 0 ? 'success' : 'info',
        title: total > 0 ? 'Maintenance Operations Healthy' : 'No Maintenance Records Found',
        detail: total > 0
          ? `${completed} of ${total} interventions closed (${fmtPercent(completionRate, 1)}) with ${fmtHours(totalDowntime)} downtime.`
          : 'No records matched active filters.'
      });
    }

    const assetTable = {
      name: 'Asset Reliability & Cost Summary',
      priority: 'high',
      note: 'Spend, failure incidents and cumulative downtime grouped per asset.',
      columns: [
        { header: 'Asset', key: 'asset', width: 30 },
        { header: 'Orders', key: 'orders', width: 11, type: 'number', align: 'right', total: 'sum' },
        { header: 'Failed', key: 'failed', width: 11, type: 'number', align: 'right', total: 'sum' },
        { header: 'Downtime (h)', key: 'downtime', width: 15, type: 'number', decimals: 2, align: 'right', total: 'sum', dataBar: true },
        { header: 'Total Cost ($)', key: 'cost', width: 17, type: 'currency', align: 'right', total: 'sum', dataBar: true }
      ],
      rows: assetSummaryRows
    };

    const ledgerTable = {
      name: 'Maintenance Records Ledger',
      note: 'Individual maintenance records (priority, scheduled/completed dates & technician in Excel).',
      columns: [
        { header: '#', key: 'id', width: 7, type: 'mono', align: 'right', printHidden: true },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Asset', key: 'asset', width: 20 },
        { header: 'Type', key: 'type', width: 14 },
        { header: 'Status', key: 'status', width: 13, type: 'badge' },
        { header: 'Priority', key: 'priority', width: 11, printHidden: true },
        { header: 'Scheduled', key: 'scheduled', width: 15, printHidden: true },
        { header: 'Completed', key: 'completed', width: 15, printHidden: true },
        { header: 'Down (h)', key: 'downtime', width: 11, type: 'number', decimals: 2, align: 'right', total: 'sum', dataBar: true },
        { header: 'Cost ($)', key: 'cost', width: 13, type: 'currency', align: 'right', total: 'sum', dataBar: true },
        { header: 'Technician', key: 'technician', width: 16, printHidden: true }
      ],
      rows: records.map((r) => ({
        id: r.id,
        title: cleanText(r.title),
        asset: r.asset?.name || '—',
        type: r.type,
        status: r.status,
        priority: r.priority,
        scheduled: fmtDateTime(r.scheduled_date),
        completed: fmtDateTime(r.completed_date),
        downtime: r.downtime_hours !== null && r.downtime_hours !== undefined ? toNumber(r.downtime_hours, 0) : null,
        cost: r.cost !== null && r.cost !== undefined ? toNumber(r.cost, 0) : null,
        technician: fullName(r.technician),
        _badgeTone: STATUS_TONE[r.status] || 'neutral',
        _flag: r.priority === 'CRITICAL' && r.status !== 'COMPLETED' ? 'danger' : STATUS_TONE[r.status]
      }))
    };

    const pages = [
      {
        eyebrow: 'SECTION 01 · RELIABILITY ALERTS & COST',
        title: 'Critical Failures & Cost Hotspots',
        subtitle: 'Priority asset risks, cumulative expenditure and top-spend equipment ranking',
        blocks: [
          { type: 'alerts', items: insights },
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Total Spend', value: fmtMoney(totalCost), rawValue: Number(totalCost.toFixed(2)), numFmt: '$#,##0.00', sublabel: total > 0 ? `Avg ${fmtMoney(totalCost / total)} / intervention` : '$0.00', tone: 'primary' },
              { label: 'Interventions', value: fmtNumber(total), rawValue: total, numFmt: '#,##0', sublabel: `${completed} completed`, tone: 'info' },
              { label: 'Total Downtime', value: fmtHours(totalDowntime), rawValue: Number(totalDowntime.toFixed(2)), numFmt: '#,##0.0" h"', sublabel: `${(totalDowntime / Math.max(total, 1)).toFixed(1)}h average`, tone: totalDowntime > 24 ? 'warning' : 'info' },
              { label: 'Critical Pending', value: fmtNumber(criticalOpen), rawValue: criticalOpen, numFmt: '#,##0', sublabel: `${failedCount} failed orders`, tone: criticalOpen > 0 ? 'danger' : 'success' },
              { label: 'Closure Rate', value: fmtPercent(completionRate, 1), rawValue: completionRate, numFmt: '0.0"%"', sublabel: 'Closed interventions', tone: completionRate >= 80 ? 'success' : 'warning' }
            ]
          },
          {
            type: 'chart',
            height: 215,
            chart: {
              type: 'lollipop',
              title: 'Top Assets by Maintenance Cost ($)',
              subtitle: 'Equipment generating highest corrective/preventive expenditure',
              valueFormat: 'currency',
              labels: topCostAssets.map((a) => a.asset),
              values: topCostAssets.map((a) => a.cost)
            }
          }
        ]
      },
      {
        eyebrow: 'SECTION 02 · ASSET COST MATRIX',
        title: 'Asset Reliability & Discipline Breakdown',
        subtitle: 'Cost/downtime comparison across equipment types and lifecycle status',
        blocks: [
          {
            type: 'chartPair',
            height: 192,
            left: {
              type: 'hbar',
              title: 'Spend by Intervention Type ($)',
              valueFormat: 'currency',
              labels: typeTop.map(([k]) => k),
              values: typeTop.map(([, v]) => Number(v.toFixed(2)))
            },
            right: {
              type: 'donut',
              title: 'Interventions by Status',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', table: assetTable }
        ]
      },
      {
        eyebrow: 'SECTION 03 · WORK ORDERS LEDGER',
        title: 'Maintenance Records Ledger',
        subtitle: `Work order audit log for ${rangeLabel(range)}`,
        blocks: [
          { type: 'table', showHeading: false, table: ledgerTable }
        ]
      }
    ];

    return {
      moduleKey: 'maintenance',
      docCode: 'CAE-MNT-05',
      theme: 'maintenance',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Total Spend', value: fmtMoney(totalCost) },
        { label: 'Equipment Downtime', value: fmtHours(totalDowntime) },
        { label: 'Interventions', value: `${completed}/${total}` }
      ],
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Priority', value: priority || 'All' },
        { label: 'Type', value: type || 'All' },
        { label: 'Total Records', value: fmtNumber(total) }
      ],
      pages
    };
  }
};
