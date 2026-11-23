const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEffectiveReorderThreshold,
  computeStockStatus,
  computeReorderMetrics,
  sanitizeInventoryPayload,
  computeMovementTransition,
  buildInventorySortOrder,
  sanitizeBulkWarehouseAction,
  summarizeInventoryRows
} = require('../../services/warehouse-helpers.service');

test('computeStockStatus classifies out, low, overstock, and healthy accurately', () => {
  assert.equal(computeStockStatus({ quantity: 0, reorder_point: 5, min_stock: 2 }), 'out');
  assert.equal(computeStockStatus({ quantity: -1, reorder_point: 5, min_stock: 2 }), 'out');
  assert.equal(computeStockStatus({ quantity: 4, reorder_point: 5, min_stock: 2 }), 'low');
  assert.equal(computeStockStatus({ quantity: 5, reorder_point: 5, min_stock: 2 }), 'low');
  assert.equal(computeStockStatus({ quantity: 3, reorder_point: 0, min_stock: 4 }), 'low');
  assert.equal(computeStockStatus({ quantity: 10, reorder_point: 5, min_stock: 2, max_stock: 20 }), 'healthy');
  assert.equal(computeStockStatus({ quantity: 25, reorder_point: 5, min_stock: 2, max_stock: 20 }), 'overstock');
  assert.equal(getEffectiveReorderThreshold({ min_stock: 8, reorder_point: 3 }), 8);
});

test('computeReorderMetrics calculates target, deficit, estimated cost, and urgency', () => {
  const withMax = computeReorderMetrics({
    quantity: 0,
    min_stock: 5,
    reorder_point: 8,
    max_stock: 24,
    unit_cost: '12.50'
  });
  assert.deepEqual(withMax, {
    threshold: 8,
    target_qty: 24,
    deficit: 24,
    estimated_cost: 300,
    urgency: 'CRITICAL'
  });

  const withoutMaxNullCost = computeReorderMetrics({
    quantity: 4,
    min_stock: 5,
    reorder_point: 10,
    max_stock: null,
    unit_cost: null
  });
  assert.deepEqual(withoutMaxNullCost, {
    threshold: 10,
    target_qty: 20,
    deficit: 16,
    estimated_cost: null,
    urgency: 'HIGH'
  });

  const mediumTier = computeReorderMetrics({
    quantity: 7,
    min_stock: 3,
    reorder_point: 10,
    max_stock: 15,
    unit_cost: 2
  });
  assert.equal(mediumTier.urgency, 'MEDIUM');
  assert.equal(mediumTier.deficit, 8);
  assert.equal(mediumTier.estimated_cost, 16);
});

test('sanitizeInventoryPayload enforces required fields, optional location, and threshold consistency', () => {
  const valid = sanitizeInventoryPayload({
    category_id: '2',
    location_id: '',
    sku: '  SRV-101 ',
    part_number: '  ',
    name: ' NVMe SSD 2TB ',
    unit: '',
    quantity: '5',
    min_stock: '2',
    reorder_point: '4',
    max_stock: '12',
    unit_cost: '149.999',
    supplier: '  Samsung  '
  }, { isCreate: true });

  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.data, {
    category_id: 2,
    location_id: null,
    sku: 'SRV-101',
    part_number: null,
    name: 'NVMe SSD 2TB',
    unit: 'pcs',
    quantity: 5,
    min_stock: 2,
    reorder_point: 4,
    max_stock: 12,
    unit_cost: 150,
    supplier: 'Samsung'
  });

  const badThreshold = sanitizeInventoryPayload({
    category_id: 1,
    sku: 'ABC-1',
    name: 'Cable',
    quantity: 10,
    min_stock: 5,
    reorder_point: 8,
    max_stock: 6
  }, { isCreate: true });
  assert.match(badThreshold.error, /Max stock must be greater than or equal/i);
});

