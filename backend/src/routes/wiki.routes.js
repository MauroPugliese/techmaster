// =============================================================================
// routes/wiki.routes.js  — FIXED:
//   • Added DELETE /articles/:id  (was missing → frontend delete was 404)
//   • Added WikiCategory include to GET /articles/:slug (category was always null)
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { WikiArticle, WikiCategory, User } = require('../models');

router.get('/categories', async (req, res, next) => {
  try {
    const cats = await WikiCategory.findAll({
      include: [{ model: WikiCategory, as: 'children' }],
      where: { parent_id: null },
      order: [['sort_order', 'ASC']]
    });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
});

router.get('/articles', async (req, res, next) => {
  try {
    const { category_id, status = 'PUBLISHED', search, page = 1, limit = 20 } = req.query;
    const where = { status };
    if (category_id) where.category_id = category_id;
    if (search) where.title = { [Op.like]: `%${search}%` };

    const { count, rows } = await WikiArticle.findAndCountAll({
      where,
      include: [
        { model: User, as: 'author', attributes: ['id','first_name','last_name'] },
        { model: WikiCategory, as: 'category', attributes: ['id','name','icon'] }
      ],
      limit: +limit, offset: (+page-1)*+limit,
      order: [['is_pinned','DESC'], ['updated_at','DESC']]
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

// FIXED: added WikiCategory include so viewingArticle.category?.name works
router.get('/articles/:slug', async (req, res, next) => {
  try {
    const article = await WikiArticle.findOne({
      where: { slug: req.params.slug },
      include: [
        { model: User, as: 'author', attributes: ['id','first_name','last_name'] },
        { model: WikiCategory, as: 'category', attributes: ['id','name','icon'] }  // ← ADDED
      ]
    });
    if (!article) return res.status(404).json({ success: false, message: 'Article not found' });
    await article.increment('view_count');
    res.json({ success: true, data: article });
  } catch (err) { next(err); }
});

router.post('/articles', async (req, res, next) => {
  try {
    const slug = req.body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const article = await WikiArticle.create({ ...req.body, slug, author_id: req.user.id });
    res.status(201).json({ success: true, data: article });
  } catch (err) { next(err); }
});

router.put('/articles/:id', async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });
    await article.update({
      ...req.body,
      last_editor_id: req.user.id,
      version: article.version + 1
    });
    res.json({ success: true, data: article });
  } catch (err) { next(err); }
});

// ADDED: DELETE /wiki/articles/:id — was completely missing
router.delete('/articles/:id', async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });
    await article.destroy();
    res.json({ success: true, message: 'Article deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
