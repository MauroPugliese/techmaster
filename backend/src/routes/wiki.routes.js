// =============================================================================
// routes/wiki.routes.js — Enhanced Knowledge Base & Documentation API
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { sequelize, WikiArticle, WikiCategory, User } = require('../models');
const { authorize } = require('../middleware/auth.middleware');
const {
  slugify,
  ensureUniqueSlug,
  escapeLikePattern,
  sanitizeArticlePayload,
  sanitizeCategoryPayload
} = require('../services/wiki-payload.service');

const ARTICLE_INCLUDES = [
  { model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'username'] },
  { model: User, as: 'lastEditor', attributes: ['id', 'first_name', 'last_name', 'username'] },
  {
    model: WikiCategory,
    as: 'category',
    attributes: ['id', 'name', 'icon', 'parent_id'],
    include: [{ model: WikiCategory, as: 'parent', attributes: ['id', 'name', 'icon'] }]
  }
];

function resolveSortOrder(sortKey) {
  switch (String(sortKey || 'recent').toLowerCase()) {
    case 'views':  return [['view_count', 'DESC'], ['updated_at', 'DESC']];
    case 'title':  return [['title', 'ASC']];
    case 'oldest': return [['created_at', 'ASC']];
    default:       return [['is_pinned', 'DESC'], ['updated_at', 'DESC']];
  }
}

async function resolveUniqueCategorySlug(baseName, excludeId = null) {
  const base = slugify(baseName);
  const where = { slug: { [Op.like]: `${escapeLikePattern(base)}%` } };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const matches = await WikiCategory.findAll({ where, attributes: ['slug'] });
  return ensureUniqueSlug(base, matches.map(m => m.slug));
}

async function resolveUniqueArticleSlug(title, excludeId = null) {
  const base = slugify(title);
  const where = { slug: { [Op.like]: `${escapeLikePattern(base)}%` } };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const matches = await WikiArticle.findAll({ where, attributes: ['slug'] });
  return ensureUniqueSlug(base, matches.map(m => m.slug));
}

// ── Categories Tree + Counts + Admin/Manager CRUD ────────────────────────────

