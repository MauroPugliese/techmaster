// =============================================================================
// exports/modules/operations.js — Operations report builder
// =============================================================================
const { Op } = require('sequelize');
const { Operation, OperationType, User } = require('../../models');
const { fmtDateTime, fullName, dash, parseRange, rangeLabel, cleanText } = require('../core/helpers');

const STATUS_FLAG = { COMPLETED: 'success', CANCELLED: 'muted', ON_HOLD: 'warning', IN_PROGRESS: 'success' };

module.exports = {
  key: 'operations',
  title: 'Operations Report',
  subtitle: 'Operational activities and their lifecycle status',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { status, priority } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.start_date = {};
      if (range.from) where.start_date[Op.gte] = range.from;
      if (range.to) where.start_date[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const ops = await Operation.findAll({
      where,
      include: [
        { model: OperationType, as: 'type' },
        { model: User, as: 'creator', attributes: ['first_name', 'last_name'] }
      ],
      order: [['start_date', 'DESC']]
    });

    const byStatus = ops.reduce((a, o) => { a[o.status] = (a[o.status] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Status', value: status || 'All' },
        { label: 'Priority', value: priority || 'All' },
        { label: 'Total records', value: ops.length }
      ],
      tables: [{
        name: 'Operations',
        summary: [
          { label: 'Total operations', value: ops.length },
          { label: 'Completed', value: byStatus.COMPLETED || 0 },
          { label: 'In progress', value: byStatus.IN_PROGRESS || 0 },
          { label: 'Planned', value: byStatus.PLANNED || 0 },
          { label: 'On hold / Cancelled', value: (byStatus.ON_HOLD || 0) + (byStatus.CANCELLED || 0) }
        ],
        columns: [
          { header: '#', key: 'id', width: 7, align: 'right' },
          { header: 'Title', key: 'title', width: 32 },
          { header: 'Type', key: 'type', width: 16 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Priority', key: 'priority', width: 12 },
          { header: 'Location', key: 'location', width: 18 },
          { header: 'Start', key: 'start', width: 18 },
          { header: 'End', key: 'end', width: 18 },
          { header: 'Created by', key: 'creator', width: 18 }
        ],
        rows: ops.map((o) => ({
          id: o.id,
          title: cleanText(o.title),
          type: o.type?.name || '—',
          status: o.status,
          priority: o.priority,
          location: dash(o.location),
          start: fmtDateTime(o.start_date),
          end: fmtDateTime(o.end_date),
          creator: fullName(o.creator),
          _flag: o.priority === 'CRITICAL' ? 'danger' : STATUS_FLAG[o.status]
        }))
      }]
    };
  }
};
