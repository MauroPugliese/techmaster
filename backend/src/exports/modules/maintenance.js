// =============================================================================
// exports/modules/maintenance.js — Corrective / records maintenance report
// =============================================================================
const { Op } = require('sequelize');
const { MaintenanceRecord, Asset, User } = require('../../models');
const { fmtDateTime, fmtMoney, fullName, dash, parseRange, rangeLabel, cleanText } = require('../core/helpers');

const STATUS_FLAG = { COMPLETED: 'success', FAILED: 'danger', DEFERRED: 'warning', IN_PROGRESS: 'success' };

module.exports = {
  key: 'maintenance',
  title: 'Maintenance Records Report',
  subtitle: 'Corrective and scheduled maintenance interventions',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { status, type } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.scheduled_date = {};
      if (range.from) where.scheduled_date[Op.gte] = range.from;
      if (range.to) where.scheduled_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (type) where.type = type;

    const records = await MaintenanceRecord.findAll({
      where,
      include: [
        { model: Asset, as: 'asset', attributes: ['name', 'serial_number'] },
        { model: User, as: 'technician', attributes: ['first_name', 'last_name'] }
      ],
      order: [['scheduled_date', 'DESC']]
    });

    const totalCost = records.reduce((a, r) => a + Number(r.cost || 0), 0);
    const totalDowntime = records.reduce((a, r) => a + Number(r.downtime_hours || 0), 0);
    const byStatus = records.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Type', value: type || 'All' },
        { label: 'Total records', value: records.length }
      ],
      tables: [{
        name: 'Maintenance Records',
        summary: [
          { label: 'Total records', value: records.length },
          { label: 'Completed', value: byStatus.COMPLETED || 0 },
          { label: 'Failed', value: byStatus.FAILED || 0 },
          { label: 'Total downtime (h)', value: totalDowntime.toFixed(2) },
          { label: 'Total cost', value: totalCost.toFixed(2) }
        ],
        columns: [
          { header: '#', key: 'id', width: 7, align: 'right' },
          { header: 'Title', key: 'title', width: 28 },
          { header: 'Asset', key: 'asset', width: 22 },
          { header: 'Type', key: 'type', width: 14 },
          { header: 'Status', key: 'status', width: 13 },
          { header: 'Priority', key: 'priority', width: 11 },
          { header: 'Scheduled', key: 'scheduled', width: 17 },
          { header: 'Completed', key: 'completed', width: 17 },
          { header: 'Downtime (h)', key: 'downtime', width: 12, align: 'right' },
          { header: 'Cost', key: 'cost', width: 12, align: 'right' },
          { header: 'Technician', key: 'technician', width: 18 }
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
          downtime: dash(r.downtime_hours),
          cost: fmtMoney(r.cost),
          technician: fullName(r.technician),
          _flag: r.priority === 'CRITICAL' && r.status !== 'COMPLETED' ? 'danger' : STATUS_FLAG[r.status]
        }))
      }]
    };
  }
};
