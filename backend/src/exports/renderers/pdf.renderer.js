// =============================================================================
// exports/renderers/pdf.renderer.js — Multi-Page A4 Composable PDF Renderer (v4)
// -----------------------------------------------------------------------------
// Executes bespoke `spec.pages` blueprints on ISO A4 Portrait with an official
// CAE `diagonal-hero` Page 1 Cover Page, embedded Red Hat Display/Text/Mono
// fonts, zero Helvetica fallback, and clean running headers/footers on Page 2+.
// =============================================================================

const PDFDocument = require('pdfkit');
const { COMPANY, COLORS, toneStyle, getLogoBuffer } = require('../core/branding');
const { registerPdfFonts } = require('../core/fonts');
const { resolveTheme } = require('../core/themes');
const { str, formatCell, computeColumnTotals, resolveBadgeTone, FORMAT_META } = require('../core/helpers');
const { drawChartsGrid, drawChartCard, drawChartPair } = require('./pdf-charts');
const {
  MARGIN,
  drawCoverPage,
  drawPageBanner,
  drawExecutiveBrief,
  drawThemedKpis,
  drawGaugeBand,
  drawScorecards,
  drawHighlights,
  drawStatMatrix,
  drawCardList,
  drawAlerts
} = require('./pdf-cover-widgets');

const FOOTER_H = 30;
const contentWidth = (doc) => doc.page.width - MARGIN * 2;
const bottomLimit = (doc) => doc.page.height - MARGIN - FOOTER_H;

function drawRunningHeader(doc, spec, F, theme) {
  const w = contentWidth(doc);
  const x = MARGIN;
  const y = MARGIN;
  const docCode = theme.docCode || spec.docCode || 'CAE-RPT';

  doc.save();
  doc.rect(x, y, w, 24).fill(theme.primary);
  const logo = getLogoBuffer('light');
  let textX = x + 10;
  if (logo) {
    doc.image(logo, x + 8, y + 4.5, { width: 40, height: 15 });
    textX = x + 56;
  }
  doc.font(F.displayBold).fontSize(8.8).fillColor(COLORS.white)
    .text(`${COMPANY.mark}  ·  ${spec.title}`, textX, y + 7, { width: Math.max(80, w - (textX - x) - 96), height: 12, lineBreak: false, ellipsis: true });
  doc.font(F.mono).fontSize(7.5).fillColor(theme.secondary || COLORS.cyan)
    .text(docCode, x + w - 88, y + 7.5, { width: 80, height: 11, align: 'right', lineBreak: false, ellipsis: true });
  doc.rect(x, y + 24, w, 1.8).fill(theme.accent);
  doc.restore();

  return y + 38;
}

function ensurePage(doc, spec, y, neededH, F, theme) {
  if (y + neededH <= bottomLimit(doc)) return y;
  doc.addPage();
  return drawRunningHeader(doc, spec, F, theme);
}

function drawSectionEyebrow(doc, title, y, F, theme) {
  doc.save();
  doc.rect(MARGIN, y + 1, 3.5, 11).fill(theme.accent || COLORS.accent);
  doc.font(F.displayBold).fontSize(10).fillColor(theme.primary || COLORS.navy)
    .text(title, MARGIN + 9, y, { width: contentWidth(doc) - 10, lineBreak: false });
  doc.restore();
  return y + 17;
}

