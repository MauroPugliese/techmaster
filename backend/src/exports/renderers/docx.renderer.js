// =============================================================================
// exports/renderers/docx.renderer.js — Word (.docx) renderer
// -----------------------------------------------------------------------------
// Renders a ReportSpec into a styled Word document using the `docx` library:
//   • Running header (brand + report title) and footer (page X of Y)
//   • Title, subtitle, metadata / filter block and optional summary block
//   • Styled tables with shaded header rows, zebra striping, conditional flags
//   • Page orientation respected (portrait / landscape)
// =============================================================================

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, BorderStyle, Header, Footer,
  PageNumber, PageOrientation, VerticalAlign
} = require('docx');

const { COMPANY, COLORS, FONTS, noHash } = require('./../core/branding');
const { str, FORMAT_META } = require('../core/helpers');

const FONT = FONTS.docx;

const flagFill = (flag) => {
  switch (flag) {
    case 'danger':  return { fill: noHash(COLORS.dangerBg),  color: noHash(COLORS.dangerFg) };
    case 'success': return { fill: noHash(COLORS.successBg), color: noHash(COLORS.successFg) };
    case 'warning': return { fill: noHash(COLORS.warningBg), color: noHash(COLORS.warningFg) };
    case 'muted':   return { fill: noHash(COLORS.mutedBg),   color: noHash(COLORS.mutedFg) };
    default:        return null;
  }
};

const cellBorder = () => {
  const side = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  return { top: side, bottom: side, left: side, right: side };
};

/** A single table cell with shading, alignment and font colour. */
function makeCell(text, { header = false, align = 'left', fill, color, widthPct } = {}) {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: fill ? { fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorder(),
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: align === 'right' ? AlignmentType.RIGHT : align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({
        text: str(text),
        bold: header,
        size: header ? 17 : 16, // half-points (8.5pt / 8pt)
        font: FONT,
        color: color || (header ? noHash(COLORS.white) : noHash(COLORS.ink))
      })]
    })]
  });
}

/** Build one styled Table for a spec table definition. */
function buildTable(table) {
  const columns = table.columns || [];
  const rows = table.rows || [];

  const weights = columns.map((c) => c.docxWidth || c.width || 12);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const pct = weights.map((w) => (w / total) * 100);

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((col, i) => makeCell(col.header, {
      header: true, align: col.align, fill: noHash(COLORS.headerRow), widthPct: pct[i]
    }))
  });

  const dataRows = rows.length ? rows.map((row, idx) => {
    const flag = flagFill(row._flag);
    const zebra = !flag && idx % 2 === 1 ? noHash(COLORS.zebra) : undefined;
    return new TableRow({
      children: columns.map((col, i) => makeCell(row[col.key], {
        align: col.align,
        fill: flag ? flag.fill : zebra,
        color: flag ? flag.color : undefined,
        widthPct: pct[i]
      }))
    });
  }) : [new TableRow({
    children: [new TableCell({
      columnSpan: columns.length,
      borders: cellBorder(),
      children: [new Paragraph({ children: [new TextRun({ text: 'No records match the selected filters.', italics: true, font: FONT, size: 16, color: noHash(COLORS.subtle) })] })]
    })]
  })];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  });
}

/** Metadata / filter paragraphs shown below the title. */
function metaParagraphs(spec) {
  const meta = spec.meta || {};
  const lines = [['Generated', new Date().toLocaleString('en-GB')]];
  if (meta.generatedBy) lines.push(['By', meta.generatedBy]);
  (meta.filters || []).forEach((f) => lines.push([f.label, str(f.value)]));
  return lines.map(([label, value]) => new Paragraph({
    spacing: { after: 20 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: FONT, size: 16, color: noHash(COLORS.subtle) }),
      new TextRun({ text: str(value), font: FONT, size: 16, color: noHash(COLORS.ink) })
    ]
  }));
}

/** Summary block paragraphs. */
function summaryParagraphs(summary) {
  if (!summary || !summary.length) return [];
  const out = [new Paragraph({
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text: 'Summary', bold: true, font: FONT, size: 20, color: noHash(COLORS.ink) })]
  })];
  summary.forEach(({ label, value }) => out.push(new Paragraph({
    spacing: { after: 20 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: FONT, size: 16, color: noHash(COLORS.subtle) }),
      new TextRun({ text: str(value), font: FONT, size: 16, color: noHash(COLORS.ink) })
    ]
  })));
  return out;
}

/** Build a fully styled docx Document from a ReportSpec. */
function buildDocument(spec) {
  const tables = spec.tables && spec.tables.length ? spec.tables : [];

  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 60 },
      children: [new TextRun({ text: spec.title, bold: true, font: FONT, size: 32, color: noHash(COLORS.ink) })]
    })
  ];
  if (spec.subtitle) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: spec.subtitle, italics: true, font: FONT, size: 18, color: noHash(COLORS.subtle) })]
    }));
  }
  children.push(...metaParagraphs(spec));

  tables.forEach((table, idx) => {
    if (tables.length > 1) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: table.name || `Table ${idx + 1}`, bold: true, font: FONT, size: 24, color: noHash(COLORS.ink) })]
      }));
    } else {
      children.push(new Paragraph({ spacing: { after: 80 }, text: '' }));
    }
    children.push(...summaryParagraphs(table.summary));
    if (table.note) {
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: table.note, italics: true, font: FONT, size: 16, color: noHash(COLORS.subtle) })] }));
    }
    children.push(buildTable(table));
  });

  const header = new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: noHash(COLORS.border) } },
      children: [
        new TextRun({ text: `${COMPANY.mark}  ·  `, bold: true, font: FONT, size: 16, color: noHash(COLORS.accent) }),
        new TextRun({ text: spec.title, font: FONT, size: 16, color: noHash(COLORS.subtle) })
      ]
    })]
  });

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: noHash(COLORS.border) } },
      children: [
        new TextRun({ text: `${COMPANY.name}    |    Page `, font: FONT, size: 14, color: noHash(COLORS.subtle) }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: noHash(COLORS.subtle) }),
        new TextRun({ text: ' of ', font: FONT, size: 14, color: noHash(COLORS.subtle) }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: noHash(COLORS.subtle) })
      ]
    })]
  });

  return new Document({
    creator: COMPANY.name,
    title: spec.title,
    sections: [{
      properties: {
        page: {
          size: spec.orientation === 'landscape' ? { orientation: PageOrientation.LANDSCAPE } : { orientation: PageOrientation.PORTRAIT }
        }
      },
      headers: { default: header },
      footers: { default: footer },
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
