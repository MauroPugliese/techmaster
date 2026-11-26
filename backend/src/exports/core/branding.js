// =============================================================================
// exports/core/branding.js — Centralised CAE Brand Palette, Typography & Assets
// -----------------------------------------------------------------------------
// Single source of truth for the visual identity shared by every exported
// document (PDF, DOCX, PPTX, XLSX). Derived strictly from the official CAE
// templates in /docs (EN_RedHatDisplay_template.pptx, CAE-General-Template,
// CAE-Standard Operating Procedure-Template, maintenance_daily_* templates).
// =============================================================================

const fs = require('fs');
const path = require('path');

/** Absolute paths to extracted CAE brand logo assets. */
const LOGOS = {
  darkPng: path.resolve(__dirname, '../templates/cae_logo_dark.png'),
  lightPng: path.resolve(__dirname, '../templates/cae_logo_light.png')
};

/** Corporate identity shown in headers / footers of every document. */
const COMPANY = {
  name: 'CAE · SMaRT Platform',
  tagline: 'Smart Maintenance & Resource Tracking',
  mark: 'CAE · SMaRT',
  confidentiality: 'Internal · Operational Intelligence Report'
};

/**
 * Brand colour palette extracted from CAE corporate templates (/docs).
 * - dk1/dk2:  #06103D (Deep Navy)
 * - accent1:  #2969F2 (Electric Blue)
 * - heading:  #0C47C7 (Cobalt H1/H2), #082F84 (Royal H3)
 * - accent3:  #B4F62A (Neon Lime)
 * - accent4:  #F59B40 (Amber)
 * - accent5:  #F55C38 (Coral / Danger)
 * - accent6:  #31C6DE (Cyan)
 * - hlink:    #1ED4B2 (Teal / Success)
 * - folHlink: #E23E90 (Magenta)
 */
const COLORS = {
  navy:         '#06103D',
  navyLight:    '#132252',
  navyTint:     '#EEF2FF',
  cobalt:       '#0C47C7',
  royal:        '#082F84',
  accent:       '#2969F2',
  accentSoft:   '#DBEAFE',
  lime:         '#B4F62A',
  amber:        '#F59B40',
  coral:        '#F55C38',
  cyan:         '#31C6DE',
  teal:         '#1ED4B2',
  magenta:      '#E23E90',

  ink:          '#06103D',
  body:         '#1E293B',
  band:         '#06103D',
  headerRow:    '#132252',
  subtle:       '#64748B',
  muted:        '#94A3B8',
  zebra:        '#F8FAFC',
  surface:      '#F1F5F9',
  border:       '#E2E8F0',
  borderStrong: '#CBD5E1',
  white:        '#FFFFFF',

  // Semantic status styles (foreground, background, accent strip, border)
  dangerFg:   '#991B1B', dangerBg:  '#FEE2E2', dangerAccent:  '#DC2626', dangerBorder:  '#FCA5A5',
  successFg:  '#166534', successBg: '#DCFCE7', successAccent: '#10B981', successBorder: '#86EFAC',
  warningFg:  '#92400E', warningBg: '#FEF3C7', warningAccent: '#D97706', warningBorder: '#FCD34D',
  infoFg:     '#1E40AF', infoBg:    '#DBEAFE', infoAccent:    '#2969F2', infoBorder:    '#93C5FD',
  tealFg:     '#0F766E', tealBg:    '#CCFBF1', tealAccent:    '#14B8A6', tealBorder:    '#5EEAD4',
  purpleFg:   '#6D28D9', purpleBg:  '#EDE9FE', purpleAccent:  '#7C3AED', purpleBorder:  '#C4B5FD',
  mutedFg:    '#475569', mutedBg:   '#F1F5F9', mutedAccent:   '#64748B', mutedBorder:   '#CBD5E1'
};

/** Ordered chart series palette matching CAE template accents. */
const CHART_PALETTE = [
  COLORS.accent,   // #2969F2
  COLORS.navy,     // #06103D
  COLORS.teal,     // #1ED4B2
  COLORS.amber,    // #F59B40
  COLORS.coral,    // #F55C38
  COLORS.cyan,     // #31C6DE
  COLORS.lime,     // #B4F62A
  COLORS.magenta   // #E23E90
];

