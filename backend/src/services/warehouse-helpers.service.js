// =============================================================================
// services/warehouse-helpers.service.js — Pure Warehouse Business Logic Helpers
// =============================================================================
const { literal } = require('sequelize');

const VALID_MOVEMENT_TYPES = new Set(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'RETURN']);
const VALID_BULK_ACTIONS = new Set(['category', 'location', 'deactivate']);
const VALID_PART_CLASSIFICATIONS = new Set(['CONSUMABLE', 'ROTATABLE_LRU', 'TOOL_CALIBRATED']);
const VALID_LRU_STATUSES = new Set(['SERVICEABLE', 'INSTALLED', 'UNSERVICEABLE', 'IN_REPAIR_RMA', 'QUARANTINE']);

/**
 * Returns the effective low-stock alert threshold for an inventory item.
 */
function getEffectiveReorderThreshold(item = {}) {
  const reorder = Number(item.reorder_point);
  const minStock = Number(item.min_stock);
  return Math.max(
    Number.isFinite(reorder) && reorder > 0 ? reorder : 0,
    Number.isFinite(minStock) && minStock > 0 ? minStock : 0
  );
}

/**
 * Classifies an item's stock level into 'out', 'low', 'overstock', or 'healthy'.
 */
function computeStockStatus(item = {}) {
  const qty = Number(item.quantity) || 0;
  if (qty <= 0) return 'out';

  const threshold = getEffectiveReorderThreshold(item);
  if (qty <= threshold) return 'low';

  const maxStock = item.max_stock != null && item.max_stock !== '' ? Number(item.max_stock) : null;
  if (maxStock != null && Number.isFinite(maxStock) && maxStock > 0 && qty > maxStock) {
    return 'overstock';
  }
  return 'healthy';
}

/**
 * Computes replenishment target, deficit, estimated cost, and urgency tier.
 */
function computeReorderMetrics(item = {}) {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const minStock = Math.max(0, Number(item.min_stock) || 0);
  const threshold = getEffectiveReorderThreshold(item);
  const rawMax = item.max_stock != null && item.max_stock !== '' ? Number(item.max_stock) : null;
  const maxStock = rawMax != null && Number.isFinite(rawMax) && rawMax > 0 ? rawMax : null;

  const target_qty = maxStock && maxStock > threshold
    ? maxStock
    : Math.max(threshold * 2, threshold + 1);

  const deficit = Math.max(0, target_qty - qty);

  const hasUnitCost = item.unit_cost !== null && item.unit_cost !== undefined && item.unit_cost !== '';
  const parsedCost = hasUnitCost ? Number(item.unit_cost) : null;
  const unitCost = parsedCost !== null && Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null;
  const estimated_cost = unitCost !== null ? Number((deficit * unitCost).toFixed(2)) : null;

  let urgency = 'MEDIUM';
  if (qty <= 0) urgency = 'CRITICAL';
  else if (qty <= minStock) urgency = 'HIGH';

  return {
    threshold,
    target_qty,
    deficit,
    estimated_cost,
    urgency
  };
}

function toOptionalPositiveInt(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 1) return NaN;
  return n;
}

function toNonNegativeInt(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return NaN;
  return n;
}

function toOptionalNonNegativeInt(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return NaN;
  return n;
}

function toOptionalUnitCost(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Number(n.toFixed(2));
}

/**
 * Validates and normalizes create/update payloads for inventory items.
 */
function sanitizeInventoryPayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.category_id !== undefined || isCreate) {
    const catId = toOptionalPositiveInt(body.category_id);
    if (!Number.isInteger(catId) || catId < 1) {
      return { error: 'Valid category_id is required.' };
    }
    payload.category_id = catId;
  }

  if (body.location_id !== undefined) {
    const locId = toOptionalPositiveInt(body.location_id);
    if (Number.isNaN(locId)) {
      return { error: 'location_id must be a positive integer or empty.' };
    }
    payload.location_id = locId;
  } else if (isCreate) {
    payload.location_id = null;
  }

  if (body.sku !== undefined || isCreate) {
    const sku = String(body.sku ?? '').trim();
    if (!sku || sku.length > 80) {
      return { error: 'SKU is required (max 80 characters).' };
    }
    payload.sku = sku;
  }

  if (body.part_number !== undefined) {
    const pn = String(body.part_number ?? '').trim();
    if (pn.length > 120) return { error: 'Part number max 120 characters.' };
    payload.part_number = pn || null;
  } else if (isCreate) {
    payload.part_number = null;
  }

  if (body.name !== undefined || isCreate) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 200) {
      return { error: 'Item name is required (max 200 characters).' };
    }
    payload.name = name;
  }

  if (body.description !== undefined) {
    const desc = String(body.description ?? '').trim();
    if (desc.length > 1000) return { error: 'Description max 1000 characters.' };
    payload.description = desc || null;
  }

  if (body.unit !== undefined || isCreate) {
    const unit = String(body.unit ?? '').trim();
    if (unit.length > 30) return { error: 'Unit max 30 characters.' };
    payload.unit = unit || 'pcs';
  }

  if (body.quantity !== undefined || isCreate) {
    const qty = toNonNegativeInt(body.quantity, 0);
    if (Number.isNaN(qty)) return { error: 'Quantity must be a non-negative integer.' };
    payload.quantity = qty;
  }

  if (body.min_stock !== undefined || isCreate) {
    const minStock = toNonNegativeInt(body.min_stock, 0);
    if (Number.isNaN(minStock)) return { error: 'Min stock must be a non-negative integer.' };
    payload.min_stock = minStock;
  }

  if (body.reorder_point !== undefined || isCreate) {
    const reorderPoint = toNonNegativeInt(body.reorder_point, 0);
    if (Number.isNaN(reorderPoint)) return { error: 'Reorder point must be a non-negative integer.' };
    payload.reorder_point = reorderPoint;
  }

  if (body.max_stock !== undefined) {
    const maxStock = toOptionalNonNegativeInt(body.max_stock);
    if (Number.isNaN(maxStock)) return { error: 'Max stock must be a non-negative integer.' };
    payload.max_stock = maxStock;
  } else if (isCreate) {
    payload.max_stock = null;
  }

  const effectiveMin = payload.min_stock ?? toNonNegativeInt(body.min_stock, 0);
  const effectiveReorder = payload.reorder_point ?? toNonNegativeInt(body.reorder_point, 0);
  if (payload.max_stock !== undefined && payload.max_stock !== null) {
    if (payload.max_stock < Math.max(effectiveMin, effectiveReorder)) {
      return { error: 'Max stock must be greater than or equal to min stock and reorder point.' };
    }
  }

  if (body.unit_cost !== undefined) {
    const cost = toOptionalUnitCost(body.unit_cost);
    if (Number.isNaN(cost)) return { error: 'Unit cost must be a non-negative number.' };
    payload.unit_cost = cost;
  } else if (isCreate) {
    payload.unit_cost = null;
  }

  if (body.supplier !== undefined) {
    const sup = String(body.supplier ?? '').trim();
    if (sup.length > 200) return { error: 'Supplier max 200 characters.' };
    payload.supplier = sup || null;
  }

  if (body.is_active !== undefined) {
    payload.is_active = Boolean(body.is_active);
  }

  if (body.part_classification !== undefined) {
    const cls = String(body.part_classification || 'CONSUMABLE').trim().toUpperCase();
    if (!VALID_PART_CLASSIFICATIONS.has(cls)) {
      return { error: 'Invalid part_classification.' };
    }
    payload.part_classification = cls;
  }

  if (body.aog_critical !== undefined) {
    payload.aog_critical = Boolean(body.aog_critical);
  }

  if (body.lead_time_days !== undefined) {
    const lt = toNonNegativeInt(body.lead_time_days, 7);
    if (Number.isNaN(lt)) return { error: 'lead_time_days must be a non-negative integer.' };
    payload.lead_time_days = lt;
  }

  if (body.unserviceable_qty !== undefined) {
    const uq = toNonNegativeInt(body.unserviceable_qty, 0);
    if (Number.isNaN(uq)) return { error: 'unserviceable_qty must be a non-negative integer.' };
    payload.unserviceable_qty = uq;
  }

  if (body.subsystem_code !== undefined) {
    const sc = String(body.subsystem_code ?? '').trim().toUpperCase().slice(0, 60);
    payload.subsystem_code = sc || null;
  }

  if (body.serial_number !== undefined) {
    const sn = String(body.serial_number ?? '').trim().slice(0, 120);
    payload.serial_number = sn || null;
  }

  if (body.lru_status !== undefined) {
    const ls = String(body.lru_status || 'SERVICEABLE').trim().toUpperCase();
    if (!VALID_LRU_STATUSES.has(ls)) return { error: 'Invalid lru_status.' };
    payload.lru_status = ls;
  }

  if (body.installed_simulator_id !== undefined) {
    const simId = toOptionalPositiveInt(body.installed_simulator_id);
    if (Number.isNaN(simId)) return { error: 'installed_simulator_id must be a positive integer or empty.' };
    payload.installed_simulator_id = simId;
  }

  if (body.rma_reference !== undefined) {
    const rma = String(body.rma_reference ?? '').trim().slice(0, 120);
    payload.rma_reference = rma || null;
  }

  if (body.on_order_qty !== undefined) {
    const ooq = toNonNegativeInt(body.on_order_qty, 0);
    if (Number.isNaN(ooq)) return { error: 'on_order_qty must be a non-negative integer.' };
    payload.on_order_qty = ooq;
  }

  if (body.expected_delivery_date !== undefined) {
    if (body.expected_delivery_date === null || body.expected_delivery_date === '') {
      payload.expected_delivery_date = null;
    } else {
      const s = String(body.expected_delivery_date).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return { error: 'expected_delivery_date must use YYYY-MM-DD format.' };
      }
      payload.expected_delivery_date = s;
    }
  }

  if (body.compatible_models !== undefined) {
    if (body.compatible_models === null || body.compatible_models === '') {
      payload.compatible_models = [];
    } else if (Array.isArray(body.compatible_models)) {
      payload.compatible_models = body.compatible_models
        .map(m => String(m || '').trim())
        .filter(Boolean)
        .slice(0, 30);
    } else if (typeof body.compatible_models === 'string') {
      payload.compatible_models = body.compatible_models
        .split(',')
        .map(m => m.trim())
        .filter(Boolean)
        .slice(0, 30);
    } else {
      return { error: 'compatible_models must be an array or comma-separated string.' };
    }
  }

  return { data: payload };
}

