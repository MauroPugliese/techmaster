// =============================================================================
// exports/modules/audit.js — Audit logs report (admin only)
// =============================================================================
const { Op } = require('sequelize');
const { AuditLog, User } = require('../../models');
const { fmtDateTime, fullName, dash, parseRange, rangeLabel, cleanText } = require('../core/helpers');

const STATUS_FLAG = (status) => {
  const s = Number(status);
  if (s >= 500) return 'danger';
  if (s >= 400) return 'warning';
  if (s >= 200 && s < 300) return 'success';
  return undefined;
};

module.exports = {
  key: 'audit',
  title: 'Audit Logs Report',
  subtitle: 'Security and change-tracking trail',
  orientation: 'landscape',
  roles: ['admin'],

  async build(req) {
    const range = parseRange(req.query);
    const { action, method, user_id } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.created_at = {};
      if (range.from) where.created_at[Op.gte] = range.from;
      if (range.to) where.created_at[Op.lte] = range.to;
    }
    if (action) where.action = action;
    if (method) where.method = method;
    if (user_id) where.user_id = user_id;

    const logs = await AuditLog.findAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['first_name', 'last_name'] }],
      order: [['created_at', 'DESC']],
      limit: 5000
    });

    const errors = logs.filter((l) => Number(l.status) >= 400).length;

    return {
      filters: [
        { label: 'Period', value: rangeLabel(range) },
        { label: 'Action', value: action || 'All' },
        { label: 'Method', value: method || 'All' },
        { label: 'Total entries', value: logs.length }
      ],
      tables: [{
        name: 'Audit Trail',
        note: 'Showing up to 5000 most recent entries within the selected period.',
        summary: [
          { label: 'Total entries', value: logs.length },
          { label: 'Error responses (>=400)', value: errors }
        ],
        columns: [
          { header: 'Timestamp', key: 'time', width: 17 },
          { header: 'User', key: 'user', width: 20 },
          { header: 'Action', key: 'action', width: 18 },
          { header: 'Method', key: 'method', width: 9 },
          { header: 'Path', key: 'path', width: 30 },
          { header: 'Status', key: 'status', width: 9, align: 'right' },
          { header: 'IP', key: 'ip', width: 16 },
          { header: 'Details', key: 'details', width: 28 }
        ],
        rows: logs.map((l) => ({
          time: fmtDateTime(l.created_at),
          user: l.user ? fullName(l.user) : (l.username || '—'),
          action: dash(l.action),
          method: dash(l.method),
          path: dash(l.path),
          status: dash(l.status),
          ip: dash(l.ip),
          details: l.details ? cleanText(JSON.stringify(l.details)).slice(0, 240) : '—',
          _flag: STATUS_FLAG(l.status)
        }))
      }]
    };
  }
};