function drawDocumentBlocks(doc, spec, blocks, startY, F, theme) {
  if (!blocks || !blocks.length) return startY;
  const w = contentWidth(doc);
  let y = startY;

  blocks.forEach((b) => {
    switch (b.type) {
      case 'h1': {
        y = ensurePage(doc, spec, y, 32, F, theme);
        y += 4;
        doc.save();
        doc.rect(MARGIN, y + 1, 4, 16).fill(theme.accent);
        doc.font(F.displayBold).fontSize(13.5).fillColor(theme.primary)
          .text(b.text, MARGIN + 11, y, { width: w - 12 });
        doc.restore();
        y = doc.y + 7;
        break;
      }
      case 'h2': {
        y = ensurePage(doc, spec, y, 26, F, theme);
        y += 3;
        doc.font(F.displayBold).fontSize(11).fillColor(COLORS.cobalt)
          .text(b.text, MARGIN, y, { width: w });
        y = doc.y + 5;
        break;
      }
      case 'h3': {
        y = ensurePage(doc, spec, y, 22, F, theme);
        doc.font(F.displaySemiBold).fontSize(9.8).fillColor(COLORS.royal)
          .text(b.text, MARGIN, y, { width: w });
        y = doc.y + 4;
        break;
      }
      case 'paragraph': {
        doc.font(F.body).fontSize(9.2);
        const h = doc.heightOfString(b.text, { width: w, lineGap: 2 });
        y = ensurePage(doc, spec, y, Math.min(h + 8, 84), F, theme);
        doc.font(F.body).fontSize(9.2).fillColor(COLORS.body)
          .text(b.text, MARGIN, y, { width: w, lineGap: 2 });
        y = doc.y + 7;
        break;
      }
      case 'bullets':
      case 'ordered': {
        (b.items || []).forEach((item, idx) => {
          const prefix = b.type === 'ordered' ? `${idx + 1}.` : '•';
          doc.font(F.body).fontSize(9.2);
          const h = doc.heightOfString(item.text, { width: w - 18, lineGap: 1.8 });
          y = ensurePage(doc, spec, y, h + 5, F, theme);
          doc.font(F.displayBold).fontSize(9.2).fillColor(theme.accent).text(prefix, MARGIN + 4, y, { lineBreak: false });
          doc.font(F.body).fontSize(9.2).fillColor(COLORS.body).text(item.text, MARGIN + 18, y, { width: w - 18, lineGap: 1.8 });
          y = doc.y + 4;
        });
        y += 4;
        break;
      }
      case 'quote': {
        doc.font(F.bodyItalic).fontSize(8.8);
        const h = doc.heightOfString(b.text, { width: w - 26, lineGap: 2 }) + 14;
        y = ensurePage(doc, spec, y, h + 6, F, theme);
        doc.save();
        doc.roundedRect(MARGIN, y, w, h, 3).fill(theme.tint || COLORS.zebra);
        doc.rect(MARGIN, y, 3.5, h).fill(theme.accent);
        doc.font(F.bodyItalic).fontSize(8.8).fillColor(COLORS.ink)
          .text(b.text, MARGIN + 13, y + 7, { width: w - 26, lineGap: 2 });
        doc.restore();
        y += h + 7;
        break;
      }
      case 'code': {
        doc.font(F.mono).fontSize(8);
        const h = doc.heightOfString(b.content || '', { width: w - 22 }) + 16;
        y = ensurePage(doc, spec, y, Math.min(h + 6, 150), F, theme);
        doc.save();
        doc.roundedRect(MARGIN, y, w, h, 4).fillAndStroke(COLORS.surface, COLORS.border);
        doc.font(F.mono).fontSize(8).fillColor(COLORS.ink)
          .text(b.content || '', MARGIN + 11, y + 8, { width: w - 22 });
        doc.restore();
        y += h + 7;
        break;
      }
      case 'divider': {
        y = ensurePage(doc, spec, y, 12, F, theme);
        doc.save().lineWidth(0.6).strokeColor(COLORS.border)
          .moveTo(MARGIN, y + 5).lineTo(MARGIN + w, y + 5).stroke().restore();
        y += 12;
        break;
      }
      case 'table': {
        const tableSpec = {
          columns: (b.headers || []).map((h, idx) => ({ header: h, key: `c${idx}`, width: 15 })),
          rows: (b.rows || []).map((r) => {
            const obj = {};
            r.forEach((cell, idx) => { obj[`c${idx}`] = cell; });
            return obj;
          })
        };
        y = drawTable(doc, spec, tableSpec, y, F, theme, { showHeading: false });
        break;
      }
    }
  });

  return y;
}

function computeColumnWidths(doc, columns) {
  const w = contentWidth(doc);
  const weights = columns.map((c) => c.pdfWidth || c.width || 12);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((wt) => (wt / total) * w);
}

function drawTableHeader(doc, columns, widths, y, F, theme) {
  const x0 = MARGIN;
  const padding = 5;
  doc.font(F.displayBold).fontSize(8);
  let rowH = 21;
  columns.forEach((col, i) => {
    const h = doc.heightOfString(str(col.header), { width: Math.max(10, widths[i] - padding * 2) }) + 10;
    if (h > rowH) rowH = h;
  });

  const totalW = widths.reduce((a, b) => a + b, 0);
  doc.save();
  doc.rect(x0, y, totalW, rowH).fill(theme.tableHeaderBg || theme.primary || COLORS.navy);
  doc.rect(x0, y + rowH - 2, totalW, 2).fill(theme.accent || COLORS.accent);

  let x = x0;
  columns.forEach((col, i) => {
    doc.font(F.displayBold).fontSize(8).fillColor(COLORS.white)
      .text(str(col.header), x + padding, y + 6, {
        width: Math.max(8, widths[i] - padding * 2),
        align: col.align || 'left'
      });
    x += widths[i];
  });
  doc.restore();
  return y + rowH;
}

