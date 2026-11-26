// =============================================================================
// exports/renderers/pptx.renderer.js — Executive Widescreen PowerPoint (.pptx) v5
// -----------------------------------------------------------------------------
// Built strictly for 16:9 Widescreen (`LAYOUT_WIDE` = 13.333" x 7.500"):
//   • Zero out-of-bounds shapes, tables, charts, or footer collisions
//   • Measured word-wrap row heights with explicit `rowH` arrays on all tables
//   • Automatic multi-slide pagination for tables, stat matrices, alerts,
//     scorecards, highlights, and Markdown documents (including MD tables)
//   • Native editable OOXML charts with clean label clamping & adaptive legends
// =============================================================================

const PptxGenJS = require('pptxgenjs');
const {
  COMPANY, COLORS, CHART_PALETTE, OFFICE_FONTS, toneStyle, noHash, getLogoBase64
} = require('../core/branding');
const { resolveTheme } = require('../core/themes');
const { collectSpecData } = require('../core/spec-collector');
const { str, cleanText, toNumber, FORMAT_META } = require('../core/helpers');
const {
  GEOM,
  estimateWrappedLines,
  linesToHeightIn,
  prepareBoundedTable,
  paginateMeasuredRows,
  prepareStatMatrixRows
} = require('./pptx-layout.helpers');

const F_HERO = OFFICE_FONTS.pptx.hero;
const F_DISP = OFFICE_FONTS.pptx.display;
const F_BODY = OFFICE_FONTS.pptx.body;
const F_MONO = OFFICE_FONTS.pptx.mono;

const {
  SLIDE_W, SLIDE_H, HEADER_H, CONTENT_X, CONTENT_W,
  TOP_Y, MAX_Y, FOOTER_LINE_Y, FOOTER_TEXT_Y, FOOTER_TEXT_H
} = GEOM;

function hasChartData(chart) {
  const labels = chart?.labels || [];
  if (!labels.length) return false;
  if (Array.isArray(chart.series) && chart.series.length) {
    return chart.series.some((s) => (s.data || []).some((v) => toNumber(v, 0) > 0));
  }
  if (Array.isArray(chart.values)) {
    return chart.values.some((v) => toNumber(v, 0) > 0);
  }
  return false;
}

