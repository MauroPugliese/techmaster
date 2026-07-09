// =============================================================================
// exports/renderers/pdf.renderer.js — PDF (.pdf) renderer
// -----------------------------------------------------------------------------
// PDFKit has no native table primitive, so this renderer implements a complete
// grid layout engine on top of it:
//   • Branded header band (full on page 1, compact running header afterwards)
//   • Metadata / filter block and optional summary block
//   • Column-weighted, word-wrapping table with header rows repeated on every
//     page, zebra striping and per-row conditional flags
//   • Footer with brand + centred timestamp + "Page X of Y" on every page
// =============================================================================

const PDFDocument = require('pdfkit');
const { COMPANY, COLORS, FONTS } = require('../core/branding');
const { str, FORMAT_META } = require('../core/helpers');

const MARGIN = 40;
const FOOTER_H = 28;

const flagColors = (flag) => {
  switch (flag) {
    case 'danger':  return { fg: COLORS.dangerFg,  bg: COLORS.dangerBg };
    case 'success': return { fg: COLORS.successFg, bg: COLORS.successBg };
    case 'warning': return { fg: COLORS.warningFg, bg: COLORS.warningBg };
    case 'muted':   return { fg: COLORS.mutedFg,   bg: COLORS.mutedBg };
    default:        return null;
  }
};

const contentWidth = (doc) => doc.page.width - MARGIN * 2;
const bottomLimit = (doc) => doc.page.height - MARGIN - FOOTER_H;

/** Draw the full branded header (used on the first page). */
function drawDocHeader(doc, spec) {
  const w = contentWidth(doc);
  const x = MARGIN;
  let y = MARGIN;

  // Header band
  const bandH = spec.subtitle ? 56 : 44;
  doc.save();
  doc.rect(x, y, w, bandH).fill(COLORS.band);
  doc.fillColor(COLORS.white).font(`${FONTS.pdf}-Bold`).fontSize(18)
    .text(`${COMPANY.mark}  ·  ${spec.title}`, x + 12, y + 10, { width: w - 24 });
  if (spec.subtitle) {
    doc.font(FONTS.pdf).fontSize(10).fillColor('#CBD5E1')
      .text(spec.subtitle, x + 12, y + 34, { width: w - 24 });
  }
  doc.restore();
  y += bandH + 10;

  // Meta / filter lines
  const meta = spec.meta || {};
  const lines = [['Generated', new Date().toLocaleString('en-GB')]];
  if (meta.generatedBy) lines.push(['By', meta.generatedBy]);
  (meta.filters || []).forEach((f) => lines.push([f.label, str(f.value)]));

  doc.fontSize(9);
  lines.forEach(([label, value]) => {
    doc.font(`${FONTS.pdf}-Bold`).fillColor(COLORS.subtle).text(`${label}:  `, x, y, { continued: true });
    doc.font(FONTS.pdf).fillColor(COLORS.ink).text(str(value));
    y = doc.y + 1;
  });

  return y + 8;
}

/** Draw a compact running header for pages after the first. */
function drawRunningHeader(doc, spec) {
  const w = contentWidth(doc);
  const x = MARGIN;
  const y = MARGIN;
  doc.save();
  doc.rect(x, y, w, 22).fill(COLORS.headerRow);
  doc.fillColor(COLORS.white).font(`${FONTS.pdf}-Bold`).fontSize(10)
    .text(`${COMPANY.mark}  ·  ${spec.title}`, x + 10, y + 6, { width: w - 20 });
  doc.restore();
  return y + 32;
}

/** Draw an optional summary block; returns the next Y position. */
function drawSummary(doc, summary, y) {
  if (!summary || !summary.length) return y;
  const x = MARGIN;
  const w = contentWidth(doc);
  doc.save();
  doc.rect(x, y, w, 18).fill(COLORS.headerRow);
  doc.fillColor(COLORS.white).font(`${FONTS.pdf}-Bold`).fontSize(10).text('Summary', x + 8, y + 4);
  doc.restore();
  y += 22;
  doc.fontSize(9);
  summary.forEach(({ label, value }) => {
    doc.font(`${FONTS.pdf}-Bold`).fillColor(COLORS.subtle).text(`${label}:  `, x + 4, y, { continued: true });
    doc.font(FONTS.pdf).fillColor(COLORS.ink).text(str(value));
    y = doc.y + 2;
  });
  return y + 8;
}

/** Compute absolute pixel widths for each column scaled to the content area. */
function computeColumnWidths(doc, columns) {
  const w = contentWidth(doc);
  const weights = columns.map((c) => c.pdfWidth || c.width || 12);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((wt) => (wt / total) * w);
}

