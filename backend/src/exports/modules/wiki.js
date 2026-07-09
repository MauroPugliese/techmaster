// =============================================================================
// exports/modules/wiki.js — Wiki articles report (list) + single article export
// =============================================================================
const { WikiArticle, WikiCategory, User } = require('../../models');
const { fmtDate, fullName, dash, cleanText } = require('../core/helpers');

const STATUS_FLAG = { PUBLISHED: 'success', ARCHIVED: 'muted', REVIEW: 'warning' };

module.exports = {
  key: 'wiki',
  title: 'Wiki Articles Report',
  subtitle: 'Knowledge base articles catalogue',
  orientation: 'landscape',

  // ── Catalogue / list export ───────────────────────────────────────────────
  async build(req) {
    const { status, category_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (category_id) where.category_id = category_id;

    const articles = await WikiArticle.findAll({
      where,
      include: [
        { model: WikiCategory, as: 'category', attributes: ['name'] },
        { model: User, as: 'author', attributes: ['first_name', 'last_name'] }
      ],
      order: [['updated_at', 'DESC']]
    });

    const byStatus = articles.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});

    return {
      filters: [
        { label: 'Status', value: status || 'All' },
        { label: 'Category', value: category_id ? `#${category_id}` : 'All' },
        { label: 'Total articles', value: articles.length }
      ],
      tables: [{
        name: 'Articles',
        summary: [
          { label: 'Total articles', value: articles.length },
          { label: 'Published', value: byStatus.PUBLISHED || 0 },
          { label: 'Draft', value: byStatus.DRAFT || 0 },
          { label: 'In review', value: byStatus.REVIEW || 0 }
        ],
        columns: [
          { header: '#', key: 'id', width: 7, align: 'right' },
          { header: 'Title', key: 'title', width: 36 },
          { header: 'Category', key: 'category', width: 18 },
          { header: 'Status', key: 'status', width: 13 },
          { header: 'Author', key: 'author', width: 20 },
          { header: 'Version', key: 'version', width: 9, align: 'right' },
          { header: 'Views', key: 'views', width: 9, align: 'right' },
          { header: 'Published', key: 'published', width: 14 }
        ],
        rows: articles.map((a) => ({
          id: a.id,
          title: a.title,
          category: a.category?.name || 'Uncategorized',
          status: a.status,
          author: fullName(a.author, 'System'),
          version: a.version,
          views: a.view_count,
          published: fmtDate(a.published_at),
          _flag: STATUS_FLAG[a.status]
        }))
      }]
    };
  },

  // ── Single article export (full content) ──────────────────────────────────
  async buildArticle(req) {
    const article = await WikiArticle.findByPk(req.params.id, {
      include: [
        { model: WikiCategory, as: 'category', attributes: ['name'] },
        { model: User, as: 'author', attributes: ['first_name', 'last_name'] }
      ]
    });
    if (!article) return null;

    const authorName = fullName(article.author, 'System');
    const body = cleanText(article.content || '');
    // Split into manageable paragraph rows for table rendering.
    const paragraphs = body.split(/(?<=\.)\s+(?=[A-Z])/).reduce((acc, sentence) => {
      const last = acc[acc.length - 1];
      if (last && (last.length + sentence.length) < 600) {
        acc[acc.length - 1] = `${last} ${sentence}`;
      } else {
        acc.push(sentence);
      }
      return acc;
    }, []);

    return {
      title: article.title,
      subtitle: 'Knowledge base article',
      orientation: 'portrait',
      filename: `Wiki_${article.slug || article.id}`,
      filters: [
        { label: 'Author', value: authorName },
        { label: 'Category', value: article.category?.name || 'Uncategorized' },
        { label: 'Status', value: article.status },
        { label: 'Version', value: article.version },
        { label: 'Published', value: fmtDate(article.published_at) }
      ],
      tables: [{
        name: 'Content',
        columns: [{ header: 'Article Content', key: 'text', width: 100, wrap: true }],
        rows: (paragraphs.length ? paragraphs : ['(No content)']).map((p) => ({ text: p }))
      }]
    };
  }
};
