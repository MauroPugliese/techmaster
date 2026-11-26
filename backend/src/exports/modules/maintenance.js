// =============================================================================
// exports/modules/maintenance.js — Reliability, Snags & Asset Cost Audit (CAE-MNT-05)
// Blueprint:
//   P1 Cover -> P2 Critical Failures, MEL Alerts, MTTR/MTBF & Top Faulty Assets/Simulators
//   -> P3 Reliability Breakdown (Preventive vs Corrective, Top Faulty Subsystems & Asset/Bay Matrix)
//   -> P4+ Enriched Maintenance Work Orders Ledger (Simulator Bay, Subsystem, Parts & Costs)
// =============================================================================
const { Op } = require('sequelize');
const { MaintenanceRecord, Asset, Simulator, WikiArticle, User } = require('../../models');
const { computeReliabilityMetrics } = require('../../services/maintenance-helpers.service');
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

function resolveEquipmentName(r) {
  if (r.simulator) return `${r.simulator.bay_code} · ${r.simulator.name}`;
  if (r.asset) return r.asset.name;
  return 'Facility / Unassigned';
}

function formatPartsSummary(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return '—';
  return parts.map(p => `${p.sku || p.name} ×${p.quantity}`).join(', ');
}

module.exports = {
  key: 'maintenance',
  docCode: 'CAE-MNT-05',
  theme: 'maintenance',
  title: 'Maintenance & Reliability Engineering Report',
  subtitle: 'Simulator snags, preventive vs corrective split, MEL exposure, subsystem faults & spare parts cost',
  category: 'MAINTENANCE INTELLIGENCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority, type, search, simulator_id, is_snag, severity, subsystem_code, mel_category } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.scheduled_date = {};
      if (range.from) where.scheduled_date[Op.gte] = range.from;
      if (range.to) where.scheduled_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (simulator_id && Number(simulator_id) > 0) where.simulator_id = Number(simulator_id);
    if (is_snag === 'true') where.is_snag = true;
    if (severity && String(severity).trim()) where.severity = String(severity).trim().toUpperCase();
    if (subsystem_code && String(subsystem_code).trim()) where.subsystem_code = String(subsystem_code).trim().toUpperCase();
    if (mel_category && String(mel_category).trim()) {
      const m = String(mel_category).trim().toUpperCase();
      where.mel_category = m === 'ACTIVE' ? { [Op.ne]: 'NONE' } : m;
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { description: { [Op.like]: q } },
        { findings: { [Op.like]: q } }
      ];
    }

    const records = await MaintenanceRecord.findAll({
      where,
      include: [
        { model: Asset, as: 'asset', attributes: ['id', 'name', 'serial_number'], required: false },
        { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'bay_code', 'name', 'station_kind'], required: false },
        { model: WikiArticle, as: 'wikiArticle', attributes: ['id', 'title'], required: false },
        { model: User, as: 'technician', attributes: ['first_name', 'last_name'] }
      ],
      order: [['scheduled_date', 'DESC']]
    });

    let totalCost = 0;
    let totalPartsCost = 0;
    let totalDowntime = 0;
    let totalLostTraining = 0;
    let failedCount = 0;
    let criticalOpen = 0;
    let aogOpen = 0;
    const byStatus = {};
    const costByType = {};
    const assetStats = {};

    records.forEach((r) => {
      const cost = toNumber(r.cost, 0);
      const pCost = toNumber(r.parts_cost, 0);
      const down = toNumber(r.downtime_hours, 0);
      const lost = toNumber(r.lost_training_hours, 0);
      totalCost += cost;
      totalPartsCost += pCost;
      totalDowntime += down;
      totalLostTraining += lost;

      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      costByType[r.type] = (costByType[r.type] || 0) + cost;

      const equipName = resolveEquipmentName(r);
      if (!assetStats[equipName]) {
        assetStats[equipName] = { asset: equipName, orders: 0, corrective: 0, failed: 0, downtime: 0, cost: 0 };
      }
      assetStats[equipName].orders += 1;
      if (r.type === 'CORRECTIVE' || r.is_snag) assetStats[equipName].corrective += 1;
      if (r.status === 'FAILED' || r.severity === 'AOG') assetStats[equipName].failed += 1;
      assetStats[equipName].downtime += down;
      assetStats[equipName].cost += cost;

      if (r.status === 'FAILED') failedCount += 1;
      if (r.priority === 'CRITICAL' && r.status !== 'COMPLETED') criticalOpen += 1;
      if (r.severity === 'AOG' && ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'].includes(r.status)) aogOpen += 1;
    });

    const plainRecords = records.map(r => r.get({ plain: true }));
    const reliability = computeReliabilityMetrics(plainRecords, 0);

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
      .sort((a, b) => b.downtime - a.downtime || b.cost - a.cost);

    const topAsset = assetSummaryRows[0];
    const topCostAssets = [...assetSummaryRows].sort((a, b) => b.cost - a.cost || b.orders - a.orders).slice(0, 7);
    const typeTop = topEntries(costByType, 6);
    const statusKeys = Object.keys(byStatus);

    const insights = [];
    if (aogOpen > 0 || failedCount > 0 || criticalOpen > 0) {
      insights.push({
        severity: 'danger',
        title: `${aogOpen} Open AOG · ${failedCount} Failed · ${criticalOpen} Critical Work Orders`,
        detail: `Total lost training impact: ${totalLostTraining.toFixed(1)} h. Prioritize AOG containment and RTS clearance.`
      });
    }
    if (reliability.activeMelCount > 0) {
      insights.push({
        severity: reliability.melExpiringSoonCount > 0 ? 'danger' : 'warning',
        title: `${reliability.activeMelCount} Active MEL / Deferred Defect(s) (${reliability.melExpiringSoonCount} Expiring <= 7d)`,
        detail: 'Verify spare parts availability and schedule corrective closure before MEL authority expiry.'
      });
    }
    if (topAsset && (topAsset.downtime > 0 || topAsset.cost > 0)) {
      insights.push({
        severity: 'warning',
        title: `Highest Exposure Unit: ${topAsset.asset}`,
        detail: `${fmtHours(topAsset.downtime)} downtime · ${fmtMoney(topAsset.cost)} spend across ${topAsset.orders} work order(s) (${topAsset.corrective} corrective).`
      });
    }
    if (!insights.length) {
      insights.push({
        severity: total > 0 ? 'success' : 'info',
        title: total > 0 ? 'Maintenance & Simulator Reliability Nominal' : 'No Maintenance Records Found',
        detail: total > 0
          ? `${completed} of ${total} interventions closed (${fmtPercent(completionRate, 1)}) · MTTR ${reliability.mttrHours} h.`
          : 'No records matched active filters.'
      });
    }

    const assetTable = {
      name: 'Simulator & Asset Reliability Matrix',
      priority: 'high',
      note: 'Work orders, corrective snag frequency, cumulative downtime and total cost grouped by Simulator Bay / Asset.',
      columns: [
        { header: 'Simulator Bay / Asset', key: 'asset', width: 150 },
        { header: 'Orders', key: 'orders', width: 48, type: 'number', align: 'right', total: 'sum' },
        { header: 'Corr.', key: 'corrective', width: 48, type: 'number', align: 'right', total: 'sum' },
        { header: 'AOG/Fail', key: 'failed', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Down (h)', key: 'downtime', width: 62, type: 'number', decimals: 2, align: 'right', total: 'sum', dataBar: true },
        { header: 'Total Cost ($)', key: 'cost', width: 78, type: 'currency', align: 'right', total: 'sum', dataBar: true }
      ],
      rows: assetSummaryRows
    };

    const ledgerTable = {
      name: 'Maintenance & Snags Work Orders Ledger',
      note: 'Detailed register including Simulator Bay/Asset, Subsystem, Severity, MEL, Spare Parts, Downtime & Costs.',
      columns: [
        { header: '#', key: 'id', width: 32, type: 'mono', align: 'right', printHidden: true },
        { header: 'Bay / Asset', key: 'asset', width: 96 },
        { header: 'Subsys.', key: 'subsystem', width: 54, type: 'mono' },
        { header: 'Title', key: 'title', width: 122 },
        { header: 'Type', key: 'type', width: 64 },
        { header: 'Sev.', key: 'severity', width: 52, type: 'badge', align: 'center', printHidden: true },
        { header: 'MEL', key: 'mel', width: 48, printHidden: true },
        { header: 'Status', key: 'status', width: 64, type: 'badge', align: 'center' },
        { header: 'Scheduled', key: 'scheduled', width: 74, printHidden: true },
        { header: 'Parts Used', key: 'parts', width: 105, printHidden: true },
        { header: 'Down (h)', key: 'downtime', width: 46, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Parts ($)', key: 'parts_cost', width: 60, type: 'currency', align: 'right', total: 'sum', printHidden: true },
        { header: 'Cost ($)', key: 'cost', width: 60, type: 'currency', align: 'right', total: 'sum', dataBar: true },
        { header: 'Engineer', key: 'technician', width: 78, printHidden: true },
        { header: 'SOP', key: 'sop', width: 95, printHidden: true }
      ],
      rows: records.map((r) => ({
        id: r.id,
        asset: cleanText(resolveEquipmentName(r), 34),
        subsystem: r.subsystem_code || 'GEN',
        title: cleanText(r.title, 48),
        type: r.is_snag ? 'SNAG' : r.type,
        severity: r.severity || 'MINOR',
        severity_tone: r.severity === 'AOG' ? 'danger' : (r.severity === 'DEGRADED' ? 'warning' : 'neutral'),
        mel: r.mel_category && r.mel_category !== 'NONE' ? r.mel_category : '—',
        status: r.status,
        status_tone: STATUS_TONE[r.status] || 'neutral',
        scheduled: fmtDateTime(r.scheduled_date),
        parts: formatPartsSummary(r.parts_used),
        downtime: r.downtime_hours != null ? toNumber(r.downtime_hours, 0) : 0,
        parts_cost: r.parts_cost != null ? toNumber(r.parts_cost, 0) : 0,
        cost: r.cost != null ? toNumber(r.cost, 0) : 0,
        technician: fullName(r.technician),
        sop: r.wikiArticle?.title ? cleanText(r.wikiArticle.title, 38) : '—',
        _flag: r.severity === 'AOG' || (r.priority === 'CRITICAL' && r.status !== 'COMPLETED') ? 'danger' : STATUS_TONE[r.status]
      }))
    };

    const pages = [
      {
        eyebrow: 'SECTION 01 · RELIABILITY ALERTS, MTTR & COST',
        title: 'Critical Failures, MEL Exposure & Cost Hotspots',
        subtitle: 'Preventive vs corrective reliability metrics, spare parts expenditure and top exposure bays',
        blocks: [
          { type: 'alerts', items: insights },
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Preventive / Corrective', value: `${reliability.preventiveCount} / ${reliability.correctiveCount}`, rawValue: total, sublabel: `${fmtPercent(completionRate, 1)} closed (${completed}/${total})`, tone: 'info' },
              { label: 'Mean Time To Repair', value: `${reliability.mttrHours} h`, rawValue: reliability.mttrHours, numFmt: '#,##0.0" h"', sublabel: `${fmtHours(totalDowntime)} total downtime`, tone: reliability.mttrHours > 4 ? 'warning' : 'success' },
              { label: 'Total Spend (Parts)', value: fmtMoney(totalCost), rawValue: Number(totalCost.toFixed(2)), numFmt: '$#,##0.00', sublabel: `${fmtMoney(totalPartsCost)} warehouse spares`, tone: 'primary' },
              { label: 'Open AOG / MEL', value: `${aogOpen} / ${reliability.activeMelCount}`, rawValue: aogOpen + reliability.activeMelCount, sublabel: `${reliability.melExpiringSoonCount} MEL expiring <=7d`, tone: aogOpen > 0 ? 'danger' : (reliability.activeMelCount > 0 ? 'warning' : 'success') },
              { label: 'Lost Training Hrs', value: fmtHours(totalLostTraining), rawValue: Number(totalLostTraining.toFixed(1)), sublabel: 'Snag-induced training loss', tone: totalLostTraining > 0 ? 'warning' : 'success' }
            ]
          },
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'lollipop',
              title: 'Top Faulty Subsystems by Incident Count',
              subtitle: 'Subsystems driving corrective work orders and technical snags',
              labels: reliability.topSubsystems.length
                ? reliability.topSubsystems.map(s => s.code)
                : topCostAssets.map(a => a.asset),
              values: reliability.topSubsystems.length
                ? reliability.topSubsystems.map(s => s.count)
                : topCostAssets.map(a => a.cost)
            }
          }
        ]
      },
      {
        eyebrow: 'SECTION 02 · SIMULATOR & ASSET MATRIX',
        title: 'Bay & Asset Reliability Matrix and Spend Mix',
        subtitle: 'Cost/downtime comparison across bays, intervention types and lifecycle statuses',
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
              title: 'Work Orders by Status',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', table: assetTable }
        ]
      },
      {
        eyebrow: 'SECTION 03 · WORK ORDERS & SNAGS LEDGER',
        title: 'Maintenance & Snags Ledger',
        subtitle: `Full work-order audit trail for ${rangeLabel(range)}`,
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
        { label: 'Prev / Corr Split', value: `${reliability.preventiveCount} / ${reliability.correctiveCount}` },
        { label: 'MTTR / Downtime', value: `${reliability.mttrHours}h / ${fmtHours(totalDowntime)}` },
        { label: 'Total Spend', value: fmtMoney(totalCost) }
      ],
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Type', value: type || 'All' },
        ...(simulator_id ? [{ label: 'Simulator ID', value: String(simulator_id) }] : []),
        ...(subsystem_code ? [{ label: 'Subsystem', value: subsystem_code }] : []),
        ...(severity ? [{ label: 'Severity', value: severity }] : []),
        ...(is_snag === 'true' ? [{ label: 'Scope', value: 'Simulator Snags Only' }] : []),
        { label: 'Total Records', value: fmtNumber(total) }
      ],
      pages
    };
  }
};