/**
 * Computes resulting stock quantity, optional location relocation, and normalized reason
 * for IN, OUT, TRANSFER, ADJUSTMENT (including 0), and RETURN movements.
 */
function computeMovementTransition({
  item,
  type,
  quantity,
  to_location_id = null,
  fromLocationLabel = null,
  toLocationLabel = null,
  destination = '',
  reason = ''
}) {
  if (!VALID_MOVEMENT_TYPES.has(type)) {
    return { ok: false, status: 400, message: 'Invalid movement type' };
  }

  const qty_before = Number(item?.quantity) || 0;
  const parsedQty = Number(quantity);
  const trimmedReason = String(reason ?? '').trim();
  const trimmedDestination = String(destination ?? '').trim();

  if (type === 'IN' || type === 'RETURN') {
    if (!Number.isInteger(parsedQty) || parsedQty < 1) {
      return { ok: false, status: 400, message: 'Quantity must be a positive integer' };
    }
    return {
      ok: true,
      qty_before,
      qty_after: qty_before + parsedQty,
      stored_quantity: parsedQty,
      next_location_id: undefined,
      effective_reason: trimmedReason || null,
      effective_destination: null
    };
  }

  if (type === 'OUT') {
    if (!Number.isInteger(parsedQty) || parsedQty < 1) {
      return { ok: false, status: 400, message: 'Quantity must be a positive integer' };
    }
    const qty_after = qty_before - parsedQty;
    if (qty_after < 0) {
      return { ok: false, status: 400, message: 'Insufficient stock' };
    }
    return {
      ok: true,
      qty_before,
      qty_after,
      stored_quantity: parsedQty,
      next_location_id: undefined,
      effective_reason: trimmedReason || null,
      effective_destination: trimmedDestination || null
    };
  }

  if (type === 'ADJUSTMENT') {
    if (!Number.isInteger(parsedQty) || parsedQty < 0) {
      return { ok: false, status: 400, message: 'Adjustment quantity must be a non-negative integer' };
    }
    return {
      ok: true,
      qty_before,
      qty_after: parsedQty,
      stored_quantity: parsedQty,
      next_location_id: undefined,
      effective_reason: trimmedReason || null,
      effective_destination: null
    };
  }

  // TRANSFER: either internal warehouse relocation (to_location_id) or external transfer out
  const hasTargetLoc = to_location_id !== null && to_location_id !== undefined && to_location_id !== '';
  if (hasTargetLoc) {
    const targetLocId = Number(to_location_id);
    if (!Number.isInteger(targetLocId) || targetLocId < 1) {
      return { ok: false, status: 400, message: 'Invalid destination location' };
    }
    if (targetLocId === Number(item?.location_id || 0)) {
      return { ok: false, status: 400, message: 'Destination location must differ from current location' };
    }

    const fromLabel = fromLocationLabel || 'Unassigned';
    const toLabel = toLocationLabel || `Location #${targetLocId}`;
    const prefix = `[Transfer: ${fromLabel} -> ${toLabel}]`;
    const effective_reason = trimmedReason ? `${prefix} ${trimmedReason}` : prefix;

    return {
      ok: true,
      qty_before,
      qty_after: qty_before,
      stored_quantity: Math.max(0, Number.isInteger(parsedQty) ? parsedQty : qty_before),
      next_location_id: targetLocId,
      effective_reason,
      effective_destination: toLabel
    };
  }

  if (!Number.isInteger(parsedQty) || parsedQty < 1) {
    return { ok: false, status: 400, message: 'Quantity must be a positive integer' };
  }
  const qty_after = qty_before - parsedQty;
  if (qty_after < 0) {
    return { ok: false, status: 400, message: 'Insufficient stock' };
  }

  const effective_reason = trimmedDestination
    ? (trimmedReason ? `[Destination: ${trimmedDestination}] ${trimmedReason}` : `[Destination: ${trimmedDestination}]`)
    : (trimmedReason || null);

  return {
    ok: true,
    qty_before,
    qty_after,
    stored_quantity: parsedQty,
    next_location_id: undefined,
    effective_reason,
    effective_destination: trimmedDestination || null
  };
}

