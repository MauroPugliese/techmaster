// =============================================================================
// exports/renderers/xlsx.renderer.js — Excel (.xlsx) renderer
// -----------------------------------------------------------------------------
// Renders a ReportSpec into a professionally styled ExcelJS workbook:
//   • Embedded CAE white logo in corporate Navy (#06103D) title banner
//   • Red Hat Display corporate typography with clean system fallback
//   • Branded title band + metadata / filter block on every sheet
//   • Optional summary key/value block with CAE accent highlights
//   • Styled, frozen, auto-filtered table header with zebra striping
//   • Per-row conditional formatting via the `_flag` hint
//   • Printable page setup with repeating header + footer page numbers
// =============================================================================

const fs = require('fs');
const ExcelJS = require('exceljs');
const { COMPANY, LOGOS, COLORS, FONTS, flagStyle, argb } = require('../core/branding');
const { str, FORMAT_META } = require('../core/helpers');

const BASE_FONT = { name: FONTS.xlsx, size: 10 };

/** Sanitise a worksheet name (Excel forbids some chars and >31 length). */
const sheetName = (name, idx) => {
  const clean = String(name || `Sheet ${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim();
  return (clean.slice(0, 31) || `Sheet ${idx + 1}`);
};

const thinBorder = () => ({
  top:    { style: 'thin', color: { argb: argb(COLORS.border) } },
  left:   { style: 'thin', color: { argb: argb(COLORS.border) } },
  bottom: { style: 'thin', color: { argb: argb(COLORS.border) } },
  right:  { style: 'thin', color: { argb: argb(COLORS.border) } }
});

/**
 * Render the report-level title band + meta/filter block at the top of a sheet.
 * Returns the next free row index.
 */
function renderHeaderBlock(wb, ws, spec, colCount) {
  const lastCol = Math.max(colCount, 4);
  const colLetter = (n) => ws.getColumn(n).letter;
  const span = (r) => `A${r}:${colLetter(lastCol)}${r}`;

  // Title band
  ws.mergeCells(span(1));
  const titleCell = ws.getCell('A1');
  titleCell.value = spec.title;
  titleCell.font = { name: FONTS.xlsx, size: 15, bold: true, color: { argb: argb(COLORS.white) } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.band) } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 7 };
  ws.getRow(1).height = 36;

  // Embed CAE White Logo in Title Band (left side)
  if (fs.existsSync(LOGOS.lightPng)) {
    const imgId = wb.addImage({
      filename: LOGOS.lightPng,
      extension: 'png'
    });
    ws.addImage(imgId, {
      tl: { col: 0.12, row: 0.12 },
      ext: { width: 104, height: 39 }, // maintains 8:3 ratio
      editAs: 'oneCell'
    });
  }

  let r = 2;
  if (spec.subtitle) {
    ws.mergeCells(span(r));
    const sub = ws.getCell(`A${r}`);
    sub.value = spec.subtitle;
    sub.font = { name: FONTS.xlsx, size: 10, italic: true, color: { argb: argb(COLORS.white) } };
    sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.headerRow) } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 20;
    r += 1;
  }

  // Meta / filter lines
  const meta = spec.meta || {};
  const lines = [];
  lines.push(['Generated', new Date().toLocaleString('en-GB')]);
  if (meta.generatedBy) lines.push(['By', meta.generatedBy]);
  (meta.filters || []).forEach((f) => lines.push([f.label, str(f.value)]));

  lines.forEach(([label, value]) => {
    const lblCell = ws.getCell(`A${r}`);
    lblCell.value = `${label}:`;
    lblCell.font = { ...BASE_FONT, bold: true, color: { argb: argb(COLORS.subtle) } };
    ws.mergeCells(`B${r}:${colLetter(lastCol)}${r}`);
    const valCell = ws.getCell(`B${r}`);
    valCell.value = value;
    valCell.font = { ...BASE_FONT, color: { argb: argb(COLORS.ink) } };
    r += 1;
  });

  return r + 1; // leave a blank spacer row
}

/** Render an optional summary key/value block; returns next free row. */
function renderSummary(ws, summary, startRow, colCount) {
  if (!summary || !summary.length) return startRow;
  const lastCol = Math.max(colCount, 2);
  const colLetter = (n) => ws.getColumn(n).letter;

  ws.mergeCells(`A${startRow}:${colLetter(lastCol)}${startRow}`);
  const head = ws.getCell(`A${startRow}`);
  head.value = 'Executive Summary';
  head.font = { ...BASE_FONT, bold: true, size: 11, color: { argb: argb(COLORS.white) } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.headerRow) } };
  head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  let r = startRow + 1;

  summary.forEach(({ label, value }) => {
    const lbl = ws.getCell(`A${r}`);
    lbl.value = label;
    lbl.font = { ...BASE_FONT, bold: true, color: { argb: argb(COLORS.subtle) } };
    lbl.border = thinBorder();
    const val = ws.getCell(`B${r}`);
    val.value = value;
    val.font = { ...BASE_FONT, bold: true, color: { argb: argb(COLORS.ink) } };
    val.border = thinBorder();
    r += 1;
  });
  return r + 1;
}

/** Render the data table with header + zebra rows + conditional flags. */
function renderTable(ws, table, startRow) {
  const columns = table.columns || [];
  const rows = table.rows || [];

  // Header row
  const headerRow = ws.getRow(startRow);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: FONTS.xlsx, size: 10, bold: true, color: { argb: argb(COLORS.white) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.navy) } };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: true };
    cell.border = thinBorder();
  });
  headerRow.height = 24;
  headerRow.commit();

  // Data rows
  rows.forEach((row, idx) => {
    const xlRow = ws.getRow(startRow + 1 + idx);
    const flag = flagStyle(row._flag);
    const zebra = idx % 2 === 1;
    columns.forEach((col, i) => {
      const cell = xlRow.getCell(i + 1);
      const raw = row[col.key];
      cell.value = (raw === null || raw === undefined) ? '' : raw;
      cell.font = { ...BASE_FONT, bold: !!flag, color: { argb: argb(flag ? flag.fg : COLORS.ink) } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: col.wrap !== false };
      cell.border = thinBorder();
      if (col.numFmt) cell.numFmt = col.numFmt;
      if (flag) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(flag.bg) } };
      } else if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
      }
    });
    xlRow.height = 20;
  });

  // Column widths
  columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width || 18; });

  // Freeze panes (header) + autofilter
  const headerExcelRow = startRow;
  ws.views = [{ state: 'frozen', ySplit: headerExcelRow }];
  if (columns.length) {
    ws.autoFilter = {
      from: { row: headerExcelRow, column: 1 },
      to:   { row: headerExcelRow + rows.length, column: columns.length }
    };
  }

  return startRow + 1 + rows.length;
}

/** Build a fully styled workbook from a ReportSpec. */
function buildWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  wb.created = new Date();
  wb.title = spec.title;

  const tables = spec.tables && spec.tables.length ? spec.tables : [{ name: 'Report', columns: [], rows: [] }];

  tables.forEach((table, idx) => {
    const ws = wb.addWorksheet(sheetName(table.name, idx), {
      pageSetup: {
        orientation: spec.orientation === 'landscape' ? 'landscape' : 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
      },
      headerFooter: {
        oddFooter: `&L${COMPANY.name}&C&D &T&RPage &P of &N`,
        oddHeader: `&R&"${FONTS.xlsx}"&8${spec.title}`
      }
    });

    const colCount = (table.columns || []).length;
    let row = renderHeaderBlock(wb, ws, spec, colCount);
    row = renderSummary(ws, table.summary, row, colCount);
    if (table.note) {
      ws.getCell(`A${row}`).value = table.note;
      ws.getCell(`A${row}`).font = { ...BASE_FONT, italic: true, color: { argb: argb(COLORS.subtle) } };
      row += 2;
    }
    renderTable(ws, table, row);
    ws.getRow(row).outlineLevel = 0;
    // Repeat the table header row when printed across pages.
    ws.pageSetup.printTitlesRow = `${row}:${row}`;
  });

  return wb;
}

/** Stream the workbook to an Express response. */
async function streamXlsx(spec, res, filename) {
  const wb = buildWorkbook(spec);
  res.setHeader('Content-Type', FORMAT_META.xlsx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { buildWorkbook, streamXlsx };