/** Build Slide 1: Balanced 16:9 Widescreen Corporate Navy Cover Slide. */
function buildCoverSlide(pptx, spec, theme) {
  const slide = pptx.addSlide();
  slide.background = { color: noHash(theme.primary) };

  // Right architectural accent column (10.65 + 2.683 = 13.333" exact)
  slide.addShape('rect', {
    x: 10.65, y: 0, w: 2.683, h: SLIDE_H,
    fill: { color: noHash(COLORS.navyLight) },
    line: { width: 0 }
  });
  slide.addShape('rect', {
    x: 10.65, y: 0, w: 0.09, h: SLIDE_H,
    fill: { color: noHash(theme.accent) },
    line: { width: 0 }
  });
  slide.addShape('rect', {
    x: 10.74, y: 0, w: 0.04, h: SLIDE_H,
    fill: { color: noHash(theme.secondary || COLORS.cyan) },
    line: { width: 0 }
  });

  // Right panel executive dossier metadata
  const docCode = cleanText(spec.docCode || theme.docCode || 'CAE-RPT', 18);
  const reportType = cleanText(theme.reportType || spec.category || 'Operational Report', 48);
  slide.addText('DOCUMENT CONTROL', {
    x: 10.98, y: 5.05, w: 2.1, h: 0.24,
    fontFace: F_DISP, fontSize: 8, bold: true, color: noHash(theme.secondary || COLORS.cyan)
  });
  slide.addText(docCode, {
    x: 10.98, y: 5.30, w: 2.1, h: 0.34,
    fontFace: F_MONO, fontSize: 13, bold: true, color: noHash(COLORS.white)
  });
  slide.addShape('line', {
    x: 10.98, y: 5.72, w: 1.9, h: 0,
    line: { color: noHash(theme.accent), width: 1.25 }
  });
  slide.addText(reportType, {
    x: 10.98, y: 5.84, w: 2.1, h: 0.56,
    fontFace: F_BODY, fontSize: 9, color: 'CBD5E1', valign: 'top'
  });
  slide.addText(cleanText(spec.meta?.confidentiality || COMPANY.confidentiality, 44), {
    x: 10.98, y: 6.62, w: 2.1, h: 0.44,
    fontFace: F_BODY, fontSize: 8, color: '94A3B8', valign: 'top'
  });

  // Top bar inside left hero zone (x = 0.78 .. 10.22)
  const logoLight = getLogoBase64('light');
  if (logoLight) {
    slide.addImage({ data: logoLight, x: 0.78, y: 0.50, w: 2.04, h: 0.76 });
  }

  const periodInfo = spec.meta?.period;
  const periodLabel = periodInfo && periodInfo.type && periodInfo.type !== 'all'
    ? cleanText(String(periodInfo.label || '').toUpperCase(), 32)
    : '';

  if (periodLabel) {
    slide.addShape('roundRect', {
      x: 5.30, y: 0.62, w: 2.80, h: 0.36,
      fill: { color: noHash(theme.accent) },
      line: { width: 0 },
      rectRadius: 0.05
    });
    slide.addText(periodLabel, {
      x: 5.34, y: 0.64, w: 2.72, h: 0.32,
      fontFace: F_DISP,
      fontSize: periodLabel.length > 22 ? 8 : 9,
      bold: true,
      color: noHash(COLORS.white),
      align: 'center',
      valign: 'middle'
    });
  }

  slide.addText(docCode, {
    x: 8.20, y: 0.64, w: 2.02, h: 0.34,
    fontFace: F_MONO, fontSize: 10.5, bold: true, color: noHash(theme.secondary || COLORS.cyan), align: 'right'
  });

  // Eyebrow + Main Title
  slide.addText(cleanText(String(spec.category || 'OPERATIONS INTELLIGENCE').toUpperCase(), 64), {
    x: 0.78, y: 1.56, w: 9.44, h: 0.30,
    fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.secondary || COLORS.cyan)
  });

  const titleText = cleanText(spec.title || 'Operational Report', 110);
  const titleSize = titleText.length > 62 ? 23 : (titleText.length > 42 ? 26 : 30);
  const titleLines = Math.min(3, estimateWrappedLines(titleText, 9.44, titleSize));
  const titleH = Math.min(1.42, linesToHeightIn(titleLines, titleSize, 0.14, 1.24));

  slide.addText(titleText, {
    x: 0.78, y: 1.92, w: 9.44, h: titleH,
    fontFace: F_HERO, fontSize: titleSize, bold: false, color: noHash(COLORS.white), valign: 'top'
  });

  let curY = 1.92 + titleH + 0.10;

  if (spec.subtitle) {
    const subText = cleanText(spec.subtitle, 155);
    const subLines = Math.min(2, estimateWrappedLines(subText, 9.44, 12.5));
    const subH = Math.min(0.62, linesToHeightIn(subLines, 12.5, 0.10, 1.28));
    slide.addText(subText, {
      x: 0.78, y: curY, w: 9.44, h: subH,
      fontFace: F_DISP, fontSize: 12.5, color: 'CBD5E1', valign: 'top'
    });
    curY += subH + 0.14;
  }

  slide.addShape('line', {
    x: 0.78, y: curY, w: 3.3, h: 0,
    line: { color: noHash(theme.accent), width: 3.2 }
  });
  curY += 0.26;

  // Cover Highlight Cards (strictly above metadata band y = 6.08)
  if (spec.coverHighlights && spec.coverHighlights.length && curY + 0.96 <= 5.98) {
    const shown = spec.coverHighlights.slice(0, 3);
    const gap = 0.22;
    const hw = Number((Math.min(3.0, (9.44 - gap * (shown.length - 1)) / shown.length)).toFixed(3));
    const cardH = 0.96;

    shown.forEach((h, idx) => {
      const hx = Number((0.78 + idx * (hw + gap)).toFixed(3));
      const lbl = cleanText(String(h.label || '').toUpperCase(), 30);
      const val = cleanText(str(h.value), 26);
      const valFont = val.length > 16 ? 12.5 : (val.length > 10 ? 15 : 17.5);

      slide.addShape('roundRect', {
        x: hx, y: curY, w: hw, h: cardH,
        fill: { color: noHash(COLORS.navyLight) },
        line: { color: noHash(theme.accent), width: 1 },
        rectRadius: 0.05
      });
      slide.addText(lbl, {
        x: hx + 0.14, y: curY + 0.10, w: hw - 0.28, h: 0.24,
        fontFace: F_DISP, fontSize: 7.8, bold: true, color: 'CBD5E1'
      });
      slide.addText(val, {
        x: hx + 0.14, y: curY + 0.36, w: hw - 0.28, h: 0.46,
        fontFace: F_DISP, fontSize: valFont, bold: true, color: noHash(COLORS.white), valign: 'middle'
      });
    });
  }

  // Metadata + Tagline anchored safely inside bottom zone (y <= 7.26 < 7.50)
  const meta = spec.meta || {};
  const generatedStr = new Date(meta.generatedAt || Date.now()).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });
  const metaParts = [
    `Generated: ${generatedStr}`,
    meta.generatedBy ? `Prepared By: ${meta.generatedBy}` : null,
    meta.filters?.length
      ? meta.filters.slice(0, 3).map((f) => `${f.label}: ${str(f.value)}`).join(' · ')
      : null
  ].filter(Boolean);

  slide.addText(cleanText(metaParts.join('   |   '), 185), {
    x: 0.78, y: 6.12, w: 9.44, h: 0.56,
    fontFace: F_BODY, fontSize: 9.5, color: '94A3B8', valign: 'bottom'
  });

  slide.addText(cleanText(`${COMPANY.name}  —  ${theme.coverTagline || COMPANY.tagline}`, 115), {
    x: 0.78, y: 6.92, w: 9.44, h: 0.30,
    fontFace: F_BODY, fontSize: 8.8, color: '64748B'
  });
}

/** Add consistent widescreen header & footer chrome to every interior slide. */
function addSlideChrome(slide, spec, theme, titleSuffix = '') {
  slide.background = { color: noHash(COLORS.white) };

  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: HEADER_H,
    fill: { color: noHash(theme.primary) },
    line: { width: 0 }
  });

  const logoLight = getLogoBase64('light');
  if (logoLight) {
    slide.addImage({ data: logoLight, x: 0.48, y: 0.14, w: 1.44, h: 0.54 });
  }

  const rawTitle = `${spec.title || 'Report'}${titleSuffix ? `  —  ${titleSuffix}` : ''}`;
  const headerTitle = cleanText(rawTitle, 82);
  const hdrFont = headerTitle.length > 58 ? 12 : 14;
  const titleX = logoLight ? 2.10 : CONTENT_X;
  const titleW = Number((11.18 - titleX).toFixed(3));

  slide.addText(headerTitle, {
    x: titleX, y: 0.16, w: titleW, h: 0.52,
    fontFace: F_DISP, fontSize: hdrFont, bold: true, color: noHash(COLORS.white), valign: 'middle'
  });

  slide.addText(cleanText(spec.docCode || theme.docCode || 'CAE-RPT', 18), {
    x: 11.28, y: 0.22, w: 1.553, h: 0.38,
    fontFace: F_MONO, fontSize: 9.5, bold: true, color: noHash(theme.secondary || COLORS.cyan), align: 'right', valign: 'middle'
  });

  slide.addShape('line', {
    x: 0, y: HEADER_H, w: SLIDE_W, h: 0,
    line: { color: noHash(theme.accent), width: 2.5 }
  });

  slide.addShape('line', {
    x: CONTENT_X, y: FOOTER_LINE_Y, w: CONTENT_W, h: 0,
    line: { color: noHash(COLORS.border), width: 1 }
  });

  slide.addText(cleanText(`${COMPANY.name}   |   ${spec.meta?.confidentiality || COMPANY.confidentiality}`, 96), {
    x: CONTENT_X, y: FOOTER_TEXT_Y, w: 8.80, h: FOOTER_TEXT_H,
    fontFace: F_BODY, fontSize: 8.5, color: noHash(COLORS.subtle), valign: 'middle'
  });

  return slide;
}

