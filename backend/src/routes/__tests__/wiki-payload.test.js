// =============================================================================
// routes/__tests__/wiki-payload.test.js — Wiki Validation, Slug & Excerpt Tests
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  slugify,
  ensureUniqueSlug,
  escapeLikePattern,
  buildExcerptFromMarkdown,
  sanitizeArticlePayload,
  sanitizeCategoryPayload
} = require('../../services/wiki-payload.service');

test('slugify & ensureUniqueSlug handle accents, punctuation, and collisions', () => {
  assert.equal(slugify('  Procedura Operativa: UPS #1 (Sì/No)! '), 'procedura-operativa-ups-1-si-no');
  assert.equal(slugify('   '), 'article');

  assert.equal(ensureUniqueSlug('ups-loto', ['other']), 'ups-loto');
  assert.equal(ensureUniqueSlug('ups-loto', ['ups-loto', 'ups-loto-2']), 'ups-loto-3');
});

test('buildExcerptFromMarkdown strips markdown chrome and truncates cleanly', () => {
  const md = [
    '# LOTO Procedure',
    '> [!CAUTION] Isolate main breaker first.',
    'Check [UPS Manual](https://example.com) and run `smart-cli status`.',
    '```bash',
    'echo ignored',
    '```'
  ].join('\n');

  const excerpt = buildExcerptFromMarkdown(md, 140);
  assert.doesNotMatch(excerpt, /\[!CAUTION\]|```|https:\/\/example\.com/);
  assert.match(excerpt, /LOTO Procedure/);
  assert.match(excerpt, /UPS Manual/);
});

test('sanitizeArticlePayload validates create payloads, auto-generates excerpt, and distinguishes pin-only updates', () => {
  const source = {
    title: '  Chiller Loop SOP  ',
    content: '# Overview\nKeep chillers balanced.',
    tags: ['HVAC', 'hvac', '#SOP', ''],
    status: 'published'
  };

  const created = sanitizeArticlePayload(source, { isCreate: true });
  assert.equal(created.error, null);
  assert.equal(created.data.title, 'Chiller Loop SOP');
  assert.equal(created.data.status, 'PUBLISHED');
  assert.deepEqual(created.data.tags, ['HVAC', 'SOP']);
  assert.match(created.data.excerpt, /Overview Keep chillers balanced\./);
  assert.equal(source.title, '  Chiller Loop SOP  ');

  assert.ok(sanitizeArticlePayload({ title: '', content: 'ok' }, { isCreate: true }).error);
  assert.ok(sanitizeArticlePayload({ title: 'Test', content: '   ' }, { isCreate: true }).error);
  assert.ok(sanitizeArticlePayload({ title: 'Test', content: 'ok', status: 'BAD' }, { isCreate: true }).error);

  const pinOnly = sanitizeArticlePayload({ is_pinned: true }, { isCreate: false });
  assert.equal(pinOnly.error, null);
  assert.equal(pinOnly.data.is_pinned, true);
  assert.equal(pinOnly.isContentChange, false);

  const editTitle = sanitizeArticlePayload({ title: 'Updated SOP Title' }, { isCreate: false });
  assert.equal(editTitle.error, null);
  assert.equal(editTitle.isContentChange, true);
});

test('sanitizeCategoryPayload validates names, icons, sort_order and prevents self-parent', () => {
  const valid = sanitizeCategoryPayload({ name: ' Electrical ', icon: 'bolt', sort_order: '2' }, { isCreate: true });
  assert.equal(valid.error, null);
  assert.equal(valid.data.name, 'Electrical');
  assert.equal(valid.data.icon, 'bolt');
  assert.equal(valid.data.sort_order, 2);

  assert.ok(sanitizeCategoryPayload({ name: '  ' }, { isCreate: true }).error);
  assert.ok(sanitizeCategoryPayload({ parent_id: 5 }, { isCreate: false, categoryId: 5 }).error);
  assert.ok(sanitizeCategoryPayload({ icon: '<script>' }, { isCreate: false, categoryId: 5 }).error);
  assert.equal(escapeLikePattern('100%_test\\x'), '100\\%\\_test\\\\x');
});
