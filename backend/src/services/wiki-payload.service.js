// =============================================================================
// services/wiki-payload.service.js — Pure Validation & Slug Helpers for Wiki
// =============================================================================

const VALID_ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'REVIEW', 'ARCHIVED'];
const VALID_SORT_KEYS        = ['recent', 'views', 'title', 'oldest'];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function slugify(text = '') {
  const normalized = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '');
  return normalized || 'article';
}

function ensureUniqueSlug(baseSlug, existingSlugs) {
  const set = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs || []);
  const cleanBase = slugify(baseSlug);
  if (!set.has(cleanBase)) return cleanBase;
  let n = 2;
  while (set.has(`${cleanBase.slice(0, 114)}-${n}`)) n += 1;
  return `${cleanBase.slice(0, 114)}-${n}`;
}

function escapeLikePattern(value = '') {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function buildExcerptFromMarkdown(md = '', maxLen = 180) {
  const plain = String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?(\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])?/gim, '')
    .replace(/[*_~>-]{1,3}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function parseNullablePositiveInt(raw, fieldLabel) {
  if (raw === null || raw === undefined || raw === '') return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `${fieldLabel} must be a positive integer` };
  }
  return { value: n, error: null };
}

function normalizeTags(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  const source = Array.isArray(raw) ? raw : String(raw).split(',');
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const clean = String(item ?? '').trim().replace(/^#+/, '').slice(0, 40);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
      if (out.length >= 20) break;
    }
  }
  return out;
}

/**
 * Validate and normalize WikiArticle create/update payloads without mutating input.
 */
function sanitizeArticlePayload(body, { isCreate = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid article payload', data: null, isContentChange: false };
  }

  const data = {};

  if (isCreate || hasOwn(body, 'title')) {
    const title = String(body.title ?? '').trim();
    if (!title) return { error: 'Article title is required', data: null, isContentChange: false };
    if (title.length > 300) return { error: 'Article title must be 300 characters or fewer', data: null, isContentChange: false };
    data.title = title;
  }

  if (isCreate || hasOwn(body, 'content')) {
    const content = String(body.content ?? '');
    if (!content.trim()) return { error: 'Article content is required', data: null, isContentChange: false };
    data.content = content;
  }

  if (isCreate || hasOwn(body, 'excerpt')) {
    const rawExcerpt = String(body.excerpt ?? '').trim();
    data.excerpt = rawExcerpt
      ? rawExcerpt.slice(0, 500)
      : (hasOwn(data, 'content') ? buildExcerptFromMarkdown(data.content) : null);
  }

  if (isCreate || hasOwn(body, 'status')) {
    const status = String(body.status ?? 'DRAFT').toUpperCase();
    if (!VALID_ARTICLE_STATUSES.includes(status)) {
      return { error: `Invalid article status: ${status}`, data: null, isContentChange: false };
    }
    data.status = status;
  }

  if (hasOwn(body, 'category_id')) {
    const parsed = parseNullablePositiveInt(body.category_id, 'category_id');
    if (parsed.error) return { error: parsed.error, data: null, isContentChange: false };
    data.category_id = parsed.value;
  }

  if (isCreate || hasOwn(body, 'tags')) {
    data.tags = normalizeTags(body.tags);
  }

  if (isCreate || hasOwn(body, 'is_pinned')) {
    data.is_pinned = Boolean(body.is_pinned);
  }

  if (!isCreate && !Object.keys(data).length) {
    return { error: 'No valid updatable fields provided', data: null, isContentChange: false };
  }

  const contentFields = ['title', 'content', 'excerpt', 'status', 'category_id', 'tags'];
  const isContentChange = contentFields.some(f => hasOwn(data, f));

  return { error: null, data, isContentChange };
}

/**
 * Validate and normalize WikiCategory create/update payloads without mutating input.
 */
function sanitizeCategoryPayload(body, { isCreate = false, categoryId = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid category payload', data: null };
  }

  const data = {};

  if (isCreate || hasOwn(body, 'name')) {
    const name = String(body.name ?? '').trim();
    if (!name) return { error: 'Category name is required', data: null };
    if (name.length > 150) return { error: 'Category name must be 150 characters or fewer', data: null };
    data.name = name;
  }

  if (hasOwn(body, 'parent_id')) {
    const parsed = parseNullablePositiveInt(body.parent_id, 'parent_id');
    if (parsed.error) return { error: parsed.error, data: null };
    if (categoryId && parsed.value === Number(categoryId)) {
      return { error: 'Category cannot be its own parent', data: null };
    }
    data.parent_id = parsed.value;
  }

  if (isCreate || hasOwn(body, 'icon')) {
    const icon = String(body.icon ?? 'folder').trim();
    if (!/^[a-z0-9_]{1,50}$/.test(icon)) {
      return { error: 'Category icon must be a valid Material icon identifier', data: null };
    }
    data.icon = icon;
  }

  if (isCreate || hasOwn(body, 'sort_order')) {
    const order = body.sort_order === '' || body.sort_order === null || body.sort_order === undefined
      ? 0
      : Number(body.sort_order);
    if (!Number.isInteger(order)) {
      return { error: 'sort_order must be an integer', data: null };
    }
    data.sort_order = order;
  }

  if (!isCreate && !Object.keys(data).length) {
    return { error: 'No valid updatable category fields provided', data: null };
  }

  return { error: null, data };
}

module.exports = {
  VALID_ARTICLE_STATUSES,
  VALID_SORT_KEYS,
  slugify,
  ensureUniqueSlug,
  escapeLikePattern,
  buildExcerptFromMarkdown,
  sanitizeArticlePayload,
  sanitizeCategoryPayload
};