/** Render a horizontal row of up to 5 KPI cards strictly inside CONTENT_W. */
function renderKpiRow(slide, kpis, startY, theme) {
  if (!kpis || !kpis.length) return startY;
  const shown = kpis.slice(0, 5);
  const gap = 0.2;
  const cardW = Number(((CONTENT_W - gap * (shown.length - 1)) / shown.length).toFixed(3));
  const cardH = 1.04;

  shown.forEach((item, i) => {
    const cx = Number((CONTENT_X + i * (cardW + gap)).toFixed(3));
    const tone = toneStyle(item.tone);
    const accentHex = tone ? noHash(tone.accent) : noHash(theme.accent);
    const valHex = tone && (item.tone === 'danger' || item.tone === 'warning')
      ? noHash(tone.fg)
      : noHash(theme.primary);

    slide.addShape('roundRect', {
      x: cx, y: startY, w: cardW, h: cardH,
      fill: { color: noHash(COLORS.zebra) },
      line: { color: noHash(COLORS.border), width: 1 },
      rectRadius: 0.06
    });
    slide.addShape('rect', {
      x: cx + 0.02, y: startY, w: Number((cardW - 0.04).toFixed(3)), h: 0.05,
      fill: { color: accentHex },
      line: { width: 0 }
    });
    slide.addText(cleanText(str(item.label).toUpperCase(), 32), {
      x: cx + 0.12, y: startY + 0.10, w: cardW - 0.24, h: 0.24,
      fontFace: F_DISP, fontSize: 7.8, bold: true, color: noHash(COLORS.subtle), valign: 'middle'
    });

    const valStr = cleanText(str(item.value), 22);
    const valSize = valStr.length > 14 ? 12.5 : (valStr.length > 9 ? 15.5 : 19.5);
    slide.addText(valStr, {
      x: cx + 0.12, y: startY + 0.34, w: cardW - 0.24, h: 0.40,
      fontFace: F_DISP, fontSize: valSize, bold: true, color: valHex, valign: 'middle'
    });

    if (item.sublabel) {
      slide.addText(cleanText(str(item.sublabel), 38), {
        x: cx + 0.12, y: startY + 0.76, w: cardW - 0.24, h: 0.22,
        fontFace: F_BODY, fontSize: 7.8, color: noHash(COLORS.subtle), valign: 'middle'
      });
    }
  });

  return Number((startY + cardH + 0.22).toFixed(3));
}

/** Render a bounded grid of alert/insight cards strictly inside [startY .. MAX_Y]. */
function renderAlertGrid(slide, items, startY, theme) {
  const cols = items.length > 2 ? 2 : 1;
  const gapX = 0.24;
  const gapY = 0.16;
  const cardW = cols === 2 ? Number(((CONTENT_W - gapX) / 2).toFixed(3)) : CONTENT_W;
  const rows = Math.ceil(items.length / cols);
  const availH = MAX_Y - startY - (rows - 1) * gapY;
  const cardH = Number(Math.min(1.65, Math.max(0.84, availH / rows)).toFixed(3));
  const detailLimit = cols === 2 ? Math.round(cardH * 140) : Math.round(cardH * 240);

  items.forEach((ins, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ix = Number((CONTENT_X + col * (cardW + gapX)).toFixed(3));
    const iy = Number((startY + row * (cardH + gapY)).toFixed(3));
    if (iy + cardH > MAX_Y + 0.01) return;

    const tone = toneStyle(ins.severity || 'info') || toneStyle('info');
    slide.addShape('roundRect', {
      x: ix, y: iy, w: cardW, h: cardH,
      fill: { color: noHash(tone.bg) },
      line: { color: noHash(tone.border), width: 1 },
      rectRadius: 0.06
    });
    slide.addShape('rect', {
      x: ix, y: iy + 0.04, w: 0.07, h: Number((cardH - 0.08).toFixed(3)),
      fill: { color: noHash(tone.accent) },
      line: { width: 0 }
    });
    slide.addText(cleanText(str(ins.title), cols === 2 ? 62 : 110), {
      x: ix + 0.18, y: iy + 0.08, w: Number((cardW - 0.30).toFixed(3)), h: 0.28,
      fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(tone.fg), valign: 'middle'
    });
    if (ins.detail && cardH >= 0.72) {
      slide.addText(cleanText(str(ins.detail), Math.max(85, detailLimit)), {
        x: ix + 0.18, y: iy + 0.38, w: Number((cardW - 0.30).toFixed(3)), h: Number((cardH - 0.44).toFixed(3)),
        fontFace: F_BODY, fontSize: 9, color: noHash(COLORS.body), valign: 'top'
      });
    }
  });
}

