// =============================================================================
// services/operation-helpers.service.js — Pure Operations & Sorties Helpers
// =============================================================================
const VALID_OP_STATUSES = new Set(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']);
const VALID_OP_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_BULK_ACTIONS = new Set(['status', 'priority', 'delete']);
const OPEN_OP_STATUSES = new Set(['PLANNED', 'IN_PROGRESS', 'ON_HOLD']);

/**
 * Returns true if an open operation's planned end_date has passed.
 */
function isOperationOverdue(op, now = new Date()) {
  if (!op || !OPEN_OP_STATUSES.has(op.status)) return false;
  if (!op.end_date) return false;
  const end = new Date(op.end_date);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < now.getTime();
}

/**
 * Returns integer minutes between two dates, or null if invalid / negative.
 */
function calculateDurationMinutes(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const diffMs = e.getTime() - s.getTime();
  if (diffMs < 0) return null;
  return Math.round(diffMs / 60000);
}

function toOptionalDate(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'Invalid date format.' };
  return { provided: true, value: d };
}

/**
 * Normalizes optional crew member assignments `{ user_id, role_in_op }[]`.
 */
function sanitizeMembersInput(rawMembers) {
  if (rawMembers === undefined) return { provided: false, data: undefined };
  if (rawMembers === null) return { provided: true, data: [] };
  if (!Array.isArray(rawMembers)) {
    return { error: 'members must be an array.' };
  }
  if (rawMembers.length > 50) {
    return { error: 'Cannot assign more than 50 members per operation.' };
  }

  const byUserId = new Map();
  for (const item of rawMembers) {
    if (!item || typeof item !== 'object') {
      return { error: 'Invalid crew member entry.' };
    }
    const userId = Number(item.user_id);
    if (!Number.isInteger(userId) || userId < 1) {
      return { error: 'Each crew member requires a valid positive user_id.' };
    }
    const role = String(item.role_in_op ?? '').trim().slice(0, 100);
    byUserId.set(userId, { user_id: userId, role_in_op: role || null });
  }

  return { provided: true, data: Array.from(byUserId.values()) };
}

/**
 * Validates and normalizes create/update payloads for Operation records.
 */
function sanitizeOperationPayload(body = {}, { isCreate = false, existing = null } = {}) {
  const payload = {};

  if (body.title !== undefined || isCreate) {
    const title = String(body.title ?? '').trim();
    if (!title || title.length > 200) {
      return { error: 'Title is required (max 200 characters).' };
    }
    payload.title = title;
  }

  if (body.type_id !== undefined || isCreate) {
    const typeId = Number(body.type_id);
    if (!Number.isInteger(typeId) || typeId < 1) {
      return { error: 'Valid operation type is required.' };
    }
    payload.type_id = typeId;
  }

  if (body.status !== undefined || isCreate) {
    const status = String(body.status ?? 'PLANNED').trim().toUpperCase();
    if (!VALID_OP_STATUSES.has(status)) {
      return { error: 'Invalid operation status.' };
    }
    payload.status = status;
  }

  if (body.priority !== undefined || isCreate) {
    const priority = String(body.priority ?? 'MEDIUM').trim().toUpperCase();
    if (!VALID_OP_PRIORITIES.has(priority)) {
      return { error: 'Invalid operation priority.' };
    }
    payload.priority = priority;
  }

  if (body.location !== undefined) {
    const loc = String(body.location ?? '').trim();
    if (loc.length > 200) return { error: 'Location max 200 characters.' };
    payload.location = loc || null;
  }

  if (body.description !== undefined) {
    const desc = String(body.description ?? '').trim();
    if (desc.length > 5000) return { error: 'Description max 5000 characters.' };
    payload.description = desc || null;
  }

  if (body.notes !== undefined) {
    const notes = String(body.notes ?? '').trim();
    if (notes.length > 5000) return { error: 'Notes max 5000 characters.' };
    payload.notes = notes || null;
  }

  if (body.start_date !== undefined || isCreate) {
    const startParsed = toOptionalDate(body.start_date);
    if (startParsed.error || !startParsed.value) {
      return { error: 'Valid start_date is required.' };
    }
    payload.start_date = startParsed.value;
  }

  const endParsed = toOptionalDate(body.end_date);
  if (endParsed.error) return { error: 'Invalid end_date format.' };
  if (endParsed.provided) payload.end_date = endParsed.value;

  const effStart = payload.start_date ?? (existing?.start_date ? new Date(existing.start_date) : null);
  const effEnd = payload.end_date !== undefined
    ? payload.end_date
    : (existing?.end_date ? new Date(existing.end_date) : null);

  if (effStart && effEnd && effEnd.getTime() < effStart.getTime()) {
    return { error: 'End date must be on or after start date.' };
  }

  const actualEndParsed = toOptionalDate(body.actual_end_date);
  if (actualEndParsed.error) return { error: 'Invalid actual_end_date format.' };
  if (actualEndParsed.provided) {
    payload.actual_end_date = actualEndParsed.value;
  } else if (payload.status === 'COMPLETED' && !existing?.actual_end_date) {
    payload.actual_end_date = new Date();
  }

  if (body.metadata !== undefined && body.metadata !== null && typeof body.metadata === 'object') {
    payload.metadata = body.metadata;
  }

  return { data: payload };
}

