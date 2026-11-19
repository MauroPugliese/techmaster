// =============================================================================
// exports/modules/warehouse.js — Supply Chain & Procurement Pack (CAE-INV-07)
// Blueprint:
//   P1 Cover -> P2 Immediate Procurement Action Sheet (Alerts + Strip KPIs + Restock Table)
//   -> P3 Capital Allocation & Velocity (ChartPair: Stock Health Donut + Category Lollipop + Spotlights)
//   -> P4+ Inventory Valuation Catalogue -> P5+ Audited Stock Movements Ledger
// =============================================================================
const { Op } = require('sequelize');
const { InventoryItem, ItemCategory, StockMovement, User } = require('../../models');
const {
  fmtDateTime, fmtNumber, fmtMoney, fmtPercent, fullName, dash,
  parseRange, rangeLabel, cleanText, toNumber, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const MOVEMENT_TONE = {
  IN:         'success',
  RETURN:     'teal',
  OUT:        'warning',
  TRANSFER:   'info',
  ADJUSTMENT: 'purple'
};

function classifyItemHealth(item) {
  const qty = toNumber(item.quantity, 0);
  const min = toNumber(item.min_stock, 0);
  const rop = toNumber(item.reorder_point, 0);
  const threshold = Math.max(min, rop);
  if (qty <= 0) return { label: 'OUT OF STOCK', tone: 'danger', flag: 'danger', threshold };
  if (threshold > 0 && qty <= threshold) return { label: 'LOW STOCK', tone: 'warning', flag: 'warning', threshold };
  return { label: 'HEALTHY', tone: 'success', flag: null, threshold };
}

function summarizeInventory(items) {
  let outCount = 0;
  let lowCount = 0;
  let healthyCount = 0;
  let totalUnits = 0;
  let totalValue = 0;
  const valueByCategory = {};
  const valueBySupplier = {};
  const priorityRestock = [];

  const itemRows = items.map((item) => {
    const qty = toNumber(item.quantity, 0);
    const unitCost = toNumber(item.unit_cost, 0);
    const lineValue = qty * unitCost;
    const catName = item.category?.name || 'Uncategorized';
    const supName = item.supplier && String(item.supplier).trim() ? String(item.supplier).trim() : 'Unspecified';
    const health = classifyItemHealth(item);

    totalUnits += qty;
    totalValue += lineValue;
    valueByCategory[catName] = (valueByCategory[catName] || 0) + lineValue;
    valueBySupplier[supName] = (valueBySupplier[supName] || 0) + lineValue;

    if (health.label === 'OUT OF STOCK') outCount += 1;
    else if (health.label === 'LOW STOCK') lowCount += 1;
    else healthyCount += 1;

    if (health.label !== 'HEALTHY') {
      const targetQty = Math.max(health.threshold || 1, toNumber(item.min_stock, 0));
      priorityRestock.push({
        sku: item.sku,
        name: cleanText(item.name, 46),
        category: catName,
        quantity: qty,
        min_stock: toNumber(item.min_stock, 0),
        reorder_point: toNumber(item.reorder_point, 0),
        deficit: Math.max(1, targetQty - qty),
        est_restock_cost: Math.max(1, targetQty - qty) * unitCost,
        supplier: cleanText(supName, 26),
        stock_status: health.label,
        stock_status_tone: health.tone,
        _flag: health.flag
      });
    }

    return {
      sku: item.sku,
      part_number: dash(item.part_number),
      name: cleanText(item.name, 48),
      category: catName,
      unit: dash(item.unit || 'pcs'),
      quantity: qty,
      min_stock: toNumber(item.min_stock, 0),
      reorder_point: toNumber(item.reorder_point, 0),
      unit_cost: unitCost,
      total_value: lineValue,
      supplier: cleanText(supName, 28),
      is_active: item.is_active ? 'Active' : 'Inactive',
      stock_status: health.label,
      stock_status_tone: health.tone,
      _flag: health.flag
    };
  });

  priorityRestock.sort((a, b) => (a.quantity - b.quantity) || (b.deficit - a.deficit));

  return {
    outCount, lowCount, healthyCount, totalUnits, totalValue,
    valueByCategory, valueBySupplier, priorityRestock, itemRows
  };
}

function buildProcurementAlerts(stats, movementsLen, totalIn, totalOut) {
  const alerts = [];
  if (stats.outCount > 0) {
    alerts.push({
      severity: 'danger',
      title: `${stats.outCount} Zero-Stock SKU${stats.outCount > 1 ? 's' : ''} Require Emergency Replenishment`,
      detail: 'Stockout parts block active corrective and planned maintenance work orders until purchase orders arrive.'
    });
  }
  if (stats.lowCount > 0) {
    const estCost = stats.priorityRestock.reduce((acc, r) => acc + toNumber(r.est_restock_cost, 0), 0);
    alerts.push({
      severity: 'warning',
      title: `${stats.lowCount} SKU${stats.lowCount > 1 ? 's' : ''} Breached Minimum / Reorder Threshold`,
      detail: `Estimated replenishment spend to restore minimum buffers: ${fmtMoney(estCost)}. Trigger PO batch review.`
    });
  }
  if (movementsLen > 0 && totalOut > totalIn * 1.25) {
    alerts.push({
      severity: 'info',
      title: `Net Inventory Drawdown: -${fmtNumber(totalOut - totalIn)} Units in Period`,
      detail: `Outbound consumption (${fmtNumber(totalOut)}) outpaced receipts (${fmtNumber(totalIn)}). Align supplier lead times.`
    });
  }
  if (!alerts.length) {
    alerts.push({
      severity: 'success',
      title: 'All Tracked Spare Parts Within Safe Buffer Thresholds',
      detail: 'No stockouts or reorder-point breaches detected across the filtered inventory scope.'
    });
  }
  return alerts;
}

module.exports = {
  key: 'warehouse',
  docCode: 'CAE-INV-07',
  theme: 'warehouse',
  title: 'Warehouse & Spare Parts Report',
  subtitle: 'Stock valuation, replenishment exposure and audited movement ledger',
  category: 'SUPPLY CHAIN & PROCUREMENT',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { category_id, low_stock, search } = req.query;

    const itemWhere = {};
    if (category_id) itemWhere.category_id = category_id;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      itemWhere[Op.or] = [
        { name: { [Op.like]: q } },
        { sku: { [Op.like]: q } },
        { part_number: { [Op.like]: q } },
        { supplier: { [Op.like]: q } }
      ];
    }

    const movWhere = {};
    if (range.from || range.to) {
      movWhere.movement_date = {};
      if (range.from) movWhere.movement_date[Op.gte] = range.from;
      if (range.to) movWhere.movement_date[Op.lte] = range.to;
    }

    const [rawItems, movements] = await Promise.all([
      InventoryItem.findAll({
        where: itemWhere,
        include: [{ model: ItemCategory, as: 'category', attributes: ['id', 'name', 'color'] }],
        order: [['name', 'ASC']]
      }),
      StockMovement.findAll({
        where: movWhere,
        include: [
          { model: InventoryItem, as: 'item', attributes: ['sku', 'name'] },
          { model: User, as: 'user', attributes: ['first_name', 'last_name'] }
        ],
        order: [['movement_date', 'DESC']],
        limit: 250
      })
    ]);

    const items = (low_stock === 'true' || low_stock === '1')
      ? rawItems.filter((it) => classifyItemHealth(it).label !== 'HEALTHY')
      : rawItems;

    const stats = summarizeInventory(items);

    let totalIn = 0;
    let totalOut = 0;
    const movementRows = movements.map((m) => {
      const qty = toNumber(m.quantity, 0);
      if (m.type === 'IN' || m.type === 'RETURN') totalIn += qty;
      if (m.type === 'OUT' || m.type === 'TRANSFER') totalOut += qty;
      const before = toNumber(m.quantity_before, 0);
      const after = toNumber(m.quantity_after, 0);
      return {
        movement_date: m.movement_date ? fmtDateTime(m.movement_date) : '—',
        type: m.type,
        type_tone: MOVEMENT_TONE[m.type] || 'info',
        item_name: cleanText(m.item?.name || 'Item', 40),
        sku: dash(m.item?.sku),
        quantity: qty,
        delta_flow: `${before} -> ${after}`,
        quantity_before: before,
        quantity_after: after,
        operator: fullName(m.user),
        reference: dash(m.reference),
        reason: cleanText(m.reason, 46)
      };
    });

    const netFlow = totalIn - totalOut;
    const catTop = topEntries(stats.valueByCategory, 7);
    const supTop = topEntries(stats.valueBySupplier, 4);
    const atRisk = stats.outCount + stats.lowCount;
    const healthyPct = pct(stats.healthyCount, items.length);

    const restockTable = {
      name: 'Priority Restock Action List',
      priority: true,
      note: 'SKUs at or below reorder threshold requiring immediate procurement release.',
      columns: [
        { header: 'SKU', key: 'sku', width: 70, type: 'mono' },
        { header: 'Spare Part / Item', key: 'name', width: 145 },
        { header: 'Category', key: 'category', width: 95, printHidden: true },
        { header: 'Status', key: 'stock_status', width: 82, type: 'badge', align: 'center' },
        { header: 'On Hand', key: 'quantity', width: 54, type: 'number', align: 'right' },
        { header: 'Deficit', key: 'deficit', width: 54, type: 'number', align: 'right', total: 'sum' },
        { header: 'Supplier', key: 'supplier', width: 105 },
        { header: 'Min Stock', key: 'min_stock', width: 65, type: 'number', align: 'right', printHidden: true },
        { header: 'Est. PO Cost', key: 'est_restock_cost', width: 85, type: 'currency', align: 'right', printHidden: true }
      ],
      rows: stats.priorityRestock
    };

    const catalogueTable = {
      name: 'Inventory Valuation Catalogue',
      note: 'Asset valuation per SKU (Unit Cost x Quantity on Hand). Extended warehouse metadata preserved in Excel.',
      columns: [
        { header: 'SKU', key: 'sku', width: 70, type: 'mono' },
        { header: 'Item Name', key: 'name', width: 140 },
        { header: 'Part Number', key: 'part_number', width: 85, type: 'mono', printHidden: true },
        { header: 'Category', key: 'category', width: 88 },
        { header: 'Unit', key: 'unit', width: 50, printHidden: true },
        { header: 'Qty', key: 'quantity', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Min', key: 'min_stock', width: 50, type: 'number', align: 'right', printHidden: true },
        { header: 'Reorder', key: 'reorder_point', width: 55, type: 'number', align: 'right', printHidden: true },
        { header: 'Unit Cost', key: 'unit_cost', width: 72, type: 'currency', align: 'right' },
        { header: 'Total Value', key: 'total_value', width: 88, type: 'currency', align: 'right', total: 'sum', dataBar: true },
        { header: 'Supplier', key: 'supplier', width: 105, printHidden: true },
        { header: 'Active', key: 'is_active', width: 60, printHidden: true }
      ],
      rows: stats.itemRows
    };

    const movementsTable = {
      name: 'Audited Stock Movements Ledger',
      note: 'Chronological warehouse receipts, consumption issues, returns and adjustments.',
      columns: [
        { header: 'Timestamp', key: 'movement_date', width: 92, type: 'date' },
        { header: 'Type', key: 'type', width: 74, type: 'badge', align: 'center' },
        { header: 'SKU', key: 'sku', width: 70, type: 'mono', printHidden: true },
        { header: 'Item', key: 'item_name', width: 142 },
        { header: 'Qty', key: 'quantity', width: 52, type: 'number', align: 'right', total: 'sum' },
        { header: 'Balance Flow', key: 'delta_flow', width: 72, type: 'mono', align: 'center' },
        { header: 'Operator', key: 'operator', width: 82 },
        { header: 'Reference', key: 'reference', width: 85, type: 'mono', printHidden: true },
        { header: 'Reason', key: 'reason', width: 150, printHidden: true }
      ],
      rows: movementRows
    };

    const filters = { 'Movement Period': rangeLabel(range) };
    if (category_id) filters['Category ID'] = category_id;
    if (low_stock === 'true' || low_stock === '1') filters['Stock Filter'] = 'Low / Out of Stock Only';
    if (search) filters.Search = search;

    const topCat = catTop[0];
    const topSup = supTop[0];

    const page2Blocks = [
      { type: 'alerts', title: 'Procurement & Buffer Exposure', items: buildProcurementAlerts(stats, movements.length, totalIn, totalOut) },
      {
        type: 'kpis',
        variant: 'strips',
        items: [
          { label: 'Tracked SKUs', value: fmtNumber(items.length), rawValue: items.length, sublabel: `${fmtNumber(stats.totalUnits)} units in stock`, tone: 'primary' },
          { label: 'Total Stock Valuation', value: fmtMoney(stats.totalValue), rawValue: stats.totalValue, numFmt: '€#,##0.00', sublabel: `${catTop.length} categories valued`, tone: 'info' },
          { label: 'Replenishment Exposure', value: fmtNumber(atRisk), rawValue: atRisk, sublabel: `${stats.outCount} zero-stock · ${stats.lowCount} low`, tone: atRisk > 0 ? 'danger' : 'success' },
          { label: 'Net Period Flow', value: `${netFlow >= 0 ? '+' : ''}${fmtNumber(netFlow)} u`, rawValue: netFlow, sublabel: `${fmtNumber(totalIn)} in / ${fmtNumber(totalOut)} out`, tone: netFlow >= 0 ? 'success' : 'warning' }
        ]
      }
    ];

    if (stats.priorityRestock.length > 0) {
      page2Blocks.push({ type: 'table', showHeading: true, table: { ...restockTable, rows: stats.priorityRestock.slice(0, 14) } });
    } else {
      page2Blocks.push({
        type: 'brief',
        title: 'Replenishment Status',
        text: `100% of ${fmtNumber(items.length)} monitored inventory SKUs maintain stock levels above their safety reorder thresholds (${fmtMoney(stats.totalValue)} total valuation).`
      });
    }

    const pages = [
      {
        title: 'Immediate Procurement Action Sheet',
        subtitle: `${fmtNumber(atRisk)} SKUs requiring attention across ${fmtMoney(stats.totalValue)} inventory base`,
        blocks: page2Blocks
      },
      {
        title: 'Capital Allocation & Velocity',
        subtitle: 'Category capital concentration, buffer health ratio and inbound/outbound highlights',
        blocks: [
          {
            type: 'chartPair',
            height: 204,
            left: {
              type: 'donut',
              title: 'Stock Buffer Health',
              subtitle: 'SKU distribution vs reorder threshold',
              labels: ['Healthy', 'Low Stock', 'Out of Stock'],
              values: [stats.healthyCount, stats.lowCount, stats.outCount],
              colors: [COLORS.successAccent, COLORS.amber, COLORS.coral]
            },
            right: {
              type: 'lollipop',
              title: 'Valuation by Category',
              subtitle: 'Capital tied up per group',
              valueFormat: 'currency',
              labels: catTop.map(([k]) => cleanText(k, 16)),
              values: catTop.map(([, v]) => Number(v.toFixed(2)))
            }
          },
          {
            type: 'highlights',
            title: 'Supply Chain Highlights',
            items: [
              {
                eyebrow: 'TOP CAPITAL CATEGORY',
                metric: topCat ? fmtMoney(topCat[1]) : '—',
                title: topCat ? cleanText(topCat[0], 30) : 'No Category Valuation',
                detail: topCat ? `${fmtPercent(pct(topCat[1], stats.totalValue), 1)} share of total warehouse valuation.` : 'No priced items registered.',
                tone: 'primary'
              },
              {
                eyebrow: 'PRIMARY SUPPLIER EXPOSURE',
                metric: topSup ? fmtMoney(topSup[1]) : '—',
                title: topSup ? cleanText(topSup[0], 30) : 'No Supplier Assigned',
                detail: 'Highest single-vendor spare parts inventory holding value.',
                tone: 'info'
              },
              {
                eyebrow: 'BUFFER ADHERENCE',
                metric: fmtPercent(healthyPct, 1),
                title: `${fmtNumber(stats.healthyCount)} Healthy SKUs`,
                detail: `${fmtNumber(atRisk)} SKU(s) currently below reorder threshold or depleted.`,
                tone: healthyPct >= 85 ? 'success' : 'warning'
              },
              {
                eyebrow: 'AUDITED VELOCITY',
                metric: `${fmtNumber(movements.length)} moves`,
                title: `+${fmtNumber(totalIn)} IN  /  -${fmtNumber(totalOut)} OUT`,
                detail: `Latest ${movements.length} stock transactions audited in selected period.`,
                tone: 'teal'
              }
            ]
          },
          {
            type: 'brief',
            title: 'Warehouse Valuation Narrative',
            text: `Current spare-parts inventory totals ${fmtMoney(stats.totalValue)} across ${fmtNumber(stats.totalUnits)} physical units. `
              + `Healthy buffer coverage stands at ${fmtPercent(healthyPct, 1)}, while ${fmtNumber(totalIn)} units were received against ${fmtNumber(totalOut)} consumed across ${fmtNumber(movements.length)} audited movements.`
          }
        ]
      },
      {
        title: 'Inventory Valuation Catalogue',
        subtitle: `Itemized SKU pricing, stock balance and capital totals (${fmtNumber(items.length)} SKUs)`,
        blocks: [{ type: 'table', showHeading: false, table: catalogueTable }]
      },
      {
        title: 'Audited Stock Movements Ledger',
        subtitle: `Chronological receipts, issues, transfers and balance deltas (${fmtNumber(movementRows.length)} records)`,
        blocks: [{ type: 'table', showHeading: false, table: movementsTable }]
      }
    ];

    return {
      moduleKey: 'warehouse',
      docCode: 'CAE-INV-07',
      theme: 'warehouse',
      title: 'Warehouse & Spare Parts Report',
      subtitle: 'Stock valuation, replenishment exposure and audited movement ledger',
      category: 'SUPPLY CHAIN & PROCUREMENT',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Total Stock Value', value: fmtMoney(stats.totalValue) },
        { label: 'At-Risk SKUs', value: fmtNumber(atRisk) },
        { label: 'Audited Movements', value: fmtNumber(movements.length) }
      ],
      filters,
      pages,
      tables: [catalogueTable, movementsTable, ...(stats.priorityRestock.length ? [restockTable] : [])]
    };
  }
};
