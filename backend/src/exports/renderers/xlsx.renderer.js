// =============================================================================
// exports/renderers/xlsx.renderer.js — Clean Tabular Excel (.xlsx) Renderer v5
// -----------------------------------------------------------------------------
// Pure, analyst-ready rows & columns spreadsheet format:
//   • Row 1 = Column Headers on EVERY worksheet (frozen pane + AutoFilter)
//   • Standard Excel gridlines ON, ZERO merged cells, ZERO floating images
//   • Data tables placed FIRST for immediate filtering, sorting, and pivoting
//   • Preserves ALL exported columns (including `printHidden: true` audit cols)
//   • True numeric types (currency, percent, number) + live SUM/AVERAGE totals
//   • Clean flat `Summary` and `Chart Data` sheets so zero report data is lost
// =============================================================================

const ExcelJS = require('exceljs');
const {
  COMPANY, COLORS, OFFICE_FONTS, toneStyle, argb
} = require('../core/branding');
const { resolveTheme } = require('../core/themes');
const { collectSpecData } = require('../core/spec-collector');
const { str, toNumber, resolveBadgeTone, FORMAT_META } = require('../core/helpers');

const F_DISP = OFFICE_FONTS.xlsx.display;
const F_BODY = OFFICE_FONTS.xlsx.body;
const F_MONO = OFFICE_FONTS.xlsx.mono;

const MIN_COL_WIDTH = 10;
const MAX_COL_WIDTH = 44;

/** Neutralize Excel formula injection on string cells (OWASP CSV/Spreadsheet Injection defense). */
function sanitizeExcelText(val) {
  const s = str(val);
  if (!s) return '';
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]\s?\d[\d,.]*(?:\s?(?:%|h|u|units|min|m|IN|OUT).*)?$/i.test(s))) {
    return `'${s}`;
  }
  return s;
}

const thinBorder = () => ({
  top:    { style: 'thin', color: { argb: argb(COLORS.border) } },
  left:   { style: 'thin', color: { argb: argb(COLORS.border) } },
  bottom: { style: 'thin', color: { argb: argb(COLORS.border) } },
  right:  { style: 'thin', color: { argb: argb(COLORS.border) } }
});

/** Generate a valid, unique Excel worksheet name (<= 31 chars). */
function uniqueSheetName(wb, rawName, idx) {
  const base = String(rawName || `Data ${idx + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || `Data ${idx + 1}`;
  let candidate = base.slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  return candidate;
}

/** Create a clean worksheet configured with gridlines ON, frozen Row 1, and A4 print setup. */
function createCleanSheet(wb, name, spec, colCount) {
  const isWide = colCount >= 6 || spec.orientation === 'landscape';
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
    pageSetup: {
      paperSize: 9,
      orientation: isWide ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 }
    },
    headerFooter: {
      oddHeader: `&R&"${F_DISP}"&8${spec.title || 'Report'}`,
      oddFooter: `&L${COMPANY.name}&C&D &T&RPage &P of &N`
    }
  });
  return ws;
}

/** Resolve Excel number format string for a column definition. */
function resolveNumFmt(col) {
  if (col.numFmt) return col.numFmt;
  if (col.type === 'currency') {
    const sym = col.currency || '$';
    return `"${sym}"#,##0.00;-"${sym}"#,##0.00;"${sym}"0.00`;
  }
  if (col.type === 'percent') {
    const dec = col.decimals !== undefined ? col.decimals : 1;
    const zeros = dec > 0 ? `.${'0'.repeat(dec)}` : '';
    return `0${zeros}"%"`;
  }
  if (col.type === 'number') {
    const dec = col.decimals !== undefined ? col.decimals : 0;
    const zeros = dec > 0 ? `.${'0'.repeat(dec)}` : '';
    return `#,##0${zeros}`;
  }
  return null;
}

