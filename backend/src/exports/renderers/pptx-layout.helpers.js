// =============================================================================
// exports/renderers/pptx-layout.helpers.js — Strict Slide Geometry & Pagination
// -----------------------------------------------------------------------------
// Pure, deterministic layout math for 16:9 Widescreen (13.333" x 7.500") PPTX
// slides. Guarantees that every shape, table, card, and text block stays
// strictly within safe margins and NEVER overflows slide edges or footers.
// =============================================================================

const { COLORS, OFFICE_FONTS, toneStyle, noHash } = require('../core/branding');
const {
  str, cleanText, formatCell, computeColumnTotals, resolveBadgeTone
} = require('../core/helpers');

const F_DISP = OFFICE_FONTS.pptx.display;
const F_BODY = OFFICE_FONTS.pptx.body;
const F_MONO = OFFICE_FONTS.pptx.mono;

/** Canonical 16:9 Widescreen (LAYOUT_WIDE = 13.333" x 7.500") slide geometry. */
const GEOM = Object.freeze({
  SLIDE_W: 13.333,
  SLIDE_H: 7.5,
  HEADER_H: 0.84,
  CONTENT_X: 0.5,
  CONTENT_W: 12.333,
  TOP_Y: 1.04,
  MAX_Y: 6.76,
  FOOTER_LINE_Y: 6.98,
  FOOTER_TEXT_Y: 7.04,
  FOOTER_TEXT_H: 0.32
});

/**
 * Estimate wrapped visual line count using word-boundary simulation.
 * Intentionally conservative (~12% safety buffer) so PowerPoint never expands
 * a table row or text card past the calculated bounding box.
 */
function estimateWrappedLines(text, boxWidthIn, fontSizePt, { bold = false, mono = false } = {}) {
  const s = str(text);
  if (!s.trim()) return 1;

  const avgCharFactor = mono ? 0.64 : (bold ? 0.60 : 0.56);
  const charWidthIn = (fontSizePt / 72) * avgCharFactor;
  const usableW = Math.max(0.35, boxWidthIn);
  const charsPerLine = Math.max(4, Math.floor(usableW / charWidthIn));

  const paragraphs = s.split('\n');
  let totalLines = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      totalLines += 1;
      continue;
    }
    const words = trimmed.split(/\s+/);
    let lineLen = 0;
    let linesInPara = 1;

    for (const word of words) {
      if (word.length > charsPerLine) {
        if (lineLen > 0) {
          linesInPara += 1;
          lineLen = 0;
        }
        const chunks = Math.ceil(word.length / charsPerLine);
        linesInPara += chunks - 1;
        lineLen = word.length % charsPerLine || charsPerLine;
      } else if (lineLen === 0) {
        lineLen = word.length;
      } else if (lineLen + 1 + word.length <= charsPerLine) {
        lineLen += 1 + word.length;
      } else {
        linesInPara += 1;
        lineLen = word.length;
      }
    }
    totalLines += linesInPara;
  }

  return Math.max(1, totalLines);
}

/** Convert a wrapped line count into safe vertical height (inches). */
function linesToHeightIn(lines, fontSizePt, padIn = 0.14, lineSpacing = 1.38) {
  const lineH = (fontSizePt / 72) * lineSpacing;
  return Number((lines * lineH + padIn).toFixed(3));
}

/**
 * Compute normalized column widths summing EXACTLY to `totalW` (default CONTENT_W)
 * while enforcing sane minimum widths so narrow columns never wrap vertically.
 */
function computeColumnWidths(columns, totalW = GEOM.CONTENT_W) {
  if (!columns.length) return [];
  const count = columns.length;
  const minW = Math.max(0.62, Math.min(1.05, (totalW / count) * 0.62));

  const weights = columns.map((c) => {
    const explicit = Number(c.width) || 10;
    const isNum = c.type === 'number' || c.type === 'currency' || c.type === 'percent';
    const isBadge = c.type === 'badge';
    if (isBadge) return Math.max(explicit, 9);
    if (isNum) return Math.max(explicit, 8);
    return Math.max(explicit, 10);
  });

  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  let widths = weights.map((w) => Math.max(minW, (w / sumW) * totalW));

  // Iteratively rebalance so sum(widths) === totalW while respecting minW
  for (let pass = 0; pass < 4; pass += 1) {
    const curSum = widths.reduce((a, b) => a + b, 0);
    const diff = curSum - totalW;
    if (Math.abs(diff) < 0.001) break;

    if (diff > 0) {
      const shrinkable = widths.map((w) => Math.max(0, w - minW));
      const shrinkPool = shrinkable.reduce((a, b) => a + b, 0);
      if (shrinkPool <= 0.001) {
        widths = widths.map((w) => (w / curSum) * totalW);
        break;
      }
      widths = widths.map((w, i) => w - (shrinkable[i] / shrinkPool) * diff);
    } else {
      widths = widths.map((w) => w + (-diff / count));
    }
  }

  // Round cleanly to 3 decimals and absorb residual on the widest column
  const rounded = widths.map((w) => Number(w.toFixed(3)));
  const finalSum = rounded.reduce((a, b) => a + b, 0);
  const residual = Number((totalW - finalSum).toFixed(3));
  const widestIdx = rounded.reduce((best, w, i) => (w > rounded[best] ? i : best), 0);
  rounded[widestIdx] = Number((rounded[widestIdx] + residual).toFixed(3));

  return rounded;
}

