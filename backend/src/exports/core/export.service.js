// =============================================================================
// exports/core/export.service.js — Unified ReportSpec v4 Normalizer & Dispatcher
// -----------------------------------------------------------------------------
// Supports Composable Page Blueprints (`spec.pages`) where every report defines
// its own tailored multi-page A4 flow alongside backward-compatible top-level
// specs, plus `collectSpecData(spec)` for tabular/slide renderers (XLSX/PPTX).
// =============================================================================

const { resolveFormat, buildFilename, normalizeFilters } = require('./helpers');
const { COMPANY } = require('./branding');
const { resolveTheme } = require('./themes');
const { streamXlsx } = require('../renderers/xlsx.renderer');
const { streamPdf }  = require('../renderers/pdf.renderer');
const { streamDocx } = require('../renderers/docx.renderer');
const { streamPptx } = require('../renderers/pptx.renderer');

/** Normalize an incoming ReportSpec so renderers receive immutable, safe defaults. */
function normalizeSpec(rawSpec = {}) {
  const meta = rawSpec.meta || {};
  const theme = resolveTheme(rawSpec);
  return {
    moduleKey: rawSpec.moduleKey || null,
    docCode: rawSpec.docCode || theme.docCode || 'CAE-RPT',
    theme,
    title: rawSpec.title || 'Operational Report',
    subtitle: rawSpec.subtitle || '',
    category: rawSpec.category || 'OPERATIONS INTELLIGENCE',
    orientation: rawSpec.orientation === 'landscape' ? 'landscape' : 'portrait',
    filename: rawSpec.filename || rawSpec.title || 'report',
    meta: {
      generatedBy: meta.generatedBy || 'System',
      generatedAt: meta.generatedAt || new Date(),
      period: meta.period || null,
      confidentiality: meta.confidentiality || COMPANY.confidentiality,
      filters: normalizeFilters(meta.filters)
    },
    executiveBrief: typeof rawSpec.executiveBrief === 'string' ? rawSpec.executiveBrief : '',
    coverHighlights: Array.isArray(rawSpec.coverHighlights) ? rawSpec.coverHighlights.slice(0, 3) : [],
    pages: Array.isArray(rawSpec.pages) ? rawSpec.pages : [],
    kpis: Array.isArray(rawSpec.kpis) ? rawSpec.kpis : [],
    scorecards: Array.isArray(rawSpec.scorecards) ? rawSpec.scorecards : [],
    highlights: Array.isArray(rawSpec.highlights) ? rawSpec.highlights : [],
    insights: Array.isArray(rawSpec.insights) ? rawSpec.insights : [],
    charts: Array.isArray(rawSpec.charts) ? rawSpec.charts : [],
    documentBlocks: Array.isArray(rawSpec.documentBlocks) ? rawSpec.documentBlocks : [],
    tables: Array.isArray(rawSpec.tables) ? rawSpec.tables : []
  };
}

/**
 * Collect deduplicated analytical artifacts from BOTH top-level fields and any
 * composable `spec.pages` blocks so Excel/PowerPoint consume page blueprints seamlessly.
 */