/** Build Executive Overview slide (+ overflow Priority Alerts slide(s) if needed). */
function buildExecutiveOverviewSlides(pptx, spec, data, theme, contentSlides) {
  const { executiveBrief, kpis, insights } = data;
  if (!kpis.length && !insights.length && !executiveBrief) return;

  const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Executive Overview');
  contentSlides.push(slide);
  let y = TOP_Y;

  if (executiveBrief) {
    const briefTxt = cleanText(executiveBrief, 360);
    const lines = Math.min(4, estimateWrappedLines(briefTxt, CONTENT_W - 0.32, 10));
    const briefH = Math.min(1.18, Math.max(0.68, linesToHeightIn(lines, 10, 0.22, 1.38)));

    slide.addShape('roundRect', {
      x: CONTENT_X, y, w: CONTENT_W, h: briefH,
      fill: { color: noHash(theme.tint || COLORS.zebra) },
      line: { color: noHash(COLORS.border), width: 0.75 },
      rectRadius: 0.05
    });
    slide.addShape('rect', {
      x: CONTENT_X, y, w: 0.07, h: briefH,
      fill: { color: noHash(theme.accent) },
      line: { width: 0 }
    });
    slide.addText(briefTxt, {
      x: CONTENT_X + 0.18, y: y + 0.06, w: Number((CONTENT_W - 0.30).toFixed(3)), h: Number((briefH - 0.12).toFixed(3)),
      fontFace: F_BODY, fontSize: 9.8, color: noHash(COLORS.body), valign: 'middle'
    });
    y = Number((y + briefH + 0.20).toFixed(3));
  }

  if (kpis.length) {
    y = renderKpiRow(slide, kpis.slice(0, 5), y, theme);
    if (kpis.length > 5 && !insights.length && y + 1.04 <= MAX_Y) {
      y = renderKpiRow(slide, kpis.slice(5, 10), y, theme);
    }
  }

  if (insights.length) {
    const remainingH = MAX_Y - y;
    const inlineCount = remainingH >= 2.75 ? 4 : (remainingH >= 1.55 ? 2 : 0);

    if (inlineCount > 0) {
      slide.addText('KEY INSIGHTS & PRIORITY ALERTS', {
        x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
        fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(theme.primary)
      });
      y = Number((y + 0.32).toFixed(3));
      renderAlertGrid(slide, insights.slice(0, inlineCount), y, theme);
    }

    // Paginate any remaining insights onto clean dedicated slides (4 per slide)
    let cursor = inlineCount;
    let pageIdx = 1;
    while (cursor < insights.length) {
      const chunk = insights.slice(cursor, cursor + 4);
      const suffix = pageIdx === 1 && inlineCount === 0
        ? 'Priority Alerts & Escalations'
        : `Priority Alerts & Escalations (${pageIdx + (inlineCount > 0 ? 1 : 0)})`;
      const alertSlide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
      contentSlides.push(alertSlide);
      alertSlide.addText('KEY INSIGHTS & PRIORITY ALERTS', {
        x: CONTENT_X, y: TOP_Y, w: CONTENT_W, h: 0.28,
        fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
      });
      renderAlertGrid(alertSlide, chunk, TOP_Y + 0.34, theme);
      cursor += 4;
      pageIdx += 1;
    }
  }
}

/** Render a scorecard section starting at `startY`, returning the new Y cursor. */
function drawScorecardGroup(slide, title, items, startY, theme) {
  let y = startY;
  slide.addText(cleanText(String(title || 'HEALTH SCORECARD').toUpperCase(), 75), {
    x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
    fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
  });
  y = Number((y + 0.34).toFixed(3));

  items.forEach((it) => {
    const pctVal = Math.max(0, Math.min(100, Number(it.percent) || 0));
    const tone = toneStyle(it.tone);
    const barHex = noHash(tone ? tone.accent : theme.accent);

    slide.addText(cleanText(str(it.label), 60), {
      x: CONTENT_X, y, w: 7.4, h: 0.24,
      fontFace: F_DISP, fontSize: 9.8, bold: true, color: noHash(COLORS.ink)
    });
    slide.addText(cleanText(str(it.valueLabel || `${pctVal.toFixed(1)}%`), 32), {
      x: 8.1, y, w: 4.733, h: 0.24,
      fontFace: F_DISP, fontSize: 9.8, bold: true, color: noHash(tone ? tone.fg : theme.primary), align: 'right'
    });
    slide.addShape('roundRect', {
      x: CONTENT_X, y: y + 0.26, w: CONTENT_W, h: 0.12,
      fill: { color: noHash(COLORS.surface) }, line: { width: 0 }, rectRadius: 0.04
    });
    if (pctVal > 0) {
      const fillW = Number(Math.min(CONTENT_W, Math.max(0.16, (CONTENT_W * pctVal) / 100)).toFixed(3));
      slide.addShape('roundRect', {
        x: CONTENT_X, y: y + 0.26, w: fillW, h: 0.12,
        fill: { color: barHex }, line: { width: 0 }, rectRadius: 0.04
      });
    }
    y = Number((y + 0.49).toFixed(3));
  });

  return Number((y + 0.16).toFixed(3));
}

