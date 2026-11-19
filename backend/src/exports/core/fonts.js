// =============================================================================
// exports/core/fonts.js — Bundled Red Hat Font Registry for PDFKit & Templates
// -----------------------------------------------------------------------------
// Provides the official Red Hat Display, Red Hat Text, and Red Hat Mono static
// TrueType fonts matching the CAE corporate templates in /docs.
// =============================================================================

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.resolve(__dirname, '../fonts');

const PDF_FONT_FILES = {
  'RHD-Light':     'RedHatDisplay-Light.ttf',
  'RHD-Regular':   'RedHatDisplay-Regular.ttf',
  'RHD-Medium':    'RedHatDisplay-Medium.ttf',
  'RHD-SemiBold':  'RedHatDisplay-SemiBold.ttf',
  'RHD-Bold':      'RedHatDisplay-Bold.ttf',
  'RHD-ExtraBold': 'RedHatDisplay-ExtraBold.ttf',
  'RHD-Italic':    'RedHatDisplay-Italic.ttf',
  'RHT-Regular':   'RedHatText-Regular.ttf',
  'RHT-Medium':    'RedHatText-Medium.ttf',
  'RHT-Bold':      'RedHatText-Bold.ttf',
  'RHT-Italic':    'RedHatText-Italic.ttf',
  'RHM-Regular':   'RedHatMono-Regular.ttf'
};

const STANDARD_FALLBACKS = {
  'RHD-Light':     'Helvetica',
  'RHD-Regular':   'Helvetica',
  'RHD-Medium':    'Helvetica-Bold',
  'RHD-SemiBold':  'Helvetica-Bold',
  'RHD-Bold':      'Helvetica-Bold',
  'RHD-ExtraBold': 'Helvetica-Bold',
  'RHD-Italic':    'Helvetica-Oblique',
  'RHT-Regular':   'Helvetica',
  'RHT-Medium':    'Helvetica-Bold',
  'RHT-Bold':      'Helvetica-Bold',
  'RHT-Italic':    'Helvetica-Oblique',
  'RHM-Regular':   'Courier'
};

/** Resolve absolute path for a bundled PDF font key. */
function getFontPath(key) {
  const filename = PDF_FONT_FILES[key];
  return filename ? path.join(FONT_DIR, filename) : null;
}

/** Verify all bundled TTF font files exist on disk. */
function verifyBundledFonts() {
  const files = Object.entries(PDF_FONT_FILES).map(([key, filename]) => {
    const fullPath = path.join(FONT_DIR, filename);
    const exists = fs.existsSync(fullPath);
    const size = exists ? fs.statSync(fullPath).size : 0;
    return { key, filename, fullPath, exists, size };
  });

  return {
    fontDir: FONT_DIR,
    allPresent: files.every((f) => f.exists && f.size > 0),
    files
  };
}

/**
 * Register all bundled Red Hat TTF fonts on a PDFKit document instance and
 * return a semantic font token map for clean usage across renderers.
 *
 * @param {import('pdfkit')} doc PDFKit document instance.
 */
function registerPdfFonts(doc) {
  const resolved = {};

  for (const [key, filename] of Object.entries(PDF_FONT_FILES)) {
    const fullPath = path.join(FONT_DIR, filename);
    if (fs.existsSync(fullPath)) {
      doc.registerFont(key, fullPath);
      resolved[key] = key;
    } else {
      console.warn(`[exports/fonts] Missing bundled font ${filename}; falling back for ${key}`);
      resolved[key] = STANDARD_FALLBACKS[key];
    }
  }

  return {
    displayLight:     resolved['RHD-Light'],
    display:          resolved['RHD-Regular'],
    displayMedium:    resolved['RHD-Medium'],
    displaySemiBold:  resolved['RHD-SemiBold'],
    displayBold:      resolved['RHD-Bold'],
    displayExtraBold: resolved['RHD-ExtraBold'],
    displayItalic:    resolved['RHD-Italic'],
    body:             resolved['RHT-Regular'],
    bodyMedium:       resolved['RHT-Medium'],
    bodyBold:         resolved['RHT-Bold'],
    bodyItalic:       resolved['RHT-Italic'],
    mono:             resolved['RHM-Regular']
  };
}

module.exports = {
  FONT_DIR,
  PDF_FONT_FILES,
  getFontPath,
  verifyBundledFonts,
  registerPdfFonts
};