/**
 * Office template typography mapping matching /docs templates:
 * - Red Hat Display / Red Hat Display Light for display titles, KPIs, headings
 * - Arial for dense body copy and data tables
 * - Courier New for IDs, SKUs, and monospace technical values
 */
const OFFICE_FONTS = {
  docx: {
    display: 'Red Hat Display',
    heading: 'Red Hat Display',
    body:    'Arial',
    mono:    'Courier New'
  },
  pptx: {
    hero:    'Red Hat Display Light',
    display: 'Red Hat Display',
    body:    'Arial',
    mono:    'Courier New'
  },
  xlsx: {
    display: 'Red Hat Display',
    body:    'Arial',
    mono:    'Courier New'
  }
};

/** Backward-compatible font aliases. */
const FONTS = {
  xlsx: OFFICE_FONTS.xlsx.display,
  pdf:  'RHD-Regular',
  docx: OFFICE_FONTS.docx.body,
  pptx: OFFICE_FONTS.pptx.display
};

/**
 * Maps a semantic tone/flag ('danger'|'critical'|'warning'|'success'|'info'|'primary'|'muted'|'neutral')
 * to a { fg, bg, accent, border } colour tuple.
 */
const toneStyle = (tone) => {
  switch (String(tone || '').toLowerCase()) {
    case 'danger':
    case 'critical':
      return { fg: COLORS.dangerFg,  bg: COLORS.dangerBg,  accent: COLORS.dangerAccent,  border: COLORS.dangerBorder };
    case 'warning':
      return { fg: COLORS.warningFg, bg: COLORS.warningBg, accent: COLORS.warningAccent, border: COLORS.warningBorder };
    case 'success':
      return { fg: COLORS.successFg, bg: COLORS.successBg, accent: COLORS.successAccent, border: COLORS.successBorder };
    case 'info':
    case 'primary':
      return { fg: COLORS.infoFg,    bg: COLORS.infoBg,    accent: COLORS.infoAccent,    border: COLORS.infoBorder };
    case 'teal':
      return { fg: COLORS.tealFg,    bg: COLORS.tealBg,    accent: COLORS.tealAccent,    border: COLORS.tealBorder };
    case 'purple':
      return { fg: COLORS.purpleFg,  bg: COLORS.purpleBg,  accent: COLORS.purpleAccent,  border: COLORS.purpleBorder };
    case 'muted':
    case 'neutral':
      return { fg: COLORS.mutedFg,   bg: COLORS.mutedBg,   accent: COLORS.mutedAccent,   border: COLORS.mutedBorder };
    default:
      return null;
  }
};

/** Alias retained for backward compatibility across modules. */
const flagStyle = toneStyle;

/** Convert '#RRGGBB' hex string to ExcelJS 'FFRRGGBB' ARGB string. */
const argb = (hex) => 'FF' + String(hex || '#000000').replace('#', '').toUpperCase();

/** Convert '#RRGGBB' hex string to docx / pptx 'RRGGBB' (no hash) string. */
const noHash = (hex) => String(hex || '#000000').replace('#', '').toUpperCase();

const logoBufferCache = {};
const logoBase64Cache = {};

/** Read and cache the CAE PNG logo buffer ('light' for dark bands, 'dark' for white surfaces). */
function getLogoBuffer(variant = 'light') {
  if (logoBufferCache[variant] !== undefined) return logoBufferCache[variant];
  const filePath = variant === 'dark' ? LOGOS.darkPng : LOGOS.lightPng;
  logoBufferCache[variant] = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  return logoBufferCache[variant];
}

/** Read and cache a PptxGenJS data URI for the CAE PNG logo. */
function getLogoBase64(variant = 'light') {
  if (logoBase64Cache[variant] !== undefined) return logoBase64Cache[variant];
  const buf = getLogoBuffer(variant);
  logoBase64Cache[variant] = buf ? `image/png;base64,${buf.toString('base64')}` : null;
  return logoBase64Cache[variant];
}

module.exports = {
  COMPANY,
  LOGOS,
  COLORS,
  CHART_PALETTE,
  OFFICE_FONTS,
  FONTS,
  toneStyle,
  flagStyle,
  argb,
  noHash,
  getLogoBuffer,
  getLogoBase64
};