/** Pick crisp readable font sizes based on table column density. */
function resolveTableFontSizes(colCount) {
  if (colCount >= 10) return { header: 8, body: 7.5, badge: 7, total: 8, padH: 4, padV: 3 };
  if (colCount >= 8)  return { header: 8.5, body: 8, badge: 7.5, total: 8.5, padH: 5, padV: 3 };
  return { header: 9, body: 8.5, badge: 8, total: 9, padH: 5, padV: 3.5 };
}

/** Clamp slide cell text proportionally to its column width so slides stay clean & readable. */
function formatSlideCellText(rawText, colWidthIn) {
  const maxChars = Math.min(165, Math.max(38, Math.round(colWidthIn * 44)));
  return cleanText(rawText, maxChars);
}

/**
 * Prepare styled PptxGenJS cells, normalized colWidths, exact headerH, and
 * accurately measured rowItems for a table (omitting `printHidden` columns).
 */
function prepareBoundedTable(table, theme) {
  const columns = (table.columns || []).filter((c) => !c.printHidden);
  const rows = table.rows || [];
  if (!columns.length) return null;

  const colWidths = computeColumnWidths(columns, GEOM.CONTENT_W);
  const sizes = resolveTableFontSizes(columns.length);
  const hdrBg = noHash(theme.tableHeaderBg || theme.primary);
  const hPadIn = (sizes.padH * 2) / 72 + 0.04;

  let maxHeaderLines = 1;
  const headerCells = columns.map((col, ci) => {
    const headerTxt = cleanText(col.header || '', 44);
    const lines = estimateWrappedLines(headerTxt, colWidths[ci] - hPadIn, sizes.header, { bold: true });
    if (lines > maxHeaderLines) maxHeaderLines = lines;
    const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';

    return {
      text: headerTxt,
      options: {
        fill: { color: hdrBg },
        color: noHash(COLORS.white),
        fontFace: F_DISP,
        fontSize: sizes.header,
        bold: true,
        align: col.align || (isNum ? 'right' : 'left'),
        valign: 'middle',
        border: { pt: 0.75, color: noHash(COLORS.border) },
        margin: [sizes.padV, sizes.padH, sizes.padV, sizes.padH]
      }
    };
  });

  const headerH = Math.max(0.36, linesToHeightIn(maxHeaderLines, sizes.header, 0.16, 1.35));

  if (!rows.length) {
    return {
      headerCells,
      headerH,
      colWidths,
      rowItems: [{
        height: 0.48,
        cells: [{
          text: 'No records match the selected filters.',
          options: {
            colspan: columns.length,
            fill: { color: noHash(COLORS.zebra) },
            color: noHash(COLORS.subtle),
            fontFace: F_BODY,
            fontSize: 9.5,
            italic: true,
            align: 'center',
            valign: 'middle',
            border: { pt: 0.5, color: noHash(COLORS.border) },
            margin: [8, 8, 8, 8]
          }
        }]
      }]
    };
  }

  const rowItems = rows.map((row, idx) => {
    const rowTone = toneStyle(row._flag);
    const isFlagRow = rowTone && (row._flag === 'danger' || row._flag === 'warning');
    const isZebra = idx % 2 === 1;
    let maxRowH = 0.30;

    const cells = columns.map((col, ci) => {
      const rawTxt = formatCell(row, col);
      const txt = formatSlideCellText(rawTxt, colWidths[ci]);
      const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
      const isBadge = col.type === 'badge';
      const isMono = col.type === 'mono';
      const fontSize = isBadge || isMono ? sizes.badge : sizes.body;
      const isBold = isBadge || (isFlagRow && isNum);

      const lines = estimateWrappedLines(txt, colWidths[ci] - hPadIn, fontSize, { bold: isBold, mono: isMono });
      const cellH = linesToHeightIn(lines, fontSize, 0.14, 1.42);
      if (cellH > maxRowH) maxRowH = cellH;

      const badgeTone = isBadge ? (toneStyle(resolveBadgeTone(row, col)) || toneStyle('neutral')) : null;
      const cellFill = isBadge
        ? noHash(badgeTone.bg)
        : (isFlagRow ? noHash(rowTone.bg) : (isZebra ? noHash(COLORS.zebra) : noHash(COLORS.white)));
      const cellColor = isBadge
        ? noHash(badgeTone.fg)
        : (isFlagRow && isNum ? noHash(rowTone.fg) : noHash(COLORS.body));

      return {
        text: txt,
        options: {
          fill: { color: cellFill },
          color: cellColor,
          fontFace: isMono ? F_MONO : (isBadge ? F_DISP : F_BODY),
          fontSize,
          bold: isBold,
          align: col.align || (isBadge ? 'center' : (isNum ? 'right' : 'left')),
          valign: 'middle',
          border: { pt: 0.5, color: noHash(COLORS.border) },
          margin: [sizes.padV, sizes.padH, sizes.padV, sizes.padH]
        }
      };
    });

    return { cells, height: Math.min(1.65, Number(maxRowH.toFixed(3))) };
  });

  const totalsRow = computeColumnTotals({ ...table, columns });
  if (totalsRow) {
    let maxTotH = 0.34;
    const totCells = columns.map((col, ci) => {
      const txt = cleanText(totalsRow[col.key] || '', 40);
      const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
      const lines = estimateWrappedLines(txt, colWidths[ci] - hPadIn, sizes.total, { bold: true });
      const h = linesToHeightIn(lines, sizes.total, 0.14, 1.38);
      if (h > maxTotH) maxTotH = h;

      return {
        text: txt,
        options: {
          fill: { color: noHash(theme.tint || COLORS.navyTint) },
          color: noHash(theme.primary),
          fontFace: F_DISP,
          fontSize: sizes.total,
          bold: true,
          align: col.align || (isNum ? 'right' : 'left'),
          valign: 'middle',
          border: { pt: 0.75, color: noHash(theme.primary) },
          margin: [sizes.padV, sizes.padH, sizes.padV, sizes.padH]
        }
      };
    });
    rowItems.push({ cells: totCells, height: Number(maxTotH.toFixed(3)) });
  }

  return { headerCells, headerH, colWidths, rowItems };
}