test('computeMovementTransition handles IN, OUT, insufficient stock, ADJUSTMENT to 0, and TRANSFER relocation', () => {
  const item = { id: 1, quantity: 10, location_id: 1 };

  const inRes = computeMovementTransition({ item, type: 'IN', quantity: 5, reason: 'Restock' });
  assert.equal(inRes.ok, true);
  assert.equal(inRes.qty_before, 10);
  assert.equal(inRes.qty_after, 15);

  const outFail = computeMovementTransition({ item, type: 'OUT', quantity: 12 });
  assert.equal(outFail.ok, false);
  assert.equal(outFail.status, 400);

  const adjZero = computeMovementTransition({ item, type: 'ADJUSTMENT', quantity: 0, reason: 'Cycle count zeroed' });
  assert.equal(adjZero.ok, true);
  assert.equal(adjZero.qty_after, 0);
  assert.equal(adjZero.stored_quantity, 0);

  const sameLocFail = computeMovementTransition({
    item,
    type: 'TRANSFER',
    quantity: 3,
    to_location_id: 1
  });
  assert.equal(sameLocFail.ok, false);

  const relocate = computeMovementTransition({
    item,
    type: 'TRANSFER',
    quantity: 10,
    to_location_id: 3,
    fromLocationLabel: 'WH-MAIN (Main Warehouse)',
    toLocationLabel: 'SR-B (Server Room B)',
    reason: 'Rack migration'
  });
  assert.equal(relocate.ok, true);
  assert.equal(relocate.qty_after, 10);
  assert.equal(relocate.next_location_id, 3);
  assert.match(relocate.effective_reason, /\[Transfer: WH-MAIN \(Main Warehouse\) -> SR-B \(Server Room B\)\] Rack migration/);

  const extTransfer = computeMovementTransition({
    item,
    type: 'TRANSFER',
    quantity: 4,
    destination: 'Field Rig 2',
    reason: 'Urgent swap'
  });
  assert.equal(extTransfer.ok, true);
  assert.equal(extTransfer.qty_after, 6);
  assert.equal(extTransfer.next_location_id, undefined);
  assert.equal(extTransfer.effective_destination, 'Field Rig 2');
  assert.equal(extTransfer.effective_reason, '[Destination: Field Rig 2] Urgent swap');
});

test('sanitizeBulkWarehouseAction validates IDs, actions, and nullable location', () => {
  const unassignLoc = sanitizeBulkWarehouseAction({ ids: [1, 2, 2], action: 'location', value: '' });
  assert.deepEqual(unassignLoc.data, { ids: [1, 2], action: 'location', value: null });

  const setCat = sanitizeBulkWarehouseAction({ ids: [4], action: 'category', value: '3' });
  assert.deepEqual(setCat.data, { ids: [4], action: 'category', value: 3 });

  const badAction = sanitizeBulkWarehouseAction({ ids: [1], action: 'drop_table' });
  assert.match(badAction.error, /Invalid bulk action/i);

  const emptyIds = sanitizeBulkWarehouseAction({ ids: [], action: 'deactivate' });
  assert.match(emptyIds.error, /At least one valid item id/i);
});

test('summarizeInventoryRows computes global KPIs, valuation, restock cost, and breakdowns', () => {
  const summary = summarizeInventoryRows([
    {
      quantity: 0, min_stock: 2, reorder_point: 5, max_stock: 10, unit_cost: 20,
      category: { id: 1, name: 'Cables', color: '#1565C0' },
      location: { id: 1, code: 'WH-MAIN', name: 'Main Warehouse' }
    },
    {
      quantity: 3, min_stock: 2, reorder_point: 5, max_stock: 10, unit_cost: 10,
      category: { id: 1, name: 'Cables', color: '#1565C0' },
      location: null
    },
    {
      quantity: 12, min_stock: 2, reorder_point: 5, max_stock: 20, unit_cost: 100,
      category: { id: 2, name: 'Servers', color: '#0288D1' },
      location: { id: 2, code: 'SR-A', name: 'Server Room A' }
    },
    {
      quantity: 25, min_stock: 2, reorder_point: 5, max_stock: 20, unit_cost: 1,
      category: { id: 1, name: 'Cables', color: '#1565C0' },
      location: { id: 1, code: 'WH-MAIN', name: 'Main Warehouse' }
    }
  ]);

  assert.equal(summary.total_skus, 4);
  assert.equal(summary.total_units, 40);
  assert.equal(summary.out_of_stock_count, 1);
  assert.equal(summary.low_count, 1);
  assert.equal(summary.healthy_count, 1);
  assert.equal(summary.overstock_count, 1);
  assert.equal(summary.total_value, 1255);
  assert.equal(summary.estimated_restock_cost, 270); // (10-0)*20 + (10-3)*10
  assert.equal(summary.category_breakdown[0].name, 'Servers');
  assert.equal(summary.location_breakdown.some(l => l.name === 'Unassigned'), true);
});

test('buildInventorySortOrder handles allowlisted columns and falls back safely', () => {
  const ItemCategory = { name: 'ItemCategory' };
  const WarehouseLocation = { name: 'WarehouseLocation' };

  const qtySort = buildInventorySortOrder('quantity', 'desc', { ItemCategory, WarehouseLocation });
  assert.deepEqual(qtySort, [['quantity', 'DESC'], ['name', 'ASC']]);

  const locSort = buildInventorySortOrder('location', 'asc', { ItemCategory, WarehouseLocation });
  assert.deepEqual(locSort, [[{ model: WarehouseLocation, as: 'location' }, 'name', 'ASC'], ['name', 'ASC']]);

  const fallbackSort = buildInventorySortOrder('malicious_col; DROP TABLE', 'asc', { ItemCategory, WarehouseLocation });
  assert.deepEqual(fallbackSort, [[{ model: ItemCategory, as: 'category' }, 'name', 'ASC'], ['name', 'ASC']]);
});
