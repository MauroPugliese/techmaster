// =============================================================================
// exports/modules/shifts.js — Workforce Attendance & Roster Schedule (CAE-HR-08)
// Blueprint:
//   P1 Cover -> P2 Attendance Compliance & Unit Coverage (3 Gauges + Dept Scorecards + Shift Bar)
//   -> P3 Employee Attendance & Overtime Summary (Alerts + Lifecycle Donut + Summary Table)
//   -> P4+ Daily Shift Roster (Curated 6-Col A4 Portrait Table)
// =============================================================================
const { Op } = require('sequelize');
const { Shift, ShiftType, User } = require('../../models');
const {
  fmtDate, fmtTime, fmtNumber, fmtHours, fmtPercent, fullName, dash,
  parseRange, rangeLabel, cleanText, toNumber, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  COMPLETED:   'success',
  CONFIRMED:   'teal',
  IN_PROGRESS: 'info',
  SCHEDULED:   'neutral',
  SWAPPED:     'purple',
  ABSENT:      'danger'
};

const STATUS_COLORS = {
  COMPLETED:   COLORS.successAccent,
  CONFIRMED:   COLORS.teal,
  IN_PROGRESS: COLORS.accent,
  SCHEDULED:   COLORS.muted,
  SWAPPED:     COLORS.amber,
  ABSENT:      COLORS.coral
};

function buildShiftAlerts(total, absences, totalOvertime, overtimeLeader) {
  const alerts = [];
  if (absences > 0) {
    alerts.push({
      severity: 'danger',
      title: `${fmtNumber(absences)} Recorded Shift Absence${absences > 1 ? 's' : ''} (${fmtPercent(pct(absences, total), 1)} Absence Rate)`,
      detail: 'Unplanned absences impact roster continuity. Review standby allocations and department coverage balance.'
    });
  }
  if (totalOvertime > 0 && overtimeLeader) {
    alerts.push({
      severity: totalOvertime > 20 ? 'warning' : 'info',
      title: `Overtime Concentrated on ${overtimeLeader.name} (${fmtHours(overtimeLeader.overtime)})`,
      detail: `Aggregate overtime logged in scope: ${fmtHours(totalOvertime)}. Monitor fatigue thresholds and rest intervals.`
    });
  }
  if (!alerts.length) {
    alerts.push({
      severity: 'success',
      title: 'Full Workforce Compliance — Zero Absences & Zero Overtime',
      detail: 'All rostered personnel attended scheduled shifts cleanly within standard shift hours.'
    });
  }
  return alerts;
}

