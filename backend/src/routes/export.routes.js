// =============================================================================
// routes/export.routes.js — Unified multi-format export endpoints
// -----------------------------------------------------------------------------
// Thin routing layer over the unified export engine (src/exports). Every module
// is exported through a single generic handler producing branded, paginated,
// professionally styled Excel / Word / PDF documents.
//
//   GET /api/export/:module?format=xlsx|pdf|docx[&filters...]
//   GET /api/export/wiki/:id?format=...          (single full article)
//   GET /api/export/shift-report?format=...       (alias → shifts)
//   GET /api/export/planned-maintenance-report    (alias → planned-maintenance)
// =============================================================================

const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { render } = require('../exports/core/export.service');
const { streamDailyTemplateExport } = require('../exports/core/planned-daily-template.service');
const { fullName } = require('../exports/core/helpers');
const { MODULES, wiki } = require('../exports/modules');

/** Ensure the current user may export the given module. Sends 403 if not. */
const ensureRole = (mod, req, res) => {
  if (!mod.roles || !mod.roles.length) return true;
  const roleName = req.user?.role?.name;
  if (roleName === 'admin' || mod.roles.includes(roleName)) return true;
  res.status(403).json({ success: false, message: 'Insufficient permissions for this export' });
  return false;
};

/** Compose a full ReportSpec from a module build result and stream it. */
const composeAndRender = async (mod, built, req, res) => {
  if (built === null) {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }
  const spec = {
    title: built.title || mod.title,
    subtitle: built.subtitle !== undefined ? built.subtitle : mod.subtitle,
    orientation: built.orientation || mod.orientation || 'portrait',
    filename: built.filename || mod.title,
    meta: {
      generatedBy: fullName(req.user, req.user?.username || 'System'),
      filters: built.filters || []
    },
    tables: built.tables || []
  };
  return render(spec, res, req.query.format, mod.fallback || 'xlsx');
};

// ── Single wiki article (full content) ───────────────────────────────────────
router.get('/wiki/:id', authenticate, async (req, res, next) => {
  try {
    if (!ensureRole(wiki, req, res)) return undefined;
    const built = await wiki.buildArticle(req);
    return await composeAndRender(wiki, built, req, res);
  } catch (err) { return next(err); }
});

// ── Backward-compatible aliases ──────────────────────────────────────────────
router.get('/shift-report', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES.shifts;
    if (!ensureRole(mod, req, res)) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

router.get('/planned-maintenance-report', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES['planned-maintenance'];
    if (!ensureRole(mod, req, res)) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

// ── Planned maintenance daily templates (checklist/report) ─────────────────
router.get('/planned-maintenance-daily/:date/:template', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES['planned-maintenance'];
    if (!ensureRole(mod, req, res)) return undefined;
    return await streamDailyTemplateExport({ req, res });
  } catch (err) { return next(err); }
});

// ── Discovery: list of available export modules ──────────────────────────────
router.get('/', authenticate, (req, res) => {
  const list = Object.values(MODULES).map((m) => ({
    key: m.key,
    title: m.title,
    subtitle: m.subtitle,
    formats: ['xlsx', 'pdf', 'docx'],
    restricted: !!(m.roles && m.roles.length)
  }));
  res.json({ success: true, data: list });
});

// ── Generic module export ────────────────────────────────────────────────────
router.get('/:module', authenticate, async (req, res, next) => {
  try {
    const mod = MODULES[req.params.module];
    if (!mod) {
      return res.status(404).json({ success: false, message: `Unknown export module: ${req.params.module}` });
    }
    if (!ensureRole(mod, req, res)) return undefined;
    return await composeAndRender(mod, await mod.build(req), req, res);
  } catch (err) { return next(err); }
});

module.exports = router;