/**
 * Builds a Sequelize ORDER clause from allowlisted sort parameters.
 */
function buildInventorySortOrder(sortBy, sortDir, { ItemCategory, WarehouseLocation } = {}) {
  const dir = String(sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const key = String(sortBy || '').trim();

  switch (key) {
    case 'name':
    case 'sku':
    case 'quantity':
    case 'unit_cost':
    case 'reorder_point':
    case 'updated_at':
    case 'supplier':
      return [[key, dir], ['name', 'ASC']];
    case 'total_value':
      return [[literal('COALESCE(quantity, 0) * COALESCE(unit_cost, 0)'), dir], ['name', 'ASC']];
    case 'category':
      return ItemCategory
        ? [[{ model: ItemCategory, as: 'category' }, 'name', dir], ['name', 'ASC']]
        : [['name', 'ASC']];
    case 'location':
      return WarehouseLocation
        ? [[{ model: WarehouseLocation, as: 'location' }, 'name', dir], ['name', 'ASC']]
        : [['name', 'ASC']];
    default:
      return ItemCategory
        ? [[{ model: ItemCategory, as: 'category' }, 'name', 'ASC'], ['name', 'ASC']]
        : [['name', 'ASC']];
  }
}

/**
 * Validates and normalizes bulk update requests for inventory items.
 */
function sanitizeBulkWarehouseAction(body = {}) {
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];

  if (!ids.length) {
    return { error: 'At least one valid item id is required.' };
  }
  if (ids.length > 200) {
    return { error: 'Cannot bulk update more than 200 items at once.' };
  }

  const action = String(body.action || '').trim();
  if (!VALID_BULK_ACTIONS.has(action)) {
    return { error: 'Invalid bulk action.' };
  }

  if (action === 'category') {
    const catId = toOptionalPositiveInt(body.value);
    if (!Number.isInteger(catId) || catId < 1) {
      return { error: 'Valid target category id is required.' };
    }
    return { data: { ids, action, value: catId } };
  }

  if (action === 'location') {
    const locId = toOptionalPositiveInt(body.value);
    if (Number.isNaN(locId)) {
      return { error: 'Invalid target warehouse location id.' };
    }
    return { data: { ids, action, value: locId } };
  }

  return { data: { ids, action, value: null } };
}

