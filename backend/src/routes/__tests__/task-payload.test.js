// =============================================================================
// routes/__tests__/task-payload.test.js — Task Payload, Bulk & Mentions Tests
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeTaskPayload,
  sanitizeBulkAction,
  extractMentionUsernames
} = require('../../services/task-payload.service');

test('sanitizeTaskPayload validates & normalizes create payloads with defaults', () => {
  const input = {
    title: '   Replace HVAC Filter Bank   ',
    description: '  Scheduled quarterly swap  ',
    assigned_to: '7',
    estimated_hours: '2.555',
    tags: 'hvac, safety , hvac, ',
    unknown_field: 'ignored'
  };

  const { error, data } = sanitizeTaskPayload(input, { isCreate: true });
  assert.equal(error, null);
  assert.equal(data.title, 'Replace HVAC Filter Bank');
  assert.equal(data.description, 'Scheduled quarterly swap');
  assert.equal(data.interval_type, 'ONCE');
  assert.equal(data.status, 'TODO');
  assert.equal(data.priority, 'MEDIUM');
  assert.equal(data.assigned_to, 7);
  assert.equal(data.estimated_hours, 2.56);
  assert.deepEqual(data.tags, ['hvac', 'safety']);
  assert.equal('unknown_field' in data, false);
  assert.equal(input.title, '   Replace HVAC Filter Bank   '); // immutable input
});

test('sanitizeTaskPayload rejects invalid fields on create and handles partial updates', () => {
  assert.ok(sanitizeTaskPayload({ title: '   ' }, { isCreate: true }).error);
  assert.ok(sanitizeTaskPayload({ title: 'Test', estimated_hours: -1 }, { isCreate: true }).error);
  assert.ok(sanitizeTaskPayload({ title: 'Test', status: 'BOGUS' }, { isCreate: true }).error);
  assert.ok(sanitizeTaskPayload({ title: 'Test', due_date: 'not-a-date' }, { isCreate: true }).error);

  const doneUpdate = sanitizeTaskPayload({ status: 'DONE' }, { isCreate: false, taskId: 12 });
  assert.equal(doneUpdate.error, null);
  assert.equal(doneUpdate.data.status, 'DONE');
  assert.ok(doneUpdate.data.completed_at instanceof Date);
  assert.equal('title' in doneUpdate.data, false);

  const reopenUpdate = sanitizeTaskPayload({ status: 'TODO', assigned_to: '' }, { isCreate: false, taskId: 12 });
  assert.equal(reopenUpdate.error, null);
  assert.equal(reopenUpdate.data.completed_at, null);
  assert.equal(reopenUpdate.data.assigned_to, null);

  const selfParent = sanitizeTaskPayload({ parent_id: 12 }, { isCreate: false, taskId: 12 });
  assert.match(selfParent.error, /own parent/i);
});

test('sanitizeBulkAction deduplicates IDs and validates each action value', () => {
  const okStatus = sanitizeBulkAction({ ids: [1, '2', 1], action: 'status', value: 'review' });
  assert.equal(okStatus.error, null);
  assert.deepEqual(okStatus.data, { ids: [1, 2], action: 'status', value: 'REVIEW' });

  const okUnassign = sanitizeBulkAction({ ids: [5], action: 'assign', value: '' });
  assert.equal(okUnassign.error, null);
  assert.equal(okUnassign.data.value, null);

  assert.ok(sanitizeBulkAction({ ids: [], action: 'delete' }).error);
  assert.ok(sanitizeBulkAction({ ids: Array.from({ length: 101 }, (_, i) => i + 1), action: 'delete' }).error);
  assert.ok(sanitizeBulkAction({ ids: [1], action: 'status', value: 'INVALID' }).error);
  assert.ok(sanitizeBulkAction({ ids: [1], action: 'unknown' }).error);
});

test('extractMentionUsernames deduplicates mentions and ignores emails', () => {
  const text = 'Hey @m.rossi and @elena_b, please review with @m.rossi. Mail support@cae.com if blocked.';
  const mentions = extractMentionUsernames(text);
  assert.deepEqual(mentions, ['m.rossi', 'elena_b']);
});
