// =============================================================================
// exports/modules/warehouse.js — Supply Chain, AOG Spares & LRU/RMA Pack (CAE-INV-07)
// Blueprint:
//   P1 Cover -> P2 Immediate Procurement & AOG Critical Action Sheet (Alerts + KPIs + Restock Table)
//   -> P3 Capital Allocation, LRU/RMA & Simulator Consumption Velocity
//   -> P4+ Inventory Valuation Catalogue -> P5+ Audited Stock Movements Ledger (with Simulator Bay)
// =============================================================================
const { Op, fn, col } = require('sequelize');
const { InventoryItem, ItemCategory, StockMovement, Simulator, User } = require('../../models');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtMoney, fmtPercent, fullName, dash,
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
  let aogCriticalLowCount = 0;
  let inRmaCount = 0;
  let onOrderUnits = 0;
  let totalUnits = 0;
  let totalValue = 0;
  const valueByCategory = {};
  const valueBySupplier = {};
  const priorityRestock = [];
  const lruRmaRows = [];

  const itemRows = items.map((item) => {
    const qty = toNumber(item.quantity, 0);
    const unitCost = toNumber(item.unit_cost, 0);
    const lineValue = qty * unitCost;
    const catName = item.category?.name || 'Uncategorized';
    const supName = item.supplier && String(item.supplier).trim() ? String(item.supplier).trim() : 'Unspecified';
    const health = classifyItemHealth(item);
    const onOrder = toNumber(item.on_order_qty, 0);

    totalUnits += qty;
    totalValue += lineValue;
    onOrderUnits += onOrder;
    valueByCategory[catName] = (valueByCategory[catName] || 0) + lineValue;
    valueBySupplier[supName] = (valueBySupplier[supName] || 0) + lineValue;

    if (health.label === 'OUT OF STOCK') outCount += 1;
    else if (health.label === 'LOW STOCK') lowCount += 1;
    else healthyCount += 1;

    if (item.aog_critical && health.label !== 'HEALTHY') aogCriticalLowCount += 1;
    if (item.lru_status === 'IN_REPAIR_RMA' || item.lru_status === 'UNSERVICEABLE' || item.lru_status === 'QUARANTINE') {
      inRmaCount += 1;
    }

    if (item.part_classification === 'ROTATABLE_LRU' || item.lru_status === 'IN_REPAIR_RMA' || item.rma_reference || item.installedSimulator) {
      lruRmaRows.push({
        sku: item.sku,
        name: cleanText(item.name, 42),
        serial: dash(item.serial_number),
        subsystem: item.subsystem_code || '—',
        lru_status: item.lru_status || 'SERVICEABLE',
        lru_status_tone: item.lru_status === 'IN_REPAIR_RMA' ? 'warning' : (item.lru_status === 'UNSERVICEABLE' ? 'danger' : 'info'),
        installed_on: item.installedSimulator ? `${item.installedSimulator.bay_code} · ${item.installedSimulator.name}` : 'Warehouse Shelf',
        rma: dash(item.rma_reference),
        eta: item.expected_delivery_date ? fmtDate(item.expected_delivery_date) : '—'
      });
    }

    if (health.label !== 'HEALTHY') {
      const targetQty = Math.max(health.threshold || 1, toNumber(item.min_stock, 0));
      priorityRestock.push({
        sku: item.sku,
        name: `${item.aog_critical ? '[AOG] ' : ''}${cleanText(item.name, 42)}`,
        category: catName,
        aog_critical: item.aog_critical ? 'YES' : 'NO',
        quantity: qty,
        on_order: onOrder,
        eta: item.expected_delivery_date ? fmtDate(item.expected_delivery_date) : '—',
        min_stock: toNumber(item.min_stock, 0),
        reorder_point: toNumber(item.reorder_point, 0),
        deficit: Math.max(1, targetQty - qty),
        est_restock_cost: Math.max(1, targetQty - qty) * unitCost,
        supplier: cleanText(supName, 26),
        stock_status: item.aog_critical ? 'AOG CRIT' : health.label,
        stock_status_tone: item.aog_critical ? 'danger' : health.tone,
        _flag: item.aog_critical ? 'danger' : health.flag
      });
    }

    return {
      sku: item.sku,
      part_number: dash(item.part_number),
      serial_number: dash(item.serial_number),
      name: cleanText(item.name, 46),
      category: catName,
      subsystem: item.subsystem_code || '—',
      aog: item.aog_critical ? 'YES' : 'NO',
      lru_status: item.lru_status || 'SERVICEABLE',
      unit: dash(item.unit || 'pcs'),
      quantity: qty,
      on_order: onOrder,
      eta: item.expected_delivery_date ? fmtDate(item.expected_delivery_date) : '—',
      min_stock: toNumber(item.min_stock, 0),
      reorder_point: toNumber(item.reorder_point, 0),
      unit_cost: unitCost,
      total_value: lineValue,
      supplier: cleanText(supName, 28),
      is_active: item.is_active ? 'Active' : 'Inactive',
      stock_status: health.label,
      stock_status_tone: health.tone,
      _flag: item.aog_critical && health.label !== 'HEALTHY' ? 'danger' : health.flag
    };
  });

  priorityRestock.sort((a, b) => (b.aog_critical === 'YES' ? 1 : 0) - (a.aog_critical === 'YES' ? 1 : 0) || (a.quantity - b.quantity) || (b.deficit - a.deficit));

  return {
    outCount, lowCount, healthyCount, aogCriticalLowCount, inRmaCount, onOrderUnits,
    totalUnits, totalValue, valueByCategory, valueBySupplier, priorityRestock, lruRmaRows, itemRows
  };
}

