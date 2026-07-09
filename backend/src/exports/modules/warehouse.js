// =============================================================================
// exports/modules/warehouse.js — Inventory items + stock movements report
// =============================================================================
const { Op } = require('sequelize');
const { InventoryItem, ItemCategory, StockMovement, User } = require('../../models');
const { fmtDateTime, fmtMoney, fullName, dash, parseRange, rangeLabel } = require('../core/helpers');

module.exports = {
  key: 'warehouse',
  title: 'Warehouse Inventory Report',
  subtitle: 'Stock levels, valuation and recent movements',
  orientation: 'landscape',

  async build(req) {
    const range = parseRange(req.query);
    const { category_id } = req.query;

    const itemWhere = { is_active: true };
    if (category_id) itemWhere.category_id = category_id;

    const items = await InventoryItem.findAll({
      where: itemWhere,
      include: [{ model: ItemCategory, as: 'category' }],
      order: [['name', 'ASC']]
    });

    const movementWhere = {};
    if (range.from || range.to) {
      movementWhere.movement_date = {};
      if (range.from) movementWhere.movement_date[Op.gte] = range.from;
      if (range.to) movementWhere.movement_date[Op.lte] = range.to;
    }
    const movements = await StockMovement.findAll({
      where: movementWhere,
      include: [
        { model: InventoryItem, as: 'item', attributes: ['name', 'sku'] },
        { model: User, as: 'user', attributes: ['first_name', 'last_name'] }
      ],
      order: [['movement_date', 'DESC']],
      limit: 1000
    });

    const lowCount = items.filter((i) => i.quantity <= i.reorder_point).length;
    const outCount = items.filter((i) => i.quantity === 0).length;
    const totalValue = items.reduce((a, i) => a + Number(i.unit_cost || 0) * Number(i.quantity || 0), 0);

    const movementFlag = { IN: 'success', RETURN: 'success', OUT: 'warning', ADJUSTMENT: 'muted', TRANSFER: 'muted' };

    return {
      filters: [
        { label: 'Movements period', value: rangeLabel(range) },
        { label: 'Category', value: category_id ? `#${category_id}` : 'All' },
        { label: 'Active items', value: items.length }
      ],
      tables: [
        {
          name: 'Inventory Items',
          summary: [
            { label: 'Total active items', value: items.length },
            { label: 'Low / reorder', value: lowCount },
            { label: 'Out of stock', value: outCount },
            { label: 'Stock valuation', value: totalValue.toFixed(2) }
          ],
          columns: [
            { header: 'SKU', key: 'sku', width: 14 },
            { header: 'Item', key: 'name', width: 30 },
            { header: 'Category', key: 'category', width: 18 },
            { header: 'Unit', key: 'unit', width: 8 },
            { header: 'Qty', key: 'quantity', width: 9, align: 'right' },
            { header: 'Min', key: 'min', width: 8, align: 'right' },
            { header: 'Reorder', key: 'reorder', width: 9, align: 'right' },
            { header: 'Max', key: 'max', width: 8, align: 'right' },
            { header: 'Unit cost', key: 'cost', width: 11, align: 'right' },
            { header: 'Supplier', key: 'supplier', width: 18 },
            { header: 'Status', key: 'status', width: 12 }
          ],
          rows: items.map((i) => {
            const out = i.quantity === 0;
            const low = i.quantity <= i.reorder_point;
            return {
              sku: i.sku,
              name: i.name,
              category: i.category?.name || 'Uncategorized',
              unit: i.unit,
              quantity: i.quantity,
              min: i.min_stock,
              reorder: i.reorder_point,
              max: dash(i.max_stock),
              cost: fmtMoney(i.unit_cost),
              supplier: dash(i.supplier),
              status: out ? 'OUT OF STOCK' : (low ? 'LOW STOCK' : 'OK'),
              _flag: out ? 'danger' : (low ? 'warning' : undefined)
            };
          })
        },
        {
          name: 'Stock Movements',
          note: 'Most recent stock movements within the selected period (max 1000 rows).',
          columns: [
            { header: 'Date', key: 'date', width: 17 },
            { header: 'SKU', key: 'sku', width: 14 },
            { header: 'Item', key: 'item', width: 28 },
            { header: 'Type', key: 'type', width: 12 },
            { header: 'Qty', key: 'qty', width: 9, align: 'right' },
            { header: 'Before', key: 'before', width: 9, align: 'right' },
            { header: 'After', key: 'after', width: 9, align: 'right' },
            { header: 'Reference', key: 'reference', width: 16 },
            { header: 'User', key: 'user', width: 18 }
          ],
          rows: movements.map((m) => ({
            date: fmtDateTime(m.movement_date),
            sku: m.item?.sku || '—',
            item: m.item?.name || '—',
            type: m.type,
            qty: m.quantity,
            before: m.quantity_before,
            after: m.quantity_after,
            reference: dash(m.reference),
            user: fullName(m.user),
            _flag: movementFlag[m.type]
          }))
        }
      ]
    };
  }
};
