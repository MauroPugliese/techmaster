// =============================================================================
// services/task-payload.service.js — Pure Validation & Normalization for Tasks
// =============================================================================

const VALID_STATUSES   = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED', 'OVERDUE'];
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_INTERVALS  = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const BULK_ACTIONS     = ['status', 'priority', 'assign', 'delete'];

const ALLOWLISTED_FIELDS = [
  'title',
  'description',
  'parent_id',
  'category_id',
  'assigned_to',
  'interval_type',
  'status',
  'priority',
  'due_date',
  'estimated_hours',
  'actual_hours',
  'tags'
];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function parseNullablePositiveInt(raw, fieldLabel) {
  if (raw === null || raw === undefined || raw === '') return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `${fieldLabel} must be a positive integer` };
  }
  return { value: n, error: null };
}

function parseNullableHours(raw, fieldLabel) {
  if (raw === null || raw === undefined || raw === '') return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10000) {
    return { value: null, error: `${fieldLabel} must be a valid non-negative number` };
  }
  return { value: Math.round(n * 100) / 100, error: null };
}

function normalizeTags(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  const source = Array.isArray(raw) ? raw : String(raw).split(',');
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const clean = String(item ?? '').trim().slice(0, 40);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
      if (out.length >= 20) break;
    }
  }
  return out;
}

/**
 * Validate and normalize incoming task creation or partial update payloads.
 * Returns { error, data } without mutating the source object.
 */
function sanitizeTaskPayload(body, { isCreate = false, taskId = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request payload', data: null };
  }

  const data = {};

  if (isCreate || hasOwn(body, 'title')) {
    const title = String(body.title ?? '').trim();
    if (!title) return { error: 'Task title is required', data: null };
    if (title.length > 300) return { error: 'Task title must be 300 characters or fewer', data: null };
    data.title = title;
  }

  if (hasOwn(body, 'description')) {
    data.description = body.description === null || body.description === undefined
      ? null
      : String(body.description).trim() || null;
  }

  if (isCreate || hasOwn(body, 'interval_type')) {
    const interval = String(body.interval_type ?? 'ONCE').toUpperCase();
    if (!VALID_INTERVALS.includes(interval)) {
      return { error: `Invalid interval_type: ${interval}`, data: null };
    }
    data.interval_type = interval;
  }

  if (isCreate || hasOwn(body, 'status')) {
    const status = String(body.status ?? 'TODO').toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      return { error: `Invalid status: ${status}`, data: null };
    }
    data.status = status;
    data.completed_at = status === 'DONE' ? new Date() : null;
  }

  if (isCreate || hasOwn(body, 'priority')) {
    const priority = String(body.priority ?? 'MEDIUM').toUpperCase();
    if (!VALID_PRIORITIES.includes(priority)) {
      return { error: `Invalid priority: ${priority}`, data: null };
    }
    data.priority = priority;
  }

  for (const idField of ['assigned_to', 'parent_id', 'category_id']) {
    if (hasOwn(body, idField)) {
      const parsed = parseNullablePositiveInt(body[idField], idField);
      if (parsed.error) return { error: parsed.error, data: null };
      if (idField === 'parent_id' && taskId && parsed.value === Number(taskId)) {
        return { error: 'Task cannot be its own parent', data: null };
      }
      data[idField] = parsed.value;
    }
  }

  for (const hrField of ['estimated_hours', 'actual_hours']) {
    if (hasOwn(body, hrField)) {
      const parsed = parseNullableHours(body[hrField], hrField);
      if (parsed.error) return { error: parsed.error, data: null };
      data[hrField] = parsed.value;
    }
  }

  if (hasOwn(body, 'due_date')) {
    if (body.due_date === null || body.due_date === undefined || body.due_date === '') {
      data.due_date = null;
    } else {
      const parsedDate = new Date(body.due_date);
      if (Number.isNaN(parsedDate.getTime())) {
        return { error: 'Invalid due_date format', data: null };
      }
      data.due_date = parsedDate;
    }
  }

  if (isCreate || hasOwn(body, 'tags')) {
    data.tags = normalizeTags(body.tags);
  }

  if (!isCreate && !Object.keys(data).length) {
    return { error: 'No valid updatable fields provided', data: null };
  }

  return { error: null, data };
}

/**
 * Validate bulk task operations (`status`, `priority`, `assign`, `delete`).
 */
function sanitizeBulkAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid bulk payload', data: null };
  }

  if (!Array.isArray(body.ids) || !body.ids.length) {
    return { error: 'Select at least one task id', data: null };
  }

  const uniqueIds = [];
  const seen = new Set();
  for (const rawId of body.ids) {
    const parsed = parseNullablePositiveInt(rawId, 'task id');
    if (parsed.error || !parsed.value) {
      return { error: 'All ids must be positive integers', data: null };
    }
    if (!seen.has(parsed.value)) {
      seen.add(parsed.value);
      uniqueIds.push(parsed.value);
    }
  }

  if (uniqueIds.length > 100) {
    return { error: 'Bulk actions support up to 100 tasks at once', data: null };
  }

  const action = String(body.action ?? '').toLowerCase();
  if (!BULK_ACTIONS.includes(action)) {
    return { error: `Unsupported bulk action: ${action}`, data: null };
  }

  let value = null;
  if (action === 'status') {
    const s = String(body.value ?? '').toUpperCase();
    if (!VALID_STATUSES.includes(s)) return { error: `Invalid bulk status: ${s}`, data: null };
    value = s;
  } else if (action === 'priority') {
    const p = String(body.value ?? '').toUpperCase();
    if (!VALID_PRIORITIES.includes(p)) return { error: `Invalid bulk priority: ${p}`, data: null };
    value = p;
  } else if (action === 'assign') {
    const parsed = parseNullablePositiveInt(body.value, 'assigned_to');
    if (parsed.error) return { error: parsed.error, data: null };
    value = parsed.value;
  }

  return { error: null, data: { ids: uniqueIds, action, value } };
}

/**
 * Extract unique @username mentions from comment text while ignoring emails.
 */
function extractMentionUsernames(content = '') {
  const regex = /(?:^|[\s([{"'])@([a-zA-Z0-9_.-]+)/g;
  const usernames = new Set();
  let match;
  while ((match = regex.exec(String(content))) !== null) {
    const clean = match[1].replace(/[.,;:!?)]+$/, '');
    if (clean) usernames.add(clean);
  }
  return Array.from(usernames);
}

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_INTERVALS,
  BULK_ACTIONS,
  ALLOWLISTED_FIELDS,
  sanitizeTaskPayload,
  sanitizeBulkAction,
  extractMentionUsernames
};
