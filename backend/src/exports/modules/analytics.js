// =============================================================================
// exports/modules/analytics.js — Financial & BI Intelligence Review (CAE-BI-02)
// Blueprint:
//   P1 Cover -> P2 Financial Cost Drivers (Brief + Compact KPIs + Lollipop Cost + Highlights)
//   -> P3 Supply Chain Velocity & Task Cadence (Full Line + GroupedBar + Flow Spotlights)
//   -> P4 Cross-Module Benchmarks (Maint Reliability Table + Ops By Type Table + Alerts)
// =============================================================================
const { sequelize } = require('../../models');
const {
  fmtNumber, fmtMoney, fmtPercent, fmtHours, parseRange, rangeLabel, toNumber, pct
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

module.exports = {
  key: 'analytics',
  docCode: 'CAE-BI-02',
  theme: 'analytics',
  title: 'Executive Operational Intelligence Report',
  subtitle: 'Cross-module KPIs, cost & downtime drivers, stock velocity and workforce attendance',
  category: 'BUSINESS INTELLIGENCE',
  orientation: 'portrait',

  async build(req) {
    const parsedRange = parseRange(req.query);
    let from = parsedRange.from;
    let to = parsedRange.to;

    if (!from && !to && req.query.period) {
      const p = String(req.query.period).trim().toLowerCase();
      const now = new Date();
      const dayMs = 86400000;
      if (p === '7d') {
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0) - 6 * dayMs);
      } else if (p === '30d') {
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0) - 29 * dayMs);
      } else if (p === '90d') {
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0) - 89 * dayMs);
      } else if (p === 'ytd' || p === 'yearly') {
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      } else if (p === 'daily') {
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      } else if (p === 'weekly') {
        const dow = now.getUTCDay();
        const monOffset = dow === 0 ? -6 : 1 - dow;
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + monOffset, 0, 0, 0, 0));
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + monOffset + 6, 23, 59, 59, 999));
      } else if (p === 'monthly') {
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      }
    }

    const range = { ...parsedRange, from, to };
    const replacements = {};
    const dateCond = (colName) => {
      let sql = '';
      if (range.from) { sql += ` AND ${colName} >= :startDate`; replacements.startDate = range.from; }
      if (range.to)   { sql += ` AND ${colName} <= :endDate`; replacements.endDate = range.to; }
      return sql;
    };

    const stockCond = range.from || range.to
      ? dateCond('movement_date')
      : ' AND movement_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';

    const [
      [opsKpisRows],
      [maintKpisRows],
      [stockKpisRows],
      [taskKpisRows],
      [shiftKpisRows],
      [opsByTypeRows],
      [opsByStatusRows],
      [maintOverviewRows],
      [stockFlowRows],
      [taskIntervalRows]
    ] = await Promise.all([
      sequelize.query(`
        SELECT COUNT(*) as totalOps,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completedOps
        FROM operations WHERE 1=1 ${dateCond('start_date')}`, { replacements }),
      sequelize.query(`
        SELECT COALESCE(SUM(cost), 0) as totalCost,
          COALESCE(SUM(downtime_hours), 0) as totalDowntime
        FROM maintenance_records WHERE deleted_at IS NULL ${dateCond('scheduled_date')}`, { replacements }),
      sequelize.query(`
        SELECT COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) as stockIn,
          COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) as stockOut
        FROM stock_movements WHERE 1=1 ${dateCond('movement_date')}`, { replacements }),
      sequelize.query(`
        SELECT COUNT(*) as totalTasks,
          SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as completedTasks
        FROM tasks WHERE 1=1 ${dateCond('created_at')}`, { replacements }),
      sequelize.query(`
        SELECT COUNT(*) as totalShifts,
          SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) as totalAbsences
        FROM shifts WHERE deleted_at IS NULL ${dateCond('date')}`, { replacements }),
      sequelize.query(`
        SELECT ot.name as type, COUNT(o.id) as total,
          SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN o.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress
        FROM operation_types ot
        LEFT JOIN operations o ON o.type_id = ot.id ${range.from ? 'AND o.start_date >= :startDate' : ''} ${range.to ? 'AND o.start_date <= :endDate' : ''}
        GROUP BY ot.id, ot.name ORDER BY total DESC`, { replacements }),
      sequelize.query(`
        SELECT status, COUNT(*) as count
        FROM operations WHERE 1=1 ${dateCond('start_date')}
        GROUP BY status`, { replacements }),
      sequelize.query(`
        SELECT type, status, COUNT(*) as count,
          COALESCE(SUM(downtime_hours), 0) as sum_downtime,
          COALESCE(SUM(cost), 0) as total_cost
        FROM maintenance_records WHERE deleted_at IS NULL ${dateCond('scheduled_date')}
        GROUP BY type, status ORDER BY count DESC`, { replacements }),
      sequelize.query(`
        SELECT DATE(movement_date) as date,
          SUM(CASE WHEN type IN ('IN','RETURN') THEN quantity ELSE 0 END) as qty_in,
          SUM(CASE WHEN type IN ('OUT','TRANSFER') THEN quantity ELSE 0 END) as qty_out
        FROM stock_movements WHERE 1=1 ${stockCond}
        GROUP BY DATE(movement_date) ORDER BY date ASC`, { replacements }),
      sequelize.query(`
        SELECT interval_type,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as done
        FROM tasks WHERE 1=1 ${dateCond('created_at')}
        GROUP BY interval_type ORDER BY total DESC`, { replacements })
    ]);

    const opsTotal = toNumber(opsKpisRows[0]?.totalOps, 0);
    const opsComp = toNumber(opsKpisRows[0]?.completedOps, 0);
    const opsRate = pct(opsComp, opsTotal);

    const maintCost = toNumber(maintKpisRows[0]?.totalCost, 0);
    const maintDowntime = toNumber(maintKpisRows[0]?.totalDowntime, 0);

    const stockIn = toNumber(stockKpisRows[0]?.stockIn, 0);
    const stockOut = toNumber(stockKpisRows[0]?.stockOut, 0);
    const netStock = stockIn - stockOut;

    const tasksTotal = toNumber(taskKpisRows[0]?.totalTasks, 0);
    const tasksComp = toNumber(taskKpisRows[0]?.completedTasks, 0);
    const taskRate = pct(tasksComp, tasksTotal);

    const shiftsTotal = toNumber(shiftKpisRows[0]?.totalShifts, 0);
    const shiftsAbs = toNumber(shiftKpisRows[0]?.totalAbsences, 0);
    const attendanceRate = shiftsTotal > 0 ? pct(shiftsTotal - shiftsAbs, shiftsTotal) : 100;

    const maintTypes = Array.from(new Set(maintOverviewRows.map((r) => r.type)));
    const maintSummaryRows = maintTypes.map((t) => {
      const rows = maintOverviewRows.filter((r) => r.type === t);
      const count = rows.reduce((s, r) => s + toNumber(r.count, 0), 0);
      const completed = rows.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + toNumber(r.count, 0), 0);
      const failed = rows.filter((r) => r.status === 'FAILED').reduce((s, r) => s + toNumber(r.count, 0), 0);
      const totalDown = rows.reduce((s, r) => s + toNumber(r.sum_downtime, 0), 0);
      const totalCostType = rows.reduce((s, r) => s + toNumber(r.total_cost, 0), 0);
      const weightedAvgDown = count > 0 ? totalDown / count : 0;
      const compRate = pct(completed, count);

      return {
        type: t,
        count,
        completed,
        failed,
        avg_downtime: Number(weightedAvgDown.toFixed(2)),
        total_cost: Number(totalCostType.toFixed(2)),
        completion_rate: Number(compRate.toFixed(1)),
        _flag: failed > 0 ? 'danger' : (compRate >= 80 ? 'success' : 'warning')
      };
    }).sort((a, b) => b.total_cost - a.total_cost);

    const topCostType = maintSummaryRows[0];
    const insights = [];
    if (topCostType && topCostType.total_cost > 0) {
      insights.push({
        severity: topCostType.failed > 0 ? 'warning' : 'info',
        title: `Primary Maintenance Cost Driver: ${topCostType.type}`,
        detail: `Represented ${fmtMoney(topCostType.total_cost)} across ${topCostType.count} work orders (avg ${topCostType.avg_downtime}h downtime).`
      });
    }
    if (opsRate < 70 && opsTotal > 0) {
      insights.push({
        severity: 'warning',
        title: `Operation Completion Rate Below Target (${fmtPercent(opsRate, 1)})`,
        detail: `${opsComp} of ${opsTotal} operations reached COMPLETED in the selected period.`
      });
    }
    if (shiftsAbs > 0) {
      insights.push({
        severity: attendanceRate < 90 ? 'danger' : 'info',
        title: `Workforce Attendance: ${fmtPercent(attendanceRate, 1)} (${shiftsAbs} Absences)`,
        detail: `${shiftsTotal - shiftsAbs} of ${shiftsTotal} scheduled shifts attended without absence.`
      });
    }
    if (!insights.length) {
      insights.push({
        severity: 'success',
        title: 'Cross-Module Operational Performance Healthy',
        detail: `${fmtPercent(opsRate, 1)} operation completion, ${fmtPercent(taskRate, 1)} task completion, ${fmtPercent(attendanceRate, 1)} attendance.`
      });
    }

    const brief = `BI review for ${rangeLabel(range)}: total maintenance expenditure reached ${fmtMoney(maintCost)} across ${fmtHours(maintDowntime)} downtime. Delivery efficiency stands at ${fmtPercent(opsRate, 1)} operations and ${fmtPercent(taskRate, 1)} tasks, backed by ${fmtPercent(attendanceRate, 1)} attendance and ${netStock >= 0 ? '+' : ''}${fmtNumber(netStock)} net inventory flow.`;

    const costSpotlights = [
      {
        eyebrow: 'COST DRIVER',
        metric: topCostType ? fmtMoney(topCostType.total_cost) : '$0.00',
        title: topCostType ? `${topCostType.type} Maintenance` : 'No Spend Logged',
        detail: topCostType ? `${topCostType.count} work orders · ${fmtPercent(topCostType.completion_rate, 1)} closed.` : 'Zero maintenance spend.',
        tone: topCostType?.failed > 0 ? 'warning' : 'info'
      },
      {
        eyebrow: 'WORKFORCE SLA',
        metric: fmtPercent(attendanceRate, 1),
        title: `${shiftsTotal - shiftsAbs}/${shiftsTotal} Shifts Attended`,
        detail: `${shiftsAbs} recorded absence${shiftsAbs === 1 ? '' : 's'} in window.`,
        tone: attendanceRate >= 95 ? 'success' : 'danger'
      }
    ];

    const flowSpotlights = [
      {
        eyebrow: 'INVENTORY FLOW',
        metric: `${netStock >= 0 ? '+' : ''}${fmtNumber(netStock)} units`,
        title: netStock >= 0 ? 'Net Stock Accumulation' : 'Net Stock Drawdown',
        detail: `+${fmtNumber(stockIn)} inbound vs -${fmtNumber(stockOut)} outbound movements.`,
        tone: netStock >= 0 ? 'success' : 'warning'
      },
      {
        eyebrow: 'EXECUTION RATIO',
        metric: fmtPercent(opsRate, 1),
        title: 'Operations vs Tasks Delivery',
        detail: `Ops ${opsComp}/${opsTotal} · Tasks ${tasksComp}/${tasksTotal} (${fmtPercent(taskRate, 1)}).`,
        tone: opsRate >= 75 ? 'success' : 'warning'
      }
    ];

    const maintTable = {
      name: 'Maintenance Cost & Reliability Summary',
      note: 'Spend, failures and weighted average downtime aggregated by intervention type.',
      columns: [
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Orders', key: 'count', width: 11, type: 'number', align: 'right', total: 'sum' },
        { header: 'Completed', key: 'completed', width: 12, type: 'number', align: 'right', total: 'sum', printHidden: true },
        { header: 'Failed', key: 'failed', width: 10, type: 'number', align: 'right', total: 'sum' },
        { header: 'Avg Down (h)', key: 'avg_downtime', width: 14, type: 'number', decimals: 2, align: 'right', total: 'avg' },
        { header: 'Total Cost ($)', key: 'total_cost', width: 16, type: 'currency', align: 'right', total: 'sum', dataBar: true },
        { header: 'Comp. (%)', key: 'completion_rate', width: 13, type: 'percent', decimals: 1, align: 'right' }
      ],
      rows: maintSummaryRows
    };

    const opsTypeTable = {
      name: 'Operations Performance by Type',
      note: 'Throughput and completion efficiency per operational category.',
      columns: [
        { header: 'Operation Type', key: 'type', width: 32 },
        { header: 'Total', key: 'total', width: 13, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Completed', key: 'completed', width: 13, type: 'number', align: 'right', total: 'sum' },
        { header: 'In Progress', key: 'in_progress', width: 13, type: 'number', align: 'right', total: 'sum' },
        { header: 'Rate (%)', key: 'rate', width: 14, type: 'percent', decimals: 1, align: 'right' }
      ],
      rows: opsByTypeRows.map((r) => {
        const tot = toNumber(r.total, 0);
        const comp = toNumber(r.completed, 0);
        return {
          type: r.type,
          total: tot,
          completed: comp,
          in_progress: toNumber(r.in_progress, 0),
          rate: Number(pct(comp, tot).toFixed(1))
        };
      })
    };

    const pages = [
      {
        eyebrow: 'SECTION 01 · FINANCIAL COST DRIVERS',
        title: 'Financial Overview & Expenditure Drivers',
        subtitle: 'Maintenance spend allocation and cross-module financial efficiency',
        blocks: [
          { type: 'brief', title: 'Executive BI Summary', text: brief },
          {
            type: 'kpis',
            variant: 'compact-row',
            items: [
              { label: 'Maint. Spend', value: fmtMoney(maintCost), rawValue: Number(maintCost.toFixed(2)), numFmt: '$#,##0.00', sublabel: `${fmtHours(maintDowntime)} down`, tone: 'primary' },
              { label: 'Ops Delivery', value: fmtPercent(opsRate, 1), rawValue: opsRate, numFmt: '0.0"%"', sublabel: `${opsComp}/${opsTotal} closed`, tone: opsRate >= 75 ? 'success' : 'warning' },
              { label: 'Task Delivery', value: fmtPercent(taskRate, 1), rawValue: taskRate, numFmt: '0.0"%"', sublabel: `${tasksComp}/${tasksTotal} done`, tone: taskRate >= 70 ? 'success' : 'warning' },
              { label: 'Attendance', value: fmtPercent(attendanceRate, 1), rawValue: attendanceRate, numFmt: '0.0"%"', sublabel: `${shiftsAbs} absences`, tone: attendanceRate >= 95 ? 'success' : 'danger' }
            ]
          },
          {
            type: 'chart',
            height: 220,
            chart: {
              type: 'lollipop',
              title: 'Maintenance Cost Ranking by Type ($)',
              subtitle: 'Expenditure concentration across intervention categories',
              valueFormat: 'currency',
              labels: maintSummaryRows.map((r) => r.type),
              values: maintSummaryRows.map((r) => r.total_cost)
            }
          },
          { type: 'highlights', items: costSpotlights }
        ]
      },
      {
        eyebrow: 'SECTION 02 · VELOCITY & CADENCE',
        title: 'Supply Chain Velocity & Task Cadence',
        subtitle: 'Warehouse flow trajectory and recurring deliverable throughput',
        blocks: [
          {
            type: 'chart',
            height: 224,
            chart: {
              type: 'line',
              fullWidth: true,
              title: 'Warehouse Stock Velocity (IN vs OUT)',
              subtitle: 'Daily inbound receipts compared with outbound dispatches',
              labels: stockFlowRows.map((r) => String(r.date)),
              series: [
                { name: 'Stock IN', data: stockFlowRows.map((r) => toNumber(r.qty_in, 0)), color: COLORS.teal },
                { name: 'Stock OUT', data: stockFlowRows.map((r) => toNumber(r.qty_out, 0)), color: COLORS.coral }
              ]
            }
          },
          {
            type: 'chartPair',
            height: 196,
            left: {
              type: 'groupedBar',
              title: 'Task Completion by Interval',
              labels: taskIntervalRows.map((r) => r.interval_type),
              series: [
                { name: 'Total', data: taskIntervalRows.map((r) => toNumber(r.total, 0)), color: COLORS.cobalt },
                { name: 'Done', data: taskIntervalRows.map((r) => toNumber(r.done, 0)), color: COLORS.teal }
              ]
            },
            right: {
              type: 'donut',
              title: 'Operations Status Share',
              labels: opsByStatusRows.map((r) => r.status),
              values: opsByStatusRows.map((r) => toNumber(r.count, 0))
            }
          },
          { type: 'highlights', items: flowSpotlights }
        ]
      },
      {
        eyebrow: 'SECTION 03 · PERFORMANCE BENCHMARKS',
        title: 'Cross-Module Benchmark Matrices',
        subtitle: 'Aggregated maintenance cost reliability & operational category closure',
        blocks: [
          { type: 'alerts', items: insights },
          { type: 'table', table: maintTable },
          { type: 'table', table: opsTypeTable }
        ]
      }
    ];

    return {
      moduleKey: 'analytics',
      docCode: 'CAE-BI-02',
      theme: 'analytics',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Maint. Expenditure', value: fmtMoney(maintCost) },
        { label: 'Ops Completion', value: fmtPercent(opsRate, 1) },
        { label: 'Shift Attendance', value: fmtPercent(attendanceRate, 1) }
      ],
      filters: [
        { label: 'Analysis Period', value: rangeLabel(range) },
        { label: 'Operations', value: fmtNumber(opsTotal) },
        { label: 'Tasks', value: fmtNumber(tasksTotal) },
        { label: 'Shifts', value: fmtNumber(shiftsTotal) }
      ],
      pages
    };
  }
};
