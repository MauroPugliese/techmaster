// =============================================================================
// exports/renderers/docx.renderer.js — Multi-Page A4 Composable Word (.docx) v4
// -----------------------------------------------------------------------------
// Executes bespoke `spec.pages` blueprints in ISO A4 Portrait (`11906 x 16838`),
// keeping official CAE `diagonal-hero` Page 1 Cover clean (`titlePage: true`),
// filtering `printHidden` columns, and styling tables with Red Hat + Arial.
// =============================================================================

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, BorderStyle, Header, Footer,
  PageNumber, PageOrientation, VerticalAlign, ImageRun
} = require('docx');

const {
  COMPANY, COLORS, OFFICE_FONTS, toneStyle, noHash, getLogoBuffer
} = require('../core/branding');
const { resolveTheme } = require('../core/themes');
const {
  str, formatCell, computeColumnTotals, resolveBadgeTone, fmtNumber, fmtMoney, fmtPercent, toNumber, FORMAT_META
} = require('../core/helpers');
const {
  buildCoverPage,
  buildPageBanner,
  buildExecutiveBrief,
  buildThemedKpis,
  buildGaugeBand,
  buildScorecards,
  buildHighlights,
  buildStatMatrix,
  buildCardList,
  buildAlerts
} = require('./docx-sections');

const F_DISP = OFFICE_FONTS.docx.display;
const F_BODY = OFFICE_FONTS.docx.body;
const F_MONO = OFFICE_FONTS.docx.mono;

const noBorder = () => {
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return { top: none, bottom: none, left: none, right: none };
};

const subtleTableBorders = () => {
  const line = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return { top: line, bottom: line, left: none, right: none };
};

function mapAlign(align) {
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'center') return AlignmentType.CENTER;
  return AlignmentType.LEFT;
}

function formatChartVal(val, valueFormat) {
  const n = toNumber(val, 0);
  if (valueFormat === 'currency') return fmtMoney(n);
  if (valueFormat === 'percent') return fmtPercent(n, 1);
  if (valueFormat === 'hours') return `${n.toFixed(1)} h`;
  return Number.isInteger(n) ? fmtNumber(n, 0) : fmtNumber(n, 1);
}

/** Build a proportional OOXML data-bar table for any chart specification. */
function buildChartBlock(chart, theme) {
  if (!chart) return [];
  const pal = theme.chartPalette || [COLORS.accent];
  const out = [
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 35 },
      children: [new TextRun({ text: chart.title || 'Breakdown', bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    })
  ];
  if (chart.subtitle) {
    out.push(new Paragraph({
      spacing: { after: 55 },
      children: [new TextRun({ text: chart.subtitle, italics: true, font: F_BODY, size: 16, color: noHash(COLORS.subtle) })]
    }));
  }

  const labels = chart.labels || [];
  const series = Array.isArray(chart.series) && chart.series.length
    ? chart.series
    : [{ name: chart.seriesName || 'Value', data: chart.values || [], color: chart.color }];
  const primaryVals = (series[0]?.data || []).map((v) => toNumber(v, 0));
  const total = primaryVals.reduce((a, b) => a + Math.max(0, b), 0);
  const maxVal = Math.max(...primaryVals, 1);

  if (!labels.length || total <= 0) {
    out.push(new Paragraph({
      spacing: { after: 90 },
      children: [new TextRun({ text: 'No quantitative data available for the selected period.', italics: true, font: F_BODY, size: 17, color: noHash(COLORS.subtle) })]
    }));
    return out;
  }

  const barMaxChars = 22;
  const hdrBg = noHash(theme.tableHeaderBg || theme.primary);
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      makeCell('Category', { header: true, widthPct: 30, fill: hdrBg }),
      makeCell('Distribution', { header: true, widthPct: 38, fill: hdrBg }),
      makeCell(series[0]?.name || 'Value', { header: true, align: 'right', widthPct: 18, fill: hdrBg }),
      makeCell('Share', { header: true, align: 'right', widthPct: 14, fill: hdrBg })
    ]
  });

  const dataRows = labels.slice(0, 12).map((lbl, idx) => {
    const val = primaryVals[idx] || 0;
    const barColor = noHash(chart.colors?.[idx] || series[0]?.color || pal[idx % pal.length]);
    const filledBlocks = val > 0 ? Math.max(1, Math.round((val / maxVal) * barMaxChars)) : 0;
    const emptyBlocks = Math.max(0, barMaxChars - filledBlocks);
    const shareStr = total > 0 ? `${((val / total) * 100).toFixed(1)}%` : '0.0%';
    const zebra = idx % 2 === 1 ? noHash(COLORS.zebra) : undefined;

    const barCell = new TableCell({
      width: { size: 38, type: WidthType.PERCENTAGE },
      shading: zebra ? { fill: zebra } : undefined,
      verticalAlign: VerticalAlign.CENTER,
      borders: subtleTableBorders(),
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        spacing: { after: 0 },
        children: [
          new TextRun({ text: '█'.repeat(filledBlocks), font: F_MONO, size: 13, color: barColor }),
          ...(emptyBlocks > 0 ? [new TextRun({ text: '░'.repeat(emptyBlocks), font: F_MONO, size: 13, color: noHash(COLORS.border) })] : [])
        ]
      })]
    });

    return new TableRow({
      cantSplit: true,
      children: [
        makeCell(lbl, { fill: zebra, widthPct: 30, bold: true }),
        barCell,
        makeCell(formatChartVal(val, chart.valueFormat), { align: 'right', fill: zebra, widthPct: 18, bold: true }),
        makeCell(shareStr, { align: 'right', fill: zebra, widthPct: 14, color: noHash(COLORS.subtle) })
      ]
    });
  });

  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }));
  out.push(new Paragraph({ spacing: { after: 100 }, text: '' }));
  return out;
}