/** Estimate printable text length of a cell value (including formatted numbers) for column sizing. */
function estimateCellDisplayLen(value, colType) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'object' && value.formula) return 14;
  if (typeof value === 'number') {
    if (colType === 'currency') return `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.length + 2;
    if (colType === 'percent') return `${value.toFixed(1)}%`.length + 1;
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 }).length + 1;
  }
  const lines = String(value).split('\n');
  return Math.max(...lines.map((l) => l.length));
}

/** Compute clean auto-fit column widths (10..44 chars) and dynamic row heights. */
function autoFitColumns(ws, columns, rowDisplayLengths) {
  const widths = columns.map((col, idx) => {
    const headerLen = String(col.header || '').length;
    const maxDataLen = rowDisplayLengths[idx] || 0;
    const hinted = col.excelWidth ? Number(col.excelWidth) : 0;
    const raw = Math.max(headerLen + 4, maxDataLen + 3, hinted);
    return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.ceil(raw)));
  });

  widths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  return widths;
}

/** Style Row 1 header cells uniformly across any tabular worksheet. */
function styleHeaderRow(ws, columns, theme) {
  const hdrRow = ws.getRow(1);
  hdrRow.height = 24;
  const headerBg = argb(theme.tableHeaderBg || theme.primary || COLORS.navy);

  columns.forEach((col, idx) => {
    const cell = hdrRow.getCell(idx + 1);
    const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
    cell.value = String(col.header || '');
    cell.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(COLORS.white) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } };
    cell.alignment = {
      horizontal: col.align || (isNum ? 'right' : 'left'),
      vertical: 'middle',
      wrapText: true
    };
    cell.border = thinBorder();
  });
}

/** Render a pure tabular dataset (Row 1 = Headers, Row 2..N = Data, optional Totals row). */
function writeDataTableSheet(wb, sheetName, table, spec, theme) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const effectiveCols = columns.length
    ? columns
    : [{ header: 'Status', key: 'status', type: 'text' }];

  const ws = createCleanSheet(wb, sheetName, spec, effectiveCols.length);
  styleHeaderRow(ws, effectiveCols, theme);

  const maxLens = effectiveCols.map(() => 0);

  if (!columns.length) {
    const row = ws.getRow(2);
    row.getCell(1).value = 'No columns defined for this dataset.';
    row.getCell(1).font = { name: F_BODY, size: 10, italic: true, color: { argb: argb(COLORS.subtle) } };
    ws.getColumn(1).width = 36;
    return ws;
  }

  rows.forEach((item, rIdx) => {
    const excelRowNum = rIdx + 2;
    const row = ws.getRow(excelRowNum);
    const isZebra = rIdx % 2 === 1;
    const rowTone = toneStyle(item._flag);
    const isFlagRow = rowTone && (item._flag === 'danger' || item._flag === 'warning');

    effectiveCols.forEach((col, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      const raw = item ? item[col.key] : undefined;
      const isNumCol = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
      const isBadge = col.type === 'badge';

      let cellVal;
      if (raw === null || raw === undefined || raw === '') {
        cellVal = '';
      } else if (isNumCol && typeof raw === 'number' && Number.isFinite(raw)) {
        cellVal = raw;
      } else if (isNumCol && typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        cellVal = Number(raw);
      } else {
        cellVal = sanitizeExcelText(raw);
      }

      cell.value = cellVal;
      const len = estimateCellDisplayLen(cellVal, col.type);
      if (len > maxLens[cIdx]) maxLens[cIdx] = len;

      const numFmt = typeof cellVal === 'number' ? resolveNumFmt(col) : null;
      if (numFmt) cell.numFmt = numFmt;

      const badgeTone = isBadge ? (toneStyle(resolveBadgeTone(item, col)) || toneStyle('neutral')) : null;
      const bgHex = isBadge
        ? badgeTone.bg
        : (isFlagRow ? rowTone.bg : (isZebra ? COLORS.zebra : COLORS.white));
      const fgHex = isBadge
        ? badgeTone.fg
        : (isFlagRow && isNumCol ? rowTone.fg : COLORS.body);

      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(bgHex) } };
      cell.font = {
        name: col.type === 'mono' ? F_MONO : F_BODY,
        size: col.type === 'mono' ? 9.5 : 10,
        bold: isBadge || (isFlagRow && isNumCol),
        color: { argb: argb(fgHex) }
      };
      cell.alignment = {
        horizontal: col.align || (isBadge ? 'center' : (isNumCol ? 'right' : 'left')),
        vertical: 'middle',
        wrapText: !isNumCol
      };
      cell.border = thinBorder();
    });
  });

  const widths = autoFitColumns(ws, effectiveCols, maxLens);

  // Set clean dynamic row heights so multi-line text cells never clip
  rows.forEach((item, rIdx) => {
    const excelRowNum = rIdx + 2;
    let maxLines = 1;
    effectiveCols.forEach((col, cIdx) => {
      const raw = item ? item[col.key] : '';
      if (typeof raw === 'string' && raw.length > 0) {
        const colW = Math.max(8, widths[cIdx] - 2);
        const lines = raw.split('\n').reduce((acc, seg) => acc + Math.max(1, Math.ceil(seg.length / colW)), 0);
        if (lines > maxLines) maxLines = lines;
      }
    });
    ws.getRow(excelRowNum).height = Math.min(110, Math.max(20, maxLines * 15 + 6));
  });

  const lastDataRow = Math.max(1, rows.length + 1);
  const lastColLetter = ws.getColumn(effectiveCols.length).letter;

  // Apply AutoFilter cleanly over Header + Data rows (excluding Totals row)
  ws.autoFilter = `A1:${lastColLetter}${lastDataRow}`;

  // Append clean Excel formula Totals row if any column requests aggregation
  const hasTotals = rows.length > 0 && effectiveCols.some((c) => c.total);
  if (hasTotals) {
    const totRowNum = rows.length + 2;
    const totRow = ws.getRow(totRowNum);
    totRow.height = 23;
    let labelPlaced = false;

    effectiveCols.forEach((col, cIdx) => {
      const cell = totRow.getCell(cIdx + 1);
      const colLet = ws.getColumn(cIdx + 1).letter;
      const isNumCol = col.type === 'number' || col.type === 'currency' || col.type === 'percent';

      if (col.total === 'label' || (cIdx === 0 && !col.total && !labelPlaced)) {
        cell.value = col.totalLabel || `TOTAL (${rows.length})`;
        labelPlaced = true;
      } else if (col.total === 'sum') {
        cell.value = { formula: `SUM(${colLet}2:${colLet}${lastDataRow})` };
        const fmt = resolveNumFmt(col);
        if (fmt) cell.numFmt = fmt;
      } else if (col.total === 'avg') {
        cell.value = { formula: `AVERAGE(${colLet}2:${colLet}${lastDataRow})` };
        const fmt = resolveNumFmt(col);
        if (fmt) cell.numFmt = fmt;
      } else if (col.total === 'count') {
        cell.value = { formula: `COUNTA(${colLet}2:${colLet}${lastDataRow})` };
        cell.numFmt = '#,##0';
      } else {
        cell.value = '';
      }

      cell.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(theme.primary || COLORS.navy) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.navyTint) } };
      cell.alignment = {
        horizontal: col.align || (isNumCol ? 'right' : 'left'),
        vertical: 'middle'
      };
      cell.border = {
        top:    { style: 'medium', color: { argb: argb(theme.primary || COLORS.navy) } },
        bottom: { style: 'double', color: { argb: argb(theme.primary || COLORS.navy) } },
        left:   { style: 'thin', color: { argb: argb(COLORS.border) } },
        right:  { style: 'thin', color: { argb: argb(COLORS.border) } }
      };
    });
  }

  return ws;
}

/** Build a simple flat 4-column Summary sheet with all metadata, KPIs, matrices, scorecards, and alerts. */
function buildSummarySheet(wb, spec, data, theme) {
  const summaryRows = [];
  const pushRow = (section, field, value, details = '', numFmt = null) => {
    summaryRows.push({ section, field: str(field), value, details: str(details), numFmt });
  };

  const meta = spec.meta || {};
  const generatedStr = new Date(meta.generatedAt || Date.now()).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });

  pushRow('Report Info', 'Title', str(spec.title || 'Report'));
  if (spec.subtitle) pushRow('Report Info', 'Subtitle', str(spec.subtitle));
  pushRow('Report Info', 'Document Code', str(spec.docCode || theme.docCode || 'CAE-RPT'));
  pushRow('Report Info', 'Category', str(spec.category || 'OPERATIONS INTELLIGENCE'));
  if (meta.period?.label) {
    pushRow('Report Info', 'Reporting Period', str(meta.period.label), str(meta.period.rangeText || ''));
  }
  pushRow('Report Info', 'Generated At', generatedStr);
  if (meta.generatedBy) pushRow('Report Info', 'Generated By', str(meta.generatedBy));

  (meta.filters || []).forEach((f) => {
    pushRow('Filter', f.label, str(f.value));
  });

  if (data.executiveBrief) {
    pushRow('Executive Brief', 'Overview', str(data.executiveBrief));
  }

  (data.kpis || []).forEach((k) => {
    const isComposite = typeof k.value === 'string' && k.value.includes('/');
    const useRaw = !isComposite && typeof k.rawValue === 'number' && Number.isFinite(k.rawValue);
    const val = useRaw ? k.rawValue : sanitizeExcelText(k.value);
    pushRow('KPI', k.label, val, k.sublabel || '', useRaw ? (k.numFmt || null) : null);
  });

  (data.scorecards || []).forEach((sc) => {
    (sc.items || []).forEach((it) => {
      const pctNum = Number.isFinite(Number(it.percent)) ? Number(it.percent) : null;
      const val = pctNum !== null ? pctNum : str(it.valueLabel || '');
      const fmt = pctNum !== null ? '0.0"%"' : null;
      pushRow(`Scorecard: ${sc.title || 'Health'}`, it.label, val, it.valueLabel || '', fmt);
    });
  });

  (data.statMatrices || []).forEach((m) => {
    (m.pairs || []).forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        pushRow(m.title || 'Operational Summary', pair[0], str(pair[1]));
      }
    });
  });

  (data.highlights || []).forEach((h) => {
    pushRow('Highlight', h.title || h.eyebrow || 'Spotlight', str(h.metric || ''), [h.eyebrow, h.detail].filter(Boolean).join(' — '));
  });

  (data.insights || []).forEach((ins) => {
    pushRow('Alert', ins.title || 'Notice', String(ins.severity || 'info').toUpperCase(), ins.detail || '');
  });

  if (!summaryRows.length) return null;

  const cols = [
    { header: 'Section', key: 'section', type: 'text', excelWidth: 22 },
    { header: 'Field / Metric', key: 'field', type: 'text', excelWidth: 28 },
    { header: 'Value', key: 'value', type: 'text', excelWidth: 28 },
    { header: 'Details', key: 'details', type: 'text', excelWidth: 42 }
  ];

  const ws = createCleanSheet(wb, uniqueSheetName(wb, 'Summary', 99), spec, cols.length);
  styleHeaderRow(ws, cols, theme);

  const maxLens = cols.map(() => 0);

  summaryRows.forEach((item, idx) => {
    const row = ws.getRow(idx + 2);
    const isZebra = idx % 2 === 1;
    const bgHex = isZebra ? COLORS.zebra : COLORS.white;

    const values = [item.section, item.field, item.value, item.details];
    values.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      const safeVal = typeof val === 'string' ? sanitizeExcelText(val) : val;
      cell.value = safeVal;
      if (cIdx === 2 && typeof safeVal === 'number' && item.numFmt) {
        cell.numFmt = item.numFmt;
      }
      const len = estimateCellDisplayLen(safeVal, typeof safeVal === 'number' ? 'number' : 'text');
      if (len > maxLens[cIdx]) maxLens[cIdx] = len;

      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(bgHex) } };
      cell.font = {
        name: F_BODY,
        size: 10,
        bold: cIdx === 0 || (cIdx === 2 && typeof val === 'number'),
        color: { argb: argb(cIdx === 0 ? (theme.primary || COLORS.navy) : COLORS.body) }
      };
      cell.alignment = {
        horizontal: typeof val === 'number' ? 'right' : 'left',
        vertical: 'middle',
        wrapText: true
      };
      cell.border = thinBorder();
    });
  });

  const widths = autoFitColumns(ws, cols, maxLens);
  summaryRows.forEach((item, idx) => {
    const values = [item.section, item.field, String(item.value ?? ''), item.details];
    let maxLines = 1;
    values.forEach((v, cIdx) => {
      const colW = Math.max(8, widths[cIdx] - 2);
      const lines = String(v || '').split('\n').reduce((acc, s) => acc + Math.max(1, Math.ceil(s.length / colW)), 0);
      if (lines > maxLines) maxLines = lines;
    });
    ws.getRow(idx + 2).height = Math.min(110, Math.max(20, maxLines * 15 + 6));
  });

  ws.autoFilter = `A1:D${summaryRows.length + 1}`;
  return ws;
}

/** Build a simple flat 4-column Chart Data sheet with numeric series values for Excel pivoting/charting. */
function buildChartDataSheet(wb, spec, charts, theme) {
  const rows = [];
  (charts || []).forEach((ch) => {
    const labels = ch?.labels || [];
    if (!labels.length) return;
    const seriesList = Array.isArray(ch.series) && ch.series.length
      ? ch.series
      : [{ name: ch.seriesName || 'Value', data: ch.values || [] }];

    seriesList.forEach((s) => {
      labels.forEach((lbl, idx) => {
        rows.push({
          chart: str(ch.title || 'Analytics'),
          category: str(lbl),
          series: str(s.name || 'Value'),
          value: toNumber((s.data || [])[idx], 0)
        });
      });
    });
  });

  if (!rows.length) return null;

  const table = {
    name: 'Chart Data',
    columns: [
      { header: 'Chart', key: 'chart', type: 'text', excelWidth: 28 },
      { header: 'Category', key: 'category', type: 'text', excelWidth: 24 },
      { header: 'Series', key: 'series', type: 'text', excelWidth: 20 },
      { header: 'Value', key: 'value', type: 'number', decimals: 2, excelWidth: 14 }
    ],
    rows
  };
  return writeDataTableSheet(wb, uniqueSheetName(wb, 'Chart Data', 98), table, spec, theme);
}

/** Build a clean 3-column Document sheet for Markdown / SOP content plus any embedded Markdown tables. */
function buildDocumentSheets(wb, spec, blocks, theme) {
  if (!blocks || !blocks.length) return;

  const docRows = [];
  const mdTables = [];
  let currentHeading = spec.title || 'Document';

  blocks.forEach((b) => {
    if (!b) return;
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      currentHeading = str(b.text);
      docRows.push({ type: b.type.toUpperCase(), section: currentHeading, content: currentHeading });
    } else if (b.type === 'paragraph' || b.type === 'quote') {
      docRows.push({ type: b.type === 'quote' ? 'Note' : 'Paragraph', section: currentHeading, content: str(b.text) });
    } else if (b.type === 'bullets' || b.type === 'ordered') {
      (b.items || []).forEach((it, idx) => {
        docRows.push({
          type: b.type === 'ordered' ? `Step ${idx + 1}` : 'Item',
          section: currentHeading,
          content: str(it.text)
        });
      });
    } else if (b.type === 'code') {
      docRows.push({ type: 'Code', section: currentHeading, content: str(b.content) });
    } else if (b.type === 'table' && Array.isArray(b.headers) && b.headers.length) {
      mdTables.push({
        name: `${currentHeading} Table`,
        columns: b.headers.map((h, i) => ({ header: str(h), key: `c${i}`, type: 'text' })),
        rows: (b.rows || []).map((r) => {
          const obj = {};
          b.headers.forEach((_, i) => { obj[`c${i}`] = str(r[i] ?? ''); });
          return obj;
        })
      });
    }
  });

  if (docRows.length) {
    writeDataTableSheet(
      wb,
      uniqueSheetName(wb, 'Document', 0),
      {
        columns: [
          { header: 'Type', key: 'type', type: 'text', excelWidth: 14 },
          { header: 'Section', key: 'section', type: 'text', excelWidth: 28 },
          { header: 'Content', key: 'content', type: 'text', excelWidth: 44 }
        ],
        rows: docRows
      },
      spec,
      theme
    );
  }

  mdTables.forEach((tbl, idx) => {
    writeDataTableSheet(wb, uniqueSheetName(wb, tbl.name, idx + 1), tbl, spec, theme);
  });
}

/** Build a clean, purely tabular ExcelJS Workbook from a normalized ReportSpec. */
function buildWorkbook(spec) {
  const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
  const data = collectSpecData(spec);

  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  wb.created = new Date(spec.meta?.generatedAt || Date.now());
  wb.modified = new Date();
  wb.properties.subject = spec.title || 'SMaRT Report';

  // 1. Primary Data Tables FIRST — immediate rows & columns starting at Row 1
  const tables = [...(data.tables || [])].sort(
    (a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
  );
  tables.forEach((table, idx) => {
    writeDataTableSheet(wb, uniqueSheetName(wb, table.name, idx), table, spec, theme);
  });

  // 2. Markdown / SOP Document sheets (if any)
  if (data.documentBlocks.length) {
    buildDocumentSheets(wb, spec, data.documentBlocks, theme);
  }

  // 3. Clean flat Summary sheet (Metadata, Filters, KPIs, Scorecards, Stat Matrices, Alerts)
  buildSummarySheet(wb, spec, data, theme);

  // 4. Clean flat Chart Data sheet (for pivot-ready chart numbers)
  buildChartDataSheet(wb, spec, data.charts, theme);

  // Ensure workbook always has at least 1 sheet
  if (!wb.worksheets.length) {
    writeDataTableSheet(wb, 'Data', { columns: [], rows: [] }, spec, theme);
  }

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

module.exports = { buildWorkbook, streamXlsx, sanitizeExcelText };