function collectSpecData(spec) {
  const briefParts = [];
  if (spec.executiveBrief) briefParts.push(spec.executiveBrief);

  const kpis = [...(spec.kpis || [])];
  const scorecards = [...(spec.scorecards || [])];
  const highlights = [...(spec.highlights || [])];
  const insights = [...(spec.insights || [])];
  const statMatrices = [];
  const charts = [...(spec.charts || [])];
  const tables = [...(spec.tables || [])];
  const documentBlocks = [...(spec.documentBlocks || [])];

  const seenTables = new Set(tables.map((t) => t.name).filter(Boolean));
  const seenCharts = new Set(charts.map((c) => c.title).filter(Boolean));

  (spec.pages || []).forEach((page) => {
    (page.blocks || []).forEach((block) => {
      switch (block.type) {
        case 'brief':
          if (block.text && !briefParts.includes(block.text)) briefParts.push(block.text);
          break;
        case 'kpis':
          if (Array.isArray(block.items) && block.includeInSummary !== false) {
            block.items.forEach((it) => {
              if (!kpis.some((k) => k.label === it.label)) kpis.push(it);
            });
          }
          break;
        case 'gaugeBand':
          if (Array.isArray(block.items) && !kpis.length) {
            block.items.forEach((it) => {
              kpis.push({
                label: it.label,
                value: it.valueLabel || `${Number(it.percent || 0).toFixed(1)}%`,
                rawValue: Number(it.percent || 0),
                numFmt: '0.0"%"',
                sublabel: it.sublabel || '',
                tone: it.tone
              });
            });
          }
          break;
        case 'scorecard':
          if (block.title || block.items?.length) {
            if (!scorecards.some((s) => s.title === block.title)) {
              scorecards.push({ title: block.title, subtitle: block.subtitle, items: block.items || [] });
            }
          }
          break;
        case 'highlights':
          (block.items || []).forEach((it) => {
            if (!highlights.some((h) => h.title === it.title && h.eyebrow === it.eyebrow)) highlights.push(it);
          });
          break;
        case 'cardList':
          (block.items || []).forEach((it) => {
            if (!highlights.some((h) => h.title === it.title)) {
              highlights.push({
                eyebrow: it.badge || block.title || 'FEATURED',
                metric: it.metric || '',
                title: it.title,
                detail: [it.meta, it.detail].filter(Boolean).join(' · '),
                tone: it.badgeTone || 'info'
              });
            }
          });
          break;
        case 'alerts':
          (block.items || []).forEach((it) => {
            if (!insights.some((ins) => ins.title === it.title)) insights.push(it);
          });
          break;
        case 'statMatrix':
          if (Array.isArray(block.pairs) && block.pairs.length) {
            statMatrices.push({ title: block.title || 'Control & Specification Summary', pairs: block.pairs });
          }
          break;
        case 'chart':
          if (block.chart && (!block.chart.title || !seenCharts.has(block.chart.title))) {
            charts.push(block.chart);
            if (block.chart.title) seenCharts.add(block.chart.title);
          }
          break;
        case 'chartPair':
          [block.left, block.right].filter(Boolean).forEach((ch) => {
            if (!ch.title || !seenCharts.has(ch.title)) {
              charts.push(ch);
              if (ch.title) seenCharts.add(ch.title);
            }
          });
          break;
        case 'table':
          if (block.table && (!block.table.name || !seenTables.has(block.table.name))) {
            tables.push(block.table);
            if (block.table.name) seenTables.add(block.table.name);
          }
          break;
        case 'markdown':
          if (Array.isArray(block.blocks)) {
            block.blocks.forEach((mb) => documentBlocks.push(mb));
          }
          break;
      }
    });
  });

  return {
    executiveBrief: briefParts[0] || '',
    kpis,
    scorecards,
    highlights,
    insights,
    statMatrices,
    charts,
    tables,
    documentBlocks
  };
}

/**
 * Render a ReportSpec to the Express response in the requested format.
 *
 * @param {object} spec    Report specification (v1, v2, v3 or v4).
 * @param {object} res     Express response.
 * @param {string} rawFmt  Requested format ('xlsx' | 'pdf' | 'docx' | 'pptx').
 * @param {string} [fallback='xlsx'] Default format when none/invalid supplied.
 */
async function render(spec, res, rawFmt, fallback = 'xlsx') {
  const format = resolveFormat(rawFmt, fallback);
  const normalized = normalizeSpec(spec);
  const periodTag = normalized.meta?.period?.filenameTag || '';
  const filename = buildFilename(normalized.filename || normalized.title || 'report', periodTag);

  if (format === 'pdf')  return streamPdf(normalized, res, filename);
  if (format === 'docx') return streamDocx(normalized, res, filename);
  if (format === 'pptx') return streamPptx(normalized, res, filename);
  return streamXlsx(normalized, res, filename);
}

module.exports = { render, normalizeSpec, collectSpecData };
