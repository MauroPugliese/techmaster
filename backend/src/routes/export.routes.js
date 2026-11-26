// =============================================================================
// routes/export.routes.js — Unified Multi-Format Executive Export Endpoints
// -----------------------------------------------------------------------------
//   GET /api/export/                          (module discovery)
//   GET /api/export/:module?format=xlsx|pdf|docx|pptx[&filters...]
//   GET /api/export/wiki/:id?format=...       (single full Markdown article)
//   GET /api/export/shift-report?format=...   (alias -> shifts)
//   GET /api/export/planned-maintenance-report (alias -> planned-maintenance)
//   GET /api/export/planned-maintenance-daily/:date/:template?format=docx|pdf
// =============================================================================

const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { isSectionHiddenForUser, getHiddenSectionKeysForUser } = require('../middleware/section-access.middleware');
const { render } = require('../exports/core/export.service');
const { streamDailyTemplateExport } = require('../exports/core/planned-daily-template.service');
const { fullName, normalizeFilters, resolveReportPeriod } = require('../exports/core/helpers');
const { COMPANY } = require('../exports/core/branding');
const { MODULES, wiki, simulators } = require('../exports/modules');

const EXPORT_SECTION_MAP = {
  dashboard: 'dashboard',
  simulators: 'simulators',
  'daily-station-ops': 'simulators',
  operations: 'operations',
  'operations-analytics': 'operations_analytics',
  maintenance: 'maintenance',
  'planned-maintenance': 'maintenance',
  warehouse: 'warehouse',
  shifts: 'shifts',
  tasks: 'tasks',
  wiki: 'wiki',
  analytics: 'analytics',
  users: 'admin',
  audit: 'admin'
};

/** Ensure the current user may export the given module (RBAC + section access). */
const ensureExportAuthorized = async (mod, req, res) => {
  const roleName = req.user?.role?.name;
  if (mod.roles && mod.roles.length && roleName !== 'admin' && !mod.roles.includes(roleName)) {
    res.status(403).json({ success: false, message: 'Insufficient permissions for this export' });
    return false;
  }
  const sectionKey = EXPORT_SECTION_MAP[mod.key];
  if (sectionKey) {
    const hidden = await isSectionHiddenForUser(req.user, sectionKey);
    if (hidden) {
      res.status(403).json({ success: false, message: 'This section is hidden for the current user.' });
      return false;
    }
  }
  return true;
};

/** Compose a full ReportSpec v4 from a module build result and stream it. */
const composeAndRender = async (mod, built, req, res) => {
  if (built === null) {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }
  const periodInfo = resolveReportPeriod(req.query || {});
  const baseFilters = normalizeFilters(built.filters);
  const hasPeriodEntry = baseFilters.some((f) => /period|window|date|range|cadence/i.test(f.label));
  const mergedFilters = periodInfo.type !== 'all'
    ? [
        { label: 'Report Type', value: periodInfo.label },
        ...(!hasPeriodEntry ? [{ label: 'Reporting Window', value: periodInfo.rangeText }] : []),
        ...baseFilters
      ]
    : baseFilters;

  const baseTitle = built.title || mod.title;
  const spec = {
    moduleKey: built.moduleKey || mod.key,
    docCode: built.docCode || mod.docCode,
    theme: built.theme || mod.theme || mod.key,
    title: baseTitle,
    subtitle: built.subtitle !== undefined ? built.subtitle : mod.subtitle,
    category: built.category || mod.category || 'OPERATIONS INTELLIGENCE',
    orientation: built.orientation || mod.orientation || 'portrait',
    filename: built.filename || mod.title,
    meta: {
      generatedBy: fullName(req.user, req.user?.username || 'System'),
      generatedAt: new Date(),
      period: periodInfo,
      confidentiality: built.confidentiality || COMPANY.confidentiality,
      filters: mergedFilters
    },
    executiveBrief: built.executiveBrief || '',
    coverHighlights: built.coverHighlights || [],
    pages: built.pages || [],
    kpis: built.kpis || [],
    scorecards: built.scorecards || [],
    highlights: built.highlights || [],
    insights: built.insights || [],
    charts: built.charts || [],
    documentBlocks: built.documentBlocks || [],
    tables: built.tables || []
  };
  return render(spec, res, req.query.format, mod.fallback || 'xlsx');
};

// ── Single wiki article (full Markdown content) ──────────────────────────────
router.get('/wiki/:id', authenticate, async (req, res, next) => {
  try {
    if (!(await ensureExportAuthorized(wiki, req, res))) return undefined;
    const built = await wiki.buildArticle(req);
    return await composeAndRender(wiki, built, req, res);
  } catch (err) { return next(err); }
});

// ── Single Simulator / Test Place / IOS Station Dossier & Annual MNT Records ─
router.get('/simulators/:id', authenticate, async (req, res, next) => {
  try {
    if (!(await ensureExportAuthorized(simulators, req, res))) return undefined;
    const built = await simulators.buildSingleStation(req);
    return await composeAndRender(simulators, built, req, res);
  } catch (err) { return next(err); }
});

// ── Backward-compatible aliases ──────────────────────────────────────────────
router.get('/shift-report', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES.shifts;
    if (!(await ensureExportAuthorized(mod, req, res))) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

router.get('/planned-maintenance-report', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES['planned-maintenance'];
    if (!(await ensureExportAuthorized(mod, req, res))) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

// ── Planned maintenance daily templates (checklist/report) ─────────────────
router.get('/planned-maintenance-daily/:date/:template', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES['planned-maintenance'];
    if (!(await ensureExportAuthorized(mod, req, res))) return undefined;
    return await streamDailyTemplateExport({ req, res });
  } catch (err) { return next(err); }
});

// ── Discovery: list of available export modules ──────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const roleName = req.user?.role?.name;
    const hiddenSections = await getHiddenSectionKeysForUser(req.user);
    const list = Object.values(MODULES).map((m) => {
      const roleAllowed = !m.roles || !m.roles.length || roleName === 'admin' || m.roles.includes(roleName);
      const secKey = EXPORT_SECTION_MAP[m.key];
      const sectionAllowed = !secKey || !hiddenSections.has(secKey);
      return {
        key: m.key,
        docCode: m.docCode,
        theme: m.theme || m.key,
        title: m.title,
        subtitle: m.subtitle,
        category: m.category,
        formats: ['xlsx', 'pdf', 'docx', 'pptx'],
        restricted: !!(m.roles && m.roles.length),
        allowed: roleAllowed && sectionAllowed
      };
    });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

// ── Generic module export ────────────────────────────────────────────────────
router.get('/:module', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES[req.params.module];
    if (!mod) {
      return res.status(404).json({ success: false, message: `Unknown export module: ${req.params.module}` });
    }
    if (!(await ensureExportAuthorized(mod, req, res))) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

module.exports = router;
