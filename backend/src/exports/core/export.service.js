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
const { collectSpecData } = require('./spec-collector');
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