router.get('/categories', async (req, res, next) => {
  try {
    const isViewer = req.user?.role?.name === 'viewer';
    const { status } = req.query;
    const articleWhere = {};
    if (isViewer) articleWhere.status = 'PUBLISHED';
    else if (status && status !== 'ALL') articleWhere.status = status;

    const [cats, countRows] = await Promise.all([
      WikiCategory.findAll({
        include: [{ model: WikiCategory, as: 'children' }],
        where: { parent_id: null },
        order: [['sort_order', 'ASC'], ['name', 'ASC']]
      }),
      WikiArticle.findAll({
        attributes: ['category_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        where: articleWhere,
        group: ['category_id'],
        raw: true
      })
    ]);

    const countMap = new Map();
    for (const r of countRows) {
      if (r.category_id) countMap.set(Number(r.category_id), Number(r.cnt) || 0);
    }

    const enriched = cats.map(c => {
      const plain = c.toJSON();
      const children = (plain.children || [])
        .map(ch => ({ ...ch, article_count: countMap.get(ch.id) || 0 }))
        .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
      const directCount = countMap.get(plain.id) || 0;
      const childrenSum = children.reduce((acc, ch) => acc + ch.article_count, 0);
      return {
        ...plain,
        article_count: directCount,
        total_count:   directCount + childrenSum,
        children
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) { next(err); }
});

router.post('/categories', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const { error, data } = sanitizeCategoryPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    if (data.parent_id) {
      const parent = await WikiCategory.findByPk(data.parent_id);
      if (!parent) return res.status(404).json({ success: false, message: 'Parent category not found' });
    }

    const slug = await resolveUniqueCategorySlug(data.name);
    const created = await WikiCategory.create({ ...data, slug });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

router.put('/categories/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const category = await WikiCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    const { error, data } = sanitizeCategoryPayload(req.body, { isCreate: false, categoryId: category.id });
    if (error) return res.status(400).json({ success: false, message: error });

    const updates = { ...data };
    if (data.name && data.name !== category.name) {
      updates.slug = await resolveUniqueCategorySlug(data.name, category.id);
    }

    await category.update(updates);
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const category = await WikiCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    await WikiArticle.update({ category_id: null }, { where: { category_id: category.id } });
    await WikiCategory.update({ parent_id: null }, { where: { parent_id: category.id } });
    await category.destroy();

    res.json({ success: true, message: 'Category deleted' });
  } catch (err) { next(err); }
});

// ── Tags Facet ───────────────────────────────────────────────────────────────

router.get('/tags', async (req, res, next) => {
  try {
    const isViewer = req.user?.role?.name === 'viewer';
    const { status } = req.query;
    const where = {};
    if (isViewer) where.status = 'PUBLISHED';
    else if (status && status !== 'ALL') where.status = status;

    const rows = await WikiArticle.findAll({ where, attributes: ['tags'], raw: true });
    const tally = new Map();

    for (const row of rows) {
      let arr = row.tags;
      if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = []; }
      }
      if (!Array.isArray(arr)) continue;
      for (const rawTag of arr) {
        const clean = String(rawTag || '').trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        const entry = tally.get(key);
        if (entry) entry.count += 1;
        else tally.set(key, { tag: clean, count: 1 });
      }
    }

    const tags = Array.from(tally.values())
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
      .slice(0, 40);

    res.json({ success: true, data: tags });
  } catch (err) { next(err); }
});

// ── Articles CRUD & Search ───────────────────────────────────────────────────

router.get('/articles', async (req, res, next) => {
  try {
    const {
      category_id,
      status = 'PUBLISHED',
      tag,
      search,
      sort = 'recent',
      page = 1,
      limit = 20
    } = req.query;

    const isViewer = req.user?.role?.name === 'viewer';
    const andClauses = [];
    if (isViewer) {
      andClauses.push({ status: 'PUBLISHED' });
    } else if (status && status !== 'ALL') {
      andClauses.push({ status });
    }

    if (category_id) {
      const catId = Number(category_id);
      if (Number.isInteger(catId) && catId > 0) {
        const children = await WikiCategory.findAll({
          where: { parent_id: catId },
          attributes: ['id'],
          raw: true
        });
        const ids = [catId, ...children.map(c => c.id)];
        andClauses.push({ category_id: ids.length > 1 ? { [Op.in]: ids } : catId });
      }
    }

    if (search && String(search).trim()) {
      const q = `%${escapeLikePattern(String(search).trim())}%`;
      andClauses.push({
        [Op.or]: [
          { title:   { [Op.like]: q } },
          { excerpt: { [Op.like]: q } },
          { content: { [Op.like]: q } },
          sequelize.where(sequelize.cast(sequelize.col('WikiArticle.tags'), 'CHAR'), { [Op.like]: q })
        ]
      });
    }

    if (tag && String(tag).trim()) {
      const t = escapeLikePattern(String(tag).trim());
      andClauses.push(
        sequelize.where(sequelize.cast(sequelize.col('WikiArticle.tags'), 'CHAR'), { [Op.like]: `%"${t}"%` })
      );
    }

    const where = andClauses.length ? { [Op.and]: andClauses } : {};
    const parsedLimit = Math.min(100, Math.max(1, +limit || 20));
    const parsedPage  = Math.max(1, +page || 1);

    const { count, rows } = await WikiArticle.findAndCountAll({
      where,
      include: ARTICLE_INCLUDES,
      distinct: true,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order: resolveSortOrder(sort)
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.get('/articles/:slug', async (req, res, next) => {
  try {
    const param = String(req.params.slug || '');
    let article = await WikiArticle.findOne({
      where: { slug: param },
      include: ARTICLE_INCLUDES
    });
    if (!article && /^\d+$/.test(param)) {
      article = await WikiArticle.findByPk(Number(param), { include: ARTICLE_INCLUDES });
    }
    if (!article) return res.status(404).json({ success: false, message: 'Article not found' });
    if (req.user?.role?.name === 'viewer' && article.status !== 'PUBLISHED') {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    await article.increment('view_count');
    res.json({ success: true, data: { ...article.toJSON(), view_count: (article.view_count || 0) + 1 } });
  } catch (err) { next(err); }
});

router.post('/articles', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const { error, data } = sanitizeArticlePayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const slug = await resolveUniqueArticleSlug(data.title);
    const created = await WikiArticle.create({
      ...data,
      slug,
      author_id:      req.user.id,
      last_editor_id: req.user.id,
      published_at:   data.status === 'PUBLISHED' ? new Date() : null
    });

    const hydrated = await WikiArticle.findByPk(created.id, { include: ARTICLE_INCLUDES });
    res.status(201).json({ success: true, data: hydrated || created });
  } catch (err) { next(err); }
});

router.put('/articles/:id', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });

    const roleName = req.user?.role?.name;
    const isPrivileged = roleName === 'admin' || roleName === 'manager';
    if (!isPrivileged) {
      const requestedStatus = req.body?.status ? String(req.body.status).toUpperCase() : null;
      if (requestedStatus === 'ARCHIVED' || (article.status === 'PUBLISHED' && Number(article.author_id) !== Number(req.user?.id))) {
        return res.status(403).json({
          success: false,
          message: 'Only managers or administrators can archive or modify published SOPs authored by others.'
        });
      }
    }

    const { error, data, isContentChange } = sanitizeArticlePayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    const updates = { ...data };
    if (isContentChange) {
      updates.last_editor_id = req.user.id;
      updates.version = (article.version || 1) + 1;
    }
    if (data.status === 'PUBLISHED' && !article.published_at) {
      updates.published_at = new Date();
    }

    await article.update(updates);
    const hydrated = await WikiArticle.findByPk(article.id, { include: ARTICLE_INCLUDES });
    res.json({ success: true, data: hydrated || article });
  } catch (err) { next(err); }
});

router.patch('/articles/:id/pin', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });

    const nextPinned = typeof req.body?.is_pinned === 'boolean' ? req.body.is_pinned : !article.is_pinned;
    await article.update({ is_pinned: nextPinned });

    const hydrated = await WikiArticle.findByPk(article.id, { include: ARTICLE_INCLUDES });
    res.json({ success: true, data: hydrated || article });
  } catch (err) { next(err); }
});

router.delete('/articles/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });
    await article.destroy();
    res.json({ success: true, message: 'Article deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
