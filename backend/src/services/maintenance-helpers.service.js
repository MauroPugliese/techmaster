// =============================================================================
// services/maintenance-helpers.service.js — Pure Maintenance & Asset Helpers
// =============================================================================
const VALID_MAINT_TYPES = new Set(['PREVENTIVE', 'CORRECTIVE', 'PREDICTIVE', 'UPGRADE', 'INSPECTION']);
const VALID_MAINT_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DEFERRED']);
const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_ASSET_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'RETIRED', 'LOST']);
const VALID_BULK_ACTIONS = new Set(['status', 'priority', 'delete']);
const OPEN_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS', 'DEFERRED']);
const VALID_SNAG_SEVERITIES = new Set(['MINOR', 'DEGRADED', 'AOG']);

/**
 * Returns true if an open maintenance record's scheduled date has passed.
 */
function isRecordOverdue(record, now = new Date()) {
  if (!record || !OPEN_STATUSES.has(record.status)) return false;
  if (!record.scheduled_date) return false;
  const sched = new Date(record.scheduled_date);
  if (Number.isNaN(sched.getTime())) return false;
  return sched.getTime() < now.getTime();
}

function toOptionalNullableFloat(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: 'Must be a non-negative number.' };
  return { provided: true, value: Number(n.toFixed(2)) };
}

function toOptionalNullableDate(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Invalid date format.' };
  return { provided: true, value: d };
}

function toOptionalDateOnly(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return { provided: true, value: str };
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return { error: 'Invalid date format.' };
  return { provided: true, value: d.toISOString().slice(0, 10) };
}

/**
 * Normalizes optional parts_used arrays linking Warehouse items to Maintenance records.
 */
function sanitizePartsUsed(rawParts) {
  if (rawParts === undefined) return { provided: false, data: undefined };
  if (rawParts === null || rawParts === '') return { provided: true, data: [] };
  if (!Array.isArray(rawParts)) {
    return { error: 'parts_used must be an array.' };
  }
  if (rawParts.length > 50) {
    return { error: 'Cannot attach more than 50 spare parts per record.' };
  }

  const normalized = [];
  for (const part of rawParts) {
    if (!part || typeof part !== 'object') {
      return { error: 'Invalid part entry in parts_used.' };
    }
    const qty = Number(part.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return { error: 'Each part quantity must be a positive integer.' };
    }
    const name = String(part.name || '').trim().slice(0, 200);
    const sku = String(part.sku || '').trim().slice(0, 80);
    if (!name && !sku && !part.item_id) {
      return { error: 'Each part entry must reference an item or name.' };
    }
    const itemId = part.item_id != null && part.item_id !== '' ? Number(part.item_id) : null;
    if (itemId !== null && (!Number.isInteger(itemId) || itemId < 1)) {
      return { error: 'Invalid warehouse item_id in parts_used.' };
    }
    normalized.push({
      item_id: itemId,
      sku: sku || null,
      name: name || sku || `Item #${itemId}`,
      quantity: qty,
      unit: String(part.unit || 'pcs').trim().slice(0, 30) || 'pcs'
    });
  }

  return { provided: true, data: normalized };
}

/**
 * Validates and normalizes create/update payloads for MaintenanceRecord.
 */
function sanitizeMaintenancePayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.asset_id !== undefined && body.asset_id !== null && body.asset_id !== '') {
    const assetId = Number(body.asset_id);
    if (!Number.isInteger(assetId) || assetId < 1) {
      return { error: 'Valid asset_id is required.' };
    }
    payload.asset_id = assetId;
  } else if (body.asset_id === null || body.asset_id === '') {
    payload.asset_id = null;
  }

  if (body.simulator_id !== undefined && body.simulator_id !== null && body.simulator_id !== '') {
    const simId = Number(body.simulator_id);
    if (!Number.isInteger(simId) || simId < 1) {
      return { error: 'Valid simulator_id is required.' };
    }
    payload.simulator_id = simId;
  } else if (body.simulator_id === null || body.simulator_id === '') {
    payload.simulator_id = null;
  }

  if (isCreate && !payload.asset_id && !payload.simulator_id) {
    return { error: 'Valid asset_id or simulator_id is required.' };
  }

  if (body.title !== undefined || isCreate) {
    const title = String(body.title ?? '').trim();
    if (!title || title.length > 200) {
      return { error: 'Title is required (max 200 characters).' };
    }
    payload.title = title;
  }

  if (body.description !== undefined || isCreate) {
    const desc = String(body.description ?? '').trim();
    if (!desc || desc.length > 5000) {
      return { error: 'Description is required (max 5000 characters).' };
    }
    payload.description = desc;
  }

  if (body.type !== undefined || isCreate) {
    const type = String(body.type ?? 'PREVENTIVE').trim().toUpperCase();
    if (!VALID_MAINT_TYPES.has(type)) {
      return { error: 'Invalid maintenance type.' };
    }
    payload.type = type;
  }

  if (body.status !== undefined || isCreate) {
    const status = String(body.status ?? 'SCHEDULED').trim().toUpperCase();
    if (!VALID_MAINT_STATUSES.has(status)) {
      return { error: 'Invalid maintenance status.' };
    }
    payload.status = status;
  }

  if (body.priority !== undefined || isCreate) {
    const priority = String(body.priority ?? 'MEDIUM').trim().toUpperCase();
    if (!VALID_PRIORITIES.has(priority)) {
      return { error: 'Invalid priority.' };
    }
    payload.priority = priority;
  }

  if (body.scheduled_date !== undefined || isCreate) {
    const parsed = toOptionalNullableDate(body.scheduled_date);
    if (parsed.error || !parsed.value) {
      return { error: 'Valid scheduled_date is required.' };
    }
    payload.scheduled_date = parsed.value;
  }

  const completedParsed = toOptionalNullableDate(body.completed_date);
  if (completedParsed.error) return { error: 'Invalid completed_date.' };
  if (completedParsed.provided) payload.completed_date = completedParsed.value;

  if (payload.status === 'COMPLETED' && !payload.completed_date) {
    payload.completed_date = new Date();
  } else if (payload.status && payload.status !== 'COMPLETED' && body.completed_date === undefined && !isCreate) {
    // preserve explicit control if omitted on partial edits unless cleared
  }

  const nextSchedParsed = toOptionalNullableDate(body.next_scheduled);
  if (nextSchedParsed.error) return { error: 'Invalid next_scheduled date.' };
  if (nextSchedParsed.provided) payload.next_scheduled = nextSchedParsed.value;

  const downtimeParsed = toOptionalNullableFloat(body.downtime_hours);
  if (downtimeParsed.error) return { error: `Downtime ${downtimeParsed.error.toLowerCase()}` };
  if (downtimeParsed.provided) payload.downtime_hours = downtimeParsed.value;

  const costParsed = toOptionalNullableFloat(body.cost);
  if (costParsed.error) return { error: `Cost ${costParsed.error.toLowerCase()}` };
  if (costParsed.provided) payload.cost = costParsed.value;

  if (body.findings !== undefined) {
    const findings = String(body.findings ?? '').trim();
    if (findings.length > 5000) return { error: 'Findings max 5000 characters.' };
    payload.findings = findings || null;
  }

  const partsParsed = sanitizePartsUsed(body.parts_used);
  if (partsParsed.error) return { error: partsParsed.error };
  if (partsParsed.provided) payload.parts_used = partsParsed.data;

  if (body.sortie_id !== undefined) {
    if (body.sortie_id === null || body.sortie_id === '') {
      payload.sortie_id = null;
    } else {
      const sId = Number(body.sortie_id);
      if (!Number.isInteger(sId) || sId < 1) return { error: 'Invalid sortie_id.' };
      payload.sortie_id = sId;
    }
  }

  if (body.subsystem_code !== undefined) {
    const sc = String(body.subsystem_code ?? '').trim().toUpperCase().slice(0, 60);
    payload.subsystem_code = sc || null;
  }

  if (body.severity !== undefined) {
    const sev = String(body.severity || 'MINOR').trim().toUpperCase();
    if (!VALID_SNAG_SEVERITIES.has(sev)) return { error: 'Invalid snag severity.' };
    payload.severity = sev;
  }

  if (body.lost_training_hours !== undefined) {
    const lth = toOptionalNullableFloat(body.lost_training_hours);
    if (lth.error) return { error: `Lost training hours ${lth.error.toLowerCase()}` };
    payload.lost_training_hours = lth.value ?? 0;
  }

  if (body.is_snag !== undefined) {
    payload.is_snag = Boolean(body.is_snag);
  }

  return { data: payload };
}