/** Draw one table header row at position y. Returns next Y. */
function drawTableHeader(doc, columns, widths, y) {
  const x0 = MARGIN;
  const padding = 4;
  // Measure height
  doc.font(`${FONTS.pdf}-Bold`).fontSize(8.5);
  let rowH = 16;
  columns.forEach((col, i) => {
    const h = doc.heightOfString(str(col.header), { width: widths[i] - padding * 2 }) + 8;
    if (h > rowH) rowH = h;
  });
  // Background band
  doc.save().rect(x0, y, widths.reduce((a, b) => a + b, 0), rowH).fill(COLORS.headerRow).restore();
  // Header text + separators
  let x = x0;
  columns.forEach((col, i) => {
    doc.fillColor(COLORS.white).font(`${FONTS.pdf}-Bold`).fontSize(8.5)
      .text(str(col.header), x + padding, y + 4, { width: widths[i] - padding * 2, align: col.align || 'left' });
    x += widths[i];
  });
  return y + rowH;
}

/** Draw the full table, handling page breaks and header repetition. */
function drawTable(doc, spec, table, startY) {
  const columns = table.columns || [];
  if (!columns.length) return startY;
  const widths = computeColumnWidths(doc, columns);
  const x0 = MARGIN;
  const padding = 4;
  const tableWidth = widths.reduce((a, b) => a + b, 0);

  let y = drawTableHeader(doc, columns, widths, startY);

  const rows = table.rows || [];
  if (!rows.length) {
    doc.font(FONTS.pdf).fontSize(9).fillColor(COLORS.subtle)
      .text('No records match the selected filters.', x0 + padding, y + 6);
    return y + 24;
  }

  rows.forEach((row, idx) => {
    // Measure row height across all columns
    doc.font(FONTS.pdf).fontSize(8.5);
    let rowH = 14;
    const cellTexts = columns.map((col) => str(row[col.key]));
    cellTexts.forEach((txt, i) => {
      const h = doc.heightOfString(txt, { width: widths[i] - padding * 2 }) + 8;
      if (h > rowH) rowH = h;
    });

    // Page break?
    if (y + rowH > bottomLimit(doc)) {
      doc.addPage();
      const top = drawRunningHeader(doc, spec);
      y = drawTableHeader(doc, columns, widths, top);
    }

    const flag = flagColors(row._flag);
    const zebra = idx % 2 === 1;
    // Row background
    if (flag) {
      doc.save().rect(x0, y, tableWidth, rowH).fill(flag.bg).restore();
    } else if (zebra) {
      doc.save().rect(x0, y, tableWidth, rowH).fill(COLORS.zebra).restore();
    }
    // Cell borders + text
    let x = x0;
    columns.forEach((col, i) => {
      doc.save().lineWidth(0.4).strokeColor(COLORS.border)
        .rect(x, y, widths[i], rowH).stroke().restore();
      doc.fillColor(flag ? flag.fg : COLORS.ink).font(FONTS.pdf).fontSize(8.5)
        .text(cellTexts[i], x + padding, y + 4, { width: widths[i] - padding * 2, align: col.align || 'left' });
      x += widths[i];
    });
    y += rowH;
  });

  return y + 10;
}

/** Draw footer (brand + timestamp + page numbers) on every buffered page. */
function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  const generated = new Date().toLocaleString('en-GB');
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const w = doc.page.width - MARGIN * 2;
    const yy = doc.page.height - MARGIN - 12;
    doc.save();
    doc.lineWidth(0.5).strokeColor(COLORS.border)
      .moveTo(MARGIN, yy - 4).lineTo(MARGIN + w, yy - 4).stroke();
    doc.font(FONTS.pdf).fontSize(8).fillColor(COLORS.subtle);
    doc.text(COMPANY.name, MARGIN, yy, { width: w / 3, align: 'left' });
    doc.text(generated, MARGIN + w / 3, yy, { width: w / 3, align: 'center' });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + (2 * w) / 3, yy, { width: w / 3, align: 'right' });
    doc.restore();
  }
}

/** Stream a PDF rendered from the ReportSpec to the Express response. */
function streamPdf(spec, res, filename) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: spec.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true
  });

  res.setHeader('Content-Type', FORMAT_META.pdf.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  let y = drawDocHeader(doc, spec);
  const tables = spec.tables && spec.tables.length ? spec.tables : [];

  tables.forEach((table, idx) => {
    if (idx > 0) y += 6;
    // Section title (only show when more than one table)
    if (tables.length > 1) {
      if (y + 30 > bottomLimit(doc)) { doc.addPage(); y = drawRunningHeader(doc, spec); }
      doc.font(`${FONTS.pdf}-Bold`).fontSize(12).fillColor(COLORS.ink)
        .text(table.name || `Table ${idx + 1}`, MARGIN, y);
      y = doc.y + 6;
    }
    y = drawSummary(doc, table.summary, y);
    if (table.note) {
      doc.font(FONTS.pdf).fontSize(8.5).fillColor(COLORS.subtle).text(table.note, MARGIN, y, { width: contentWidth(doc) });
      y = doc.y + 6;
    }
    y = drawTable(doc, spec, table, y);
  });

  drawFooters(doc);
  doc.end();
}

module.exports = { streamPdf };
