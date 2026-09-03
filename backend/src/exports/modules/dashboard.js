// =============================================================================
// exports/modules/dashboard.js — Executive dashboard KPI summary
// =============================================================================
const { Op, literal } = require('sequelize');
const {
  Operation, MaintenanceRecord, Task, InventoryItem, Shift, User, WikiArticle
} = require('../../models');
const { fmtDate } = require('../core/helpers');

module.exports = {
  key: 'dashboard',
  title: 'Dashboard Summary Report',
  subtitle: 'At-a-glance operational health snapshot',
  orientation: 'portrait',

  async build(req) {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const [
      opsTotal, opsActive,
      maintTotal, maintOpen,
      tasksTotal, tasksOpen, tasksOverdue,
      itemsTotal, lowStock,
      shiftsToday, usersActive, wikiPublished
    ] = await Promise.all([
      Operation.count(),
      Operation.count({ where: { status: { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] } } }),
      MaintenanceRecord.count(),
      MaintenanceRecord.count({ where: { status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] } } }),
      Task.count(),
      Task.count({ where: { status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW'] } } }),
      Task.count({ where: { status: 'OVERDUE' } }),
      InventoryItem.count({ where: { is_active: true } }),
      InventoryItem.count({ where: { is_active: true, [Op.and]: literal('quantity <= reorder_point') } }),
      Shift.count({ where: { date: startOfDay.toISOString().slice(0, 10) } }),
      User.count({ where: { is_active: true } }),
      WikiArticle.count({ where: { status: 'PUBLISHED' } })
    ]);

    const kpi = (metric, value, flag) => ({ metric, value, _flag: flag });

    return {
      filters: [
        { label: 'Snapshot date', value: fmtDate(today) }
      ],
      tables: [{
        name: 'KPI Summary',
        summary: [
          { label: 'Active operations', value: opsActive },
          { label: 'Open maintenance', value: maintOpen },
          { label: 'Open tasks', value: tasksOpen },
          { label: 'Low-stock items', value: lowStock }
        ],
        columns: [
          { header: 'Metric', key: 'metric', width: 40 },
          { header: 'Value', key: 'value', width: 16, align: 'right' }
        ],
        rows: [
          kpi('Operations — total', opsTotal),
          kpi('Operations — active', opsActive),
          kpi('Maintenance — total', maintTotal),
          kpi('Maintenance — open', maintOpen, maintOpen > 0 ? 'warning' : 'success'),
          kpi('Tasks — total', tasksTotal),
          kpi('Tasks — open', tasksOpen),
          kpi('Tasks — overdue', tasksOverdue, tasksOverdue > 0 ? 'danger' : 'success'),
          kpi('Inventory — active items', itemsTotal),
          kpi('Inventory — low stock', lowStock, lowStock > 0 ? 'warning' : 'success'),
          kpi('Shifts scheduled today', shiftsToday),
          kpi('Active users', usersActive),
          kpi('Published wiki articles', wikiPublished)
        ]
      }]
    };
  }
};
