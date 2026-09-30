// =============================================================================
// exports/renderers/pptx.renderer.js — PowerPoint (.pptx) renderer
// -----------------------------------------------------------------------------
// Renders a ReportSpec into a 16:9 widescreen presentation using pptxgenjs,
// styled strictly according to the CAE corporate template guidelines:
//   • 16:9 widescreen layout matching EN_RedHatDisplay_template.pptx
//   • Cover slide with corporate navy (#06103D) background, CAE white logo,
//     Red Hat Display typography, subtitle, and neon lime (#B4F62A) divider
//   • Content slides with branded navy top banner, CAE logo, and slide title
//   • KPI summary cards for high-level metrics
//   • Weighted column tables with zebra fills, borders, and status flag styling
//   • Multi-slide table pagination for long record sets
//   • Running footer with document metadata and slide numbering
// =============================================================================

const fs = require('fs');
const PptxGenJS = require('pptxgenjs');
const { COMPANY, LOGOS, COLORS, FONTS, noHash } = require('../core/branding');
const { str, FORMAT_META } = require('../core/helpers');

const FONT = FONTS.pptx || 'Red Hat Display';
const ROWS_PER_SLIDE = 10;
const ROWS_PER_SLIDE_WITH_SUMMARY = 7;

/** Map semantic row flag to pptx fill and text hex colors (without leading #). */
const flagColors = (flag) => {
  switch (flag) {
    case 'danger':  return { fill: noHash(COLORS.dangerBg),  color: noHash(COLORS.dangerFg) };
    case 'success': return { fill: noHash(COLORS.successBg), color: noHash(COLORS.successFg) };
    case 'warning': return { fill: noHash(COLORS.warningBg), color: noHash(COLORS.warningFg) };
    case 'muted':   return { fill: noHash(COLORS.mutedBg),   color: noHash(COLORS.mutedFg) };
    default:        return null;
  }
};

/**
 * Build the cover / title slide.
 */
function buildCoverSlide(pptx, spec) {
  const slide = pptx.addSlide();
  slide.background = { color: noHash(COLORS.navy) };

  // CAE White Logo
  if (fs.existsSync(LOGOS.lightPng)) {
    slide.addImage({
      path: LOGOS.lightPng,
      x: 0.8,
      y: 0.8,
      w: 2.2,
      h: 0.825 // 8:3 ratio
    });
  }

  // Report Title
  slide.addText(spec.title || 'Operational Report', {
    x: 0.8,
    y: 2.4,
    w: 11.5,
    h: 1.1,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: noHash(COLORS.white)
  });

  // Subtitle
  let currentY = 3.5;
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.8,
      y: currentY,
      w: 11.5,
      h: 0.5,
      fontFace: FONT,
      fontSize: 14,
      color: 'CBD5E1'
    });
    currentY += 0.6;
  }

  // Lime Accent Line (from CAE template palette)
  slide.addShape('line', {
    x: 0.8,
    y: currentY + 0.1,
    w: 3.5,
    h: 0,
    line: { color: noHash(COLORS.lime), width: 3.5 }
  });
  currentY += 0.4;

  // Metadata block
  const meta = spec.meta || {};
  const metaLines = [
    `Generated: ${new Date().toLocaleString('en-GB')}`,
    meta.generatedBy ? `Prepared By: ${meta.generatedBy}` : null
  ].filter(Boolean);

  slide.addText(metaLines.join('   |   '), {
    x: 0.8,
    y: currentY,
    w: 11.5,
    h: 0.4,
    fontFace: FONT,
    fontSize: 11,
    color: '94A3B8'
  });
  currentY += 0.45;

  // Active filters badges
  if (meta.filters && meta.filters.length) {
    const filterText = meta.filters.map(f => `${f.label}: ${str(f.value)}`).join('   •   ');
    slide.addText(`Filters:  ${filterText}`, {
      x: 0.8,
      y: currentY,
      w: 11.5,
      h: 0.4,
      fontFace: FONT,
      fontSize: 10,
      italic: true,
      color: '64748B'
    });
  }

  // Footer Tagline
  slide.addText(`${COMPANY.name}  —  ${COMPANY.tagline}`, {
    x: 0.8,
    y: 6.8,
    w: 11.5,
    h: 0.3,
    fontFace: FONT,
    fontSize: 9,
    color: '64748B'
  });
}

