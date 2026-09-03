// =============================================================================
// exports/modules/shifts.js — Shift schedule report
// =============================================================================
const { Op } = require('sequelize');
const { Shift, ShiftType, User } = require('../../models');
const { fmtDate, fmtTime, fullName, dash, parseRange, rangeLabel } = require('../core/helpers');

const STATUS_FLAG = { COMPLETED: 'success', ABSENT: 'danger', SWAPPED: 'warning', IN_PROGRESS: 'success' };

module.exports = {
  key: 'shifts',
  title: 'Shift Schedule Report',
  subtitle: 'Workforce shift planning, attendance and overtime',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { status, date } = req.query;

    const where = {};
    if (date) {
      where.date = date;
    } else if (range.from || range.to) {
      where.date = {};
      if (range.from) where.date[Op.gte] = range.from.toISOString().slice(0, 10);
      if (range.to) where.date[Op.lte] = range.to.toISOString().slice(0, 10);
    }
    if (status) where.status = status;

    const shifts = await Shift.findAll({
      where,
      include: [
        { model: ShiftType, as: 'shiftType' },
        { model: User, as: 'employee', attributes: ['first_name', 'last_name', 'department'] },
        { model: User, as: 'supervisor', attributes: ['first_name', 'last_name'] }
      ],
      order: [['date', 'ASC']]
    });

    const totalOvertime = shifts.reduce((a, s) => a + Number(s.overtime_hours || 0), 0);
    const byStatus = shifts.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Period', value: date ? fmtDate(date) : rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Total shifts', value: shifts.length }
      ],
      tables: [{
        name: 'Shifts',
        summary: [
          { label: 'Total shifts', value: shifts.length },
          { label: 'Completed', value: byStatus.COMPLETED || 0 },
          { label: 'Absent', value: byStatus.ABSENT || 0 },
          { label: 'Total overtime (h)', value: totalOvertime.toFixed(2) }
        ],
        columns: [
          { header: 'Date', key: 'date', width: 13 },
          { header: 'Employee', key: 'employee', width: 22 },
          { header: 'Department', key: 'department', width: 18 },
          { header: 'Shift', key: 'shift', width: 14 },
          { header: 'Status', key: 'status', width: 13 },
          { header: 'Check-in', key: 'checkin', width: 11, align: 'center' },
          { header: 'Check-out', key: 'checkout', width: 11, align: 'center' },
          { header: 'Overtime', key: 'overtime', width: 10, align: 'right' },
          { header: 'Supervisor', key: 'supervisor', width: 20 },
          { header: 'Notes', key: 'notes', width: 24 }
        ],
        rows: shifts.map((s) => ({
          date: fmtDate(s.date),
          employee: fullName(s.employee, 'Unassigned'),
          department: s.employee?.department || '—',
          shift: s.shiftType ? `${s.shiftType.code} (${s.shiftType.name})` : '—',
          status: s.status,
          checkin: fmtTime(s.check_in),
          checkout: fmtTime(s.check_out),
          overtime: dash(s.overtime_hours),
          supervisor: fullName(s.supervisor),
          notes: dash(s.notes),
          _flag: STATUS_FLAG[s.status]
        }))
      }]
    };
  }
};