/**
 * Validates bulk updates on Operation rows.
 */
function sanitizeBulkOperationAction(body = {}) {
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];

  if (!ids.length) {
    return { error: 'At least one valid operation id is required.' };
  }
  if (ids.length > 200) {
    return { error: 'Cannot update more than 200 operations at once.' };
  }

  const action = String(body.action || '').trim();
  if (!VALID_BULK_ACTIONS.has(action)) {
    return { error: 'Invalid bulk action.' };
  }

  if (action === 'status') {
    const val = String(body.value || '').trim().toUpperCase();
    if (!VALID_OP_STATUSES.has(val)) return { error: 'Invalid target operation status.' };
    return { data: { ids, action, value: val } };
  }

  if (action === 'priority') {
    const val = String(body.value || '').trim().toUpperCase();
    if (!VALID_OP_PRIORITIES.has(val)) return { error: 'Invalid target priority.' };
    return { data: { ids, action, value: val } };
  }

  return { data: { ids, action, value: null } };
}

/**
 * Validates manual mission log entry payloads.
 */
function sanitizeOperationLogPayload(body = {}) {
  const action = String(body.action ?? '').trim();
  if (!action || action.length > 200) {
    return { error: 'Log action is required (max 200 characters).' };
  }
  const details = body.details !== undefined && body.details !== null
    ? String(body.details).trim()
    : '';
  if (details.length > 2000) {
    return { error: 'Log details max 2000 characters.' };
  }
  return { data: { action, details: details || null } };
}

/**
 * Builds a Sequelize ORDER clause from allowlisted sort parameters.
 */
function buildOperationSortOrder(sortBy, sortDir, { OperationType, User } = {}) {
  const dir = String(sortDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const key = String(sortBy || '').trim();

  switch (key) {
    case 'id':
    case 'title':
    case 'status':
    case 'priority':
    case 'location':
    case 'start_date':
    case 'end_date':
    case 'created_at':
      return [[key, dir], ['id', 'DESC']];
    case 'type':
      return OperationType
        ? [[{ model: OperationType, as: 'type' }, 'name', dir], ['start_date', 'DESC']]
        : [['start_date', 'DESC']];
    case 'creator':
      return User
        ? [[{ model: User, as: 'creator' }, 'first_name', dir], ['start_date', 'DESC']]
        : [['start_date', 'DESC']];
    default:
      return [['start_date', 'DESC'], ['id', 'DESC']];
  }
}

/**
 * Aggregates global Operations KPI metrics.
 */
function summarizeOperationRows(rows = [], now = new Date()) {
  let planned_count = 0;
  let in_progress_count = 0;
  let on_hold_count = 0;
  let completed_count = 0;
  let cancelled_count = 0;
  let overdue_count = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const row of rows) {
    if (row.status === 'PLANNED') planned_count += 1;
    else if (row.status === 'IN_PROGRESS') in_progress_count += 1;
    else if (row.status === 'ON_HOLD') on_hold_count += 1;
    else if (row.status === 'COMPLETED') completed_count += 1;
    else if (row.status === 'CANCELLED') cancelled_count += 1;

    if (isOperationOverdue(row, now)) {
      overdue_count += 1;
    }

    const mins = calculateDurationMinutes(row.start_date, row.actual_end_date || row.end_date);
    if (mins !== null && mins > 0) {
      durationSum += mins;
      durationCount += 1;
    }
  }

  const total = rows.length;
  const activeDenominator = total - cancelled_count;
  const completion_rate = activeDenominator > 0
    ? Math.round((completed_count / activeDenominator) * 100)
    : 0;
  const avg_duration_minutes = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

  return {
    total,
    planned_count,
    in_progress_count,
    on_hold_count,
    completed_count,
    cancelled_count,
    overdue_count,
    completion_rate,
    avg_duration_minutes
  };
}

module.exports = {
  isOperationOverdue,
  calculateDurationMinutes,
  sanitizeMembersInput,
  sanitizeOperationPayload,
  sanitizeBulkOperationAction,
  sanitizeOperationLogPayload,
  buildOperationSortOrder,
  summarizeOperationRows
};
