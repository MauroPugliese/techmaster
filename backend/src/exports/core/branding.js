// =============================================================================
// exports/core/branding.js — Centralised brand palette & document constants
// -----------------------------------------------------------------------------
// Single source of truth for the visual identity shared by every exported
// document (Excel / Word / PDF / PowerPoint). Configured from CAE corporate
// template assets (Red Hat Display font, CAE Navy/Blue/Lime palette, logo mark).
// =============================================================================

const path = require('path');

/** Absolute paths to extracted brand logo assets. */
const LOGOS = {
  darkPng: path.resolve(__dirname, '../templates/cae_logo_dark.png'),
  lightPng: path.resolve(__dirname, '../templates/cae_logo_light.png')
};

/** Corporate identity shown in headers / footers of every document. */
const COMPANY = {
  name: 'CAE · SMaRT Platform',
  tagline: 'Smart Maintenance & Resource Tracking',
  mark: 'CAE · SMaRT'
};

/**
 * Brand colour palette extracted from CAE templates.
 * ExcelJS expects 'FFRRGGBB' ARGB strings — use `argb()` to convert.
 */
const COLORS = {
  navy:       '#06103D', // CAE corporate primary navy
  ink:        '#06103D', // primary text
  band:       '#06103D', // document header band background
  headerRow:  '#132252', // table header row background
  accent:     '#2969F2', // template vibrant electric blue accent
  lime:       '#B4F62A', // template neon lime accent (highlights / success badges)
  subtle:     '#64748B', // secondary / meta text
  zebra:      '#F8FAFC', // alternating row background
  border:     '#E2E8F0', // table / divider borders
  white:      '#FFFFFF',

  // Semantic status styles (foreground + background pairs).
  dangerFg:   '#991B1B', dangerBg:  '#FEE2E2',
  successFg:  '#166534', successBg: '#DCFCE7',
  warningFg:  '#92400E', warningBg: '#FEF3C7',
  mutedFg:    '#475569', mutedBg:   '#F1F5F9'
};

/** Per-format default font families. */
const FONTS = {
  xlsx: 'Red Hat Display',
  pdf:  'Helvetica',
  docx: 'Red Hat Display',
  pptx: 'Red Hat Display'
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

/** Convert a '#RRGGBB' hex string to a docx / pptx 'RRGGBB' (no hash) string. */
const noHash = (hex) => String(hex || '#000000').replace('#', '').toUpperCase();

module.exports = { COMPANY, LOGOS, COLORS, FONTS, flagStyle, argb, noHash };
