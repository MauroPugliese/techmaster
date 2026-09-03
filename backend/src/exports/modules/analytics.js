// =============================================================================
// exports/modules/analytics.js — Analytics KPIs + chart-snapshot data tables
// =============================================================================
const { Op, fn, col, literal } = require('sequelize');
const { Operation, MaintenanceRecord, Task, InventoryItem, Shift } = require('../../models');
const { parseRange, rangeLabel } = require('../core/helpers');

/** Group a model by a column within an optional date range → [{label,count}]. */
async function countBy(Model, groupCol, dateCol, range) {
  const where = {};
  if (dateCol && (range.from || range.to)) {
    where[dateCol] = {};
    if (range.from) where[dateCol][Op.gte] = range.from;
    if (range.to) where[dateCol][Op.lte] = range.to;
  }
  const rows = await Model.findAll({
    where,
    attributes: [[col(groupCol), 'label'], [fn('COUNT', literal('*')), 'count']],
    group: [col(groupCol)],
    raw: true
  });
  return rows.map((r) => ({ label: r.label || '—', count: Number(r.count) }));
}

module.exports = {
  key: 'analytics',
  title: 'Analytics Report',
  subtitle: 'Cross-module KPIs and distribution snapshots',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);

    const [opsByStatus, maintByStatus, tasksByStatus, tasksByPriority, shiftsByStatus] = await Promise.all([
      countBy(Operation, 'status', 'start_date', range),
      countBy(MaintenanceRecord, 'status', 'scheduled_date', range),
      countBy(Task, 'status', 'due_date', range),
      countBy(Task, 'priority', 'due_date', range),
      countBy(Shift, 'status', 'date', range)
    ]);

    const sum = (arr) => arr.reduce((a, x) => a + x.count, 0);
    const lowStock = await InventoryItem.count({ where: { is_active: true, [Op.and]: literal('quantity <= reorder_point') } });

    const snapshot = (name, data) => ({
      name,
      columns: [
        { header: 'Category', key: 'label', width: 30 },
        { header: 'Count', key: 'count', width: 14, align: 'right' },
        { header: 'Share', key: 'share', width: 12, align: 'right' }
      ],
      rows: (() => {
        const total = sum(data) || 1;
        return data.map((d) => ({ label: d.label, count: d.count, share: `${((d.count / total) * 100).toFixed(1)}%` }));
      })()
    });

    return {
      filters: [
        { label: 'Period', value: rangeLabel(range) }
      ],
      tables: [
        {
          name: 'Key Performance Indicators',
          columns: [
            { header: 'Metric', key: 'metric', width: 36 },
            { header: 'Value', key: 'value', width: 16, align: 'right' }
          ],
          rows: [
            { metric: 'Operations (total)', value: sum(opsByStatus) },
            { metric: 'Operations completed', value: (opsByStatus.find((x) => x.label === 'COMPLETED') || {}).count || 0 },
            { metric: 'Maintenance records (total)', value: sum(maintByStatus) },
            { metric: 'Maintenance failed', value: (maintByStatus.find((x) => x.label === 'FAILED') || {}).count || 0 },
            { metric: 'Tasks (total)', value: sum(tasksByStatus) },
            { metric: 'Tasks overdue', value: (tasksByStatus.find((x) => x.label === 'OVERDUE') || {}).count || 0 },
            { metric: 'Shifts (total)', value: sum(shiftsByStatus) },
            { metric: 'Low-stock items', value: lowStock, _flag: lowStock > 0 ? 'warning' : 'success' }
          ]
        },
        snapshot('Operations by Status', opsByStatus),
        snapshot('Maintenance by Status', maintByStatus),
        snapshot('Tasks by Status', tasksByStatus),
        snapshot('Tasks by Priority', tasksByPriority),
        snapshot('Shifts by Status', shiftsByStatus)
      ]
    };
  }
};