/** Render a bounded 2-column grid of operational highlight cards. */
function drawHighlightCards(slide, items, startY, theme) {
  slide.addText('OPERATIONAL SPOTLIGHTS', {
    x: CONTENT_X, y: startY, w: CONTENT_W, h: 0.28,
    fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
  });
  const gridY = Number((startY + 0.34).toFixed(3));
  const gapX = 0.22;
  const gapY = 0.16;
  const cw = Number(((CONTENT_W - gapX) / 2).toFixed(3));
  const rows = Math.ceil(items.length / 2);
  const availH = MAX_Y - gridY - (rows - 1) * gapY;
  const ch = Number(Math.min(1.42, Math.max(0.96, availH / rows)).toFixed(3));

  items.forEach((h, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const hx = Number((CONTENT_X + col * (cw + gapX)).toFixed(3));
    const hy = Number((gridY + row * (ch + gapY)).toFixed(3));
    if (hy + ch > MAX_Y + 0.01) return;

    const tone = toneStyle(h.tone || 'info') || toneStyle('info');
    slide.addShape('roundRect', {
      x: hx, y: hy, w: cw, h: ch,
      fill: { color: noHash(COLORS.white) },
      line: { color: noHash(COLORS.border), width: 1 },
      rectRadius: 0.05
    });
    slide.addShape('rect', {
      x: hx, y: hy + 0.04, w: 0.07, h: Number((ch - 0.08).toFixed(3)),
      fill: { color: noHash(tone.accent) }, line: { width: 0 }
    });
    slide.addText(cleanText(String(h.eyebrow || 'HIGHLIGHT').toUpperCase(), 32), {
      x: hx + 0.16, y: hy + 0.08, w: Number((cw * 0.56).toFixed(3)), h: 0.22,
      fontFace: F_DISP, fontSize: 7.8, bold: true, color: noHash(tone.fg)
    });
    if (h.metric) {
      slide.addText(cleanText(str(h.metric), 22), {
        x: Number((hx + cw * 0.58).toFixed(3)), y: hy + 0.07, w: Number((cw * 0.38).toFixed(3)), h: 0.24,
        fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary), align: 'right'
      });
    }
    slide.addText(cleanText(str(h.title), 54), {
      x: hx + 0.16, y: hy + 0.32, w: Number((cw - 0.28).toFixed(3)), h: 0.26,
      fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(COLORS.ink)
    });
    if (h.detail) {
      slide.addText(cleanText(str(h.detail), Math.round((ch - 0.58) * 165)), {
        x: hx + 0.16, y: hy + 0.58, w: Number((cw - 0.28).toFixed(3)), h: Number((ch - 0.64).toFixed(3)),
        fontFace: F_BODY, fontSize: 8.6, color: noHash(COLORS.body), valign: 'top'
      });
    }
  });
}

/** Build Health Scorecards & Operational Highlights slides (combining ONLY when comfortably bounded). */
function buildScorecardsAndHighlightsSlides(pptx, spec, data, theme, contentSlides) {
  const { scorecards, highlights } = data;
  if (!scorecards.length && !highlights.length) return;

  const canCombine =
    scorecards.length === 1 &&
    highlights.length > 0 &&
    (scorecards[0].items || []).length <= 5 &&
    highlights.length <= 4 &&
    (0.34 + (scorecards[0].items || []).length * 0.49 + 0.16 + 0.34 + Math.ceil(highlights.length / 2) * 1.16) <= (MAX_Y - TOP_Y);

  if (canCombine) {
    const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Health Scorecards & Highlights');
    contentSlides.push(slide);
    const nextY = drawScorecardGroup(slide, scorecards[0].title, scorecards[0].items || [], TOP_Y, theme);
    drawHighlightCards(slide, highlights, nextY, theme);
    return;
  }

  // Render every scorecard cleanly (max 9 bars per slide)
  scorecards.forEach((group) => {
    const items = group.items || [];
    for (let i = 0; i < items.length; i += 9) {
      const chunk = items.slice(i, i + 9);
      const suffix = i === 0 ? (group.title || 'Health Scorecard') : `${group.title || 'Health Scorecard'} (Cont.)`;
      const slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
      contentSlides.push(slide);
      drawScorecardGroup(slide, group.title, chunk, TOP_Y, theme);
    }
  });

  // Render every operational highlight cleanly (max 6 cards per slide in 2x3 grid)
  for (let i = 0; i < highlights.length; i += 6) {
    const chunk = highlights.slice(i, i + 6);
    const suffix = i === 0 ? 'Operational Spotlights' : `Operational Spotlights (${Math.floor(i / 6) + 1})`;
    const slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
    contentSlides.push(slide);
    drawHighlightCards(slide, chunk, TOP_Y, theme);
  }
}