function buildDocumentBlocks(blocks, theme) {
  if (!blocks || !blocks.length) return [];
  const out = [];

  const runsToTextRuns = (runs = [], baseSize = 19) =>
    runs.map((r) => new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      font: r.code ? F_MONO : F_BODY,
      size: r.code ? 17 : baseSize,
      color: r.code ? noHash(COLORS.royal) : noHash(COLORS.body)
    }));

  blocks.forEach((b) => {
    switch (b.type) {
      case 'h1':
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: b.text, bold: true, font: F_DISP, size: 28, color: noHash(theme.primary) })]
        }));
        break;
      case 'h2':
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 160, after: 60 },
          children: [new TextRun({ text: b.text, bold: true, font: F_DISP, size: 24, color: noHash(COLORS.cobalt) })]
        }));
        break;
      case 'h3':
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: b.text, bold: true, font: F_DISP, size: 20, color: noHash(COLORS.royal) })]
        }));
        break;
      case 'paragraph':
        out.push(new Paragraph({
          spacing: { after: 100, line: 276 },
          children: b.runs?.length ? runsToTextRuns(b.runs) : [new TextRun({ text: b.text, font: F_BODY, size: 19, color: noHash(COLORS.body) })]
        }));
        break;
      case 'bullets':
        (b.items || []).forEach((item) => {
          out.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 55 },
            children: item.runs?.length ? runsToTextRuns(item.runs) : [new TextRun({ text: item.text, font: F_BODY, size: 19, color: noHash(COLORS.body) })]
          }));
        });
        break;
      case 'ordered':
        (b.items || []).forEach((item, idx) => {
          out.push(new Paragraph({
            spacing: { after: 55 },
            indent: { left: 360 },
            children: [
              new TextRun({ text: `${idx + 1}. `, bold: true, font: F_DISP, size: 19, color: noHash(theme.accent) }),
              ...(item.runs?.length ? runsToTextRuns(item.runs) : [new TextRun({ text: item.text, font: F_BODY, size: 19, color: noHash(COLORS.body) })])
            ]
          }));
        });
        break;
      case 'quote':
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({
            cantSplit: true,
            children: [new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { fill: noHash(theme.tint || COLORS.zebra) },
              borders: { ...noBorder(), left: { style: BorderStyle.SINGLE, size: 24, color: noHash(theme.accent) } },
              margins: { top: 85, bottom: 85, left: 150, right: 120 },
              children: [new Paragraph({
                spacing: { after: 0 },
                children: [new TextRun({ text: b.text, italics: true, font: F_BODY, size: 18, color: noHash(COLORS.ink) })]
              })]
            })]
          })]
        }));
        out.push(new Paragraph({ spacing: { after: 80 }, text: '' }));
        break;
      case 'code':
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({
            cantSplit: true,
            children: [new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { fill: noHash(COLORS.surface) },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.borderStrong) },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.borderStrong) },
                left: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.borderStrong) },
                right: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.borderStrong) }
              },
              margins: { top: 90, bottom: 90, left: 130, right: 130 },
              children: String(b.content || '').split('\n').map((line) => new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: line || ' ', font: F_MONO, size: 16, color: noHash(COLORS.ink) })]
              }))
            })]
          })]
        }));
        out.push(new Paragraph({ spacing: { after: 80 }, text: '' }));
        break;
      case 'divider':
        out.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: noHash(COLORS.border) } },
          spacing: { before: 70, after: 110 },
          text: ''
        }));
        break;
      case 'table':
        out.push(buildDataTable({
          columns: (b.headers || []).map((h, idx) => ({ header: h, key: `c${idx}`, width: 15 })),
          rows: (b.rows || []).map((r) => {
            const obj = {};
            r.forEach((cell, idx) => { obj[`c${idx}`] = cell; });
            return obj;
          })
        }, theme));
        out.push(new Paragraph({ spacing: { after: 90 }, text: '' }));
        break;
    }
  });

  return out;
}

