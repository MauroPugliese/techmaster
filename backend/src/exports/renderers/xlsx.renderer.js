// =============================================================================
// exports/renderers/xlsx.renderer.js — Official CAE Excel (.xlsx) Renderer v4
// -----------------------------------------------------------------------------
// Consumes both top-level specs and composable `spec.pages` blueprints:
//   • A4 Print Setup (`paperSize: 9`) with spec orientation
//   • Dedicated "Executive Summary" dashboard sheet (gridlines off, Brief, KPIs,
//     Scorecards, Spotlights, Insights, analytical breakdowns + ColorScale)
//   • Typography: Red Hat Display (Banners, KPIs, Headers, Totals), Arial (Data),
//     Courier New (SKUs / Monospace IDs)
//   • Preserves ALL dataset columns (including `printHidden: true` audit cols)
// =============================================================================

const ExcelJS = require('exceljs');
const {
  COMPANY, COLORS, OFFICE_FONTS, toneStyle, argb, getLogoBuffer
} = require('../core/branding');
const { resolveTheme } = require('../core/themes');
const { str, toNumber, resolveBadgeTone, FORMAT_META } = require('../core/helpers');

const F_DISP = OFFICE_FONTS.xlsx.display;
const F_BODY = OFFICE_FONTS.xlsx.body;
const F_MONO = OFFICE_FONTS.xlsx.mono;

const thinBorder = () => ({
  top:    { style: 'thin', color: { argb: argb(COLORS.border) } },
  left:   { style: 'thin', color: { argb: argb(COLORS.border) } },
  bottom: { style: 'thin', color: { argb: argb(COLORS.border) } },
  right:  { style: 'thin', color: { argb: argb(COLORS.border) } }
});

function extractAggregatedData(spec) {
  const briefParts = [];
  if (spec.executiveBrief) briefParts.push(spec.executiveBrief);
  const kpis = [...(spec.kpis || [])];
  const scorecards = [...(spec.scorecards || [])];
  const highlights = [...(spec.highlights || [])];
  const insights = [...(spec.insights || [])];
  const statMatrices = [];
  const charts = [...(spec.charts || [])];
  const tables = [...(spec.tables || [])];
  const documentBlocks = [...(spec.documentBlocks || [])];

  const seenTables = new Set(tables.map((t) => t.name).filter(Boolean));
  const seenCharts = new Set(charts.map((c) => c.title).filter(Boolean));

  (spec.pages || []).forEach((page) => {
    (page.blocks || []).forEach((block) => {
      if (block.type === 'brief' && block.text && !briefParts.includes(block.text)) briefParts.push(block.text);
      if (block.type === 'kpis' && Array.isArray(block.items) && block.includeInSummary !== false) {
        block.items.forEach((it) => { if (!kpis.some((k) => k.label === it.label)) kpis.push(it); });
      }
      if (block.type === 'gaugeBand' && Array.isArray(block.items) && !kpis.length) {
        block.items.forEach((it) => kpis.push({
          label: it.label,
          value: it.valueLabel || `${Number(it.percent || 0).toFixed(1)}%`,
          rawValue: Number(it.percent || 0),
          numFmt: '0.0"%"',
          sublabel: it.sublabel,
          tone: it.tone
        }));
      }
      if (block.type === 'scorecard' && block.items?.length && !scorecards.some((s) => s.title === block.title)) {
        scorecards.push({ title: block.title, subtitle: block.subtitle, items: block.items });
      }
      if (block.type === 'highlights') {
        (block.items || []).forEach((it) => { if (!highlights.some((h) => h.title === it.title)) highlights.push(it); });
      }
      if (block.type === 'cardList') {
        (block.items || []).forEach((it) => {
          if (!highlights.some((h) => h.title === it.title)) {
            highlights.push({ eyebrow: it.badge || block.title, metric: it.metric, title: it.title, detail: [it.meta, it.detail].filter(Boolean).join(' · '), tone: it.badgeTone || 'info' });
          }
        });
      }
      if (block.type === 'alerts') {
        (block.items || []).forEach((it) => { if (!insights.some((ins) => ins.title === it.title)) insights.push(it); });
      }
      if (block.type === 'statMatrix' && Array.isArray(block.pairs) && block.pairs.length) {
        statMatrices.push({ title: block.title || 'Control & Specification Summary', pairs: block.pairs });
      }
      if (block.type === 'chart' && block.chart && (!block.chart.title || !seenCharts.has(block.chart.title))) {
        charts.push(block.chart);
        if (block.chart.title) seenCharts.add(block.chart.title);
      }
      if (block.type === 'chartPair') {
        [block.left, block.right].filter(Boolean).forEach((ch) => {
          if (!ch.title || !seenCharts.has(ch.title)) {
            charts.push(ch);
            if (ch.title) seenCharts.add(ch.title);
          }
        });
      }
      if (block.type === 'table' && block.table && (!block.table.name || !seenTables.has(block.table.name))) {
        tables.push(block.table);
        if (block.table.name) seenTables.add(block.table.name);
      }
      if (block.type === 'markdown' && Array.isArray(block.blocks)) {
        block.blocks.forEach((mb) => documentBlocks.push(mb));
      }
    });
  });

  return { executiveBrief: briefParts[0] || '', kpis, scorecards, highlights, insights, statMatrices, charts, tables, documentBlocks };
}

