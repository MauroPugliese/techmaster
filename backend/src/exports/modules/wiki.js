// =============================================================================
// exports/modules/wiki.js — Engineering Knowledge Catalogue & Formal SOP (v4)
// Blueprints:
//   1. build() -> CAE-DOC-10: P2 Knowledge Governance + CardList Top SOPs + Cat Lollipop
//      -> P3 Lifecycle Donut + Controlled Index Table
//   2. buildArticle() -> CAE-SOP-<id>: Formal CAE SOP Document matching /docs SOP
//      template (Document Control Matrix + Section Outline + Rendered Markdown)
// =============================================================================
const { Op } = require('sequelize');
const { WikiArticle, WikiCategory, User } = require('../../models');
const { parseMarkdownBlocks } = require('../core/markdown.parser');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtPercent, fullName, dash,
  cleanText, pct, toNumber, topEntries, parseRange, rangeLabel
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  PUBLISHED: 'success',
  REVIEW:    'warning',
  DRAFT:     'neutral',
  ARCHIVED:  'purple'
};

const STATUS_COLORS = {
  PUBLISHED: COLORS.successAccent,
  REVIEW:    COLORS.amber,
  DRAFT:     COLORS.muted,
  ARCHIVED:  COLORS.royal
};

function normalizeTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags.filter(Boolean).map(String);
  if (typeof rawTags === 'string' && rawTags.trim()) {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      return rawTags.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
}

