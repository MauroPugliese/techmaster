// =============================================================================
// exports/renderers/pptx.renderer.js — Official CAE PowerPoint (.pptx) v4
// -----------------------------------------------------------------------------
// Consumes both top-level specs and composable `spec.pages` blueprints via
// `collectSpecData`, rendering unified CAE diagonal-hero Navy/Blue covers,
// Scorecards & Highlights slides, native editable OOXML charts, and tables.
// =============================================================================

const PptxGenJS = require('pptxgenjs');
const {
  COMPANY, COLORS, CHART_PALETTE, OFFICE_FONTS, toneStyle, noHash, getLogoBase64
} = require('../core/branding');
const { resolveTheme } = require('../core/themes');
const {
  str, formatCell, computeColumnTotals, toNumber, FORMAT_META
} = require('../core/helpers');

const F_HERO = OFFICE_FONTS.pptx.hero;
const F_DISP = OFFICE_FONTS.pptx.display;
const F_BODY = OFFICE_FONTS.pptx.body;
const F_MONO = OFFICE_FONTS.pptx.mono;

const SLIDE_W = 13.33;
const CONTENT_X = 0.5;
const CONTENT_W = 12.33;
const TOP_CONTENT_Y = 1.12;
const MAX_CONTENT_Y = 6.78;

function extractAggregatedData(spec) {
  const briefParts = [];
  if (spec.executiveBrief) briefParts.push(spec.executiveBrief);
  const kpis = [...(spec.kpis || [])];
  const scorecards = [...(spec.scorecards || [])];
  const highlights = [...(spec.highlights || [])];
  const insights = [...(spec.insights || [])];
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
        block.items.forEach((it) => kpis.push({ label: it.label, value: it.valueLabel || `${Number(it.percent || 0).toFixed(1)}%`, sublabel: it.sublabel, tone: it.tone }));
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

  return { executiveBrief: briefParts[0] || '', kpis, scorecards, highlights, insights, charts, tables, documentBlocks };
}

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

