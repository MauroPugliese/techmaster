const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

const {
  validatePasswordStrength,
  guardSelfOrLastAdminAction,
  buildAuditLogWhere,
  formatDbTableRow
} = require('../../services/admin-helpers.service');

test('validatePasswordStrength enforces length and character classes', () => {
  assert.equal(validatePasswordStrength('').valid, false);
  assert.equal(validatePasswordStrength('Short1A').valid, false);
  assert.equal(validatePasswordStrength('alllowercase1').valid, false);
  assert.equal(validatePasswordStrength('ALLUPPERCASE1').valid, false);
  assert.equal(validatePasswordStrength('NoDigitsHere').valid, false);

  const ok = validatePasswordStrength('SmartPass2026');
  assert.deepEqual(ok, { valid: true });
});

test('guardSelfOrLastAdminAction blocks self-delete, self-deactivate, and self-demotion', () => {
  const selfAdmin = { id: 7, is_active: true, role: { name: 'admin' } };

  const del = guardSelfOrLastAdminAction({
    actorId: 7,
    targetUser: selfAdmin,
    action: 'delete',
    activeAdminCount: 3
  });
  assert.equal(del.allowed, false);
  assert.equal(del.status, 400);

  const deact = guardSelfOrLastAdminAction({
    actorId: 7,
    targetUser: selfAdmin,
    action: 'deactivate',
    activeAdminCount: 3
  });
  assert.equal(deact.allowed, false);

  const demote = guardSelfOrLastAdminAction({
    actorId: 7,
    targetUser: selfAdmin,
    action: 'change_role',
    nextRoleName: 'manager',
    activeAdminCount: 3
  });
  assert.equal(demote.allowed, false);
});

test('guardSelfOrLastAdminAction protects the last active administrator', () => {
  const onlyAdmin = { id: 2, is_active: true, role: { name: 'admin' } };

  for (const action of ['delete', 'deactivate', 'change_role']) {
    const res = guardSelfOrLastAdminAction({
      actorId: 99,
      targetUser: onlyAdmin,
      action,
      nextRoleName: action === 'change_role' ? 'tech' : 'admin',
      activeAdminCount: 1
    });
    assert.equal(res.allowed, false, `Expected action ${action} to be blocked`);
    assert.match(res.message, /last active administrator/i);
  }

  const allowedWhenTwoAdmins = guardSelfOrLastAdminAction({
    actorId: 99,
    targetUser: onlyAdmin,
    action: 'deactivate',
    activeAdminCount: 2
  });
  assert.deepEqual(allowedWhenTwoAdmins, { allowed: true });
});

test('buildAuditLogWhere builds filters for search, method, status groups, user_id, and date range', () => {
  assert.deepEqual(buildAuditLogWhere({}, Op), {});

  const w1 = buildAuditLogWhere({
    search: 'users',
    method: 'patch',
    status_group: 'errors',
    user_id: '12',
    from: '2026-11-01',
    to: '2026-11-23'
  }, Op);

  assert.equal(Array.isArray(w1[Op.or]), true);
  assert.equal(w1[Op.or].length, 4);
  assert.equal(w1.method, 'PATCH');
  assert.equal(w1.status[Op.gte], 400);
  assert.equal(w1.user_id, 12);
  assert.equal(w1.created_at[Op.gte].toISOString().startsWith('2026-11-01'), true);
  assert.equal(w1.created_at[Op.lte].toISOString(), '2026-11-23T23:59:59.999Z');

  const w2 = buildAuditLogWhere({ status_group: '2xx', user_id: 'invalid' }, Op);
  assert.deepEqual(w2.status, { [Op.between]: [200, 399] });
  assert.equal('user_id' in w2, false);
});

test('formatDbTableRow normalizes bytes to MB and non-negative row counts', () => {
  const row = formatDbTableRow({
    table_name: 'audit_logs',
    table_rows: 1500,
    size_bytes: 2 * 1024 * 1024 + 512 * 1024
  });
  assert.deepEqual(row, {
    table_name: 'audit_logs',
    table_rows: 1500,
    size_mb: 2.5
  });
});