/**
 * Aggregates global inventory KPIs, valuation, restock deficit cost, and breakdowns.
 */
function summarizeInventoryRows(rows = []) {
  let total_units = 0;
  let healthy_count = 0;
  let low_count = 0;
  let out_of_stock_count = 0;
  let overstock_count = 0;
  let total_value = 0;
  let estimated_restock_cost = 0;

  const categoryMap = new Map();
  const locationMap = new Map();

  for (const row of rows) {
    const qty = Math.max(0, Number(row.quantity) || 0);
    const unitCost = row.unit_cost != null && row.unit_cost !== '' && Number.isFinite(Number(row.unit_cost))
      ? Number(row.unit_cost)
      : 0;
    const itemValue = qty * unitCost;
    const status = computeStockStatus(row);

    total_units += qty;
    total_value += itemValue;

    if (status === 'out') out_of_stock_count += 1;
    else if (status === 'low') low_count += 1;
    else if (status === 'overstock') overstock_count += 1;
    else healthy_count += 1;

    if (status === 'out' || status === 'low') {
      const { estimated_cost } = computeReorderMetrics(row);
      if (estimated_cost !== null) estimated_restock_cost += estimated_cost;
    }

    const catKey = row.category?.id ?? 'uncategorized';
    const existingCat = categoryMap.get(catKey) || {
      id: row.category?.id ?? null,
      name: row.category?.name || 'Uncategorized',
      color: row.category?.color || '#1565C0',
      items_count: 0,
      units: 0,
      total_value: 0
    };
    categoryMap.set(catKey, {
      ...existingCat,
      items_count: existingCat.items_count + 1,
      units: existingCat.units + qty,
      total_value: existingCat.total_value + itemValue
    });

    const locKey = row.location?.id ?? 'unassigned';
    const existingLoc = locationMap.get(locKey) || {
      id: row.location?.id ?? null,
      code: row.location?.code || null,
      name: row.location?.name || 'Unassigned',
      items_count: 0,
      units: 0,
      total_value: 0
    };
    locationMap.set(locKey, {
      ...existingLoc,
      items_count: existingLoc.items_count + 1,
      units: existingLoc.units + qty,
      total_value: existingLoc.total_value + itemValue
    });
  }

  const category_breakdown = Array.from(categoryMap.values())
    .map(c => ({ ...c, total_value: Number(c.total_value.toFixed(2)) }))
    .sort((a, b) => b.total_value - a.total_value || b.items_count - a.items_count);

  const location_breakdown = Array.from(locationMap.values())
    .map(l => ({ ...l, total_value: Number(l.total_value.toFixed(2)) }))
    .sort((a, b) => b.total_value - a.total_value || b.items_count - a.items_count);

  return {
    total_skus: rows.length,
    total_units,
    healthy_count,
    low_count,
    out_of_stock_count,
    overstock_count,
    total_value: Number(total_value.toFixed(2)),
    estimated_restock_cost: Number(estimated_restock_cost.toFixed(2)),
    category_breakdown,
    location_breakdown
  };
}

module.exports = {
  getEffectiveReorderThreshold,
  computeStockStatus,
  computeReorderMetrics,
  sanitizeInventoryPayload,
  computeMovementTransition,
  buildInventorySortOrder,
  sanitizeBulkWarehouseAction,
  summarizeInventoryRows
};