/** Build Slide 1: Unified CAE diagonal-hero Cover Slide. */
function buildCoverSlide(pptx, spec, theme) {
  const slide = pptx.addSlide();
  slide.background = { color: noHash(theme.primary) };

  slide.addShape('rect', { x: 10.65, y: 0, w: 2.68, h: 7.5, fill: { color: noHash(COLORS.navyLight) }, line: { width: 0 } });
  slide.addShape('rect', { x: 10.65, y: 0, w: 0.09, h: 7.5, fill: { color: noHash(theme.accent) }, line: { width: 0 } });
  slide.addShape('rect', { x: 10.74, y: 0, w: 0.04, h: 7.5, fill: { color: noHash(theme.secondary || COLORS.cyan) }, line: { width: 0 } });

  const logoLight = getLogoBase64('light');
  if (logoLight) {
    slide.addImage({ data: logoLight, x: 0.8, y: 0.56, w: 2.1, h: 0.78 });
  }

  slide.addText(theme.docCode || spec.docCode || 'CAE-RPT', {
    x: 8.4, y: 0.65, w: 1.9, h: 0.36,
    fontFace: F_MONO, fontSize: 11, bold: true, color: noHash(theme.secondary || COLORS.cyan), align: 'right'
  });

  slide.addText(String(spec.category || 'OPERATIONS INTELLIGENCE').toUpperCase(), {
    x: 0.8, y: 1.75, w: 9.4, h: 0.35,
    fontFace: F_DISP, fontSize: 11, bold: true, color: noHash(theme.secondary || COLORS.cyan)
  });

  slide.addText(spec.title || 'Operational Report', {
    x: 0.8, y: 2.12, w: 9.5, h: 1.15,
    fontFace: F_HERO, fontSize: 31, bold: false, color: noHash(COLORS.white), valign: 'top'
  });

  let curY = 3.32;
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.8, y: curY, w: 9.4, h: 0.52,
      fontFace: F_DISP, fontSize: 13.5, color: 'CBD5E1'
    });
    curY += 0.62;
  }

  slide.addShape('line', {
    x: 0.8, y: curY + 0.04, w: 3.4, h: 0,
    line: { color: noHash(theme.accent), width: 3.5 }
  });
  curY += 0.32;

  if (spec.coverHighlights && spec.coverHighlights.length) {
    const shown = spec.coverHighlights.slice(0, 3);
    const gap = 0.22;
    const hw = Math.min(3.0, (9.4 - gap * (shown.length - 1)) / shown.length);
    shown.forEach((h, idx) => {
      const hx = 0.8 + idx * (hw + gap);
      slide.addShape('roundRect', {
        x: hx, y: curY, w: hw, h: 0.92,
        fill: { color: noHash(COLORS.navyLight) },
        line: { color: noHash(theme.accent), width: 1 },
        rectRadius: 0.05
      });
      slide.addText(String(h.label || '').toUpperCase(), {
        x: hx + 0.14, y: curY + 0.1, w: hw - 0.28, h: 0.24,
        fontFace: F_DISP, fontSize: 8, bold: true, color: 'CBD5E1'
      });
      slide.addText(str(h.value), {
        x: hx + 0.14, y: curY + 0.36, w: hw - 0.28, h: 0.42,
        fontFace: F_DISP, fontSize: 18, bold: true, color: noHash(COLORS.white)
      });
    });
    curY += 1.12;
  }

  const meta = spec.meta || {};
  const metaLines = [
    `Generated: ${new Date(meta.generatedAt || Date.now()).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    meta.generatedBy ? `Prepared By: ${meta.generatedBy}` : null,
    meta.filters?.length ? meta.filters.slice(0, 3).map((f) => `${f.label}: ${str(f.value)}`).join(' · ') : null
  ].filter(Boolean);

  slide.addText(metaLines.join('   |   '), {
    x: 0.8, y: Math.min(6.35, curY + 0.08), w: 9.4, h: 0.38,
    fontFace: F_BODY, fontSize: 10.5, color: '94A3B8'
  });

  slide.addText(`${COMPANY.name}  —  ${theme.coverTagline || COMPANY.tagline}`, {
    x: 0.8, y: 6.9, w: 9.4, h: 0.3,
    fontFace: F_BODY, fontSize: 9, color: '64748B'
  });
}

function addSlideChrome(slide, spec, theme, titleSuffix = '') {
  slide.background = { color: noHash(COLORS.white) };

  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: 0.85,
    fill: { color: noHash(theme.primary) },
    line: { color: noHash(theme.primary), width: 0 }
  });

  const logoLight = getLogoBase64('light');
  if (logoLight) {
    slide.addImage({ data: logoLight, x: 0.48, y: 0.14, w: 1.44, h: 0.54 });
  }

  const headerTitle = `${spec.title}${titleSuffix ? `  —  ${titleSuffix}` : ''}`;
  slide.addText(headerTitle, {
    x: logoLight ? 2.12 : 0.5, y: 0.17, w: 9.2, h: 0.5,
    fontFace: F_DISP, fontSize: 14.5, bold: true, color: noHash(COLORS.white), valign: 'middle'
  });

  slide.addText(theme.docCode || 'CAE-RPT', {
    x: 11.4, y: 0.23, w: 1.4, h: 0.38,
    fontFace: F_MONO, fontSize: 9.5, bold: true, color: noHash(theme.secondary || COLORS.cyan), align: 'right'
  });

  slide.addShape('line', {
    x: 0, y: 0.85, w: SLIDE_W, h: 0,
    line: { color: noHash(theme.accent), width: 2.5 }
  });

  slide.addShape('line', {
    x: 0.5, y: 7.02, w: CONTENT_W, h: 0,
    line: { color: noHash(COLORS.border), width: 1 }
  });

  slide.addText(`${COMPANY.name}   |   ${spec.meta?.confidentiality || COMPANY.confidentiality}`, {
    x: 0.5, y: 7.06, w: 8.5, h: 0.34,
    fontFace: F_BODY, fontSize: 8.5, color: noHash(COLORS.subtle)
  });

  return slide;
}

function renderKpiCards(slide, kpis, startY, theme) {
  if (!kpis || !kpis.length) return startY;
  const shown = kpis.slice(0, 5);
  const gap = 0.2;
  const cardW = (CONTENT_W - gap * (shown.length - 1)) / shown.length;
  const cardH = 1.02;

  shown.forEach((item, i) => {
    const cx = CONTENT_X + i * (cardW + gap);
    const tone = toneStyle(item.tone);
    const accentHex = tone ? noHash(tone.accent) : noHash(theme.accent);
    const valHex = tone && (item.tone === 'danger' || item.tone === 'warning')
      ? noHash(tone.fg) : noHash(theme.primary);

    slide.addShape('roundRect', {
      x: cx, y: startY, w: cardW, h: cardH,
      fill: { color: noHash(COLORS.zebra) },
      line: { color: noHash(COLORS.border), width: 1 },
      rectRadius: 0.06
    });
    slide.addShape('rect', {
      x: cx + 0.02, y: startY, w: cardW - 0.04, h: 0.05,
      fill: { color: accentHex },
      line: { width: 0 }
    });
    slide.addText(str(item.label).toUpperCase(), {
      x: cx + 0.12, y: startY + 0.11, w: cardW - 0.24, h: 0.24,
      fontFace: F_DISP, fontSize: 8, bold: true, color: noHash(COLORS.subtle)
    });
    const valStr = str(item.value);
    slide.addText(valStr, {
      x: cx + 0.12, y: startY + 0.35, w: cardW - 0.24, h: 0.4,
      fontFace: F_DISP, fontSize: valStr.length > 9 ? 16 : 20, bold: true, color: valHex
    });
    if (item.sublabel) {
      slide.addText(str(item.sublabel), {
        x: cx + 0.12, y: startY + 0.74, w: cardW - 0.24, h: 0.22,
        fontFace: F_BODY, fontSize: 8, color: noHash(COLORS.subtle)
      });
    }
  });

  return startY + cardH + 0.24;
}

function buildExecutiveOverviewSlide(pptx, spec, data, theme, contentSlides) {
  const { executiveBrief, kpis, insights } = data;
  if (!kpis.length && !insights.length && !executiveBrief) return;

  const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Executive Overview');
  contentSlides.push(slide);

  let y = TOP_CONTENT_Y;
  if (executiveBrief) {
    slide.addShape('roundRect', {
      x: CONTENT_X, y, w: CONTENT_W, h: 0.76,
      fill: { color: noHash(theme.tint || COLORS.zebra) },
      line: { color: noHash(COLORS.border), width: 0.75 },
      rectRadius: 0.05
    });
    slide.addShape('rect', { x: CONTENT_X, y, w: 0.07, h: 0.76, fill: { color: noHash(theme.accent) }, line: { width: 0 } });
    slide.addText(executiveBrief, {
      x: CONTENT_X + 0.18, y: y + 0.06, w: CONTENT_W - 0.3, h: 0.64,
      fontFace: F_BODY, fontSize: 10, color: noHash(COLORS.body), valign: 'middle'
    });
    y += 0.92;
  }

  y = renderKpiCards(slide, kpis, y, theme);

  if (insights.length) {
    slide.addText('KEY INSIGHTS & PRIORITY ALERTS', {
      x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
      fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(theme.primary)
    });
    y += 0.32;

    const shown = insights.slice(0, 4);
    const cols = shown.length > 2 ? 2 : 1;
    const gapX = 0.24;
    const gapY = 0.16;
    const cardW = cols === 2 ? (CONTENT_W - gapX) / 2 : CONTENT_W;
    const rowCount = Math.ceil(shown.length / cols);
    const availH = MAX_CONTENT_Y - y - (rowCount - 1) * gapY;
    const cardH = Math.min(1.36, Math.max(0.82, availH / rowCount));

    shown.forEach((ins, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const ix = CONTENT_X + col * (cardW + gapX);
      const iy = y + row * (cardH + gapY);
      const tone = toneStyle(ins.severity || 'info') || toneStyle('info');

      slide.addShape('roundRect', {
        x: ix, y: iy, w: cardW, h: cardH,
        fill: { color: noHash(tone.bg) },
        line: { color: noHash(tone.border), width: 1 },
        rectRadius: 0.06
      });
      slide.addShape('rect', {
        x: ix, y: iy + 0.04, w: 0.07, h: cardH - 0.08,
        fill: { color: noHash(tone.accent) },
        line: { width: 0 }
      });
      slide.addText(str(ins.title), {
        x: ix + 0.18, y: iy + 0.08, w: cardW - 0.3, h: 0.3,
        fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(tone.fg)
      });
      if (ins.detail) {
        slide.addText(str(ins.detail), {
          x: ix + 0.18, y: iy + 0.4, w: cardW - 0.3, h: cardH - 0.48,
          fontFace: F_BODY, fontSize: 9.2, color: noHash(COLORS.body), valign: 'top'
        });
      }
    });
  }
}

function buildScorecardsAndHighlightsSlide(pptx, spec, data, theme, contentSlides) {
  const { scorecards, highlights } = data;
  if (!scorecards.length && !highlights.length) return;

  const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Health Scorecards & Highlights');
  contentSlides.push(slide);
  let y = TOP_CONTENT_Y;

  if (scorecards.length) {
    const group = scorecards[0];
    const items = (group.items || []).slice(0, 6);
    slide.addText(String(group.title || 'HEALTH SCORECARD').toUpperCase(), {
      x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
      fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
    });
    y += 0.34;

    items.forEach((it) => {
      const pctVal = Math.max(0, Math.min(100, Number(it.percent) || 0));
      const tone = toneStyle(it.tone);
      const barHex = noHash(tone ? tone.accent : theme.accent);

      slide.addText(str(it.label), {
        x: CONTENT_X, y, w: 6.0, h: 0.24,
        fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(COLORS.ink)
      });
      slide.addText(str(it.valueLabel || `${pctVal.toFixed(1)}%`), {
        x: 6.8, y, w: 6.0, h: 0.24,
        fontFace: F_DISP, fontSize: 10, bold: true, color: noHash(tone ? tone.fg : theme.primary), align: 'right'
      });
      slide.addShape('roundRect', { x: CONTENT_X, y: y + 0.26, w: CONTENT_W, h: 0.12, fill: { color: noHash(COLORS.surface) }, line: { width: 0 }, rectRadius: 0.04 });
      if (pctVal > 0) {
        slide.addShape('roundRect', { x: CONTENT_X, y: y + 0.26, w: Math.max(0.16, (CONTENT_W * pctVal) / 100), h: 0.12, fill: { color: barHex }, line: { width: 0 }, rectRadius: 0.04 });
      }
      y += 0.5;
    });
    y += 0.18;
  }

  if (highlights.length && y < MAX_CONTENT_Y - 1.1) {
    slide.addText('OPERATIONAL SPOTLIGHTS', {
      x: CONTENT_X, y, w: CONTENT_W, h: 0.28,
      fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(theme.primary)
    });
    y += 0.34;
    const shown = highlights.slice(0, 4);
    const gap = 0.22;
    const cw = (CONTENT_W - gap) / 2;
    const ch = 1.08;
    shown.forEach((h, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const hx = CONTENT_X + col * (cw + gap);
      const hy = y + row * (ch + 0.18);
      if (hy + ch > MAX_CONTENT_Y) return;
      const tone = toneStyle(h.tone || 'info') || toneStyle('info');

      slide.addShape('roundRect', {
        x: hx, y: hy, w: cw, h: ch,
        fill: { color: noHash(COLORS.white) },
        line: { color: noHash(COLORS.border), width: 1 },
        rectRadius: 0.05
      });
      slide.addShape('rect', { x: hx, y: hy + 0.04, w: 0.07, h: ch - 0.08, fill: { color: noHash(tone.accent) }, line: { width: 0 } });
      slide.addText(String(h.eyebrow || 'HIGHLIGHT').toUpperCase(), {
        x: hx + 0.16, y: hy + 0.08, w: cw * 0.56, h: 0.22,
        fontFace: F_DISP, fontSize: 8, bold: true, color: noHash(tone.fg)
      });
      if (h.metric) {
        slide.addText(str(h.metric), {
          x: hx + cw * 0.58, y: hy + 0.07, w: cw * 0.38, h: 0.24,
          fontFace: F_DISP, fontSize: 11, bold: true, color: noHash(theme.primary), align: 'right'
        });
      }
      slide.addText(str(h.title), {
        x: hx + 0.16, y: hy + 0.32, w: cw - 0.28, h: 0.26,
        fontFace: F_DISP, fontSize: 10.5, bold: true, color: noHash(COLORS.ink)
      });
      if (h.detail) {
        slide.addText(str(h.detail), {
          x: hx + 0.16, y: hy + 0.58, w: cw - 0.28, h: ch - 0.64,
          fontFace: F_BODY, fontSize: 8.8, color: noHash(COLORS.body), valign: 'top'
        });
      }
    });
  }
}

function renderChartBox(pptx, slide, chart, x, y, w, h, theme) {
  const pal = theme.chartPalette || CHART_PALETTE;
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: noHash(COLORS.white) },
    line: { color: noHash(COLORS.border), width: 1 },
    rectRadius: 0.06
  });
  slide.addShape('rect', {
    x: x + 0.15, y, w: 0.85, h: 0.05,
    fill: { color: noHash(theme.accent) },
    line: { width: 0 }
  });
  slide.addText(chart.title || 'Analytics Chart', {
    x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.3,
    fontFace: F_DISP, fontSize: 12, bold: true, color: noHash(theme.primary)
  });
  if (chart.subtitle) {
    slide.addText(chart.subtitle, {
      x: x + 0.18, y: y + 0.40, w: w - 0.36, h: 0.22,
      fontFace: F_BODY, fontSize: 8.5, color: noHash(COLORS.subtle)
    });
  }

  const chartTop = y + (chart.subtitle ? 0.68 : 0.5);
  const chartH = h - (chart.subtitle ? 0.8 : 0.62);

  if (!hasChartData(chart)) {
    slide.addText('No quantitative data available for the selected period.', {
      x: x + 0.3, y: chartTop + chartH * 0.38, w: w - 0.6, h: 0.5,
      fontFace: F_BODY, fontSize: 10.5, italic: true, color: noHash(COLORS.subtle), align: 'center'
    });
    return;
  }

  const labels = (chart.labels || []).map((l) => String(l));
  const seriesList = Array.isArray(chart.series) && chart.series.length
    ? chart.series
    : [{ name: chart.seriesName || 'Value', data: chart.values || [] }];

  const chartData = seriesList.map((s) => ({
    name: s.name || 'Series',
    labels,
    values: (s.data || []).map((v) => toNumber(v, 0))
  }));

  const palette = (chart.colors && chart.colors.length)
    ? chart.colors.map(noHash)
    : seriesList.map((s, i) => (s.color ? noHash(s.color) : noHash(pal[i % pal.length])));

  const fullPalette = (chart.type === 'donut' || chart.type === 'pie' || (seriesList.length === 1 && !chart.colors))
    ? labels.map((_, i) => noHash(chart.colors?.[i] || pal[i % pal.length]))
    : palette;

  const baseOpts = {
    x: x + 0.14,
    y: chartTop,
    w: w - 0.28,
    h: chartH,
    chartColors: fullPalette,
    showTitle: false,
    showLegend: chart.type === 'donut' || chart.type === 'pie' || seriesList.length > 1,
    legendFontFace: F_BODY,
    legendFontSize: 8.5,
    legendColor: noHash(COLORS.body),
    catAxisLabelFontFace: F_BODY,
    catAxisLabelFontSize: 8.5,
    catAxisLabelColor: noHash(COLORS.subtle),
    valAxisLabelFontFace: F_BODY,
    valAxisLabelFontSize: 8.5,
    valAxisLabelColor: noHash(COLORS.subtle),
    valGridLine: { color: noHash(COLORS.border), size: 0.5 }
  };

  if (chart.type === 'donut' || chart.type === 'pie') {
    slide.addChart(pptx.ChartType.doughnut, chartData, {
      ...baseOpts,
      holeSize: 56,
      legendPos: 'r',
      showPercent: true,
      showValue: false,
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8.5,
      dataLabelColor: noHash(COLORS.white)
    });
  } else if (chart.type === 'hbar' || chart.type === 'lollipop') {
    slide.addChart(pptx.ChartType.bar, chartData, {
      ...baseOpts,
      barDir: 'bar',
      barGrouping: 'clustered',
      showValue: true,
      dataLabelPosition: 'outEnd',
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8.5,
      dataLabelColor: noHash(theme.primary),
      catGridLine: { style: 'none' }
    });
  } else if (chart.type === 'line' || chart.type === 'area') {
    slide.addChart(pptx.ChartType.line, chartData, {
      ...baseOpts,
      legendPos: 't',
      lineSize: 2.5,
      lineSmooth: true,
      lineDataSymbol: 'circle',
      lineDataSymbolSize: 5
    });
  } else {
    slide.addChart(pptx.ChartType.bar, chartData, {
      ...baseOpts,
      barDir: 'col',
      barGrouping: chart.type === 'stackedBar' ? 'stacked' : 'clustered',
      legendPos: 't',
      showValue: seriesList.length === 1,
      dataLabelPosition: 'outEnd',
      dataLabelFontFace: F_DISP,
      dataLabelFontSize: 8.5,
      dataLabelColor: noHash(theme.primary)
    });
  }
}

function buildChartSlides(pptx, spec, charts, theme, contentSlides) {
  if (!charts.length) return;
  let i = 0;
  while (i < charts.length) {
    const c = charts[i];
    const isFull = Boolean(c.fullWidth || (c.type === 'line' && (c.labels?.length || 0) > 8) || charts.length === 1);
    const slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Visual Analytics');
    contentSlides.push(slide);

    if (isFull || i + 1 >= charts.length || charts[i + 1].fullWidth) {
      renderChartBox(pptx, slide, c, CONTENT_X, TOP_CONTENT_Y, CONTENT_W, 5.6, theme);
      i += 1;
    } else {
      const gap = 0.28;
      const boxW = (CONTENT_W - gap) / 2;
      renderChartBox(pptx, slide, c, CONTENT_X, TOP_CONTENT_Y, boxW, 5.6, theme);
      renderChartBox(pptx, slide, charts[i + 1], CONTENT_X + boxW + gap, TOP_CONTENT_Y, boxW, 5.6, theme);
      i += 2;
    }
  }
}

function buildDocumentSlides(pptx, spec, blocks, theme, contentSlides) {
  if (!blocks.length) return;
  let slide = addSlideChrome(pptx.addSlide(), spec, theme, 'Document Content');
  contentSlides.push(slide);
  let y = TOP_CONTENT_Y;

  const nextSlide = (suffix = 'Document Content (Cont.)') => {
    slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
    contentSlides.push(slide);
    y = TOP_CONTENT_Y;
  };

  blocks.forEach((b) => {
    if (b.type === 'h1' || b.type === 'h2') {
      if (y > 5.4) nextSlide(b.text);
      slide.addText(b.text, {
        x: CONTENT_X, y, w: CONTENT_W, h: 0.42,
        fontFace: F_DISP, fontSize: b.type === 'h1' ? 18 : 14, bold: true, color: noHash(theme.primary)
      });
      y += 0.46;
      return;
    }

    if (b.type === 'h3') {
      if (y > 5.8) nextSlide();
      slide.addText(b.text, {
        x: CONTENT_X, y, w: CONTENT_W, h: 0.34,
        fontFace: F_DISP, fontSize: 12.5, bold: true, color: noHash(COLORS.royal)
      });
      y += 0.36;
      return;
    }

    if (b.type === 'paragraph' || b.type === 'quote') {
      const lines = Math.max(1, Math.ceil(b.text.length / 115));
      const h = Math.min(2.2, lines * 0.24 + 0.16);
      if (y + h > MAX_CONTENT_Y) nextSlide();
      if (b.type === 'quote') {
        slide.addShape('rect', {
          x: CONTENT_X, y, w: CONTENT_W, h,
          fill: { color: noHash(theme.tint || COLORS.zebra) },
          line: { color: noHash(COLORS.border), width: 0.75 }
        });
        slide.addShape('rect', {
          x: CONTENT_X, y, w: 0.06, h,
          fill: { color: noHash(theme.accent) },
          line: { width: 0 }
        });
      }
      slide.addText(b.text, {
        x: b.type === 'quote' ? CONTENT_X + 0.16 : CONTENT_X,
        y: y + 0.04,
        w: b.type === 'quote' ? CONTENT_W - 0.28 : CONTENT_W,
        h,
        fontFace: F_BODY,
        fontSize: 10.5,
        italic: b.type === 'quote',
        color: noHash(COLORS.body),
        valign: 'top'
      });
      y += h + 0.1;
      return;
    }

    if (b.type === 'bullets' || b.type === 'ordered') {
      const textItems = (b.items || []).map((item, idx) => ({
        text: b.type === 'ordered' ? `${idx + 1}. ${item.text}` : `•  ${item.text}`,
        options: { breakLine: true, fontFace: F_BODY, fontSize: 10.5, color: noHash(COLORS.body), paraSpaceAfter: 4 }
      }));
      const h = Math.min(3.5, Math.max(0.45, textItems.length * 0.28));
      if (y + h > MAX_CONTENT_Y) nextSlide();
      slide.addText(textItems, { x: CONTENT_X + 0.15, y, w: CONTENT_W - 0.2, h, valign: 'top' });
      y += h + 0.1;
      return;
    }

    if (b.type === 'code') {
      const codeLines = String(b.content || '').split('\n').slice(0, 12);
      const h = Math.min(3.0, Math.max(0.55, codeLines.length * 0.22 + 0.18));
      if (y + h > MAX_CONTENT_Y) nextSlide();
      slide.addShape('roundRect', {
        x: CONTENT_X, y, w: CONTENT_W, h,
        fill: { color: noHash(COLORS.surface) },
        line: { color: noHash(COLORS.borderStrong), width: 0.75 },
        rectRadius: 0.05
      });
      slide.addText(codeLines.join('\n'), {
        x: CONTENT_X + 0.14, y: y + 0.08, w: CONTENT_W - 0.28, h: h - 0.14,
        fontFace: F_MONO, fontSize: 9, color: noHash(COLORS.ink), valign: 'top'
      });
      y += h + 0.12;
    }
  });
}

function prepareTableData(table, theme) {
  const columns = (table.columns || []).filter((c) => !c.printHidden);
  const rows = table.rows || [];
  const totalWeight = columns.reduce((a, c) => a + (c.width || 10), 0) || 1;
  const colWidths = columns.map((c) => ((c.width || 10) / totalWeight) * CONTENT_W);
  const hdrBg = noHash(theme.tableHeaderBg || theme.primary);

  const headerCells = columns.map((col) => {
    const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
    return {
      text: col.header || '',
      options: {
        fill: { color: hdrBg },
        color: noHash(COLORS.white),
        fontFace: F_DISP,
        fontSize: 9.5,
        bold: true,
        align: col.align || (isNum ? 'right' : 'left'),
        valign: 'middle',
        border: { pt: 0.75, color: noHash(COLORS.border) },
        margin: [4, 6, 4, 6]
      }
    };
  });

  if (!rows.length) {
    return {
      headerCells,
      colWidths,
      rowItems: [{
        height: 0.5,
        cells: [{
          text: 'No records match the selected filters.',
          options: {
            colspan: Math.max(1, columns.length),
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
    const isZebra = idx % 2 === 1;
    let maxLines = 1;

    const cells = columns.map((col, ci) => {
      const txt = formatCell(row, col);
      const charsPerLine = Math.max(8, Math.floor(colWidths[ci] * 11.5));
      const lines = Math.max(1, Math.ceil(txt.length / charsPerLine));
      if (lines > maxLines) maxLines = lines;

      const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
      const isBadge = col.type === 'badge';
      const badgeTone = isBadge ? (toneStyle(row._badgeTone || row._flag) || toneStyle('neutral')) : null;
      const cellFill = isBadge
        ? noHash(badgeTone.bg)
        : (rowTone && (row._flag === 'danger' || row._flag === 'warning')
          ? noHash(rowTone.bg)
          : (isZebra ? noHash(COLORS.zebra) : noHash(COLORS.white)));
      const cellColor = isBadge
        ? noHash(badgeTone.fg)
        : (rowTone && isNum ? noHash(rowTone.fg) : noHash(COLORS.body));

      return {
        text: txt,
        options: {
          fill: { color: cellFill },
          color: cellColor,
          fontFace: col.type === 'mono' ? F_MONO : (isBadge ? F_DISP : F_BODY),
          fontSize: isBadge || col.type === 'mono' ? 8 : 8.5,
          bold: isBadge || (rowTone && isNum),
          align: col.align || (isBadge ? 'center' : (isNum ? 'right' : 'left')),
          valign: 'middle',
          border: { pt: 0.5, color: noHash(COLORS.border) },
          margin: [3, 5, 3, 5]
        }
      };
    });

    const estHeight = Math.min(1.4, 0.24 + (maxLines - 1) * 0.16);
    return { cells, height: estHeight };
  });

  const totalsRow = computeColumnTotals({ ...table, columns });
  if (totalsRow) {
    rowItems.push({
      height: 0.34,
      cells: columns.map((col) => {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        return {
          text: totalsRow[col.key] || '',
          options: {
            fill: { color: noHash(theme.tint || COLORS.navyTint) },
            color: noHash(theme.primary),
            fontFace: F_DISP,
            fontSize: 9,
            bold: true,
            align: col.align || (isNum ? 'right' : 'left'),
            valign: 'middle',
            border: { pt: 0.75, color: noHash(theme.primary) },
            margin: [4, 5, 4, 5]
          }
        };
      })
    });
  }

  return { headerCells, colWidths, rowItems };
}

function buildTableSlides(pptx, spec, tablesList, theme, contentSlides) {
  const tables = [...tablesList].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));

  tables.forEach((table) => {
    const visibleCols = (table.columns || []).filter((c) => !c.printHidden);
    if (!visibleCols.length) return;
    const { headerCells, colWidths, rowItems } = prepareTableData(table, theme);

    let idx = 0;
    let part = 1;

    while (idx < rowItems.length) {
      const suffix = (table.name || 'Data') + (part > 1 ? ' (Cont.)' : '');
      const slide = addSlideChrome(pptx.addSlide(), spec, theme, suffix);
      contentSlides.push(slide);

      let tableY = TOP_CONTENT_Y;
      if (part === 1 && table.note) {
        slide.addText(table.note, {
          x: CONTENT_X, y: tableY, w: CONTENT_W, h: 0.25,
          fontFace: F_BODY, fontSize: 9, italic: true, color: noHash(COLORS.subtle)
        });
        tableY += 0.28;
      }

      const maxBudget = MAX_CONTENT_Y - tableY - 0.36;
      let usedH = 0;
      const chunk = [];

      while (idx < rowItems.length) {
        const item = rowItems[idx];
        if (chunk.length > 0 && usedH + item.height > maxBudget) break;
        chunk.push(item.cells);
        usedH += item.height;
        idx += 1;
      }

      slide.addTable([headerCells, ...chunk], {
        x: CONTENT_X,
        y: tableY,
        w: CONTENT_W,
        colW: colWidths,
        autoPage: false
      });

      part += 1;
    }
  });
}

/** Build a full PowerPoint buffer from a normalised ReportSpec v4. */
async function buildPptxBuffer(spec) {
  const theme = spec.theme?.primary ? spec.theme : resolveTheme(spec);
  const data = extractAggregatedData(spec);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = COMPANY.name;
  pptx.company = COMPANY.name;
  pptx.title = spec.title || 'SMaRT Report';

  const contentSlides = [];

  buildCoverSlide(pptx, spec, theme);
  buildExecutiveOverviewSlide(pptx, spec, data, theme, contentSlides);
  buildScorecardsAndHighlightsSlide(pptx, spec, data, theme, contentSlides);
  buildChartSlides(pptx, spec, data.charts, theme, contentSlides);
  buildDocumentSlides(pptx, spec, data.documentBlocks, theme, contentSlides);
  buildTableSlides(pptx, spec, data.tables, theme, contentSlides);

  const totalSlides = 1 + contentSlides.length;
  contentSlides.forEach((slide, idx) => {
    slide.addText(`Slide ${idx + 2} of ${totalSlides}`, {
      x: 9.5, y: 7.06, w: 3.33, h: 0.34,
      fontFace: F_DISP, fontSize: 8.5, bold: true, color: noHash(theme.primary), align: 'right'
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