function drawBadgeCell(doc, text, x, y, width, rowH, tone, F) {
  const pillStyle = tone || toneStyle('info');
  const label = str(text);
  doc.font(F.displayBold).fontSize(6.8);
  const textW = Math.min(width - 6, doc.widthOfString(label) + 10);
  const pillW = Math.max(26, textW);
  const pillH = 13;
  const px = x + Math.max(3, (width - pillW) / 2);
  const py = y + (rowH - pillH) / 2;

  doc.save();
  doc.roundedRect(px, py, pillW, pillH, 3.5).fill(pillStyle.bg);
  doc.font(F.displayBold).fontSize(6.8).fillColor(pillStyle.fg)
    .text(label, px + 2, py + 3, { width: pillW - 4, align: 'center', lineBreak: false });
  doc.restore();
}

function drawTable(doc, spec, table, startY, F, theme, opts = {}) {
  const columns = (table?.columns || []).filter((c) => !c.printHidden);
  if (!columns.length) return startY;

  const widths = computeColumnWidths(doc, columns);
  const x0 = MARGIN;
  const padding = 5;
  const tableWidth = widths.reduce((a, b) => a + b, 0);

  let y = startY;
  y = ensurePage(doc, spec, y, 72, F, theme);

  if (opts.showHeading !== false && table.name) {
    y = drawSectionEyebrow(doc, table.name, y, F, theme);
    if (table.note) {
      doc.font(F.body).fontSize(8).fillColor(COLORS.subtle)
        .text(table.note, MARGIN, y, { width: tableWidth });
      y = doc.y + 4;
    }
  }

  y = drawTableHeader(doc, columns, widths, y, F, theme);

  const rows = table.rows || [];
  if (!rows.length) {
    doc.save().rect(x0, y, tableWidth, 26).fillAndStroke(COLORS.zebra, COLORS.border).restore();
    doc.font(F.bodyItalic).fontSize(8.2).fillColor(COLORS.subtle)
      .text('No records match the selected filters.', x0 + padding + 4, y + 8);
    return y + 34;
  }

  rows.forEach((row, idx) => {
    doc.font(F.body).fontSize(8);
    let rowH = 20;
    const cellTexts = columns.map((col) => formatCell(row, col));
    cellTexts.forEach((txt, i) => {
      const col = columns[i];
      doc.font(col.type === 'mono' ? F.mono : F.body).fontSize(col.type === 'badge' ? 7 : 8);
      const h = doc.heightOfString(txt, { width: Math.max(8, widths[i] - padding * 2) }) + 10;
      if (h > rowH) rowH = h;
    });

    if (y + rowH > bottomLimit(doc)) {
      doc.addPage();
      const top = drawRunningHeader(doc, spec, F, theme);
      y = drawTableHeader(doc, columns, widths, top, F, theme);
    }

    const rowTone = toneStyle(row._flag);
    const zebra = idx % 2 === 1;

    if (rowTone && (row._flag === 'danger' || row._flag === 'warning')) {
      doc.save().rect(x0, y, tableWidth, rowH).fillOpacity(0.32).fill(rowTone.bg).restore();
    } else if (zebra) {
      doc.save().rect(x0, y, tableWidth, rowH).fill(COLORS.zebra).restore();
    }

    if (rowTone) {
      doc.save().rect(x0, y, 2.4, rowH).fill(rowTone.accent).restore();
    }

    doc.save().lineWidth(0.4).strokeColor(COLORS.border)
      .moveTo(x0, y + rowH).lineTo(x0 + tableWidth, y + rowH).stroke().restore();

    let x = x0;
    columns.forEach((col, i) => {
      if (col.type === 'badge') {
        const badgeTone = toneStyle(resolveBadgeTone(row, col)) || toneStyle('neutral');
        drawBadgeCell(doc, cellTexts[i], x, y, widths[i], rowH, badgeTone, F);
      } else {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        const fontName = col.type === 'mono' ? F.mono : (isNum ? F.displayMedium : F.body);
        const textColor = rowTone && isNum ? rowTone.fg : COLORS.body;
        doc.font(fontName).fontSize(col.type === 'mono' ? 7.5 : 8).fillColor(textColor)
          .text(cellTexts[i], x + padding, y + 5, {
            width: Math.max(8, widths[i] - padding * 2),
            align: col.align || (isNum ? 'right' : 'left')
          });
      }
      x += widths[i];
    });

    y += rowH;
  });

  const totalsRow = computeColumnTotals({ ...table, columns });
  if (totalsRow) {
    const rowH = 21;
    if (y + rowH > bottomLimit(doc)) {
      doc.addPage();
      const top = drawRunningHeader(doc, spec, F, theme);
      y = drawTableHeader(doc, columns, widths, top, F, theme);
    }
    doc.save();
    doc.rect(x0, y, tableWidth, rowH).fill(theme.tint || COLORS.navyTint);
    doc.lineWidth(1).strokeColor(theme.primary).moveTo(x0, y).lineTo(x0 + tableWidth, y).stroke();

    let x = x0;
    columns.forEach((col, colIdx) => {
      const val = str(totalsRow[col.key]);
      if (val) {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        doc.font(F.displayBold).fontSize(8).fillColor(theme.primary)
          .text(val, x + padding, y + 6, {
            width: Math.max(8, widths[colIdx] - padding * 2),
            align: col.align || (isNum ? 'right' : 'left'),
            lineBreak: false
          });
      }
      x += widths[colIdx];
    });
    doc.restore();
    y += rowH;
  }

  return y + 12;
}