function makeCell(text, { header = false, align = 'left', fill, color, widthPct, bold = false, mono = false, topBorder = null, bottomBorder = null } = {}) {
  const baseBorders = subtleTableBorders();
  if (topBorder) baseBorders.top = topBorder;
  if (bottomBorder) baseBorders.bottom = bottomBorder;

  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: fill ? { fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: baseBorders,
    margins: { top: 70, bottom: 70, left: 95, right: 95 },
    children: [new Paragraph({
      spacing: { after: 0 },
      alignment: mapAlign(align),
      children: [new TextRun({
        text: str(text),
        bold: header || bold,
        size: header ? 16 : (mono ? 14 : 16),
        font: header ? F_DISP : (mono ? F_MONO : F_BODY),
        color: color || (header ? noHash(COLORS.white) : noHash(COLORS.body))
      })]
    })]
  });
}

function buildDataTable(table, theme) {
  const columns = (table?.columns || []).filter((c) => !c.printHidden);
  const rows = table?.rows || [];
  if (!columns.length) return new Paragraph({ text: '' });

  const weights = columns.map((c) => c.docxWidth || c.width || 12);
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const pct = weights.map((w) => (w / totalW) * 100);
  const hdrBg = noHash(theme.tableHeaderBg || theme.primary);

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: columns.map((col, i) => makeCell(col.header, {
      header: true,
      align: col.align || ((col.type === 'number' || col.type === 'currency' || col.type === 'percent') ? 'right' : 'left'),
      fill: hdrBg,
      widthPct: pct[i],
      bottomBorder: { style: BorderStyle.SINGLE, size: 12, color: noHash(theme.accent) }
    }))
  });

  const dataRows = rows.length ? rows.map((row, idx) => {
    const rowTone = toneStyle(row._flag);
    const zebra = idx % 2 === 1 ? noHash(COLORS.zebra) : undefined;
    return new TableRow({
      cantSplit: true,
      children: columns.map((col, i) => {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        const isBadge = col.type === 'badge';
        const badgeTone = isBadge ? (toneStyle(resolveBadgeTone(row, col)) || toneStyle('neutral')) : null;
        return makeCell(formatCell(row, col), {
          align: col.align || (isBadge ? 'center' : (isNum ? 'right' : 'left')),
          fill: isBadge ? noHash(badgeTone.bg) : (rowTone && (row._flag === 'danger' || row._flag === 'warning') ? noHash(rowTone.bg) : zebra),
          color: isBadge ? noHash(badgeTone.fg) : (rowTone && isNum ? noHash(rowTone.fg) : undefined),
          bold: isBadge || (rowTone && isNum),
          mono: col.type === 'mono',
          widthPct: pct[i]
        });
      })
    });
  }) : [new TableRow({
    cantSplit: true,
    children: [new TableCell({
      columnSpan: columns.length,
      borders: subtleTableBorders(),
      margins: { top: 90, bottom: 90, left: 110, right: 110 },
      children: [new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({ text: 'No records match the selected filters.', italics: true, font: F_BODY, size: 17, color: noHash(COLORS.subtle) })]
      })]
    })]
  })];

  const allRows = [headerRow, ...dataRows];
  const totalsRow = computeColumnTotals({ ...table, columns });
  if (totalsRow) {
    allRows.push(new TableRow({
      cantSplit: true,
      children: columns.map((col, i) => {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        return makeCell(totalsRow[col.key] || '', {
          align: col.align || (isNum ? 'right' : 'left'),
          fill: noHash(theme.tint || COLORS.navyTint),
          color: noHash(theme.primary),
          bold: true,
          widthPct: pct[i],
          topBorder: { style: BorderStyle.SINGLE, size: 12, color: noHash(theme.primary) }
        });
      })
    }));
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: allRows });
}