module.exports = {
  key: 'shifts',
  docCode: 'CAE-HR-08',
  theme: 'shifts',
  title: 'Workforce Shifts & Attendance Report',
  subtitle: 'Roster compliance, department coverage, absences and overtime hours',
  category: 'WORKFORCE MANAGEMENT',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, date, user_id } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.date = {};
      if (range.from) where.date[Op.gte] = range.from.toISOString().slice(0, 10);
      if (range.to) where.date[Op.lte] = range.to.toISOString().slice(0, 10);
    }
    if (date) where.date = date;
    if (status) where.status = status;
    if (user_id) where.user_id = user_id;

    const shifts = await Shift.findAll({
      where,
      include: [
        { model: ShiftType, as: 'shiftType' },
        { model: User, as: 'employee', attributes: ['id', 'first_name', 'last_name', 'department'] },
        { model: User, as: 'supervisor', attributes: ['first_name', 'last_name'] }
      ],
      order: [['date', 'DESC'], ['id', 'DESC']]
    });

    const total = shifts.length;
    const byStatus = {};
    const byType = {};
    const deptStats = {};
    const empStats = {};
    let totalOvertime = 0;
    let presentOrCompleted = 0;
    let checkedInCount = 0;

    const rosterRows = shifts.map((s) => {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      const typeName = s.shiftType?.name || 'Standard';
      const typeLabel = s.shiftType?.code ? `${s.shiftType.code} (${typeName})` : typeName;
      byType[typeName] = (byType[typeName] || 0) + 1;

      const dept = s.employee?.department && String(s.employee.department).trim()
        ? String(s.employee.department).trim()
        : 'Unassigned';
      const empId = s.employee?.id || `u_${s.user_id}`;
      const empName = fullName(s.employee);
      const ot = toNumber(s.overtime_hours, 0);
      totalOvertime += ot;

      if (s.status !== 'ABSENT') presentOrCompleted += 1;
      if (s.check_in || s.status === 'COMPLETED' || s.status === 'IN_PROGRESS') checkedInCount += 1;

      if (!deptStats[dept]) deptStats[dept] = { total: 0, present: 0, absent: 0, overtime: 0 };
      deptStats[dept].total += 1;
      if (s.status === 'ABSENT') deptStats[dept].absent += 1;
      else deptStats[dept].present += 1;
      deptStats[dept].overtime += ot;

      if (!empStats[empId]) {
        empStats[empId] = { name: empName, dept, total: 0, completed: 0, absent: 0, overtime: 0 };
      }
      empStats[empId].total += 1;
      if (s.status === 'COMPLETED' || s.status === 'CONFIRMED') empStats[empId].completed += 1;
      if (s.status === 'ABSENT') empStats[empId].absent += 1;
      empStats[empId].overtime += ot;

      const checkWindow = (s.check_in || s.check_out)
        ? `${s.check_in ? fmtTime(s.check_in) : '--:--'} / ${s.check_out ? fmtTime(s.check_out) : '--:--'}`
        : '—';

      return {
        date: fmtDate(s.date),
        employee: empName,
        department: dept,
        shift_type: typeLabel,
        shift_type_tone: 'info',
        status: s.status,
        status_tone: STATUS_TONE[s.status] || 'neutral',
        overtime_hours: ot,
        check_window: checkWindow,
        supervisor: fullName(s.supervisor),
        notes: cleanText(s.notes, 48),
        _flag: s.status === 'ABSENT' ? 'danger' : (ot >= 4 ? 'warning' : null)
      };
    });

    const uniqueEmployees = Object.keys(empStats).length;
    const absences = byStatus.ABSENT || 0;
    const attendanceRate = total ? pct(presentOrCompleted, total) : 100;
    const checkInRate = total ? pct(checkedInCount, total) : 100;
    const standardHoursRate = total ? pct(total - rosterRows.filter((r) => r.overtime_hours > 0).length, total) : 100;

    const deptScoreItems = Object.entries(deptStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 7)
      .map(([dept, st]) => {
        const rate = pct(st.present, st.total);
        return {
          label: dept,
          valueLabel: `${fmtPercent(rate, 1)} (${st.present}/${st.total})`,
          percent: rate,
          tone: rate >= 92 ? 'success' : (rate >= 80 ? 'warning' : 'danger'),
          detail: `${fmtNumber(st.absent)} absent · ${fmtHours(st.overtime)} overtime logged`
        };
      });

    const empSummaryRows = Object.values(empStats)
      .sort((a, b) => (b.overtime - a.overtime) || (b.total - a.total))
      .map((e) => ({
        name: e.name,
        department: e.dept,
        shifts: e.total,
        completed: e.completed,
        absent: e.absent,
        overtime_hours: e.overtime,
        attendance_pct: pct(e.total - e.absent, e.total),
        _flag: e.absent > 0 ? 'warning' : null
      }));

    const overtimeLeader = Object.values(empStats)
      .filter((e) => e.overtime > 0)
      .sort((a, b) => b.overtime - a.overtime)[0] || null;

    const statusKeys = Object.keys(byStatus).filter((k) => byStatus[k] > 0);
    const typeTop = topEntries(byType, 8);

    const empSummaryTable = {
      name: 'Employee Attendance & Overtime Matrix',
      note: 'Per-operator roster count, absence tally, overtime load and net attendance compliance.',
      columns: [
        { header: 'Employee', key: 'name', width: 120 },
        { header: 'Department', key: 'department', width: 95 },
        { header: 'Shifts', key: 'shifts', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Completed', key: 'completed', width: 62, type: 'number', align: 'right', total: 'sum', printHidden: true },
        { header: 'Absent', key: 'absent', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Overtime (h)', key: 'overtime_hours', width: 68, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Attendance %', key: 'attendance_pct', width: 78, type: 'percent', decimals: 1, align: 'right', total: 'avg', dataBar: true }
      ],
      rows: empSummaryRows
    };

    const rosterTable = {
      name: 'Daily Shift Roster',
      priority: true,
      note: 'Chronological shift ledger. Supervisor and shift notes preserved in Excel.',
      columns: [
        { header: 'Date', key: 'date', width: 68, type: 'date' },
        { header: 'Employee', key: 'employee', width: 108 },
        { header: 'Department', key: 'department', width: 90, printHidden: true },
        { header: 'Shift Pattern', key: 'shift_type', width: 96, type: 'badge', align: 'center' },
        { header: 'Status', key: 'status', width: 82, type: 'badge', align: 'center' },
        { header: 'Overtime (h)', key: 'overtime_hours', width: 62, type: 'number', decimals: 1, align: 'right', total: 'sum' },
        { header: 'Check-In / Out', key: 'check_window', width: 86, type: 'mono', align: 'center' },
        { header: 'Supervisor', key: 'supervisor', width: 95, printHidden: true },
        { header: 'Notes', key: 'notes', width: 140, printHidden: true }
      ],
      rows: rosterRows
    };

    const filters = { 'Roster Period': rangeLabel(range) };
    if (status) filters.Status = status;
    if (date) filters.Date = date;
    if (user_id) filters['User ID'] = user_id;

    const pages = [
      {
        title: 'Attendance Compliance & Unit Coverage',
        subtitle: `${fmtNumber(total)} shifts across ${fmtNumber(uniqueEmployees)} rostered personnel`,
        blocks: [
          {
            type: 'gaugeBand',
            items: [
              { label: 'Attendance Rate', valueLabel: fmtPercent(attendanceRate, 1), percent: attendanceRate, sublabel: `${fmtNumber(absences)} absence(s)`, tone: attendanceRate >= 95 ? 'success' : 'warning' },
              { label: 'Clock-In Verification', valueLabel: fmtPercent(checkInRate, 1), percent: checkInRate, sublabel: `${fmtNumber(checkedInCount)} verified shifts`, tone: 'info' },
              { label: 'Within Standard Hours', valueLabel: fmtPercent(standardHoursRate, 1), percent: standardHoursRate, sublabel: `${fmtHours(totalOvertime)} overtime`, tone: totalOvertime > 24 ? 'warning' : 'success' }
            ]
          },
          {
            type: 'scorecard',
            title: 'Department Attendance Health',
            subtitle: 'Attendance compliance rate and overtime load per organizational unit',
            items: deptScoreItems.length ? deptScoreItems : [{ label: 'All Units', valueLabel: fmtPercent(attendanceRate, 1), percent: attendanceRate, tone: 'primary' }]
          },
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'bar',
              title: 'Shifts by Roster Pattern / Archetype',
              subtitle: 'Volume across shift schedules (Morning, Afternoon, Night, On-Call)',
              valueFormat: 'number',
              labels: typeTop.map(([k]) => cleanText(k, 16)),
              values: typeTop.map(([, v]) => v)
            }
          }
        ]
      },
      {
        title: 'Employee Attendance & Overtime Matrix',
        subtitle: 'Shift lifecycle distribution and personnel workload summary',
        blocks: [
          { type: 'alerts', title: 'Attendance & Overtime Advisories', items: buildShiftAlerts(total, absences, totalOvertime, overtimeLeader) },
          {
            type: 'chart',
            height: 196,
            chart: {
              type: 'donut',
              title: 'Shift Lifecycle Breakdown',
              subtitle: 'Status mix across scheduled and executed shifts',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', showHeading: true, table: { ...empSummaryTable, rows: empSummaryRows.slice(0, 14) } }
        ]
      },
      {
        title: 'Daily Shift Roster',
        subtitle: `Complete rostered shift schedule (${fmtNumber(rosterRows.length)} shifts)`,
        blocks: [{ type: 'table', showHeading: false, table: rosterTable }]
      }
    ];

    return {
      moduleKey: 'shifts',
      docCode: 'CAE-HR-08',
      theme: 'shifts',
      title: 'Workforce Shifts & Attendance Report',
      subtitle: 'Roster compliance, department coverage, absences and overtime hours',
      category: 'WORKFORCE MANAGEMENT',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Rostered Shifts', value: fmtNumber(total) },
        { label: 'Attendance Rate', value: fmtPercent(attendanceRate, 1) },
        { label: 'Total Overtime', value: fmtHours(totalOvertime) }
      ],
      filters,
      pages,
      tables: [rosterTable, empSummaryTable]
    };
  }
};