/** Render a bounded native OOXML chart inside a clean rounded container card. */
function renderChartBox(pptx, slide, chart, x, y, w, h, theme, isFull) {
  const pal = theme.chartPalette || CHART_PALETTE;

  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: noHash(COLORS.white) },
    line: { color: noHash(COLORS.border), width: 1 },
    rectRadius: 0.06
  });
  slide.addShape('rect', {
    x: x + 0.15, y, w: 0.85, h: 0.05,
    fill: { color: noHash(theme.accent) }, line: { width: 0 }
  });
  slide.addText(cleanText(chart.title || 'Analytics Chart', isFull ? 76 : 44), {
    x: x + 0.18, y: y + 0.12, w: Number((w - 0.36).toFixed(3)), h: 0.30,
    fontFace: F_DISP, fontSize: 11.5, bold: true, color: noHash(theme.primary), valign: 'middle'
  });

  if (chart.subtitle) {
    slide.addText(cleanText(chart.subtitle, isFull ? 115 : 64), {
      x: x + 0.18, y: y + 0.42, w: Number((w - 0.36).toFixed(3)), h: 0.22,
      fontFace: F_BODY, fontSize: 8.5, color: noHash(COLORS.subtle), valign: 'middle'
    });
  }

  const chartTop = Number((y + (chart.subtitle ? 0.70 : 0.50)).toFixed(3));
  const chartH = Number((h - (chart.subtitle ? 0.82 : 0.62)).toFixed(3));

  if (!hasChartData(chart)) {
    slide.addText('No quantitative data available for the selected period.', {
      x: x + 0.30, y: Number((chartTop + chartH * 0.38).toFixed(3)),
      w: Number((w - 0.60).toFixed(3)), h: 0.50,
      fontFace: F_BODY, fontSize: 10.5, italic: true, color: noHash(COLORS.subtle), align: 'center'
    });
    return;
  }

  const maxCats = isFull ? 14 : 10;
  const maxLblLen = isFull ? 26 : 18;
  const rawLabels = (chart.labels || []).slice(0, maxCats);
  const labels = rawLabels.map((l) => cleanText(str(l), maxLblLen));

  const seriesList = Array.isArray(chart.series) && chart.series.length
    ? chart.series
    : [{ name: chart.seriesName || 'Value', data: chart.values || [] }];

  const chartData = seriesList.map((s) => ({
    name: cleanText(s.name || 'Series', 24),
    labels,
    values: (s.data || []).slice(0, maxCats).map((v) => toNumber(v, 0))
  }));

  const palette = (chart.colors && chart.colors.length)
    ? chart.colors.map(noHash)
    : seriesList.map((s, i) => (s.color ? noHash(s.color) : noHash(pal[i % pal.length])));

  const isDonut = chart.type === 'donut' || chart.type === 'pie';
  const fullPalette = (isDonut || (seriesList.length === 1 && !chart.colors))
    ? labels.map((_, i) => noHash(chart.colors?.[i] || pal[i % pal.length]))
    : palette;

  const baseOpts = {
    x: Number((x + 0.14).toFixed(3)),
    y: chartTop,
    w: Number((w - 0.28).toFixed(3)),
    h: chartH,
    chartColors: fullPalette,
    showTitle: false,
    showLegend: isDonut || seriesList.length > 1,
    legendFontFace: F_BODY,
    legendFontSize: 8,
    legendColor: noHash(COLORS.body),
    catAxisLabelFontFace: F_BODY,
    catAxisLabelFontSize: 8,
    catAxisLabelColor: noHash(COLORS.subtle),
    valAxisLabelFontFace: F_BODY,
    valAxisLabelFontSize: 8,
    valAxisLabelColor: noHash(COLORS.subtle),
    valGridLine: { color: noHash(COLORS.border), size: 0.5 }
  };

  if (isDonut) {
    slide.addChart(pptx.ChartType.doughnut, chartData, {
      ...baseOpts,
      holeSize: 54,
      legendPos: isFull ? 'r' : 'b',
      showPercent: true,
      showValue: false,
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8,
      dataLabelColor: noHash(COLORS.white)
    });
  } else if (chart.type === 'hbar' || chart.type === 'horizontalBar' || chart.type === 'lollipop') {
    slide.addChart(pptx.ChartType.bar, chartData, {
      ...baseOpts,
      barDir: 'bar',
      barGrouping: 'clustered',
      legendPos: 't',
      showValue: seriesList.length === 1,
      dataLabelPosition: 'outEnd',
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8,
      dataLabelColor: noHash(theme.primary),
      catGridLine: { style: 'none' }
    });
  } else if (chart.type === 'line' || chart.type === 'area') {
    slide.addChart(pptx.ChartType.line, chartData, {
      ...baseOpts,
      legendPos: 't',
      lineSize: 2.25,
      lineSmooth: true,
      lineDataSymbol: 'circle',
      lineDataSymbolSize: 5,
      catAxisLabelRotate: labels.length > 8 ? -35 : 0
    });
  } else {
    slide.addChart(pptx.ChartType.bar, chartData, {
      ...baseOpts,
      barDir: 'col',
      barGrouping: chart.type === 'stackedBar' ? 'stacked' : 'clustered',
      legendPos: 't',
      showValue: seriesList.length === 1 && labels.length <= 10,
      dataLabelPosition: 'outEnd',
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8,
      dataLabelColor: noHash(theme.primary),
      catAxisLabelRotate: (!isFull && labels.length > 5) || labels.length > 8 ? -35 : 0
    });
  }
}

function buildChartSlides(pptx, spec, charts, theme, contentSlides) {
  if (!charts.length) return;
  const boxH = Number((MAX_Y - TOP_Y).toFixed(3));
  let i = 0;

  while (i < charts.length) {
    const c = charts[i];
    const isFull = Boolean(c.fullWidth || (c.type === 'line' && (c.labels?.length || 0) > 8) || charts.length === 1);
    const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Visual Analytics');
    contentSlides.push(slide);

    if (isFull || i + 1 >= charts.length || charts[i + 1].fullWidth) {
      renderChartBox(pptx, slide, c, CONTENT_X, TOP_Y, CONTENT_W, boxH, theme, true);
      i += 1;
    } else {
      const gap = 0.26;
      const boxW = Number(((CONTENT_W - gap) / 2).toFixed(3));
      const rightX = Number((CONTENT_X + boxW + gap).toFixed(3));
      renderChartBox(pptx, slide, c, CONTENT_X, TOP_Y, boxW, boxH, theme, false);
      renderChartBox(pptx, slide, charts[i + 1], rightX, TOP_Y, boxW, boxH, theme, false);
      i += 2;
    }
  }
}