/**
 * Build the top branded banner and running footer for content slides.
 */
function addSlideChrome(slide, spec, titleSuffix = '', pageNum, totalPages) {
  slide.background = { color: noHash(COLORS.white) };

  // Top Navy Banner
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: 0.9,
    fill: { color: noHash(COLORS.navy) },
    line: { color: noHash(COLORS.navy), width: 0 }
  });

  // White Logo in Banner
  if (fs.existsSync(LOGOS.lightPng)) {
    slide.addImage({
      path: LOGOS.lightPng,
      x: 0.5,
      y: 0.16,
      w: 1.5,
      h: 0.5625 // 8:3 ratio
    });
  }

  // Header Title
  const headerTitle = `${spec.title}${titleSuffix ? `  —  ${titleSuffix}` : ''}`;
  slide.addText(headerTitle, {
    x: 2.2,
    y: 0.2,
    w: 10.5,
    h: 0.5,
    fontFace: FONT,
    fontSize: 15,
    bold: true,
    color: noHash(COLORS.white),
    valign: 'middle'
  });

  // Vibrant Blue Accent Line under Banner
  slide.addShape('line', {
    x: 0,
    y: 0.9,
    w: '100%',
    h: 0,
    line: { color: noHash(COLORS.accent), width: 2.5 }
  });

  // Running Footer Divider
  slide.addShape('line', {
    x: 0.5,
    y: 7.0,
    w: 12.33,
    h: 0,
    line: { color: noHash(COLORS.border), width: 1 }
  });

  // Footer Left: Company & Confidentiality
  slide.addText(`${COMPANY.name}   |   Confidential & Proprietary`, {
    x: 0.5,
    y: 7.05,
    w: 8.0,
    h: 0.35,
    fontFace: FONT,
    fontSize: 8.5,
    color: noHash(COLORS.subtle)
  });

  // Footer Right: Slide number
  slide.addText(`Slide ${pageNum} of ${totalPages}`, {
    x: 9.5,
    y: 7.05,
    w: 3.33,
    h: 0.35,
    fontFace: FONT,
    fontSize: 8.5,
    color: noHash(COLORS.subtle),
    align: 'right'
  });
}

/**
 * Render executive summary cards on the slide.
 */
function renderSummaryCards(slide, summary, startY = 1.1) {
  if (!summary || !summary.length) return startY;

  const maxCards = Math.min(summary.length, 5);
  const totalW = 12.33;
  const gap = 0.2;
  const cardW = (totalW - gap * (maxCards - 1)) / maxCards;
  const cardH = 0.85;

  for (let i = 0; i < maxCards; i++) {
    const item = summary[i];
    const cardX = 0.5 + i * (cardW + gap);

    // Card background box
    slide.addShape('roundRect', {
      x: cardX,
      y: startY,
      w: cardW,
      h: cardH,
      fill: { color: noHash(COLORS.zebra) },
      line: { color: noHash(COLORS.border), width: 1 },
      rectRadius: 0.08
    });

    // Metric Label
    slide.addText(str(item.label).toUpperCase(), {
      x: cardX + 0.1,
      y: startY + 0.1,
      w: cardW - 0.2,
      h: 0.25,
      fontFace: FONT,
      fontSize: 8,
      bold: true,
      color: noHash(COLORS.subtle)
    });

    // Metric Value
    slide.addText(str(item.value), {
      x: cardX + 0.1,
      y: startY + 0.35,
      w: cardW - 0.2,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: noHash(COLORS.navy)
    });
  }

  return startY + cardH + 0.25;
}

/**
 * Format table rows into pptxgenjs table cell objects.
 */
