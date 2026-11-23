// =============================================================================
// services/admin-helpers.service.js — Pure helpers & safety guards for Admin API
// =============================================================================

/**
 * Validates that a password meets SMaRT platform complexity rules:
 * min 8 chars, at least 1 lowercase, 1 uppercase, and 1 digit.
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return {
      valid: false,
      message: 'Password must include uppercase, lowercase, and a number'
    };
  }
  return { valid: true };
}

/**
 * Prevents self-lockout and removal of the last active administrator account.
 * action: 'delete' | 'deactivate' | 'change_role'
 */
function guardSelfOrLastAdminAction({
  actorId,
  targetUser,
  action,
  nextRoleName,
  activeAdminCount
}) {
  if (!targetUser) {
    return { allowed: false, status: 404, message: 'User not found' };
  }

  const targetId = Number(targetUser.id);
  const currentActorId = Number(actorId);
  const isSelf = Number.isInteger(currentActorId) && currentActorId > 0 && targetId === currentActorId;
  const currentRoleName = String(targetUser.role?.name || targetUser.role_name || '').trim().toLowerCase();
  const targetIsActiveAdmin = currentRoleName === 'admin' && Boolean(targetUser.is_active);
  const normalizedNextRole = nextRoleName !== undefined && nextRoleName !== null
    ? String(nextRoleName).trim().toLowerCase()
    : currentRoleName;

  if (isSelf) {
    if (action === 'delete') {
      return { allowed: false, status: 400, message: 'Cannot delete your own account' };
    }
    if (action === 'deactivate') {
      return { allowed: false, status: 400, message: 'Cannot deactivate your own account' };
    }
    if (action === 'change_role' && currentRoleName === 'admin' && normalizedNextRole !== 'admin') {
      return { allowed: false, status: 400, message: 'Cannot remove admin role from your own account' };
    }
  }

  if (targetIsActiveAdmin && Number(activeAdminCount) <= 1) {
    if (
      action === 'delete' ||
      action === 'deactivate' ||
      (action === 'change_role' && normalizedNextRole !== 'admin')
    ) {
      return {
        allowed: false,
        status: 400,
        message: 'Cannot modify the last active administrator'
      };
    }
  }

  return { allowed: true };
}

/**
 * Safely builds a Sequelize `where` filter object for AuditLog queries.
 */
function buildAuditLogWhere(query = {}, Op) {
  const where = {};
  const { search, method, status_group, user_id, from, to } = query;

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    where[Op.or] = [
      { action:   { [Op.like]: term } },
      { path:     { [Op.like]: term } },
      { username: { [Op.like]: term } },
      { ip:       { [Op.like]: term } }
    ];
  }

  if (method && String(method).trim()) {
    const normalizedMethod = String(method).trim().toUpperCase();
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
      where.method = normalizedMethod;
    }
  }

  if (status_group && String(status_group).trim()) {
    const group = String(status_group).trim().toLowerCase();
    if (group === '2xx') {
      where.status = { [Op.between]: [200, 399] };
    } else if (group === '4xx') {
      where.status = { [Op.between]: [400, 499] };
    } else if (group === '5xx') {
      where.status = { [Op.gte]: 500 };
    } else if (group === 'errors') {
      where.status = { [Op.gte]: 400 };
    } else if (group === 'auth') {
      where.status = { [Op.in]: [401, 403] };
    }
  }

  if (user_id !== undefined && user_id !== null && String(user_id).trim() !== '') {
    const parsedUserId = Number(user_id);
    if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
      where.user_id = parsedUserId;
    }
  }

  const createdRange = {};
  if (from && String(from).trim()) {
    const fromDate = new Date(String(from).trim());
    if (!Number.isNaN(fromDate.getTime())) {
      createdRange[Op.gte] = fromDate;
    }
  }
  if (to && String(to).trim()) {
    const rawTo = String(to).trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawTo);
    const toDate = new Date(isDateOnly ? `${rawTo}T23:59:59.999Z` : rawTo);
    if (!Number.isNaN(toDate.getTime())) {
      createdRange[Op.lte] = toDate;
    }
  }
  if (Object.keys(createdRange).length > 0 || Object.getOwnPropertySymbols(createdRange).length > 0) {
    where.created_at = createdRange;
  }

  return where;
}

/**
 * Normalizes a table metadata row returned by INFORMATION_SCHEMA.TABLES.
 */
function formatDbTableRow(row = {}) {
  const bytes = Number(row.size_bytes ?? ((Number(row.data_length) || 0) + (Number(row.index_length) || 0)));
  const sizeMb = Number((bytes / (1024 * 1024)).toFixed(2));
  return {
    table_name: String(row.table_name || row.TABLE_NAME || ''),
    table_rows: Math.max(0, Number(row.table_rows ?? row.TABLE_ROWS ?? 0) || 0),
    size_mb: Number.isFinite(sizeMb) ? sizeMb : 0
  };
}

module.exports = {
  validatePasswordStrength,
  guardSelfOrLastAdminAction,
  buildAuditLogWhere,
  formatDbTableRow
};