module.exports = {
  key: 'wiki',
  docCode: 'CAE-DOC-10',
  theme: 'wiki',
  title: 'Engineering Knowledge Base Catalogue',
  subtitle: 'Controlled documentation governance, SOP readership and lifecycle index',
  category: 'DOCUMENTATION GOVERNANCE',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { status, category_id, tag, search } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.updated_at = {};
      if (range.from) where.updated_at[Op.gte] = range.from;
      if (range.to) where.updated_at[Op.lte] = range.to;
    }
    if (status) where.status = status;
    if (category_id) where.category_id = category_id;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [{ title: { [Op.like]: q } }, { excerpt: { [Op.like]: q } }];
    }

    const rawArticles = await WikiArticle.findAll({
      where,
      attributes: { exclude: ['content'] },
      include: [
        { model: WikiCategory, as: 'category', attributes: ['id', 'name'] },
        { model: User, as: 'author', attributes: ['first_name', 'last_name'] }
      ],
      order: [['is_pinned', 'DESC'], ['view_count', 'DESC'], ['updated_at', 'DESC']]
    });

    const normTag = tag && String(tag).trim() ? String(tag).trim().toLowerCase() : '';
    const articles = normTag
      ? rawArticles.filter((a) => normalizeTags(a.tags).some((t) => t.toLowerCase() === normTag))
      : rawArticles;

    const byStatus = { PUBLISHED: 0, REVIEW: 0, DRAFT: 0, ARCHIVED: 0 };
    const byCategory = {};
    let totalViews = 0;

    const rows = articles.map((a) => {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      const catName = a.category?.name || 'Uncategorized';
      byCategory[catName] = (byCategory[catName] || 0) + 1;
      const views = toNumber(a.view_count, 0);
      totalViews += views;

      return {
        title: cleanText(a.title, 48),
        full_title: a.title,
        category: catName,
        status: a.status,
        status_tone: STATUS_TONE[a.status] || 'neutral',
        version: `v${a.version || 1}`,
        view_count: views,
        updated_at: fmtDate(a.updated_at),
        author: fullName(a.author),
        pinned: a.is_pinned ? 'Yes' : 'No',
        tags: normalizeTags(a.tags).join(', ') || '—',
        excerpt: cleanText(a.excerpt || '', 72) || '—'
      };
    });

    const total = articles.length;
    const published = byStatus.PUBLISHED || 0;
    const draftReview = (byStatus.DRAFT || 0) + (byStatus.REVIEW || 0);
    const pubRate = pct(published, total);
    const statusKeys = Object.keys(byStatus).filter((k) => byStatus[k] > 0);
    const catTop = topEntries(byCategory, 7);

    const featuredCards = articles.slice(0, 4).map((a) => ({
      badge: a.is_pinned ? `PINNED · ${a.status}` : a.status,
      badgeTone: STATUS_TONE[a.status] || 'info',
      title: cleanText(a.title, 54),
      metric: `${fmtNumber(a.view_count || 0)} views`,
      meta: `${a.category?.name || 'General'} · By ${fullName(a.author)} · v${a.version || 1} · Updated ${fmtDate(a.updated_at)}`,
      detail: cleanText(a.excerpt || '', 130)
    }));

    const catalogueTable = {
      name: 'Knowledge Base Controlled Index',
      priority: true,
      note: 'Master documentation index. Author, pinned flag, tags and abstract preserved in Excel.',
      columns: [
        { header: 'Document Title', key: 'title', width: 158 },
        { header: 'Category', key: 'category', width: 92 },
        { header: 'Status', key: 'status', width: 76, type: 'badge', align: 'center' },
        { header: 'Ver.', key: 'version', width: 42, type: 'mono', align: 'center' },
        { header: 'Views', key: 'view_count', width: 58, type: 'number', align: 'right', total: 'sum', dataBar: true },
        { header: 'Updated', key: 'updated_at', width: 68, type: 'date' },
        { header: 'Author', key: 'author', width: 92, printHidden: true },
        { header: 'Pinned', key: 'pinned', width: 52, printHidden: true },
        { header: 'Tags', key: 'tags', width: 100, printHidden: true },
        { header: 'Excerpt', key: 'excerpt', width: 165, printHidden: true }
      ],
      rows
    };

    const filters = {};
    if (range.from || range.to) filters['Revision Window'] = rangeLabel(range);
    if (status) filters.Status = status;
    if (category_id) filters['Category ID'] = category_id;
    if (tag) filters.Tag = tag;
    if (search) filters.Search = search;

    const pages = [
      {
        title: 'Knowledge Governance & Featured SOPs',
        subtitle: `${fmtNumber(published)} published out of ${fmtNumber(total)} controlled documents (${fmtNumber(totalViews)} total views)`,
        blocks: [
          {
            type: 'brief',
            title: 'Documentation Posture Summary',
            text: `The engineering repository holds ${fmtNumber(total)} tracked procedures across ${fmtNumber(Object.keys(byCategory).length)} knowledge domains. `
              + `${fmtPercent(pubRate, 1)} are approved for production release (${fmtNumber(published)} PUBLISHED), while ${fmtNumber(draftReview)} documents remain in DRAFT or REVIEW validation.`
          },
          {
            type: 'cardList',
            title: 'Most-Consulted Procedures & Reference Guides',
            items: featuredCards
          },
          {
            type: 'chart',
            height: 196,
            chart: {
              type: 'lollipop',
              title: 'Coverage by Knowledge Domain',
              subtitle: 'Document distribution across taxonomy categories',
              valueFormat: 'number',
              labels: catTop.map(([k]) => cleanText(k, 18)),
              values: catTop.map(([, v]) => v)
            }
          }
        ]
      },
      {
        title: 'Lifecycle Audit & Controlled Index',
        subtitle: 'Approval status breakdown and complete document register',
        blocks: [
          {
            type: 'chart',
            height: 194,
            chart: {
              type: 'donut',
              title: 'Editorial Lifecycle Status',
              subtitle: 'Published vs review, draft and archived SOPs',
              labels: statusKeys,
              values: statusKeys.map((k) => byStatus[k]),
              colors: statusKeys.map((k) => STATUS_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', showHeading: true, table: catalogueTable }
        ]
      }
    ];

    return {
      moduleKey: 'wiki',
      docCode: 'CAE-DOC-10',
      theme: 'wiki',
      title: 'Engineering Knowledge Base Catalogue',
      subtitle: 'Controlled documentation governance, SOP readership and lifecycle index',
      category: 'DOCUMENTATION GOVERNANCE',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Controlled Documents', value: fmtNumber(total) },
        { label: 'Publication Rate', value: fmtPercent(pubRate, 1) },
        { label: 'Total Readership', value: `${fmtNumber(totalViews)} views` }
      ],
      filters,
      pages,
      tables: [catalogueTable]
    };
  },

  async buildArticle(req) {
    const article = await WikiArticle.findByPk(req.params.id, {
      include: [
        { model: WikiCategory, as: 'category', attributes: ['id', 'name'] },
        { model: User, as: 'author', attributes: ['first_name', 'last_name', 'job_title', 'department'] }
      ]
    });

    if (!article) {
      const err = new Error('Wiki article not found');
      err.status = 404;
      throw err;
    }

    const blocks = parseMarkdownBlocks(article.content || '');
    const docCode = `CAE-SOP-${String(article.id).padStart(3, '0')}`;
    const authorName = fullName(article.author);
    const catName = article.category?.name || 'General Procedure';
    const tagsStr = normalizeTags(article.tags).join(', ') || 'Standard Procedure';
    const headingList = blocks
      .filter((b) => b.type === 'h1' || b.type === 'h2')
      .slice(0, 10)
      .map((b, idx) => [`Section ${String(idx + 1).padStart(2, '0')}`, cleanText(b.text, 54)]);

    const controlPairs = [
      ['Document Code', docCode],
      ['Version', `v${article.version || 1}`],
      ['Lifecycle Status', article.status || 'DRAFT'],
      ['Written By', authorName],
      ['Domain Category', catName],
      ['Published Date', article.published_at ? fmtDate(article.published_at) : 'Unpublished'],
      ['Last Revised', fmtDateTime(article.updated_at)],
      ['Tags', tagsStr]
    ];

    const pageBlocks = [
      { type: 'statMatrix', title: 'Document Control Metadata', pairs: controlPairs }
    ];

    if (article.excerpt) {
      pageBlocks.push({
        type: 'brief',
        title: 'Scope & Summary',
        text: String(article.excerpt).trim()
      });
    }

    if (headingList.length >= 2) {
      pageBlocks.push({
        type: 'statMatrix',
        title: 'Procedure Section Index',
        pairs: headingList
      });
    }

    pageBlocks.push({ type: 'markdown', blocks });

    return {
      moduleKey: 'wiki-article',
      docCode,
      theme: 'wiki-article',
      title: article.title,
      subtitle: `${catName} — Controlled Standard Operating Procedure`,
      category: 'STANDARD OPERATING PROCEDURE',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Revision', value: `v${article.version || 1}` },
        { label: 'Approval Status', value: article.status || 'DRAFT' },
        { label: 'Consultations', value: fmtNumber(article.view_count || 0) }
      ],
      filters: { Category: catName, Author: authorName, Status: article.status || 'DRAFT' },
      pages: [
        {
          title: 'Standard Operating Procedure',
          subtitle: `${docCode} · Revision v${article.version || 1} · Prepared by ${authorName}`,
          blocks: pageBlocks
        }
      ]
    };
  }
};