function renderDocxBlock(block, page, theme) {
  switch (block.type) {
    case 'brief':
      return buildExecutiveBrief(block.title, block.text, theme);
    case 'kpis':
      return buildThemedKpis(block.items, block.variant || 'grid-2col', theme);
    case 'gaugeBand':
      return buildGaugeBand(block.items, theme);
    case 'scorecard':
      return buildScorecards(block, theme);
    case 'highlights':
      return buildHighlights(block.title, block.items, theme);
    case 'alerts':
      return buildAlerts(block.title, block.items, theme);
    case 'statMatrix':
      return buildStatMatrix(block.title, block.pairs, theme);
    case 'cardList':
      return buildCardList(block.title, block.items, theme);
    case 'chart':
      return buildChartBlock(block.chart, theme);
    case 'chartPair':
      return [
        ...buildChartBlock(block.left, theme),
        ...buildChartBlock(block.right, theme)
      ];
    case 'table': {
      const out = [];
      const showHdr = block.showHeading !== undefined
        ? block.showHeading
        : (block.table?.name && block.table.name !== page.title);
      if (showHdr && block.table?.name) {
        out.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: block.table.name, bold: true, font: F_DISP, size: 21, color: noHash(theme.primary) })]
        }));
      }
      if (showHdr && block.table?.note) {
        out.push(new Paragraph({
          spacing: { after: 50 },
          children: [new TextRun({ text: block.table.note, italics: true, font: F_BODY, size: 16, color: noHash(COLORS.subtle) })]
        }));
      }
      out.push(buildDataTable(block.table, theme));
      out.push(makeSpacer(90));
      return out;
    }
    case 'markdown':
      return buildDocumentBlocks(block.blocks, theme);
    default:
      return [];
  }
}

/** Strip trailing empty spacer paragraphs from a section so `pageBreakBefore` never creates blank pages. */
function trimTrailingEmptySpacer(items) {
  while (items.length > 0) {
    const last = items[items.length - 1];
    if (last && last.rootKey === 'w:p' && last._isEmptySpacer) {
      items.pop();
    } else {
      break;
    }
  }
  return items;
}

function makeSpacer(after = 80) {
  const p = new Paragraph({ spacing: { before: 0, after, line: 40 }, children: [new TextRun({ text: '', size: 4 })] });
  p._isEmptySpacer = true;
  return p;
}