function uniqueSheetName(wb, rawName, idx) {
  const base = String(rawName || `Sheet ${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim() || `Sheet ${idx + 1}`;
  let candidate = base.slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  return candidate;
}

function renderHeaderBlock(wb, ws, logoId, spec, colCount, theme, subtitleOverride = null) {
  const lastCol = Math.max(colCount, 6);
  const colLetter = (n) => ws.getColumn(n).letter;
  const span = (r) => `A${r}:${colLetter(lastCol)}${r}`;

  ws.mergeCells(span(1));
  const titleCell = ws.getCell('A1');
  titleCell.value = `[${theme.docCode || spec.docCode || 'CAE-RPT'}]  ${spec.title}`;
  titleCell.font = { name: F_DISP, size: 15, bold: true, color: { argb: argb(COLORS.white) } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.primary) } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: logoId !== null ? 9 : 1 };
  ws.getRow(1).height = 38;

  if (logoId !== null) {
    ws.addImage(logoId, {
      tl: { col: 0.14, row: 0.12 },
      ext: { width: 96, height: 36 },
      editAs: 'oneCell'
    });
  }

  let r = 2;
  const subtitle = subtitleOverride ?? spec.subtitle;
  if (subtitle) {
    ws.mergeCells(span(r));
    const sub = ws.getCell(`A${r}`);
    sub.value = subtitle;
    sub.font = { name: F_DISP, size: 10, italic: true, color: { argb: argb(COLORS.white) } };
    sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.navyLight) } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 22;
    r += 1;
  }

  const meta = spec.meta || {};
  const lines = [
    ['Generated', new Date(meta.generatedAt || Date.now()).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
    ...(meta.generatedBy ? [['Prepared By', meta.generatedBy]] : []),
    ...(meta.filters || []).map((f) => [f.label, str(f.value)])
  ];

  lines.forEach(([label, value]) => {
    const lblCell = ws.getCell(`A${r}`);
    lblCell.value = `${label}:`;
    lblCell.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.subtle) } };
    ws.mergeCells(`B${r}:${colLetter(lastCol)}${r}`);
    const valCell = ws.getCell(`B${r}`);
    valCell.value = value;
    valCell.font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.ink) } };
    ws.getRow(r).height = 18;
    r += 1;
  });

  return r + 1;
}

function buildExecutiveSummarySheet(wb, logoId, spec, data, theme) {
  const ws = wb.addWorksheet(uniqueSheetName(wb, 'Executive Summary', 0), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: spec.orientation === 'landscape' ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    },
    headerFooter: {
      oddFooter: `&L${COMPANY.name}&C&D &T&RPage &P of &N`,
      oddHeader: `&R&"${F_DISP}"&8${spec.title} — Executive Summary`
    }
  });

  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 22;
  ws.getColumn(6).width = 22;

  let row = renderHeaderBlock(wb, ws, logoId, spec, 6, theme);

  if (data.executiveBrief) {
    ws.mergeCells(`A${row}:F${row}`);
    const bCell = ws.getCell(`A${row}`);
    bCell.value = `EXECUTIVE BRIEF: ${data.executiveBrief}`;
    bCell.font = { name: F_BODY, size: 10, italic: true, color: { argb: argb(COLORS.ink) } };
    bCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.zebra) } };
    bCell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    bCell.border = { left: { style: 'thick', color: { argb: argb(theme.accent) } }, top: thinBorder().top, bottom: thinBorder().bottom, right: thinBorder().right };
    ws.getRow(row).height = Math.max(28, Math.ceil(data.executiveBrief.length / 105) * 16 + 10);
    row += 2;
  }

  if (data.kpis.length) {
    ws.mergeCells(`A${row}:F${row}`);
    const secHead = ws.getCell(`A${row}`);
    secHead.value = 'KEY PERFORMANCE INDICATORS';
    secHead.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
    ws.getRow(row).height = 22;
    row += 1;

    for (let i = 0; i < data.kpis.length; i += 6) {
      const chunk = data.kpis.slice(i, i + 6);
      chunk.forEach((k, ci) => {
        const col = ci + 1;
        const tone = toneStyle(k.tone);
        const topColor = argb(tone ? tone.accent : theme.accent);
        const valColor = argb(tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : theme.primary);
        const topBorder = { style: 'thick', color: { argb: topColor } };
        const sideBorder = { style: 'thin', color: { argb: argb(COLORS.border) } };

        const lblCell = ws.getRow(row).getCell(col);
        lblCell.value = String(k.label || '').toUpperCase();
        lblCell.font = { name: F_DISP, size: 8.5, bold: true, color: { argb: argb(COLORS.subtle) } };
        lblCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
        lblCell.border = { top: topBorder, left: sideBorder, right: sideBorder };
        lblCell.alignment = { vertical: 'middle', horizontal: 'left' };

        const valCell = ws.getRow(row + 1).getCell(col);
        if (k.rawValue !== undefined && k.rawValue !== null && Number.isFinite(Number(k.rawValue))) {
          valCell.value = Number(k.rawValue);
          if (k.numFmt) valCell.numFmt = k.numFmt;
        } else {
          valCell.value = str(k.value);
        }
        valCell.font = { name: F_DISP, size: 15, bold: true, color: { argb: valColor } };
        valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.white) } };
        valCell.border = { left: sideBorder, right: sideBorder };
        valCell.alignment = { vertical: 'middle', horizontal: 'left' };

        const subCell = ws.getRow(row + 2).getCell(col);
        subCell.value = k.sublabel ? str(k.sublabel) : '';
        subCell.font = { name: F_BODY, size: 8.5, color: { argb: argb(COLORS.subtle) } };
        subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
        subCell.border = { bottom: sideBorder, left: sideBorder, right: sideBorder };
        subCell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      ws.getRow(row).height = 20;
      ws.getRow(row + 1).height = 28;
      ws.getRow(row + 2).height = 18;
      row += 4;
    }
  }

  if (data.scorecards.length) {
    data.scorecards.forEach((group) => {
      ws.mergeCells(`A${row}:F${row}`);
      const sh = ws.getCell(`A${row}`);
      sh.value = String(group.title || 'HEALTH SCORECARD').toUpperCase();
      sh.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
      ws.getRow(row).height = 22;
      row += 1;

      const hdr = ws.getRow(row);
      hdr.getCell(1).value = 'Dimension';
      hdr.getCell(2).value = 'Score (%)';
      hdr.getCell(3).value = 'Display';
      ws.mergeCells(`D${row}:F${row}`);
      hdr.getCell(4).value = 'Assessment Details';
      for (let c = 1; c <= 6; c += 1) {
        hdr.getCell(c).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.white) } };
        hdr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tableHeaderBg || theme.primary) } };
        hdr.getCell(c).border = thinBorder();
      }
      hdr.height = 21;
      row += 1;

      const sStart = row;
      (group.items || []).forEach((item) => {
        const rObj = ws.getRow(row);
        const tone = toneStyle(item.tone);
        rObj.getCell(1).value = str(item.label);
        rObj.getCell(1).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.ink) } };
        rObj.getCell(1).border = thinBorder();

        rObj.getCell(2).value = Number((Number(item.percent) || 0).toFixed(1));
        rObj.getCell(2).numFmt = '0.0"%"';
        rObj.getCell(2).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(tone ? tone.fg : theme.primary) } };
        rObj.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
        rObj.getCell(2).border = thinBorder();

        rObj.getCell(3).value = str(item.valueLabel || '');
        rObj.getCell(3).font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.body) } };
        rObj.getCell(3).border = thinBorder();

        ws.mergeCells(`D${row}:F${row}`);
        rObj.getCell(4).value = str(item.detail || '');
        rObj.getCell(4).font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.subtle) } };
        for (let c = 4; c <= 6; c += 1) rObj.getCell(c).border = thinBorder();

        rObj.height = 20;
        row += 1;
      });
      if (row - 1 > sStart) {
        ws.addConditionalFormatting({
          ref: `B${sStart}:B${row - 1}`,
          rules: [{
            type: 'colorScale',
            priority: 1,
            cfvo: [{ type: 'min' }, { type: 'max' }],
            color: [{ argb: argb(COLORS.coral) }, { argb: argb(COLORS.teal) }]
          }]
        });
      }
      row += 1;
    });
  }

  if (data.highlights.length) {
    ws.mergeCells(`A${row}:F${row}`);
    const hlHead = ws.getCell(`A${row}`);
    hlHead.value = 'OPERATIONAL SPOTLIGHTS';
    hlHead.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
    ws.getRow(row).height = 22;
    row += 1;

    data.highlights.forEach((h) => {
      const tone = toneStyle(h.tone || 'info') || toneStyle('info');
      const rObj = ws.getRow(row);
      rObj.getCell(1).value = String(h.eyebrow || 'HIGHLIGHT').toUpperCase();
      rObj.getCell(1).font = { name: F_DISP, size: 9, bold: true, color: { argb: argb(tone.fg) } };
      rObj.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tone.bg) } };
      rObj.getCell(1).border = thinBorder();

      rObj.getCell(2).value = str(h.metric || '');
      rObj.getCell(2).font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(theme.primary) } };
      rObj.getCell(2).border = thinBorder();

      rObj.getCell(3).value = str(h.title);
      rObj.getCell(3).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.ink) } };
      rObj.getCell(3).border = thinBorder();

      ws.mergeCells(`D${row}:F${row}`);
      rObj.getCell(4).value = str(h.detail || '');
      rObj.getCell(4).font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.body) } };
      rObj.getCell(4).alignment = { wrapText: true, vertical: 'middle' };
      for (let c = 4; c <= 6; c += 1) rObj.getCell(c).border = thinBorder();

      rObj.height = 22;
      row += 1;
    });
    row += 1;
  }

  if (data.insights.length) {
    ws.mergeCells(`A${row}:F${row}`);
    const insHead = ws.getCell(`A${row}`);
    insHead.value = 'KEY INSIGHTS & PRIORITY ALERTS';
    insHead.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
    ws.getRow(row).height = 22;
    row += 1;

    const hRow = ws.getRow(row);
    hRow.getCell(1).value = 'Severity';
    hRow.getCell(2).value = 'Insight';
    ws.mergeCells(`C${row}:F${row}`);
    hRow.getCell(3).value = 'Details & Actionable Context';
    for (let c = 1; c <= 6; c += 1) {
      const cell = hRow.getCell(c);
      cell.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.white) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tableHeaderBg || theme.primary) } };
      cell.border = thinBorder();
    }
    hRow.height = 22;
    row += 1;

    data.insights.forEach((ins) => {
      const tone = toneStyle(ins.severity || 'info') || toneStyle('info');
      const rObj = ws.getRow(row);
      const sevCell = rObj.getCell(1);
      sevCell.value = String(ins.severity || 'info').toUpperCase();
      sevCell.font = { name: F_DISP, size: 9, bold: true, color: { argb: argb(tone.fg) } };
      sevCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tone.bg) } };
      sevCell.alignment = { vertical: 'middle', horizontal: 'center' };
      sevCell.border = thinBorder();

      const titleCell = rObj.getCell(2);
      titleCell.value = str(ins.title);
      titleCell.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.ink) } };
      titleCell.alignment = { vertical: 'middle', wrapText: true };
      titleCell.border = thinBorder();

      ws.mergeCells(`C${row}:F${row}`);
      const detailCell = rObj.getCell(3);
      detailCell.value = str(ins.detail);
      detailCell.font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.body) } };
      detailCell.alignment = { vertical: 'middle', wrapText: true };
      for (let c = 3; c <= 6; c += 1) rObj.getCell(c).border = thinBorder();

      const estLines = Math.max(1, Math.ceil(str(ins.detail).length / 80));
      rObj.height = Math.max(22, estLines * 15 + 8);
      row += 1;
    });
    row += 1;
  }

  if (data.statMatrices && data.statMatrices.length) {
    data.statMatrices.forEach((mat) => {
      ws.mergeCells(`A${row}:F${row}`);
      const mh = ws.getCell(`A${row}`);
      mh.value = String(mat.title || 'CONTROL & SPECIFICATION SUMMARY').toUpperCase();
      mh.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
      ws.getRow(row).height = 22;
      row += 1;

      const pairs = mat.pairs || [];
      for (let i = 0; i < pairs.length; i += 2) {
        const left = pairs[i];
        const right = pairs[i + 1];
        const rObj = ws.getRow(row);
        if (left) {
          rObj.getCell(1).value = str(left[0]);
          rObj.getCell(1).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.subtle) } };
          rObj.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
          rObj.getCell(1).border = thinBorder();
          ws.mergeCells(`B${row}:C${row}`);
          rObj.getCell(2).value = str(left[1]);
          rObj.getCell(2).font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.ink) } };
          rObj.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
          rObj.getCell(2).border = thinBorder();
          rObj.getCell(3).border = thinBorder();
        }
        if (right) {
          rObj.getCell(4).value = str(right[0]);
          rObj.getCell(4).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.subtle) } };
          rObj.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
          rObj.getCell(4).border = thinBorder();
          ws.mergeCells(`E${row}:F${row}`);
          rObj.getCell(5).value = str(right[1]);
          rObj.getCell(5).font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.ink) } };
          rObj.getCell(5).alignment = { wrapText: true, vertical: 'middle' };
          rObj.getCell(5).border = thinBorder();
          rObj.getCell(6).border = thinBorder();
        }
        rObj.height = 20;
        row += 1;
      }
      row += 1;
    });
  }

  if (data.charts.length) {
    ws.mergeCells(`A${row}:F${row}`);
    const cHead = ws.getCell(`A${row}`);
    cHead.value = 'ANALYTICAL BREAKDOWNS';
    cHead.font = { name: F_DISP, size: 11, bold: true, color: { argb: argb(theme.primary) } };
    ws.getRow(row).height = 22;
    row += 1;

    data.charts.forEach((chart) => {
      const labels = chart.labels || [];
      const seriesList = Array.isArray(chart.series) && chart.series.length
        ? chart.series
        : [{ name: chart.seriesName || 'Value', data: chart.values || [] }];
      if (!labels.length || !seriesList.length) return;

      ws.mergeCells(`A${row}:D${row}`);
      const tTitle = ws.getCell(`A${row}`);
      tTitle.value = chart.title || 'Breakdown';
      tTitle.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(theme.primary) } };
      ws.getRow(row).height = 20;
      row += 1;

      const isSingleSeries = seriesList.length === 1;
      const headers = ['Category', ...seriesList.map((s) => s.name || 'Value'), ...(isSingleSeries ? ['Share (%)'] : [])];
      const hdrRow = ws.getRow(row);
      headers.forEach((h, i) => {
        const cell = hdrRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(COLORS.white) } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tableHeaderBg || COLORS.navyLight) } };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' };
        cell.border = thinBorder();
      });
      hdrRow.height = 20;
      row += 1;

      const dataStart = row;
      const dataEnd = dataStart + labels.length - 1;
      const valFormat = chart.valueFormat === 'currency'
        ? '$#,##0.00'
        : (chart.valueFormat === 'percent' ? '0.0"%"' : '#,##0.##');

      labels.forEach((lbl, li) => {
        const rObj = ws.getRow(row);
        const c0 = rObj.getCell(1);
        c0.value = str(lbl);
        c0.font = { name: F_BODY, size: 9.5, bold: true, color: { argb: argb(COLORS.ink) } };
        c0.border = thinBorder();
        if (li % 2 === 1) c0.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };

        seriesList.forEach((s, si) => {
          const vc = rObj.getCell(si + 2);
          vc.value = toNumber(s.data?.[li], 0);
          vc.numFmt = valFormat;
          vc.font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.body) } };
          vc.alignment = { vertical: 'middle', horizontal: 'right' };
          vc.border = thinBorder();
          if (li % 2 === 1) vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
        });

        if (isSingleSeries) {
          const sc = rObj.getCell(3);
          sc.value = { formula: `IF(SUM($B$${dataStart}:$B$${dataEnd})=0,0,B${row}/SUM($B$${dataStart}:$B$${dataEnd}))` };
          sc.numFmt = '0.0%';
          sc.font = { name: F_BODY, size: 9.5, color: { argb: argb(COLORS.subtle) } };
          sc.alignment = { vertical: 'middle', horizontal: 'right' };
          sc.border = thinBorder();
          if (li % 2 === 1) sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
        }
        rObj.height = 19;
        row += 1;
      });

      const totRow = ws.getRow(row);
      totRow.getCell(1).value = 'Total';
      totRow.getCell(1).font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(theme.primary) } };
      totRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.navyTint) } };
      totRow.getCell(1).border = thinBorder();

      seriesList.forEach((_, si) => {
        const colLet = ws.getColumn(si + 2).letter;
        const tc = totRow.getCell(si + 2);
        tc.value = { formula: `SUM(${colLet}${dataStart}:${colLet}${dataEnd})` };
        tc.numFmt = valFormat;
        tc.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(theme.primary) } };
        tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.navyTint) } };
        tc.alignment = { vertical: 'middle', horizontal: 'right' };
        tc.border = thinBorder();
      });

      if (isSingleSeries) {
        const sc = totRow.getCell(3);
        sc.value = { formula: `SUM(C${dataStart}:C${dataEnd})` };
        sc.numFmt = '0.0%';
        sc.font = { name: F_DISP, size: 9.5, bold: true, color: { argb: argb(theme.primary) } };
        sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.navyTint) } };
        sc.alignment = { vertical: 'middle', horizontal: 'right' };
        sc.border = thinBorder();

        if (dataEnd > dataStart) {
          ws.addConditionalFormatting({
            ref: `B${dataStart}:B${dataEnd}`,
            rules: [{
              type: 'colorScale',
              priority: 1,
              cfvo: [{ type: 'min' }, { type: 'max' }],
              color: [{ argb: argb(COLORS.white) }, { argb: argb(COLORS.infoBorder) }]
            }]
          });
        }
      }

      totRow.height = 20;
      row += 2;
    });
  }
}

function buildDocumentSheet(wb, logoId, spec, blocks, theme) {
  const ws = wb.addWorksheet(uniqueSheetName(wb, 'Article Content', 1), {
    views: [{ showGridLines: true }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 92;

  let row = renderHeaderBlock(wb, ws, logoId, spec, 2, theme);

  const hdr = ws.getRow(row);
  hdr.getCell(1).value = 'Section / Type';
  hdr.getCell(2).value = 'Content';
  [1, 2].forEach((ci) => {
    const c = hdr.getCell(ci);
    c.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(COLORS.white) } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.primary) } };
    c.border = thinBorder();
  });
  hdr.height = 22;
  row += 1;

  blocks.forEach((b) => {
    if (b.type === 'divider') return;
    let label = b.type.toUpperCase();
    let content = b.text || b.content || '';
    if (b.type === 'bullets' || b.type === 'ordered') {
      content = (b.items || []).map((it, idx) => (b.type === 'ordered' ? `${idx + 1}. ${it.text}` : `• ${it.text}`)).join('\n');
    } else if (b.type === 'table') {
      label = 'TABLE';
      content = [(b.headers || []).join(' | '), ...(b.rows || []).map((r) => r.join(' | '))].join('\n');
    }

    const rObj = ws.getRow(row);
    const c1 = rObj.getCell(1);
    c1.value = label;
    c1.font = { name: F_DISP, size: 9, bold: true, color: { argb: argb(theme.primary) } };
    c1.alignment = { vertical: 'top', horizontal: 'left' };
    c1.border = thinBorder();

    const c2 = rObj.getCell(2);
    c2.value = content;
    c2.font = {
      name: b.type === 'code' ? F_MONO : (b.type.startsWith('h') ? F_DISP : F_BODY),
      size: b.type === 'h1' ? 12 : (b.type === 'h2' ? 11 : 10),
      bold: b.type.startsWith('h'),
      color: { argb: argb(b.type.startsWith('h') ? theme.primary : COLORS.body) }
    };
    c2.alignment = { vertical: 'top', wrapText: true };
    c2.border = thinBorder();
    if (b.type === 'code' || b.type === 'quote') {
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
    }

    const lineCount = Math.max(content.split('\n').length, Math.ceil(content.length / 86));
    rObj.height = Math.max(20, Math.min(260, lineCount * 14.5 + 8));
    row += 1;
  });
}

function defaultNumFmt(col) {
  if (col.numFmt) return col.numFmt;
  if (col.type === 'currency') return '$#,##0.00';
  if (col.type === 'percent') return '0.0"%"';
  if (col.type === 'number') return '#,##0.##';
  return null;
}

/** Render full dataset table (including `printHidden` columns) onto an Excel worksheet. */
function renderTable(ws, table, startRow, theme) {
  const columns = table.columns || [];
  const rows = table.rows || [];
  if (!columns.length) return startRow;

  const headerRow = ws.getRow(startRow);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
    cell.value = col.header;
    cell.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(COLORS.white) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tableHeaderBg || theme.primary) } };
    cell.alignment = { vertical: 'middle', horizontal: col.align || (isNum ? 'right' : 'left'), wrapText: true };
    cell.border = {
      ...thinBorder(),
      bottom: { style: 'medium', color: { argb: argb(theme.accent) } }
    };
  });
  headerRow.height = 24;

  const maxRawWidth = columns.reduce((mx, c) => Math.max(mx, Number(c.width) || 0), 0);
  const isPointScale = maxRawWidth > 55;
  const widths = columns.map((c) => {
    const rawW = Number(c.width) || 0;
    const baseW = rawW > 0
      ? (isPointScale ? Math.round(rawW / 5.4) : rawW)
      : (String(c.header || '').length + 4);
    return Math.min(42, Math.max(10, baseW));
  });
  const dataStartRow = startRow + 1;

  rows.forEach((row, rIdx) => {
    const xlRow = ws.getRow(dataStartRow + rIdx);
    const rowTone = toneStyle(row._flag);
    const zebra = rIdx % 2 === 1;
    let maxLines = 1;

    columns.forEach((col, i) => {
      const cell = xlRow.getCell(i + 1);
      const raw = row[col.key];
      const isNumType = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
      const isBadge = col.type === 'badge';

      if (raw === null || raw === undefined || raw === '') {
        cell.value = '—';
      } else if (isNumType && Number.isFinite(Number(raw))) {
        cell.value = Number(raw);
        const fmt = defaultNumFmt(col);
        if (fmt) cell.numFmt = fmt;
      } else {
        cell.value = str(raw);
      }

      const badgeTone = isBadge ? (toneStyle(resolveBadgeTone(row, col)) || toneStyle('neutral')) : null;
      const fontColor = isBadge
        ? argb(badgeTone.fg)
        : (rowTone && isNumType ? argb(rowTone.fg) : argb(COLORS.body));

      cell.font = {
        name: col.type === 'mono' ? F_MONO : (isBadge ? F_DISP : F_BODY),
        size: col.type === 'mono' ? 9 : 9.5,
        bold: isBadge || Boolean(rowTone && isNumType),
        color: { argb: fontColor }
      };

      cell.alignment = {
        vertical: 'middle',
        horizontal: col.align || (isBadge ? 'center' : (isNumType ? 'right' : 'left')),
        wrapText: col.wrap !== false
      };
      cell.border = thinBorder();

      if (isBadge) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(badgeTone.bg) } };
      } else if (rowTone && (row._flag === 'danger' || row._flag === 'warning')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(rowTone.bg) } };
      } else if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(COLORS.zebra) } };
      }

      const textLen = String(cell.value ?? '').length;
      const colW = Math.min(48, Math.max(widths[i], Math.min(44, textLen + 3)));
      widths[i] = colW;
      if (col.wrap !== false) {
        const lines = Math.max(1, Math.ceil(textLen / Math.max(12, widths[i] - 2)));
        if (lines > maxLines) maxLines = lines;
      }
    });

    xlRow.height = Math.max(20, Math.min(110, maxLines * 14.5 + 7));
  });

  columns.forEach((_, i) => {
    ws.getColumn(i + 1).width = Math.min(48, Math.max(9, widths[i]));
  });

  ws.views = [{ state: 'frozen', ySplit: startRow }];
  if (columns.length) {
    ws.autoFilter = {
      from: { row: startRow, column: 1 },
      to:   { row: startRow + rows.length, column: columns.length }
    };
  }

  let nextRow = dataStartRow + rows.length;

  if (rows.length > 0 && columns.some((c) => c.total)) {
    const dataEndRow = dataStartRow + rows.length - 1;
    const totRow = ws.getRow(nextRow);
    let labelPlaced = false;

    columns.forEach((col, i) => {
      const cell = totRow.getCell(i + 1);
      const colLet = ws.getColumn(i + 1).letter;
      const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';

      if (col.total === 'label' || (i === 0 && !col.total && !labelPlaced)) {
        cell.value = col.totalLabel || `TOTAL (${rows.length})`;
        labelPlaced = true;
      } else if (col.total === 'sum') {
        cell.value = { formula: `SUM(${colLet}${dataStartRow}:${colLet}${dataEndRow})` };
      } else if (col.total === 'avg') {
        cell.value = { formula: `AVERAGE(${colLet}${dataStartRow}:${colLet}${dataEndRow})` };
      } else if (col.total === 'count') {
        cell.value = { formula: `COUNTA(${colLet}${dataStartRow}:${colLet}${dataEndRow})` };
      } else {
        cell.value = '';
      }

      const fmt = defaultNumFmt(col);
      if (fmt && col.total && col.total !== 'label') cell.numFmt = fmt;

      cell.font = { name: F_DISP, size: 10, bold: true, color: { argb: argb(theme.primary) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(theme.tint || COLORS.navyTint) } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || (isNum ? 'right' : 'left') };
      cell.border = {
        ...thinBorder(),
        top: { style: 'medium', color: { argb: argb(theme.primary) } }
      };
    });

    totRow.height = 22;
    nextRow += 1;
  }

  if (rows.length > 1) {
    const dataEndRow = dataStartRow + rows.length - 1;
    columns.forEach((col, i) => {
      if (!col.dataBar) return;
      const colLet = ws.getColumn(i + 1).letter;
      ws.addConditionalFormatting({
        ref: `${colLet}${dataStartRow}:${colLet}${dataEndRow}`,
        rules: [{
          type: 'colorScale',
          priority: 1,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: argb(COLORS.white) }, { argb: argb(COLORS.accentSoft) }]
        }]
      });
    });
  }

  return nextRow;
}

/** Build a fully styled ExcelJS workbook from a normalised ReportSpec v4. */
function buildWorkbook(spec) {
  const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
  const data = extractAggregatedData(spec);

  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  wb.created = new Date();
  wb.title = spec.title;

  const logoBuf = getLogoBuffer('light');
  const logoId = logoBuf ? wb.addImage({ buffer: logoBuf, extension: 'png' }) : null;

  const hasExecSummary = Boolean(
    data.executiveBrief ||
    data.kpis.length ||
    data.scorecards.length ||
    data.highlights.length ||
    data.insights.length ||
    (data.statMatrices && data.statMatrices.length) ||
    data.charts.length
  );

  if (hasExecSummary) {
    buildExecutiveSummarySheet(wb, logoId, spec, data, theme);
  }

  if (data.documentBlocks.length) {
    buildDocumentSheet(wb, logoId, spec, data.documentBlocks, theme);
  }

  const tables = [...data.tables].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));

  if (!tables.length && !hasExecSummary && !data.documentBlocks.length) {
    tables.push({ name: 'Report', columns: [], rows: [] });
  }

  tables.forEach((table, idx) => {
    const ws = wb.addWorksheet(uniqueSheetName(wb, table.name, idx), {
      pageSetup: {
        paperSize: 9,
        orientation: spec.orientation === 'landscape' ? 'landscape' : 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
      },
      headerFooter: {
        oddFooter: `&L${COMPANY.name}&C&D &T&RPage &P of &N`,
        oddHeader: `&R&"${F_DISP}"&8${spec.title}`
      }
    });

    const colCount = (table.columns || []).length;
    let row = renderHeaderBlock(wb, ws, logoId, spec, colCount, theme);
    if (table.note) {
      ws.getCell(`A${row}`).value = table.note;
      ws.getCell(`A${row}`).font = { name: F_BODY, size: 9.5, italic: true, color: { argb: argb(COLORS.subtle) } };
      row += 2;
    }
    renderTable(ws, table, row, theme);
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