function renderBlueprintBlock(doc, spec, page, block, y, w, F, theme) {
  switch (block.type) {
    case 'brief':
      return drawExecutiveBrief(doc, block.title, block.text, y, w, F, theme);

    case 'kpis':
      return drawThemedKpis(doc, spec, block.items, block.variant || 'grid-2col', y, w, F, theme, ensurePage);

    case 'gaugeBand': {
      const nextY = ensurePage(doc, spec, y, 114, F, theme);
      return drawGaugeBand(doc, block.items, nextY, w, F, theme);
    }

    case 'scorecard':
      return drawScorecards(doc, spec, block, y, w, F, theme, ensurePage);

    case 'highlights':
      return drawHighlights(doc, spec, block.title, block.items, y, w, F, theme, ensurePage);

    case 'alerts':
      return drawAlerts(doc, spec, block.title, block.items, y, w, F, theme, ensurePage);

    case 'statMatrix':
      return drawStatMatrix(doc, block.title, block.pairs, y, w, F, theme, ensurePage, spec);

    case 'cardList':
      return drawCardList(doc, spec, block.title, block.items, y, w, F, theme, ensurePage);

    case 'chart': {
      const ch = block.chart;
      if (!ch) return y;
      const isTall = ['bar', 'groupedBar', 'stackedBar', 'line', 'area'].includes(ch.type);
      const h = block.height || (isTall ? 228 : 206);
      const nextY = ensurePage(doc, spec, y, h + 6, F, theme);
      drawChartCard(doc, ch, MARGIN, nextY, w, h, F, theme);
      return nextY + h + 12;
    }

    case 'chartPair': {
      const h = block.height || 196;
      const nextY = ensurePage(doc, spec, y, h + 6, F, theme);
      return drawChartPair(doc, block.left, block.right, MARGIN, w, nextY, h, F, theme);
    }

    case 'table':
      return drawTable(doc, spec, block.table, y, F, theme, {
        showHeading: block.showHeading !== undefined
          ? block.showHeading
          : (block.table?.name !== page.title)
      });

    case 'markdown':
      return drawDocumentBlocks(doc, spec, block.blocks, y, F, theme);

    default:
      return y;
  }
}

function drawFooters(doc, spec, F, theme) {
  const range = doc.bufferedPageRange();
  const generated = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const docCode = theme.docCode || spec.docCode || 'CAE-RPT';

  // Skip Page 1 cover page
  for (let i = range.start + 1; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const w = contentWidth(doc);
    const yy = doc.page.height - MARGIN - 14;

    doc.save();
    doc.lineWidth(0.5).strokeColor(COLORS.border)
      .moveTo(MARGIN, yy - 5).lineTo(MARGIN + w, yy - 5).stroke();
    doc.font(F.body).fontSize(7.5).fillColor(COLORS.subtle);
    doc.text(`${COMPANY.name}  ·  ${docCode}`, MARGIN, yy, { width: w * 0.45, height: 11, align: 'left', lineBreak: false, ellipsis: true });
    doc.text(generated, MARGIN + w * 0.45, yy, { width: w * 0.25, height: 11, align: 'center', lineBreak: false });
    doc.font(F.displaySemiBold).fillColor(theme.primary)
      .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + w * 0.70, yy, { width: w * 0.30, height: 11, align: 'right', lineBreak: false });
    doc.restore();
  }
}