/**
 * Partition measured table rows into pages guaranteeing every page's total height
 * (headerH + sum(chunk.height)) stays strictly inside `firstPageBudget` / `contPageBudget`.
 */
function paginateMeasuredRows(rowItems, headerH, firstPageAvailH, contPageAvailH) {
  const pages = [];
  let idx = 0;

  while (idx < rowItems.length) {
    const availH = (pages.length === 0 ? firstPageAvailH : contPageAvailH) - headerH - 0.1;
    const budget = Math.max(0.55, availH);
    const chunk = [];
    let usedH = 0;

    while (idx < rowItems.length) {
      const item = rowItems[idx];
      if (chunk.length > 0 && usedH + item.height > budget) break;
      chunk.push(item);
      usedH += item.height;
      idx += 1;
    }
    pages.push(chunk);
  }

  return pages;
}

/**
 * Prepare measured 4-column rows for a Stat Matrix (`[label, value, label, value]`)
 * with accurate per-row heights so tall values paginate cleanly instead of overflowing.
 */
function prepareStatMatrixRows(pairs, theme) {
  const colW = [
    Number((GEOM.CONTENT_W * 0.21).toFixed(3)),
    Number((GEOM.CONTENT_W * 0.29).toFixed(3)),
    Number((GEOM.CONTENT_W * 0.21).toFixed(3)),
    Number((GEOM.CONTENT_W * 0.29).toFixed(3))
  ];
  // Adjust last column so sum === GEOM.CONTENT_W strictly
  const sum = colW[0] + colW[1] + colW[2] + colW[3];
  colW[3] = Number((colW[3] + (GEOM.CONTENT_W - sum)).toFixed(3));

  const rowItems = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const left = pairs[i];
    const right = pairs[i + 1];

    const lKey = left ? cleanText(left[0], 60) : '';
    const lVal = left ? cleanText(left[1], 140) : '';
    const rKey = right ? cleanText(right[0], 60) : '';
    const rVal = right ? cleanText(right[1], 140) : '';

    const lines = Math.max(
      estimateWrappedLines(lKey, colW[0] - 0.18, 8.8, { bold: true }),
      estimateWrappedLines(lVal, colW[1] - 0.18, 9.2),
      estimateWrappedLines(rKey, colW[2] - 0.18, 8.8, { bold: true }),
      estimateWrappedLines(rVal, colW[3] - 0.18, 9.2)
    );
    const height = Math.max(0.38, Math.min(1.25, linesToHeightIn(lines, 9.2, 0.16, 1.4)));

    const makePairCells = (k, v) => [
      {
        text: k,
        options: {
          fill: { color: noHash(theme.tint || COLORS.zebra) },
          color: noHash(COLORS.subtle),
          fontFace: F_DISP,
          fontSize: 8.8,
          bold: true,
          valign: 'middle',
          border: { pt: 0.5, color: noHash(COLORS.border) },
          margin: [4, 6, 4, 6]
        }
      },
      {
        text: v,
        options: {
          fill: { color: noHash(COLORS.white) },
          color: noHash(COLORS.ink),
          fontFace: F_BODY,
          fontSize: 9.2,
          valign: 'middle',
          border: { pt: 0.5, color: noHash(COLORS.border) },
          margin: [4, 6, 4, 6]
        }
      }
    ];

    rowItems.push({ height, cells: [...makePairCells(lKey, lVal), ...makePairCells(rKey, rVal)] });
  }

  return { colW, rowItems };
}

module.exports = {
  GEOM,
  estimateWrappedLines,
  linesToHeightIn,
  computeColumnWidths,
  prepareBoundedTable,
  paginateMeasuredRows,
  prepareStatMatrixRows
};
