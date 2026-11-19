// =============================================================================
// exports/modules/operations-analytics.js — Telemetry Study (CAE-TEL-04)
// Blueprint:
//   P1 Cover -> P2 Throughput Curve & Peak Window (Line Chart FIRST + Telemetry StatMatrix + Brief)
//   -> P3 Discipline Effort Analysis (Lollipop Chart + Time Distribution Table)
//   -> P4 Lifecycle Mix & Period Velocity Log (Status Donut + Period Velocity Table)
// =============================================================================
const { sequelize } = require('../../models');
const {
  fmtNumber, fmtPercent, fmtDurationMin, parseRange, rangeLabel, toNumber
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_COLORS = {
  COMPLETED:   COLORS.successAccent,
  IN_PROGRESS: COLORS.accent,
  PLANNED:     COLORS.muted,
  ON_HOLD:     COLORS.amber,
  CANCELLED:   COLORS.coral
};

module.exports = {
  key: 'operations-analytics',
  docCode: 'CAE-TEL-04',
  theme: 'operations-analytics',
  title: 'Operations Analytics & Performance Report',
  subtitle: 'Time investment, operational velocity, peak hours and type breakdown',
  category: 'OPERATIONS ANALYTICS',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const period = req.query.period || 'all';
    const granularity = ['hour', 'day', 'week', 'month'].includes(req.query.granularity)
      ? req.query.granularity
      : 'day';

    let dateFilter = '';
    const replacements = {};
    if (period === 'daily') {
      dateFilter = 'AND DATE(o.start_date) = CURDATE()';
    } else if (period === 'weekly') {
      dateFilter = 'AND YEARWEEK(o.start_date, 1) = YEARWEEK(CURDATE(), 1)';
    } else if (period === 'monthly') {
      dateFilter = 'AND YEAR(o.start_date) = YEAR(CURDATE()) AND MONTH(o.start_date) = MONTH(CURDATE())';
    } else if (period === 'yearly') {
      dateFilter = 'AND YEAR(o.start_date) = YEAR(CURDATE())';
    } else {
      if (range.from) { dateFilter += ' AND o.start_date >= :startDate'; replacements.startDate = range.from; }
      if (range.to)   { dateFilter += ' AND o.start_date <= :endDate'; replacements.endDate = range.to; }
    }

    let selectExpr = 'DATE(o.start_date)';
    let groupExpr = 'DATE(o.start_date)';
    if (granularity === 'hour') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-%d %H:00')";
      groupExpr = selectExpr;
    } else if (granularity === 'week') {
      selectExpr = "DATE_FORMAT(DATE_SUB(o.start_date, INTERVAL WEEKDAY(o.start_date) DAY), '%Y-%m-%d')";
      groupExpr = 'YEARWEEK(o.start_date, 1)';
    } else if (granularity === 'month') {
      selectExpr = "DATE_FORMAT(o.start_date, '%Y-%m-01')";
      groupExpr = "DATE_FORMAT(o.start_date, '%Y-%m')";
    }

    const [[metricsRows], [trendRows], [timeDistRows], [statusRows], [peakRows]] = await Promise.all([
      sequelize.query(`
        SELECT
          COUNT(*) as totalOperations,
          COALESCE(SUM(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE 0 END), 0) as totalMinutes,
          COALESCE(AVG(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as avgDuration,
          COALESCE(MAX(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as maxDuration,
          COALESCE(ROUND((SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 1), 0) as completionRate
        FROM operations o
        WHERE 1=1 ${dateFilter}`, { replacements }),
      sequelize.query(`
        SELECT
          ${selectExpr} as date,
          COUNT(*) as count,
          COALESCE(ROUND(AVG(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 1), 0) as avgDuration
        FROM operations o
        WHERE o.end_date IS NOT NULL ${dateFilter}
        GROUP BY ${groupExpr}
        ORDER BY date ASC`, { replacements }),
      sequelize.query(`
        SELECT
          ot.name as type,
          ot.color,
          COUNT(*) as count,
          COALESCE(SUM(TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date)), 0) as totalMinutes
        FROM operations o
        JOIN operation_types ot ON o.type_id = ot.id
        WHERE o.end_date IS NOT NULL ${dateFilter}
        GROUP BY ot.id, ot.name, ot.color
        ORDER BY totalMinutes DESC`, { replacements }),
      sequelize.query(`
        SELECT o.status, COUNT(*) as count
        FROM operations o
        WHERE 1=1 ${dateFilter}
        GROUP BY o.status`, { replacements }),
      sequelize.query(`
        SELECT DAYNAME(o.start_date) as dayName, HOUR(o.start_date) as hour, COUNT(*) as count
        FROM operations o
        WHERE 1=1 ${dateFilter}
        GROUP BY DAYNAME(o.start_date), HOUR(o.start_date)
        ORDER BY count DESC
        LIMIT 1`, { replacements })
    ]);

    const m = metricsRows[0] || {};
    const peak = peakRows[0] || {};
    const totalOps = toNumber(m.totalOperations, 0);
    const totalMinutes = toNumber(m.totalMinutes, 0);
    const avgDuration = toNumber(m.avgDuration, 0);
    const maxDuration = toNumber(m.maxDuration, 0);
    const completionRate = toNumber(m.completionRate, 0);
    const topType = timeDistRows[0];

    const timeDistTable = {
      name: 'Time Distribution by Operation Type',
      columns: [
        { header: 'Operation Type', key: 'type', width: 28 },
        { header: 'Sorties', key: 'count', width: 12, type: 'number', align: 'right', total: 'sum' },
        { header: 'Minutes', key: 'minutes', width: 15, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Hours', key: 'hours', width: 13, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Share (%)', key: 'share', width: 14, type: 'percent', decimals: 1, align: 'right' }
      ],
      rows: timeDistRows.map((r) => {
        const mins = toNumber(r.totalMinutes, 0);
        return {
          type: r.type,
          count: toNumber(r.count, 0),
          minutes: mins,
          hours: Number((mins / 60).toFixed(1)),
          share: totalMinutes > 0 ? Number(((mins / totalMinutes) * 100).toFixed(1)) : 0
        };
      })
    };

    const velocityTable = {
      name: 'Period Velocity Breakdown',
      columns: [
        { header: 'Period', key: 'date', width: 24 },
        { header: 'Operations', key: 'count', width: 18, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Avg Duration (min)', key: 'avgDuration', width: 22, type: 'number', decimals: 1, align: 'right', total: 'avg' }
      ],
      rows: trendRows.map((r) => ({
        date: String(r.date),
        count: toNumber(r.count, 0),
        avgDuration: toNumber(r.avgDuration, 0)
      }))
    };

    const brief = `Telemetry review (${granularity.toUpperCase()} bucket): evaluated ${fmtNumber(totalOps)} operational sorties totaling ${fmtDurationMin(totalMinutes)} (${(totalMinutes / 60).toFixed(1)} hours). Mean runtime is ${fmtDurationMin(avgDuration)} (max single operation ${fmtDurationMin(maxDuration)}) with ${fmtPercent(completionRate, 1)} closure.`;

    const telemetryPairs = [
      ['Peak Demand Window', peak.dayName ? `${peak.dayName} · ${String(peak.hour).padStart(2, '0')}:00 (${peak.count} ops)` : 'Uniform / None'],
      ['Primary Consumer', topType ? `${topType.type} (${fmtDurationMin(topType.totalMinutes)})` : '—'],
      ['Mean Sortie Duration', fmtDurationMin(avgDuration)],
      ['Longest Sortie', fmtDurationMin(maxDuration)],
      ['Completion Efficiency', fmtPercent(completionRate, 1)],
      ['Series Resolution', `${granularity.toUpperCase()} (${trendRows.length} buckets)`]
    ];

    const pages = [
      {
        eyebrow: 'SECTION 01 · THROUGHPUT CURVE',
        title: 'Throughput Curve & Peak Demand Window',
        subtitle: 'Operational velocity trajectory paired with runtime telemetry benchmarks',
        blocks: [
          {
            type: 'chart',
            height: 238,
            chart: {
              type: 'line',
              fullWidth: true,
              title: `Operational Volume Trend (${granularity})`,
              subtitle: 'Chronological sortie throughput curve',
              labels: trendRows.map((r) => String(r.date)),
              series: [{ name: 'Operations', data: trendRows.map((r) => toNumber(r.count, 0)), color: COLORS.accent }]
            }
          },
          { type: 'statMatrix', title: 'Peak Demand & Runtime Telemetry', pairs: telemetryPairs },
          { type: 'brief', title: 'Telemetry Interpretation', text: brief }
        ]
      },
      {
        eyebrow: 'SECTION 02 · DISCIPLINE ALLOCATION',
        title: 'Effort Allocation by Operational Discipline',
        subtitle: 'Time invested across operation types with exact hourly and percentage splits',
        blocks: [
          {
            type: 'chart',
            height: 215,
            chart: {
              type: 'lollipop',
              title: 'Time Invested by Operation Type (min)',
              subtitle: 'Ranked cumulative minutes per discipline',
              labels: timeDistRows.map((r) => r.type),
              values: timeDistRows.map((r) => toNumber(r.totalMinutes, 0))
            }
          },
          { type: 'table', table: timeDistTable }
        ]
      },
      {
        eyebrow: 'SECTION 03 · LIFECYCLE & VELOCITY LOG',
        title: 'Status Mix & Period Velocity Log',
        subtitle: 'Lifecycle state share and chronological throughput register',
        blocks: [
          {
            type: 'chart',
            height: 200,
            chart: {
              type: 'donut',
              title: 'Status Distribution',
              labels: statusRows.map((r) => r.status),
              values: statusRows.map((r) => toNumber(r.count, 0)),
              colors: statusRows.map((r) => STATUS_COLORS[r.status] || COLORS.accent)
            }
          },
          { type: 'table', table: velocityTable }
        ]
      }
    ];

    return {
      moduleKey: 'operations-analytics',
      docCode: 'CAE-TEL-04',
      theme: 'operations-analytics',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Total Sorties', value: fmtNumber(totalOps) },
        { label: 'Cumulative Effort', value: `${(totalMinutes / 60).toFixed(1)} h` },
        { label: 'Avg Duration', value: fmtDurationMin(avgDuration) }
      ],
      filters: [
        { label: 'Period', value: period !== 'all' ? period.toUpperCase() : rangeLabel(range) },
        { label: 'Granularity', value: granularity.toUpperCase() },
        { label: 'Total Operations', value: fmtNumber(totalOps) }
      ],
      kpis: [
        { label: 'Total Operations', value: fmtNumber(totalOps), rawValue: totalOps, numFmt: '#,##0', tone: 'info' },
        { label: 'Total Time', value: fmtDurationMin(totalMinutes), rawValue: totalMinutes, numFmt: '#,##0" min"', tone: 'primary' },
        { label: 'Avg Duration', value: fmtDurationMin(avgDuration), rawValue: Math.round(avgDuration), numFmt: '#,##0" min"', tone: 'info' },
        { label: 'Completion', value: fmtPercent(completionRate, 1), rawValue: completionRate, numFmt: '0.0"%"', tone: completionRate >= 75 ? 'success' : 'warning' }
      ],
      pages
    };
  }
};