function buildProcurementAlerts(stats, movementsLen, totalIn, totalOut) {
  const alerts = [];
  if (stats.aogCriticalLowCount > 0) {
    alerts.push({
      severity: 'danger',
      title: `${stats.aogCriticalLowCount} AOG-Critical Spare Part(s) Below Safety Buffer`,
      detail: 'Immediate procurement or RMA expedite required — shortage risks grounding Full Flight Simulators or Test Places.'
    });
  }
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
      detail: `Estimated replenishment spend: ${fmtMoney(estCost)}. Currently ${fmtNumber(stats.onOrderUnits)} unit(s) on order.`
    });
  }
  if (stats.inRmaCount > 0) {
    alerts.push({
      severity: 'info',
      title: `${stats.inRmaCount} Rotable LRU(s) in Repair (RMA) / Unserviceable`,
      detail: 'Track vendor turnaround ETA to protect rotable pool availability.'
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
      title: 'All Tracked Spare Parts & AOG Buffers Healthy',
      detail: 'No stockouts or reorder-point breaches detected across the filtered inventory scope.'
    });
  }
  return alerts;
}

module.exports = {
  key: 'warehouse',
  docCode: 'CAE-INV-07',
  theme: 'warehouse',
  title: 'Warehouse, AOG Spares & LRU/RMA Report',
  subtitle: 'AOG critical buffers, rotable LRU/RMA tracking, valuation and simulator-linked movement ledger',
  category: 'SUPPLY CHAIN & PROCUREMENT',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const {
      category_id, location_id, low_stock, stock_status, part_classification,
      supplier, search, aog_critical, subsystem_code, lru_status
    } = req.query;

    const itemWhere = {};
    if (category_id) itemWhere.category_id = category_id;
    if (location_id) itemWhere.location_id = location_id;
    if (aog_critical === 'true' || aog_critical === '1') itemWhere.aog_critical = true;
    if (subsystem_code && String(subsystem_code).trim()) itemWhere.subsystem_code = String(subsystem_code).trim().toUpperCase();
    if (lru_status && String(lru_status).trim()) itemWhere.lru_status = String(lru_status).trim().toUpperCase();
    if (part_classification && String(part_classification).trim()) {
      itemWhere.part_classification = String(part_classification).trim().toUpperCase();
    }
    if (supplier && String(supplier).trim()) {
      itemWhere.supplier = { [Op.like]: `%${String(supplier).trim()}%` };
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      itemWhere[Op.or] = [
        { name: { [Op.like]: q } },
        { sku: { [Op.like]: q } },
        { part_number: { [Op.like]: q } },
        { serial_number: { [Op.like]: q } },
        { rma_reference: { [Op.like]: q } },
        { supplier: { [Op.like]: q } }
      ];
    }

    const movWhere = {};
    if (range.from || range.to) {
      movWhere.movement_date = {};
      if (range.from) movWhere.movement_date[Op.gte] = range.from;
      if (range.to) movWhere.movement_date[Op.lte] = range.to;
    }

    const [rawItems, movements, movAggRows] = await Promise.all([
      InventoryItem.findAll({
        where: itemWhere,
        include: [
          { model: ItemCategory, as: 'category', attributes: ['id', 'name', 'color'] },
          { model: Simulator, as: 'installedSimulator', attributes: ['id', 'bay_code', 'name'], required: false }
        ],
        order: [['aog_critical', 'DESC'], ['name', 'ASC']]
      }),
      StockMovement.findAll({
        where: movWhere,
        include: [
          { model: InventoryItem, as: 'item', attributes: ['sku', 'name'] },
          { model: Simulator, as: 'simulator', attributes: ['id', 'bay_code', 'name'], required: false },
          { model: User, as: 'user', attributes: ['first_name', 'last_name'] }
        ],
        order: [['movement_date', 'DESC']],
        limit: 250
      }),
      StockMovement.findAll({
        where: movWhere,
        attributes: [
          'type',
          [fn('COUNT', col('id')), 'cnt'],
          [fn('COALESCE', fn('SUM', col('quantity')), 0), 'qty_sum']
        ],
        group: ['type'],
        raw: true
      })
    ]);

    const normStockStatus = stock_status ? String(stock_status).trim().toUpperCase() : '';
    const items = rawItems.filter((it) => {
      const health = classifyItemHealth(it);
      if ((low_stock === 'true' || low_stock === '1') && health.label === 'HEALTHY') return false;
      if (normStockStatus === 'OUT' || normStockStatus === 'OUT_OF_STOCK') return health.label === 'OUT OF STOCK';
      if (normStockStatus === 'LOW' || normStockStatus === 'LOW_STOCK') return health.label === 'LOW STOCK';
      if (normStockStatus === 'HEALTHY' || normStockStatus === 'OK') return health.label === 'HEALTHY';
      if (normStockStatus === 'AT_RISK') return health.label !== 'HEALTHY';
      return true;
    });

    const stats = summarizeInventory(items);

    let totalIn = 0;
    let totalOut = 0;
    let totalMovementsCount = 0;
    for (const agg of movAggRows) {
      const cnt = toNumber(agg.cnt, 0);
      const qsum = toNumber(agg.qty_sum, 0);
      totalMovementsCount += cnt;
      if (agg.type === 'IN' || agg.type === 'RETURN') totalIn += qsum;
      if (agg.type === 'OUT' || agg.type === 'TRANSFER') totalOut += qsum;
    }

    const movementRows = movements.map((m) => {
      const qty = toNumber(m.quantity, 0);
      const before = toNumber(m.quantity_before, 0);
      const after = toNumber(m.quantity_after, 0);
      return {
        movement_date: m.movement_date ? fmtDateTime(m.movement_date) : '—',
        type: m.type,
        type_tone: MOVEMENT_TONE[m.type] || 'info',
        item_name: cleanText(m.item?.name || 'Item', 38),
        sku: dash(m.item?.sku),
        simulator: m.simulator ? `${m.simulator.bay_code}` : '—',
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
      name: 'Priority Restock & AOG Action List',
      priority: true,
      note: 'AOG-critical parts prioritized first, followed by SKUs at or below reorder threshold.',
      columns: [
        { header: 'SKU', key: 'sku', width: 64, type: 'mono' },
        { header: 'Spare Part / Item', key: 'name', width: 138 },
        { header: 'Status', key: 'stock_status', width: 72, type: 'badge', align: 'center' },
        { header: 'On Hand', key: 'quantity', width: 48, type: 'number', align: 'right' },
        { header: 'On Ord.', key: 'on_order', width: 46, type: 'number', align: 'right', total: 'sum' },
        { header: 'Deficit', key: 'deficit', width: 48, type: 'number', align: 'right', total: 'sum' },
        { header: 'ETA / Supplier', key: 'supplier', width: 96 },
        { header: 'ETA Date', key: 'eta', width: 68, printHidden: true },
        { header: 'Est. PO Cost', key: 'est_restock_cost', width: 82, type: 'currency', align: 'right', printHidden: true }
      ],
      rows: stats.priorityRestock
    };

    const lruTable = {
      name: 'Rotable LRU & RMA Repair Tracker',
      note: 'Serialized Line-Replaceable Units installed on simulator bays or undergoing vendor RMA repair.',
      columns: [
        { header: 'SKU', key: 'sku', width: 58, type: 'mono' },
        { header: 'LRU Component', key: 'name', width: 112 },
        { header: 'S/N', key: 'serial', width: 62, type: 'mono' },
        { header: 'Status', key: 'lru_status', width: 74, type: 'badge', align: 'center' },
        { header: 'Installed / Location', key: 'installed_on', width: 88 },
        { header: 'RMA Ref', key: 'rma', width: 62, type: 'mono' },
        { header: 'ETA', key: 'eta', width: 60 }
      ],
      rows: stats.lruRmaRows
    };

    const catalogueTable = {
      name: 'Inventory Valuation Catalogue',
      note: 'Asset valuation per SKU including AOG Criticality, LRU Status, On-Order & ETA (extended columns in Excel).',
      columns: [
        { header: 'SKU', key: 'sku', width: 64, type: 'mono' },
        { header: 'Item Name', key: 'name', width: 132 },
        { header: 'P/N', key: 'part_number', width: 75, type: 'mono', printHidden: true },
        { header: 'S/N', key: 'serial_number', width: 75, type: 'mono', printHidden: true },
        { header: 'Subsys.', key: 'subsystem', width: 58, printHidden: true },
        { header: 'AOG', key: 'aog', width: 42, printHidden: true },
        { header: 'LRU Status', key: 'lru_status', width: 76, printHidden: true },
        { header: 'Category', key: 'category', width: 82 },
        { header: 'Qty', key: 'quantity', width: 48, type: 'number', align: 'right', total: 'sum' },
        { header: 'On Ord.', key: 'on_order', width: 48, type: 'number', align: 'right', printHidden: true },
        { header: 'ETA', key: 'eta', width: 64, printHidden: true },
        { header: 'Unit Cost', key: 'unit_cost', width: 68, type: 'currency', align: 'right' },
        { header: 'Total Value', key: 'total_value', width: 82, type: 'currency', align: 'right', total: 'sum', dataBar: true },
        { header: 'Supplier', key: 'supplier', width: 95, printHidden: true }
      ],
      rows: stats.itemRows
    };

    const movementsTable = {
      name: 'Audited Stock Movements Ledger',
      note: 'Chronological warehouse receipts, consumption issues linked to Simulator Bays & Work Orders.',
      columns: [
        { header: 'Timestamp', key: 'movement_date', width: 86, type: 'date' },
        { header: 'Type', key: 'type', width: 66, type: 'badge', align: 'center' },
        { header: 'SKU', key: 'sku', width: 66, type: 'mono', printHidden: true },
        { header: 'Item', key: 'item_name', width: 126 },
        { header: 'Bay', key: 'simulator', width: 54, type: 'mono', align: 'center' },
        { header: 'Qty', key: 'quantity', width: 44, type: 'number', align: 'right', total: 'sum' },
        { header: 'Flow', key: 'delta_flow', width: 64, type: 'mono', align: 'center' },
        { header: 'Operator', key: 'operator', width: 76 },
        { header: 'Reference', key: 'reference', width: 76, type: 'mono', printHidden: true },
        { header: 'Reason', key: 'reason', width: 140, printHidden: true }
      ],
      rows: movementRows
    };

    const filters = { 'Movement Period': rangeLabel(range) };
    if (category_id) filters['Category ID'] = category_id;
    if (location_id) filters['Location ID'] = location_id;
    if (aog_critical === 'true' || aog_critical === '1') filters['AOG Filter'] = 'AOG Critical Only';
    if (subsystem_code) filters['Subsystem'] = subsystem_code;
    if (lru_status) filters['LRU Status'] = lru_status;
    if (part_classification) filters['Part Class'] = part_classification;
    if (supplier) filters['Supplier'] = supplier;
    if (stock_status) filters['Stock Status'] = String(stock_status).toUpperCase();
    if (low_stock === 'true' || low_stock === '1') filters['Stock Filter'] = 'Low / Out of Stock Only';
    if (search) filters.Search = search;

    const topCat = catTop[0];
    const topSup = supTop[0];

    const page2Blocks = [
      { type: 'alerts', title: 'Procurement, AOG Critical & RMA Exposure', items: buildProcurementAlerts(stats, totalMovementsCount, totalIn, totalOut) },
      {
        type: 'kpis',
        variant: 'strips',
        items: [
          { label: 'Tracked SKUs', value: fmtNumber(items.length), rawValue: items.length, sublabel: `${fmtNumber(stats.totalUnits)} units · ${fmtNumber(stats.onOrderUnits)} on order`, tone: 'primary' },
          { label: 'Total Stock Valuation', value: fmtMoney(stats.totalValue), rawValue: stats.totalValue, numFmt: '$#,##0.00', sublabel: `${catTop.length} categories valued`, tone: 'info' },
          { label: 'AOG Critical / At-Risk', value: `${stats.aogCriticalLowCount} / ${atRisk}`, rawValue: atRisk, sublabel: `${stats.outCount} zero · ${stats.inRmaCount} in RMA`, tone: stats.aogCriticalLowCount > 0 || atRisk > 0 ? 'danger' : 'success' },
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
        title: 'Immediate Procurement & AOG Spares Action Sheet',
        subtitle: `${stats.aogCriticalLowCount} AOG-critical low · ${fmtNumber(atRisk)} total SKUs requiring attention`,
        blocks: page2Blocks
      },
      {
        title: 'Capital Allocation, LRU/RMA & Velocity',
        subtitle: 'Category capital concentration, buffer health ratio and rotable LRU fleet status',
        blocks: [
          {
            type: 'chartPair',
            height: 196,
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
          ...(stats.lruRmaRows.length > 0 ? [{ type: 'table', showHeading: true, table: { ...lruTable, rows: stats.lruRmaRows.slice(0, 20) } }] : []),
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
                eyebrow: 'ROTABLE LRU / RMA POOL',
                metric: `${fmtNumber(stats.inRmaCount)} RMA`,
                title: `${fmtNumber(stats.lruRmaRows.length)} Tracked LRUs`,
                detail: `${fmtNumber(stats.onOrderUnits)} inbound spare units currently on purchase order.`,
                tone: stats.inRmaCount > 0 ? 'warning' : 'success'
              },
              {
                eyebrow: 'AUDITED VELOCITY',
                metric: `${fmtNumber(totalMovementsCount)} moves`,
                title: `+${fmtNumber(totalIn)} IN  /  -${fmtNumber(totalOut)} OUT`,
                detail: totalMovementsCount > movements.length
                  ? `Totals across all ${fmtNumber(totalMovementsCount)} movements (latest ${movements.length} itemized below).`
                  : `All ${fmtNumber(totalMovementsCount)} stock transactions audited with bay traceability.`,
                tone: 'teal'
              }
            ]
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
        subtitle: totalMovementsCount > movementRows.length
          ? `Latest ${fmtNumber(movementRows.length)} of ${fmtNumber(totalMovementsCount)} audited transactions`
          : `Chronological receipts, bay-linked issues, returns and deltas (${fmtNumber(movementRows.length)} records)`,
        blocks: [{ type: 'table', showHeading: false, table: movementsTable }]
      }
    ];

    return {
      moduleKey: 'warehouse',
      docCode: 'CAE-INV-07',
      theme: 'warehouse',
      title: 'Warehouse, AOG Spares & LRU/RMA Report',
      subtitle: 'Stock valuation, AOG critical buffers, rotable LRU/RMA & simulator-linked movement ledger',
      category: 'SUPPLY CHAIN & PROCUREMENT',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Total Stock Value', value: fmtMoney(stats.totalValue) },
        { label: 'AOG Crit / At-Risk', value: `${stats.aogCriticalLowCount} / ${fmtNumber(atRisk)}` },
        { label: 'In RMA / On Order', value: `${stats.inRmaCount} / ${fmtNumber(stats.onOrderUnits)} u` }
      ],
      filters,
      pages,
      tables: [catalogueTable, movementsTable, ...(stats.priorityRestock.length ? [restockTable] : []), ...(stats.lruRmaRows.length ? [lruTable] : [])]
    };
  }
};
