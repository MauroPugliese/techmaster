// =============================================================================
// exports/core/branding.js — Centralised brand palette & document constants
// -----------------------------------------------------------------------------
// Single source of truth for the visual identity shared by every exported
// document (Excel / Word / PDF). Keeping it here guarantees that all formats
// render with the exact same colours, fonts and corporate metadata.
// =============================================================================

/** Corporate identity shown in headers / footers of every document. */
const COMPANY = {
  name: 'SMaRT Platform',
  tagline: 'Smart Maintenance & Resource Tracking',
  // Plain-text logo mark (no external asset dependency needed at render time).
  mark: 'SMaRT'
};

/**
 * Brand colour palette. Stored as plain hex strings (with leading '#').
 * ExcelJS expects 'FFRRGGBB' ARGB strings — use `argb()` to convert.
 */
const COLORS = {
  ink:        '#0F172A', // primary titles
  band:       '#1E293B', // document header band background
  headerRow:  '#334155', // table header row background
  accent:     '#2563EB', // accent / links
  subtle:     '#64748B', // secondary / meta text
  zebra:      '#F1F5F9', // alternating row background
  border:     '#CBD5E1', // table borders
  white:      '#FFFFFF',

  // Semantic status styles (foreground + background pairs).
  dangerFg:   '#991B1B', dangerBg:  '#FEE2E2',
  successFg:  '#166534', successBg: '#DCFCE7',
  warningFg:  '#92400E', warningBg: '#FEF3C7',
  mutedFg:    '#475569', mutedBg:   '#F1F5F9'
};

/** Per-format default font families. */
const FONTS = {
  xlsx: 'Segoe UI',
  pdf:  'Helvetica',
  docx: 'Calibri'
};

/**
 * Maps a semantic row flag to a { fg, bg } colour pair.
 * Falls back to `null` (no special styling) when the flag is unknown.
 */
const flagStyle = (flag) => {
  switch (flag) {
    case 'danger':  return { fg: COLORS.dangerFg,  bg: COLORS.dangerBg };
    case 'success': return { fg: COLORS.successFg, bg: COLORS.successBg };
    case 'warning': return { fg: COLORS.warningFg, bg: COLORS.warningBg };
    case 'muted':   return { fg: COLORS.mutedFg,   bg: COLORS.mutedBg };
    default:        return null;
  }
};

/** Convert a '#RRGGBB' hex string to an ExcelJS 'FFRRGGBB' ARGB string. */
const argb = (hex) => 'FF' + String(hex || '#000000').replace('#', '').toUpperCase();

/** Convert a '#RRGGBB' hex string to a docx 'RRGGBB' (no hash) string. */
const noHash = (hex) => String(hex || '#000000').replace('#', '').toUpperCase();

module.exports = { COMPANY, COLORS, FONTS, flagStyle, argb, noHash };