/** Render a normalised ReportSpec v4 to an A4 multi-page PDF Buffer. */
function buildPdfBuffer(spec) {
  return new Promise((resolve, reject) => {
    const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
    const doc = new PDFDocument({
      size: 'A4',
      layout: spec.orientation === 'landscape' ? 'landscape' : 'portrait',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true
    });

    const F = registerPdfFonts(doc);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Page 1: Official CAE Diagonal-Hero Cover Page
    drawCoverPage(doc, spec, F, theme);

    const w = contentWidth(doc);

    if (spec.pages && spec.pages.length) {
      const renderablePages = spec.pages.filter((p) => p && (p.title || (Array.isArray(p.blocks) && p.blocks.length > 0)));
      renderablePages.forEach((page, pIdx) => {
        doc.addPage();
        let y = drawRunningHeader(doc, spec, F, theme);
        if (page.title) {
          y = drawPageBanner(doc, pIdx + 1, page.eyebrow, page.title, page.subtitle, y, w, F, theme);
        }
        (page.blocks || []).forEach((block) => {
          y = renderBlueprintBlock(doc, spec, page, block, y, w, F, theme);
        });
      });
    } else {
      // Legacy top-level ReportSpec fallback
      doc.addPage();
      let y = drawRunningHeader(doc, spec, F, theme);
      let sectionNum = 1;

      const hasExec = Boolean(
        spec.executiveBrief ||
        (spec.kpis && spec.kpis.length) ||
        (spec.scorecards && spec.scorecards.length) ||
        (spec.highlights && spec.highlights.length) ||
        (spec.insights && spec.insights.length)
      );

      if (hasExec) {
        y = drawPageBanner(doc, sectionNum++, 'SECTION 01 · OVERVIEW', 'Executive Overview', theme.coverTagline || '', y, w, F, theme);
        y = drawExecutiveBrief(doc, 'Executive Brief', spec.executiveBrief, y, w, F, theme);
        y = drawThemedKpis(doc, spec, spec.kpis, 'grid-2col', y, w, F, theme, ensurePage);
        (spec.scorecards || []).forEach((sc) => { y = drawScorecards(doc, spec, sc, y, w, F, theme, ensurePage); });
        y = drawHighlights(doc, spec, null, spec.highlights, y, w, F, theme, ensurePage);
        y = drawAlerts(doc, spec, 'Key Insights & Alerts', spec.insights, y, w, F, theme, ensurePage);
      }

      if (spec.charts && spec.charts.length) {
        if (hasExec) {
          doc.addPage();
          y = drawRunningHeader(doc, spec, F, theme);
        }
        y = drawPageBanner(doc, sectionNum++, `SECTION 0${sectionNum - 1} · ANALYTICS`, 'Visual Analytics', '', y, w, F, theme);
        y = drawChartsGrid(doc, spec.charts, MARGIN, w, y, bottomLimit(doc), () => {
          doc.addPage();
          return drawRunningHeader(doc, spec, F, theme);
        }, F, theme);
      }

      if (spec.documentBlocks && spec.documentBlocks.length) {
        if (hasExec || (spec.charts && spec.charts.length)) {
          doc.addPage();
          y = drawRunningHeader(doc, spec, F, theme);
        }
        y = drawPageBanner(doc, sectionNum++, 'DOCUMENT', spec.title, '', y, w, F, theme);
        y = drawDocumentBlocks(doc, spec, spec.documentBlocks, y, F, theme);
      }

      const tables = [...(spec.tables || [])].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));
      tables.forEach((table, tIdx) => {
        if (hasExec || (spec.charts && spec.charts.length) || tIdx > 0) {
          doc.addPage();
          y = drawRunningHeader(doc, spec, F, theme);
        }
        y = drawPageBanner(doc, sectionNum++, 'DATA LEDGER', table.name || 'Report Data', table.note || '', y, w, F, theme);
        y = drawTable(doc, spec, table, y, F, theme, { showHeading: false });
      });
    }

    drawFooters(doc, spec, F, theme);
    doc.end();
  });
}

/** Stream a PDF rendered from the ReportSpec to the Express response. */
async function streamPdf(spec, res, filename) {
  const buffer = await buildPdfBuffer(spec);
  res.setHeader('Content-Type', FORMAT_META.pdf.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.send(buffer);
}

module.exports = { buildPdfBuffer, streamPdf };