/**
 * Validates and normalizes create/update payloads for Asset.
 */
function sanitizeAssetPayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.name !== undefined || isCreate) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 200) {
      return { error: 'Asset name is required (max 200 characters).' };
    }
    payload.name = name;
  }

  if (body.category_id !== undefined || isCreate) {
    const catId = Number(body.category_id);
    if (!Number.isInteger(catId) || catId < 1) {
      return { error: 'Valid category_id is required.' };
    }
    payload.category_id = catId;
  }

  if (body.status !== undefined || isCreate) {
    const status = String(body.status ?? 'ACTIVE').trim().toUpperCase();
    if (!VALID_ASSET_STATUSES.has(status)) {
      return { error: 'Invalid asset status.' };
    }
    payload.status = status;
  }

  if (body.assigned_to !== undefined) {
    if (body.assigned_to === null || body.assigned_to === '') {
      payload.assigned_to = null;
    } else {
      const uid = Number(body.assigned_to);
      if (!Number.isInteger(uid) || uid < 1) return { error: 'Invalid assigned_to user id.' };
      payload.assigned_to = uid;
    }
  }

  const stringFields = [
    ['serial_number', 100],
    ['model', 150],
    ['manufacturer', 150],
    ['location', 200],
    ['notes', 2000]
  ];
  for (const [key, maxLen] of stringFields) {
    if (body[key] !== undefined) {
      const val = String(body[key] ?? '').trim();
      if (val.length > maxLen) return { error: `${key} exceeds ${maxLen} characters.` };
      payload[key] = val || null;
    }
  }

  const purchaseParsed = toOptionalDateOnly(body.purchase_date);
  if (purchaseParsed.error) return { error: 'Invalid purchase_date.' };
  if (purchaseParsed.provided) payload.purchase_date = purchaseParsed.value;

  const warrantyParsed = toOptionalDateOnly(body.warranty_expiry);
  if (warrantyParsed.error) return { error: 'Invalid warranty_expiry date.' };
  if (warrantyParsed.provided) payload.warranty_expiry = warrantyParsed.value;

  return { data: payload };
}

/**
 * Validates and normalizes bulk updates on MaintenanceRecord rows.
 */
function sanitizeBulkMaintenanceAction(body = {}) {
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];

  if (!ids.length) {
    return { error: 'At least one valid maintenance record id is required.' };
  }
  if (ids.length > 200) {
    return { error: 'Cannot update more than 200 records at once.' };
  }

  const action = String(body.action || '').trim();
  if (!VALID_BULK_ACTIONS.has(action)) {
    return { error: 'Invalid bulk action.' };
  }

  if (action === 'status') {
    const val = String(body.value || '').trim().toUpperCase();
    if (!VALID_MAINT_STATUSES.has(val)) {
      return { error: 'Invalid target maintenance status.' };
    }
    return { data: { ids, action, value: val } };
  }

  if (action === 'priority') {
    const val = String(body.value || '').trim().toUpperCase();
    if (!VALID_PRIORITIES.has(val)) {
      return { error: 'Invalid target priority.' };
    }
    return { data: { ids, action, value: val } };
  }

  return { data: { ids, action, value: null } };
}

/**
 * Builds a Sequelize ORDER clause from allowlisted maintenance sort columns.
 */