function formatTableData(columns, rows) {
  const colCount = columns.length || 1;
  const totalWeight = columns.reduce((a, c) => a + (c.width || 10), 0) || 1;
  const totalWidth = 12.33;
  const colWidths = columns.map(c => ((c.width || 10) / totalWeight) * totalWidth);

  // Table Header Row
  const headerCells = columns.map(col => ({
    text: col.header || '',
    options: {
      fill: { color: noHash(COLORS.headerRow) },
      color: noHash(COLORS.white),
      fontFace: FONT,
      fontSize: 9.5,
      bold: true,
      align: col.align || 'left',
      valign: 'middle',
      border: { pt: 1, color: noHash(COLORS.border) },
      margin: [4, 6, 4, 6]
    }
  }));

  const dataRows = [];
  if (!rows || !rows.length) {
    dataRows.push([{
      text: 'No records match the selected filters.',
      options: {
        colspan: colCount,
        fill: { color: noHash(COLORS.zebra) },
        color: noHash(COLORS.subtle),
        fontFace: FONT,
        fontSize: 9,
        italic: true,
        align: 'center',
        valign: 'middle',
        border: { pt: 1, color: noHash(COLORS.border) },
        margin: [8, 8, 8, 8]
      }
    }]);
  } else {
    rows.forEach((row, idx) => {
      const flag = flagColors(row._flag);
      const isZebra = !flag && (idx % 2 === 1);
      const rowFill = flag ? flag.fill : (isZebra ? noHash(COLORS.zebra) : noHash(COLORS.white));
      const rowColor = flag ? flag.color : noHash(COLORS.ink);

      const rowCells = columns.map(col => ({
        text: str(row[col.key]),
        options: {
          fill: { color: rowFill },
          color: rowColor,
          fontFace: FONT,
          fontSize: 8.5,
          bold: !!flag,
          align: col.align || 'left',
          valign: 'middle',
          border: { pt: 1, color: noHash(COLORS.border) },
          margin: [3, 5, 3, 5]
        }
      }));
      dataRows.push(rowCells);
    });
  }

  return { headerCells, dataRows, colWidths };
}

/**
 * Render a ReportSpec into a PowerPoint presentation buffer and stream to Express response.
 *
 * @param {object} spec     Normalised report specification (see modules/*).
 * @param {object} res      Express response.
 * @param {string} filename Base filename (without extension).
 */
async function streamPptx(spec, res, filename) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = COMPANY.name;
  pptx.company = COMPANY.name;
  pptx.title = spec.title || 'SMaRT Report';

  // 1. Cover Slide
  buildCoverSlide(pptx, spec);

  // 2. Pre-calculate total slides for accurate footer numbering
  const tables = spec.tables && spec.tables.length ? spec.tables : [{ columns: [], rows: [] }];
  let totalDataSlides = 0;

  tables.forEach(table => {
    const rows = table.rows || [];
    const hasSummary = !!(table.summary && table.summary.length);
    const firstLimit = hasSummary ? ROWS_PER_SLIDE_WITH_SUMMARY : ROWS_PER_SLIDE;

    if (rows.length <= firstLimit) {
      totalDataSlides += 1;
    } else {
      const remaining = rows.length - firstLimit;
      totalDataSlides += 1 + Math.ceil(remaining / ROWS_PER_SLIDE);
    }
  });

  const totalSlides = 1 + totalDataSlides;
  let currentSlideNum = 2;

  // 3. Build Content Slides for each table
  for (const table of tables) {
    const { headerCells, dataRows, colWidths } = formatTableData(table.columns || [], table.rows || []);
    const hasSummary = !!(table.summary && table.summary.length);
    const firstLimit = hasSummary ? ROWS_PER_SLIDE_WITH_SUMMARY : ROWS_PER_SLIDE;

    let offset = 0;
    let isFirstForTable = true;

    while (offset < dataRows.length || (dataRows.length === 0 && isFirstForTable)) {
      const slide = pptx.addSlide();
      const limit = isFirstForTable ? firstLimit : ROWS_PER_SLIDE;
      const chunk = dataRows.slice(offset, offset + limit);
      const suffix = (table.name || '') + (isFirstForTable ? '' : ' (Cont.)');

      addSlideChrome(slide, spec, suffix, currentSlideNum, totalSlides);

      let tableY = 1.15;
      if (isFirstForTable && hasSummary) {
        tableY = renderSummaryCards(slide, table.summary, 1.15);
      }

      slide.addTable([headerCells, ...chunk], {
        x: 0.5,
        y: tableY,
        w: 12.33,
        colW: colWidths,
        autoPage: false
      });

      offset += limit;
      isFirstForTable = false;
      currentSlideNum += 1;

      if (dataRows.length === 0) break;
    }
  }

  // 4. Generate buffer and stream to client
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  res.setHeader('Content-Type', FORMAT_META.pptx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pptx"`);
  res.send(buffer);
}

module.exports = { streamPptx };