/** Render a bounded, paginated table across 1 or more slides with exact `rowH` arrays. */
function renderBoundedTablePages(pptx, spec, table, theme, contentSlides) {
  const prepared = prepareBoundedTable(table, theme);
  if (!prepared) return;

  const { headerCells, headerH, colWidths, rowItems } = prepared;
  const noteTxt = table.note ? cleanText(table.note, 210) : '';
  const noteLines = noteTxt ? Math.min(2, estimateWrappedLines(noteTxt, CONTENT_W, 9)) : 0;
  const noteH = noteTxt ? linesToHeightIn(noteLines, 9, 0.08, 1.32) : 0;

  const firstTableY = noteTxt ? Number((TOP_Y + noteH + 0.08).toFixed(3)) : TOP_Y;
  const firstAvailH = Number((MAX_Y - firstTableY).toFixed(3));
  const contAvailH = Number((MAX_Y - TOP_Y).toFixed(3));

  const pages = paginateMeasuredRows(rowItems, headerH, firstAvailH, contAvailH);
  const totalParts = pages.length;

  pages.forEach((chunk, pIdx) => {
    const partLabel = totalParts > 1 ? ` (${pIdx + 1} of ${totalParts})` : '';
    const suffix = `${table.name || 'Data'}${partLabel}`;
    const slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
    contentSlides.push(slide);

    let tableY = TOP_Y;
    if (pIdx === 0 && noteTxt) {
      slide.addText(noteTxt, {
        x: CONTENT_X, y: TOP_Y, w: CONTENT_W, h: noteH,
        fontFace: F_BODY, fontSize: 9, italic: true, color: noHash(COLORS.subtle), valign: 'top'
      });
      tableY = firstTableY;
    }

    const rowH = [headerH, ...chunk.map((item) => item.height)];
    slide.addTable([headerCells, ...chunk.map((item) => item.cells)], {
      x: CONTENT_X,
      y: tableY,
      w: CONTENT_W,
      colW: colWidths,
      rowH,
      autoPage: false
    });
  });
}

function buildTableSlides(pptx, spec, tablesList, theme, contentSlides) {
  const tables = [...tablesList].sort(
    (a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
  );
  tables.forEach((table) => renderBoundedTablePages(pptx, spec, table, theme, contentSlides));
}

/** Build bounded, row-paginated Stat Matrix slides with explicit `rowH` arrays. */
function buildStatMatrixSlides(pptx, spec, statMatrices, theme, contentSlides) {
  if (!statMatrices || !statMatrices.length) return;
  let slide = null;
  let y = TOP_Y;

  const openSlide = (suffix) => {
    slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
    contentSlides.push(slide);
    y = TOP_Y;
  };

  statMatrices.forEach((matrix) => {
    const pairs = (matrix.pairs || []).filter((p) => Array.isArray(p) && p.length >= 2);
    if (!pairs.length) return;

    const { colW, rowItems } = prepareStatMatrixRows(pairs, theme);
    const titleBase = matrix.title || 'Operational Summary';
    let idx = 0;
    let part = 1;

    while (idx < rowItems.length) {
      const minNeeded = 0.34 + rowItems[idx].height + 0.14;
      if (!slide || y + minNeeded > MAX_Y) {
        openSlide(part === 1 ? titleBase : `${titleBase} (Cont.)`);
      }

      const titleLabel = part === 1 ? titleBase : `${titleBase} (Cont.)`;
      slide.addText(cleanText(titleLabel.toUpperCase(), 75), {
        x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
        fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
      });
      y = Number((y + 0.34).toFixed(3));

      const availH = MAX_Y - y - 0.08;
      const chunk = [];
      let usedH = 0;

      while (idx < rowItems.length) {
        const item = rowItems[idx];
        if (chunk.length > 0 && usedH + item.height > availH) break;
        chunk.push(item);
        usedH = Number((usedH + item.height).toFixed(3));
        idx += 1;
      }

      slide.addTable(chunk.map((r) => r.cells), {
        x: CONTENT_X,
        y,
        w: CONTENT_W,
        colW,
        rowH: chunk.map((r) => r.height),
        autoPage: false
      });

      y = Number((y + usedH + 0.24).toFixed(3));
      part += 1;
    }
  });
}

/** Build bounded Markdown / SOP slides including item-level bullet & table pagination. */
function buildDocumentSlides(pptx, spec, blocks, theme, contentSlides) {
  if (!blocks || !blocks.length) return;
  let slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Document Content');
  contentSlides.push(slide);
  let y = TOP_Y;
  let currentHeading = 'Document Content';

  const nextSlide = (suffix) => {
    slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix || `${currentHeading} (Cont.)`);
    contentSlides.push(slide);
    y = TOP_Y;
  };

  blocks.forEach((b) => {
    if (!b) return;

    if (b.type === 'h1' || b.type === 'h2') {
      currentHeading = cleanText(b.text, 48) || 'Document Content';
      const fontSize = b.type === 'h1' ? 16.5 : 13.5;
      const lines = Math.min(2, estimateWrappedLines(b.text, CONTENT_W, fontSize, { bold: true }));
      const h = linesToHeightIn(lines, fontSize, 0.12, 1.3);
      if (y + h + 0.65 > MAX_Y) nextSlide(currentHeading);
      slide.addText(cleanText(b.text, 120), {
        x: CONTENT_X, y, w: CONTENT_W, h,
        fontFace: F_DISP, fontSize, bold: true, color: noHash(theme.primary), valign: 'middle'
      });
      y = Number((y + h + 0.10).toFixed(3));
      return;
    }

    if (b.type === 'h3') {
      const lines = Math.min(2, estimateWrappedLines(b.text, CONTENT_W, 11.5, { bold: true }));
      const h = linesToHeightIn(lines, 11.5, 0.10, 1.3);
      if (y + h + 0.50 > MAX_Y) nextSlide();
      slide.addText(cleanText(b.text, 120), {
        x: CONTENT_X, y, w: CONTENT_W, h,
        fontFace: F_DISP, fontSize: 11.5, bold: true, color: noHash(COLORS.royal), valign: 'middle'
      });
      y = Number((y + h + 0.08).toFixed(3));
      return;
    }

    if (b.type === 'paragraph' || b.type === 'quote') {
      const isQuote = b.type === 'quote';
      const textW = isQuote ? CONTENT_W - 0.32 : CONTENT_W;
      const txt = cleanText(b.text, 620);
      const lines = estimateWrappedLines(txt, textW, 10);
      const h = Math.min(MAX_Y - TOP_Y - 0.2, linesToHeightIn(lines, 10, 0.18, 1.38));
      if (y + h > MAX_Y) nextSlide();
      if (isQuote) {
        slide.addShape('rect', {
          x: CONTENT_X, y, w: CONTENT_W, h,
          fill: { color: noHash(theme.tint || COLORS.zebra) },
          line: { color: noHash(COLORS.border), width: 0.75 }
        });
        slide.addShape('rect', {
          x: CONTENT_X, y, w: 0.06, h,
          fill: { color: noHash(theme.accent) }, line: { width: 0 }
        });
      }
      slide.addText(txt, {
        x: isQuote ? CONTENT_X + 0.18 : CONTENT_X,
        y: y + 0.04,
        w: textW,
        h: Number((h - 0.08).toFixed(3)),
        fontFace: F_BODY,
        fontSize: 10,
        italic: isQuote,
        color: noHash(COLORS.body),
        valign: 'top'
      });
      y = Number((y + h + 0.12).toFixed(3));
      return;
    }

    if (b.type === 'bullets' || b.type === 'ordered') {
      const listW = Number((CONTENT_W - 0.24).toFixed(3));
      (b.items || []).forEach((item, idx) => {
        const prefix = b.type === 'ordered' ? `${idx + 1}. ` : '•  ';
        const txt = cleanText(`${prefix}${str(item.text)}`, 320);
        const lines = estimateWrappedLines(txt, listW, 10);
        const itemH = Math.min(1.6, linesToHeightIn(lines, 10, 0.08, 1.35));
        if (y + itemH > MAX_Y) nextSlide();
        slide.addText(txt, {
          x: CONTENT_X + 0.14, y, w: listW, h: itemH,
          fontFace: F_BODY, fontSize: 10, color: noHash(COLORS.body), valign: 'top'
        });
        y = Number((y + itemH + 0.05).toFixed(3));
      });
      y = Number((y + 0.08).toFixed(3));
      return;
    }

    if (b.type === 'code') {
      const allLines = String(b.content || '').split('\n').map((l) => l.slice(0, 118));
      let offset = 0;
      while (offset < allLines.length) {
        const availLines = Math.max(3, Math.floor((MAX_Y - y - 0.26) / 0.21));
        if (MAX_Y - y < 0.85) {
          nextSlide();
          continue;
        }
        const chunk = allLines.slice(offset, offset + Math.min(16, availLines));
        const h = Number((chunk.length * 0.21 + 0.22).toFixed(3));
        slide.addShape('roundRect', {
          x: CONTENT_X, y, w: CONTENT_W, h,
          fill: { color: noHash(COLORS.surface) },
          line: { color: noHash(COLORS.borderStrong), width: 0.75 },
          rectRadius: 0.05
        });
        slide.addText(chunk.join('\n'), {
          x: CONTENT_X + 0.14, y: y + 0.08, w: Number((CONTENT_W - 0.28).toFixed(3)), h: Number((h - 0.16).toFixed(3)),
          fontFace: F_MONO, fontSize: 8.8, color: noHash(COLORS.ink), valign: 'top'
        });
        y = Number((y + h + 0.14).toFixed(3));
        offset += chunk.length;
      }
      return;
    }

    if (b.type === 'table' && Array.isArray(b.headers) && b.headers.length) {
      const mdTable = {
        name: `${currentHeading} — Table`,
        columns: b.headers.map((h, i) => ({ header: str(h), key: `c${i}`, type: 'text', width: 14 })),
        rows: (b.rows || []).map((r) => {
          const obj = {};
          b.headers.forEach((_, i) => { obj[`c${i}`] = str(r[i] ?? ''); });
          return obj;
        })
      };
      renderBoundedTablePages(pptx, spec, mdTable, theme, contentSlides);
      y = MAX_Y + 1; // Force any subsequent document block onto a fresh slide
    }
  });
}

