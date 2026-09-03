// =============================================================================
// exports/core/export.service.js — Format dispatcher
// -----------------------------------------------------------------------------
// Takes a normalised ReportSpec plus a requested format and streams the
// rendered document to the Express response using the matching renderer.
// =============================================================================

const { resolveFormat, buildFilename } = require('./helpers');
const { streamXlsx } = require('../renderers/xlsx.renderer');
const { streamPdf } = require('../renderers/pdf.renderer');
const { streamDocx } = require('../renderers/docx.renderer');

/**
 * Render a ReportSpec to the response in the requested format.
 *
 * @param {object} spec    Normalised report specification (see modules/*).
 * @param {object} res     Express response.
 * @param {string} rawFmt  Requested format ('xlsx' | 'pdf' | 'docx').
 * @param {string} [fallback='xlsx'] Default format when none/invalid supplied.
 */
async function render(spec, res, rawFmt, fallback = 'xlsx') {
  const format = resolveFormat(rawFmt, fallback);
  const filename = buildFilename(spec.filename || spec.title || 'report');

  if (format === 'pdf')  return streamPdf(spec, res, filename);
  if (format === 'docx') return streamDocx(spec, res, filename);
  return streamXlsx(spec, res, filename);
}

module.exports = { render };