function buildMaintenanceSortOrder(sortBy, sortDir, { Asset, User } = {}) {
  const dir = String(sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const key = String(sortBy || '').trim();

  switch (key) {
    case 'title':
    case 'scheduled_date':
    case 'completed_date':
    case 'status':
    case 'priority':
    case 'type':
    case 'cost':
    case 'downtime_hours':
    case 'created_at':
      return [[key, dir], ['id', 'ASC']];
    case 'asset':
      return Asset
        ? [[{ model: Asset, as: 'asset' }, 'name', dir], ['scheduled_date', 'ASC']]
        : [['scheduled_date', 'ASC']];
    case 'technician':
      return User
        ? [[{ model: User, as: 'technician' }, 'first_name', dir], ['scheduled_date', 'ASC']]
        : [['scheduled_date', 'ASC']];
    default:
      return [['scheduled_date', 'ASC'], ['id', 'DESC']];
  }
}

/**
 * Aggregates KPI metrics for work orders (MaintenanceRecord).
 */
function summarizeMaintenanceRows(rows = [], now = new Date()) {
  let scheduled_count = 0;
  let in_progress_count = 0;
  let completed_count = 0;
  let failed_count = 0;
  let deferred_count = 0;
  let overdue_count = 0;
  let total_cost = 0;
  let total_downtime_hours = 0;

  for (const row of rows) {
    if (row.status === 'SCHEDULED') scheduled_count += 1;
    else if (row.status === 'IN_PROGRESS') in_progress_count += 1;
    else if (row.status === 'COMPLETED') completed_count += 1;
    else if (row.status === 'FAILED') failed_count += 1;
    else if (row.status === 'DEFERRED') deferred_count += 1;

    if (isRecordOverdue(row, now)) {
      overdue_count += 1;
    }

    const cost = row.cost != null && row.cost !== '' && Number.isFinite(Number(row.cost))
      ? Number(row.cost)
      : 0;
    const downtime = row.downtime_hours != null && row.downtime_hours !== '' && Number.isFinite(Number(row.downtime_hours))
      ? Number(row.downtime_hours)
      : 0;

    total_cost += cost;
    total_downtime_hours += downtime;
  }

  return {
    total: rows.length,
    scheduled_count,
    in_progress_count,
    completed_count,
    failed_count,
    deferred_count,
    overdue_count,
    total_cost: Number(total_cost.toFixed(2)),
    total_downtime_hours: Number(total_downtime_hours.toFixed(2))
  };
}

/**
 * Computes Planned Maintenance summary KPIs for a target calendar month.
 */
function summarizePlannedMonth({ masters = [], expandedOccurrences = [], todayStr = '' } = {}) {
  const resolvedToday = todayStr || new Date().toISOString().slice(0, 10);
  const total_series = masters.length;
  const active_series = masters.filter(m => m.status !== 'DONE').length;
  const optional_series = masters.filter(m => Boolean(m.optional)).length;

  let due_today_count = 0;
  let due_today_todo = 0;
  let month_total_occurrences = 0;
  let month_done_occurrences = 0;

  for (const occ of expandedOccurrences) {
    month_total_occurrences += 1;
    if (occ.status === 'DONE') month_done_occurrences += 1;

    const occDate = String(occ.occurrenceDate || occ.operationDateStart || '').slice(0, 10);
    if (occDate === resolvedToday) {
      due_today_count += 1;
      if (occ.status !== 'DONE') due_today_todo += 1;
    }
  }

  const month_completion_pct = month_total_occurrences > 0
    ? Math.round((month_done_occurrences / month_total_occurrences) * 100)
    : 0;

  return {
    total_series,
    active_series,
    optional_series,
    due_today_count,
    due_today_todo,
    month_total_occurrences,
    month_done_occurrences,
    month_completion_pct
  };
}

module.exports = {
  isRecordOverdue,
  sanitizePartsUsed,
  sanitizeMaintenancePayload,
  sanitizeAssetPayload,
  sanitizeBulkMaintenanceAction,
  buildMaintenanceSortOrder,
  summarizeMaintenanceRows,
  summarizePlannedMonth
};