/** Build a strictly bounded Widescreen 16:9 PowerPoint buffer from a ReportSpec. */
async function buildPptxBuffer(spec) {
  const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
  const data = collectSpecData(spec);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // Exact 13.333" x 7.500" (12192000 x 6858000 EMU)
  pptx.author = COMPANY.name;
  pptx.company = COMPANY.name;
  pptx.title = spec.title || 'SMaRT Report';

  const contentSlides = [];

  buildCoverSlide(pptx, spec, theme);
  buildExecutiveOverviewSlides(pptx, spec, data, theme, contentSlides);
  buildScorecardsAndHighlightsSlides(pptx, spec, data, theme, contentSlides);
  buildStatMatrixSlides(pptx, spec, data.statMatrices, theme, contentSlides);
  buildChartSlides(pptx, spec, data.charts, theme, contentSlides);
  buildDocumentSlides(pptx, spec, data.documentBlocks, theme, contentSlides);
  buildTableSlides(pptx, spec, data.tables, theme, contentSlides);

  const totalSlides = 1 + contentSlides.length;
  contentSlides.forEach((slide, idx) => {
    slide.addText(`Slide ${idx + 2} of ${totalSlides}`, {
      x: 9.50, y: FOOTER_TEXT_Y, w: 3.333, h: FOOTER_TEXT_H,
      fontFace: F_DISP, fontSize: 8.5, bold: true, color: noHash(theme.primary), align: 'right', valign: 'middle'
    });
  });

  return pptx.write({ outputType: 'nodebuffer' });
}

/** Stream a PowerPoint presentation to the Express response. */
async function streamPptx(spec, res, filename) {
  const buffer = await buildPptxBuffer(spec);
  res.setHeader('Content-Type', FORMAT_META.pptx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pptx"`);
  res.send(buffer);
}

module.exports = { buildPptxBuffer, streamPptx };
