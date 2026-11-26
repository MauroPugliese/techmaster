// =============================================================================
// exports/modules/operations-analytics.js — Telemetry & Simulator Utilization Study (CAE-TEL-04)
// Blueprint:
//   P1 Cover -> P2 Throughput Curve & Peak Window (Line Chart FIRST + Telemetry StatMatrix + Brief)
//   -> P3 Bay & Customer Utilization + TP/IOS Shift Hours (Lollipop + Bay/Lost-Min Scorecard)
//   -> P4 Discipline Effort, Lifecycle Mix & Period Velocity Log
// =============================================================================
const { sequelize } = require('../../models');
const { computeTestingDurationMinutes } = require('../../services/simulator-helpers.service');
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
  title: 'Operations Analytics & Simulator Telemetry Study',
  subtitle: 'Throughput curves, bay utilization, customer hours, lost training minutes & TP/IOS shift telemetry',
  category: 'OPERATIONS ANALYTICS',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const period = req.query.period || 'all';
    const granularity = ['hour', 'day', 'week', 'month'].includes(req.query.granularity)
      ? req.query.granularity
      : 'day';

    let dateFilter = '';
    let shiftDateFilter = '';
    const replacements = {};
    if (period === 'daily') {
      dateFilter = 'AND DATE(o.start_date) = CURDATE()';
      shiftDateFilter = 'AND dl.log_date = CURDATE()';
    } else if (period === 'weekly') {
      dateFilter = 'AND YEARWEEK(o.start_date, 1) = YEARWEEK(CURDATE(), 1)';
      shiftDateFilter = 'AND YEARWEEK(dl.log_date, 1) = YEARWEEK(CURDATE(), 1)';
    } else if (period === 'monthly') {
      dateFilter = 'AND YEAR(o.start_date) = YEAR(CURDATE()) AND MONTH(o.start_date) = MONTH(CURDATE())';
      shiftDateFilter = 'AND YEAR(dl.log_date) = YEAR(CURDATE()) AND MONTH(dl.log_date) = MONTH(CURDATE())';
    } else if (period === 'yearly') {
      dateFilter = 'AND YEAR(o.start_date) = YEAR(CURDATE())';
      shiftDateFilter = 'AND YEAR(dl.log_date) = YEAR(CURDATE())';
    } else {
      if (range.from) {
        dateFilter += ' AND o.start_date >= :startDate';
        shiftDateFilter += ' AND dl.log_date >= DATE(:startDate)';
        replacements.startDate = range.from;
      }
      if (range.to) {
        dateFilter += ' AND o.start_date <= :endDate';
        shiftDateFilter += ' AND dl.log_date <= DATE(:endDate)';
        replacements.endDate = range.to;
      }
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

    const [
      [metricsRows],
      [trendRows],
      [timeDistRows],
      [statusRows],
      [peakRows],
      [bayRows],
      [customerRows],
      [shiftEntriesRows]
    ] = await Promise.all([
      sequelize.query(`
        SELECT
          COUNT(*) as totalOperations,
          COALESCE(SUM(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE 0 END), 0) as totalMinutes,
          COALESCE(AVG(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as avgDuration,
          COALESCE(MAX(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE NULL END), 0) as maxDuration,
          COALESCE(SUM(COALESCE(o.lost_training_minutes, 0)), 0) as lostMinutes,
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
        LIMIT 1`, { replacements }),
      sequelize.query(`
        SELECT
          s.id, s.bay_code, s.name, s.station_kind,
          COUNT(o.id) as sorties,
          COALESCE(SUM(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE 0 END), 0) as sortieMinutes,
          COALESCE(SUM(COALESCE(o.lost_training_minutes, 0)), 0) as lostMinutes
        FROM operations o
        JOIN simulators s ON o.simulator_id = s.id
        WHERE 1=1 ${dateFilter}
        GROUP BY s.id, s.bay_code, s.name, s.station_kind
        ORDER BY sortieMinutes DESC`, { replacements }),
      sequelize.query(`
        SELECT
          COALESCE(NULLIF(TRIM(o.customer_operator), ''), 'Internal / Unassigned') as customer,
          COUNT(*) as sorties,
          COALESCE(SUM(CASE WHEN o.end_date IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.start_date, o.end_date) ELSE 0 END), 0) as totalMinutes,
          COALESCE(SUM(COALESCE(o.lost_training_minutes, 0)), 0) as lostMinutes
        FROM operations o
        WHERE 1=1 ${dateFilter}
        GROUP BY customer
        ORDER BY totalMinutes DESC
        LIMIT 8`, { replacements }),
      sequelize.query(`
        SELECT s.id as simulator_id, s.bay_code, s.name, s.station_kind, e.sim_testing_start, e.sim_testing_end, e.usage_status
        FROM simulator_shift_entries e
        JOIN simulator_daily_shifts sh ON e.shift_id = sh.id
        JOIN simulator_daily_logs dl ON sh.daily_log_id = dl.id
        JOIN simulators s ON e.simulator_id = s.id
        WHERE 1=1 ${shiftDateFilter}`, { replacements }).catch(() => [[]])
    ]);

    const m = metricsRows[0] || {};
    const peak = peakRows[0] || {};
    const totalOps = toNumber(m.totalOperations, 0);
    const totalMinutes = toNumber(m.totalMinutes, 0);
    const avgDuration = toNumber(m.avgDuration, 0);
    const maxDuration = toNumber(m.maxDuration, 0);
    const lostMinutes = toNumber(m.lostMinutes, 0);
    const completionRate = toNumber(m.completionRate, 0);
    const topType = timeDistRows[0];

    // Merge shift testing hours into station utilization map
    const stationMap = new Map();
    for (const b of bayRows) {
      stationMap.set(Number(b.id), {
        station: `${b.bay_code} · ${b.name}`,
        kind: b.station_kind || 'FFS_BAY',
        sorties: toNumber(b.sorties, 0),
        sortieHrs: Number((toNumber(b.sortieMinutes, 0) / 60).toFixed(1)),
        shiftHrs: 0,
        lostMin: toNumber(b.lostMinutes, 0)
      });
    }
    let totalShiftMin = 0;
    for (const se of shiftEntriesRows) {
      const dur = computeTestingDurationMinutes(se.sim_testing_start, se.sim_testing_end);
      totalShiftMin += dur;
      if (dur > 0) {
        const simId = Number(se.simulator_id);
        const cur = stationMap.get(simId) || {
          station: `${se.bay_code} · ${se.name}`,
          kind: se.station_kind || 'TEST_PLACE',
          sorties: 0,
          sortieHrs: 0,
          shiftHrs: 0,
          lostMin: 0
        };
        cur.shiftHrs = Number((cur.shiftHrs + dur / 60).toFixed(1));
        stationMap.set(simId, cur);
      }
    }
    const stationUtilRows = [...stationMap.values()]
      .map(r => ({
        ...r,
        totalHrs: Number((r.sortieHrs + r.shiftHrs).toFixed(1)),
        _flag: r.lostMin > 0 ? 'warning' : undefined
      }))
      .sort((a, b) => b.totalHrs - a.totalHrs);

    const totalShiftHours = Number((totalShiftMin / 60).toFixed(1));

    const stationUtilTable = {
      name: 'Simulator Bay & Station Utilization (Sorties + Daily Shifts)',
      columns: [
        { header: 'Bay / Station', key: 'station', width: 145 },
        { header: 'Class', key: 'kind', width: 66, type: 'mono' },
        { header: 'Sorties', key: 'sorties', width: 48, type: 'number', align: 'right', total: 'sum' },
        { header: 'Sortie (h)', key: 'sortieHrs', width: 58, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Shift (h)', key: 'shiftHrs', width: 54, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Total (h)', key: 'totalHrs', width: 58, type: 'number', decimals: 1, align: 'right', total: 'sum', dataBar: true },
        { header: 'Lost (m)', key: 'lostMin', width: 50, type: 'number', align: 'right', total: 'sum' }
      ],
      rows: stationUtilRows.slice(0, 20)
    };

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

    const brief = `Telemetry review (${granularity.toUpperCase()} bucket): evaluated ${fmtNumber(totalOps)} operational sorties totaling ${(totalMinutes / 60).toFixed(1)} h plus ${totalShiftHours} h across Test Place & IOS Console daily shifts (${fmtNumber(lostMinutes)} lost training minutes). Mean sortie runtime is ${fmtDurationMin(avgDuration)} with ${fmtPercent(completionRate, 1)} closure.`;

    const telemetryPairs = [
      ['Peak Demand Window', peak.dayName ? `${peak.dayName} · ${String(peak.hour).padStart(2, '0')}:00 (${peak.count} ops)` : 'Uniform / None'],
      ['Primary Discipline', topType ? `${topType.type} (${fmtDurationMin(topType.totalMinutes)})` : '—'],
      ['Mean / Max Sortie', `${fmtDurationMin(avgDuration)} / ${fmtDurationMin(maxDuration)}`],
      ['Lost Training Time', `${fmtNumber(lostMinutes)} min (${(lostMinutes / 60).toFixed(1)} h)`],
      ['TP / IOS Shift Hours', `${totalShiftHours} h across daily station logs`],
      ['Completion Efficiency', fmtPercent(completionRate, 1)]
    ];

    const pages = [
      {
        eyebrow: 'SECTION 01 · THROUGHPUT CURVE',
        title: 'Throughput Curve & Peak Demand Window',
        subtitle: 'Operational velocity trajectory paired with runtime & station shift telemetry',
        blocks: [
          {
            type: 'chart',
            height: 230,
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
        eyebrow: 'SECTION 02 · SIMULATOR BAY & CUSTOMER UTILIZATION',
        title: 'Bay Utilization, Customer Share & Shift Hours',
        subtitle: 'Combined FFS sortie hours, TP/IOS daily shift hours and customer operator ranking',
        blocks: [
          ...(customerRows.length ? [{
            type: 'chart',
            height: 195,
            chart: {
              type: 'lollipop',
              title: 'Training Effort by Customer Operator (Hours)',
              labels: customerRows.map(c => c.customer),
              values: customerRows.map(c => Number((toNumber(c.totalMinutes, 0) / 60).toFixed(1)))
            }
          }] : []),
          ...(stationUtilRows.length ? [{ type: 'table', showHeading: true, table: stationUtilTable }] : [])
        ]
      },
      {
        eyebrow: 'SECTION 03 · DISCIPLINE ALLOCATION & VELOCITY',
        title: 'Effort Allocation, Status Mix & Velocity Log',
        subtitle: 'Time invested across operation types and chronological throughput register',
        blocks: [
          {
            type: 'chartPair',
            height: 190,
            left: {
              type: 'lollipop',
              title: 'Effort by Operation Type (min)',
              labels: timeDistRows.map((r) => r.type),
              values: timeDistRows.map((r) => toNumber(r.totalMinutes, 0))
            },
            right: {
              type: 'donut',
              title: 'Status Distribution',
              labels: statusRows.map((r) => r.status),
              values: statusRows.map((r) => toNumber(r.count, 0)),
              colors: statusRows.map((r) => STATUS_COLORS[r.status] || COLORS.accent)
            }
          },
          { type: 'table', table: timeDistTable },
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
        { label: 'Sortie / Shift Hrs', value: `${(totalMinutes / 60).toFixed(1)}h / ${totalShiftHours}h` },
        { label: 'Lost Training Min', value: `${fmtNumber(lostMinutes)} min` },
        { label: 'Completion Rate', value: fmtPercent(completionRate, 1) }
      ],
      filters: [
        { label: 'Period', value: period !== 'all' ? period.toUpperCase() : rangeLabel(range) },
        { label: 'Granularity', value: granularity.toUpperCase() },
        { label: 'Total Operations', value: fmtNumber(totalOps) }
      ],
      kpis: [
        { label: 'Total Operations', value: fmtNumber(totalOps), rawValue: totalOps, numFmt: '#,##0', tone: 'info' },
        { label: 'Sortie + Shift Hrs', value: `${((totalMinutes / 60) + totalShiftHours).toFixed(1)} h`, rawValue: Number(((totalMinutes / 60) + totalShiftHours).toFixed(1)), tone: 'primary' },
        { label: 'Lost Training Min', value: `${fmtNumber(lostMinutes)} min`, rawValue: lostMinutes, tone: lostMinutes > 0 ? 'danger' : 'success' },
        { label: 'Completion', value: fmtPercent(completionRate, 1), rawValue: completionRate, numFmt: '0.0"%"', tone: completionRate >= 75 ? 'success' : 'warning' }
      ],
      pages
    };
  }
};