/** Build a styled A4 Multi-Page docx Document from a normalised ReportSpec v5. */
function buildDocument(spec) {
  const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
  const children = [...buildCoverPage(spec, theme)];

  if (spec.pages && spec.pages.length) {
    const renderablePages = spec.pages.filter((p) => p && (p.title || (Array.isArray(p.blocks) && p.blocks.length > 0)));
    renderablePages.forEach((page, idx) => {
      trimTrailingEmptySpacer(children);
      if (page.title) {
        children.push(...buildPageBanner(idx + 1, page.eyebrow, page.title, page.subtitle, theme, true));
      } else {
        children.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, text: '' }));
      }
      const pageNodes = [];
      (page.blocks || []).forEach((block) => {
        pageNodes.push(...renderDocxBlock(block, page, theme));
      });
      trimTrailingEmptySpacer(pageNodes);
      children.push(...pageNodes);
    });
  } else {
    let sectionNum = 1;
    const hasExec = Boolean(
      spec.executiveBrief ||
      (spec.kpis && spec.kpis.length) ||
      (spec.scorecards && spec.scorecards.length) ||
      (spec.highlights && spec.highlights.length) ||
      (spec.insights && spec.insights.length)
    );
    if (hasExec) {
      children.push(...buildPageBanner(sectionNum++, 'SECTION 01 · OVERVIEW', 'Executive Overview', theme.coverTagline || '', theme, true));
      children.push(...buildExecutiveBrief('Executive Brief', spec.executiveBrief, theme));
      children.push(...buildThemedKpis(spec.kpis, 'grid-2col', theme));
      (spec.scorecards || []).forEach((sc) => children.push(...buildScorecards(sc, theme)));
      children.push(...buildHighlights(null, spec.highlights, theme));
      children.push(...buildAlerts('Key Insights & Alerts', spec.insights, theme));
    }
    if (spec.charts && spec.charts.length) {
      children.push(...buildPageBanner(sectionNum++, 'ANALYTICS', 'Visual Analytics', '', theme, true));
      spec.charts.forEach((ch) => children.push(...buildChartBlock(ch, theme)));
    }
    if (spec.documentBlocks && spec.documentBlocks.length) {
      children.push(...buildPageBanner(sectionNum++, 'DOCUMENT', spec.title, '', theme, true));
      children.push(...buildDocumentBlocks(spec.documentBlocks, theme));
    }
    const tables = [...(spec.tables || [])].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));
    tables.forEach((table, idx) => {
      children.push(...buildPageBanner(sectionNum++, 'DATA LEDGER', table.name || `Data ${idx + 1}`, table.note || '', theme, true));
      children.push(buildDataTable(table, theme));
      children.push(new Paragraph({ spacing: { after: 100 }, text: '' }));
    });
  }

  const darkLogo = getLogoBuffer('dark');
  const headerChildren = [new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: noHash(COLORS.border) } },
    children: [
      ...(darkLogo ? [new ImageRun({ data: darkLogo, transformation: { width: 64, height: 24 } })] : []),
      new TextRun({ text: `${darkLogo ? '   ' : ''}${theme.docCode}  ·  `, bold: true, font: F_DISP, size: 16, color: noHash(theme.accent) }),
      new TextRun({ text: spec.title, font: F_DISP, size: 16, color: noHash(COLORS.subtle) })
    ]
  })];

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: noHash(COLORS.border) } },
      children: [
        new TextRun({ text: `${COMPANY.name}  |  ${theme.docCode}  |  Page `, font: F_BODY, size: 14, color: noHash(COLORS.subtle) }),
        new TextRun({ children: [PageNumber.CURRENT], font: F_DISP, bold: true, size: 14, color: noHash(theme.primary) }),
        new TextRun({ text: ' of ', font: F_BODY, size: 14, color: noHash(COLORS.subtle) }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: F_DISP, bold: true, size: 14, color: noHash(theme.primary) })
      ]
    })]
  });

  const isLandscape = spec.orientation === 'landscape';

  return new Document({
    creator: COMPANY.name,
    title: spec.title,
    styles: {
      default: {
        document: {
          run: { font: F_BODY, size: 19, color: noHash(COLORS.body) },
          paragraph: { spacing: { after: 100, line: 260 } }
        },
        heading1: {
          run: { font: F_DISP, size: 32, bold: true, color: noHash(COLORS.cobalt) },
          paragraph: { spacing: { before: 120, after: 80 } }
        },
        heading2: {
          run: { font: F_DISP, size: 26, bold: true, color: noHash(COLORS.cobalt) },
          paragraph: { spacing: { before: 140, after: 60 } }
        },
        heading3: {
          run: { font: F_DISP, size: 22, bold: true, color: noHash(COLORS.royal) },
          paragraph: { spacing: { before: 120, after: 40 } }
        }
      }
    },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          margin: { top: 960, bottom: 960, left: 860, right: 860, header: 480, footer: 480 },
          size: isLandscape
            ? { width: 16838, height: 11906, orientation: PageOrientation.LANDSCAPE }
            : { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }
        }
      },
      headers: {
        first: new Header({ children: [] }),
        default: new Header({ children: headerChildren })
      },
      footers: {
        first: new Footer({ children: [] }),
        default: footer
      },
      children
    }]
  });
}

/** Stream a generated Word document to the Express response. */
async function streamDocx(spec, res, filename) {
  const doc = buildDocument(spec);
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', FORMAT_META.docx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(buffer);
}

module.exports = { buildDocument, streamDocx };
