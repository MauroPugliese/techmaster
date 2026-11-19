// =============================================================================
// exports/renderers/pdf-cover-widgets.js — CAE A4 Cover & Composable Widgets (v4)
// -----------------------------------------------------------------------------
// Official CAE diagonal-hero A4 cover page with Contents Outline + composable
// executive widgets (`brief`, `kpis`, `gaugeBand`, `scorecard`, `highlights`,
// `statMatrix`, `cardList`, `alerts`).
// =============================================================================

const { COLORS, COMPANY, toneStyle, getLogoBuffer } = require('../core/branding');
const { str } = require('../core/helpers');

const MARGIN = 38;

function formatGeneratedDate(meta) {
  return new Date(meta?.generatedAt || Date.now()).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function drawCoverHighlightsStrip(doc, highlights, x, y, w, F, theme) {
  if (!highlights || !highlights.length) return y;
  const shown = highlights.slice(0, 3);
  const gap = 10;
  const cardW = (w - gap * (shown.length - 1)) / shown.length;
  const cardH = 52;

  shown.forEach((h, i) => {
    const cx = x + i * (cardW + gap);
    doc.save();
    doc.roundedRect(cx, y, cardW, cardH, 4).fillAndStroke(COLORS.white, COLORS.border);
    doc.rect(cx, y, cardW, 3).fill(theme.accent);
    doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
      .text(String(h.label || '').toUpperCase(), cx + 10, y + 9, { width: cardW - 20, lineBreak: false });
    const valText = str(h.value);
    doc.font(F.displayBold).fontSize(valText.length > 10 ? 12.5 : 15).fillColor(theme.primary)
      .text(valText, cx + 10, y + 23, { width: cardW - 20, lineBreak: false });
    doc.restore();
  });

  return y + cardH + 14;
}

function drawCoverContentsOutline(doc, pages, x, y, w, F, theme) {
  const named = (pages || []).filter((p) => p && p.title).slice(0, 6);
  if (!named.length) return y;

  doc.save();
  doc.font(F.displayBold).fontSize(7.5).fillColor(theme.cobalt || theme.primary)
    .text('REPORT CONTENTS & STRUCTURE', x, y, { width: w, lineBreak: false });
  doc.lineWidth(0.6).strokeColor(COLORS.border)
    .moveTo(x, y + 12).lineTo(x + w, y + 12).stroke();

  const colW = (w - 16) / 2;
  named.forEach((p, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ix = x + col * (colW + 16);
    const iy = y + 18 + row * 17;
    const num = String(idx + 1).padStart(2, '0');
    doc.font(F.displayBold).fontSize(8.2).fillColor(theme.accent)
      .text(`${num}. `, ix, iy, { continued: true, width: colW });
    doc.font(F.bodyMedium).fillColor(COLORS.ink)
      .text(p.title, { width: colW, lineBreak: false });
  });
  doc.restore();

  const rows = Math.ceil(named.length / 2);
  return y + 22 + rows * 17 + 10;
}

function drawCoverControlBox(doc, spec, x, y, w, F, theme) {
  const meta = spec.meta || {};
  const entries = [
    ['Document ID', theme.docCode || spec.docCode || 'CAE-RPT'],
    ['Generated', formatGeneratedDate(meta)],
    ...(meta.generatedBy ? [['Prepared By', meta.generatedBy]] : []),
    ...(meta.filters || []).slice(0, 5).map((f) => [f.label, str(f.value)])
  ];

  const rows = Math.ceil(entries.length / 2);
  const boxH = rows * 16 + 24;
  const colW = (w - 24) / 2;

  doc.save();
  doc.roundedRect(x, y, w, boxH, 5).fillAndStroke(COLORS.zebra, COLORS.border);
  doc.rect(x, y, 4, boxH).fill(theme.primary);
  doc.font(F.displaySemiBold).fontSize(7).fillColor(theme.primary)
    .text('DOCUMENT CONTROL & ACTIVE SCOPE', x + 14, y + 7, { width: w - 28, lineBreak: false });

  entries.forEach(([k, v], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ix = x + 14 + col * colW;
    const iy = y + 21 + row * 16;
    doc.font(F.displaySemiBold).fontSize(7.8).fillColor(COLORS.subtle)
      .text(`${k}: `, ix, iy, { continued: true, width: colW - 8 });
    doc.font(F.bodyMedium).fillColor(COLORS.ink)
      .text(str(v), { width: colW - 8, lineBreak: false });
  });
  doc.restore();

  return y + boxH;
}

/**
 * Draw the unified official CAE A4 Portrait Page 1 Cover (`diagonal-hero`).
 */
function drawCoverPage(doc, spec, F, theme) {
  const W = doc.page.width;
  const H = doc.page.height;
  const tagline = theme.coverTagline || COMPANY.tagline;
  const conf = spec.meta?.confidentiality || COMPANY.confidentiality;
  const lightLogo = getLogoBuffer('light');

  doc.save();
  doc.rect(0, 0, W, H).fill(COLORS.white);
  doc.moveTo(0, 0).lineTo(W, 0).lineTo(W, 348).lineTo(0, 408).closePath().fill(theme.primary);
  doc.moveTo(0, 408).lineTo(W, 348).lineTo(W, 360).lineTo(0, 420).closePath().fill(theme.accent);
  doc.moveTo(0, 420).lineTo(W, 360).lineTo(W, 364).lineTo(0, 424).closePath().fill(theme.secondary || COLORS.cyan);
  doc.restore();

  if (lightLogo) doc.image(lightLogo, MARGIN, 40, { width: 112, height: 42 });

  doc.save();
  doc.roundedRect(W - MARGIN - 104, 48, 104, 21, 3).fill(COLORS.navyLight);
  doc.font(F.displayBold).fontSize(8.5).fillColor(theme.secondary || COLORS.cyan)
    .text(theme.docCode, W - MARGIN - 104, 54, { width: 104, align: 'center', lineBreak: false });

  doc.font(F.displaySemiBold).fontSize(9.5).fillColor(theme.secondary || COLORS.cyan)
    .text(String(spec.category || '').toUpperCase(), MARGIN, 134, { width: W - MARGIN * 2 });
  doc.font(F.displayBold).fontSize(28).fillColor(COLORS.white)
    .text(spec.title, MARGIN, 155, { width: W - MARGIN * 2 });
  if (spec.subtitle) {
    doc.font(F.displayLight).fontSize(11).fillColor('#CBD5E1')
      .text(spec.subtitle, MARGIN, Math.min(290, doc.y + 10), { width: W - MARGIN * 2 });
  }
  doc.restore();

  let lowerY = 446;
  lowerY = drawCoverHighlightsStrip(doc, spec.coverHighlights, MARGIN, lowerY, W - MARGIN * 2, F, theme);
  lowerY = drawCoverContentsOutline(doc, spec.pages, MARGIN, lowerY, W - MARGIN * 2, F, theme);

  const controlY = Math.max(lowerY + 6, Math.min(646, lowerY + 12));
  drawCoverControlBox(doc, spec, MARGIN, controlY, W - MARGIN * 2, F, theme);

  doc.save().font(F.body).fontSize(8).fillColor(COLORS.subtle)
    .text(`${COMPANY.name}  ·  ${tagline}  ·  ${conf}`, MARGIN, H - 34, { width: W - MARGIN * 2, lineBreak: false })
    .restore();
}

/** Numbered custom page banner (`SECTION 01 · SITUATIONAL COMMAND CENTER`). */
function drawPageBanner(doc, pageNum, eyebrow, title, subtitle, y, contentW, F, theme) {
  doc.save();
  const eye = eyebrow || `SECTION ${String(pageNum).padStart(2, '0')}`;
  doc.font(F.displayBold).fontSize(7.8).fillColor(theme.accent)
    .text(String(eye).toUpperCase(), MARGIN, y, { width: contentW, lineBreak: false });
  doc.font(F.displayBold).fontSize(15).fillColor(theme.primary)
    .text(title, MARGIN, y + 11, { width: contentW, lineBreak: false });
  const ruleY = subtitle ? y + 43 : y + 32;
  if (subtitle) {
    doc.font(F.body).fontSize(8.5).fillColor(COLORS.subtle)
      .text(subtitle, MARGIN, y + 29, { width: contentW, lineBreak: false });
  }
  doc.rect(MARGIN, ruleY, 52, 2.5).fill(theme.accent);
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .moveTo(MARGIN + 56, ruleY + 1).lineTo(MARGIN + contentW, ruleY + 1).stroke();
  doc.restore();
  return ruleY + 12;
}

/** Narrative executive brief card. */
function drawExecutiveBrief(doc, title, text, y, contentW, F, theme) {
  if (!text) return y;
  doc.font(F.body).fontSize(9);
  const textH = doc.heightOfString(text, { width: contentW - 26, lineGap: 2.3 });
  const boxH = textH + 26;

  doc.save();
  doc.roundedRect(MARGIN, y, contentW, boxH, 4).fillAndStroke(theme.tint || COLORS.zebra, COLORS.border);
  doc.rect(MARGIN, y, 4, boxH).fill(theme.accent);
  doc.font(F.displayBold).fontSize(7.5).fillColor(theme.primary)
    .text(String(title || 'EXECUTIVE BRIEF').toUpperCase(), MARGIN + 13, y + 7, { lineBreak: false });
  doc.font(F.body).fontSize(9).fillColor(COLORS.body)
    .text(text, MARGIN + 13, y + 19, { width: contentW - 26, lineGap: 2.3 });
  doc.restore();
  return y + boxH + 12;
}

/**
 * Draw KPI block in requested layout variant:
 * 'hero-split' | 'compact-row' | 'strips' | 'gauges' | 'grid-2col'
 */
function drawThemedKpis(doc, spec, kpis, variant, startY, contentW, F, theme, ensurePageFn) {
  if (!kpis || !kpis.length) return startY;
  const style = variant || 'grid-2col';
  let y = startY;

  if (style === 'hero-split' && kpis.length >= 2) {
    const hero = kpis[0];
    const rest = kpis.slice(1, 5);
    const heroW = contentW * 0.42;
    const gap = 10;
    const gridW = contentW - heroW - gap;
    const totalH = rest.length > 2 ? 120 : 68;
    y = ensurePageFn(doc, spec, y, totalH + 10, F, theme);

    doc.save();
    doc.roundedRect(MARGIN, y, heroW, totalH, 5).fill(theme.primary);
    doc.rect(MARGIN, y, heroW, 3.5).fill(theme.accent);
    doc.font(F.displaySemiBold).fontSize(7.5).fillColor(theme.secondary || COLORS.cyan)
      .text(String(hero.label || '').toUpperCase(), MARGIN + 13, y + 13, { width: heroW - 26, lineBreak: false });
    doc.font(F.displayBold).fontSize(22).fillColor(COLORS.white)
      .text(str(hero.value), MARGIN + 13, y + 34, { width: heroW - 26, lineBreak: false });
    if (hero.sublabel) {
      doc.font(F.body).fontSize(8.2).fillColor('#CBD5E1')
        .text(str(hero.sublabel), MARGIN + 13, y + 70, { width: heroW - 26 });
    }
    doc.restore();

    const tileW = (gridW - gap) / 2;
    const tileH = rest.length > 2 ? (totalH - gap) / 2 : totalH;
    rest.forEach((k, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const tx = MARGIN + heroW + gap + col * (tileW + gap);
      const ty = y + row * (tileH + gap);
      const tone = toneStyle(k.tone);
      const valCol = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : COLORS.navy;

      doc.save();
      doc.roundedRect(tx, ty, tileW, tileH, 4).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(tx, ty, tileW, 2.5).fill(tone ? tone.accent : theme.accent);
      doc.font(F.displaySemiBold).fontSize(6.8).fillColor(COLORS.subtle)
        .text(String(k.label || '').toUpperCase(), tx + 9, ty + 7, { width: tileW - 18, lineBreak: false });
      doc.font(F.displayBold).fontSize(14).fillColor(valCol)
        .text(str(k.value), tx + 9, ty + 19, { width: tileW - 18, lineBreak: false });
      if (k.sublabel) {
        doc.font(F.body).fontSize(7).fillColor(COLORS.subtle)
          .text(str(k.sublabel), tx + 9, ty + 38, { width: tileW - 18, lineBreak: false });
      }
      doc.restore();
    });

    return y + totalH + 12;
  }

  if (style === 'compact-row') {
    const shown = kpis.slice(0, 4);
    const gap = 8;
    const cardH = 54;
    y = ensurePageFn(doc, spec, y, cardH + 8, F, theme);
    const cardW = (contentW - gap * (shown.length - 1)) / shown.length;

    shown.forEach((k, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(k.tone);
      const valColor = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : theme.primary;
      const valStr = str(k.value);

      doc.save();
      doc.roundedRect(cx, y, cardW, cardH, 4).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(cx, y, cardW, 2.5).fill(tone ? tone.accent : theme.accent);
      doc.font(F.displaySemiBold).fontSize(6.5).fillColor(COLORS.subtle)
        .text(String(k.label || '').toUpperCase(), cx + 8, y + 7, { width: cardW - 16, lineBreak: false });
      doc.font(F.displayBold).fontSize(valStr.length > 9 ? 11.5 : 14).fillColor(valColor)
        .text(valStr, cx + 8, y + 18, { width: cardW - 16, lineBreak: false });
      if (k.sublabel) {
        doc.font(F.body).fontSize(6.8).fillColor(COLORS.subtle)
          .text(str(k.sublabel), cx + 8, y + 38, { width: cardW - 16, lineBreak: false });
      }
      doc.restore();
    });
    return y + cardH + 12;
  }

  // 2-per-row cards ('grid-2col' | 'strips' | 'gauges')
  const gap = 10;
  for (let i = 0; i < kpis.length; i += 2) {
    const chunk = kpis.slice(i, i + 2);
    const cardH = style === 'strips' ? 46 : 56;
    y = ensurePageFn(doc, spec, y, cardH + 8, F, theme);
    const cardW = (contentW - gap * (chunk.length - 1)) / chunk.length;

    chunk.forEach((k, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(k.tone);
      const accentColor = tone ? tone.accent : theme.accent;
      const valColor = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : theme.primary;
      const valStr = str(k.value);

      doc.save();
      if (style === 'strips') {
        doc.roundedRect(cx, y, cardW, cardH, 4).fillAndStroke(COLORS.zebra, COLORS.border);
        doc.rect(cx, y, 4, cardH).fill(accentColor);
        doc.font(F.displaySemiBold).fontSize(7.2).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 11, y + 8, { width: cardW * 0.56, lineBreak: false });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7.2).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + 11, y + 23, { width: cardW * 0.56, lineBreak: false });
        }
        doc.font(F.displayBold).fontSize(valStr.length > 9 ? 12.5 : 15).fillColor(valColor)
          .text(valStr, cx + cardW * 0.55, y + 14, { width: cardW * 0.41, align: 'right', lineBreak: false });
      } else if (style === 'gauges') {
        doc.roundedRect(cx, y, cardW, cardH, 5).fillAndStroke(COLORS.white, COLORS.border);
        doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 10, y + 7, { width: cardW - 20, lineBreak: false });
        doc.font(F.displayBold).fontSize(14).fillColor(valColor)
          .text(valStr, cx + 10, y + 18, { width: cardW * 0.5, lineBreak: false });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + cardW * 0.52, y + 22, { width: cardW * 0.44, align: 'right', lineBreak: false });
        }
        const pctVal = k.percent !== undefined
          ? Math.max(0, Math.min(100, Number(k.percent)))
          : (String(k.numFmt || '').includes('%') ? Math.max(0, Math.min(100, Number(k.rawValue) || 0)) : 65);
        doc.roundedRect(cx + 10, y + 43, cardW - 20, 5, 2.5).fill(COLORS.surface);
        if (pctVal > 0) {
          doc.roundedRect(cx + 10, y + 43, Math.max(6, ((cardW - 20) * pctVal) / 100), 5, 2.5).fill(accentColor);
        }
      } else {
        doc.roundedRect(cx, y, cardW, cardH, 4).fillAndStroke(COLORS.white, COLORS.border);
        doc.rect(cx, y, cardW, 2.8).fill(accentColor);
        doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 10, y + 8, { width: cardW - 20, lineBreak: false });
        doc.font(F.displayBold).fontSize(valStr.length > 10 ? 13 : 16).fillColor(valColor)
          .text(valStr, cx + 10, y + 20, { width: cardW - 20, lineBreak: false });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7.3).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + 10, y + 40, { width: cardW - 20, lineBreak: false });
        }
      }
      doc.restore();
    });

    y += cardH + 8;
  }

  return y + 4;
}

/** Crisp vector radial gauge rings (2 or 3 side-by-side) for executive & compliance reports. */
function drawGaugeBand(doc, items, startY, contentW, F, theme) {
  if (!items || !items.length) return startY;
  const shown = items.slice(0, 3);
  const gap = 10;
  const cardW = (contentW - gap * (shown.length - 1)) / shown.length;
  const cardH = 104;

  shown.forEach((item, idx) => {
    const cxBox = MARGIN + idx * (cardW + gap);
    const centerX = cxBox + cardW / 2;
    const centerY = startY + 38;
    const radius = 25;
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));
    const tone = toneStyle(item.tone);
    const arcCol = tone ? tone.accent : theme.accent;

    doc.save();
    doc.roundedRect(cxBox, startY, cardW, cardH, 5).fillAndStroke(COLORS.white, COLORS.border);

    // Background track circle
    doc.lineWidth(5.5).strokeColor(COLORS.surface).circle(centerX, centerY, radius).stroke();

    // Foreground arc path
    if (pctVal > 0.5) {
      const startA = -Math.PI / 2;
      const span = (pctVal / 100) * Math.PI * 2;
      const steps = Math.max(12, Math.ceil((pctVal / 100) * 48));
      doc.lineWidth(5.5).lineCap('round').strokeColor(arcCol);
      doc.moveTo(centerX + radius * Math.cos(startA), centerY + radius * Math.sin(startA));
      for (let s = 1; s <= steps; s += 1) {
        const a = startA + (span * s) / steps;
        doc.lineTo(centerX + radius * Math.cos(a), centerY + radius * Math.sin(a));
      }
      doc.stroke();
    }

    doc.font(F.displayBold).fontSize(11).fillColor(theme.primary)
      .text(str(item.valueLabel || `${pctVal.toFixed(0)}%`), cxBox + 4, centerY - 6, { width: cardW - 8, align: 'center', lineBreak: false });

    doc.font(F.displayBold).fontSize(8).fillColor(COLORS.ink)
      .text(str(item.label), cxBox + 6, startY + 72, { width: cardW - 12, align: 'center', lineBreak: false });

    if (item.sublabel) {
      doc.font(F.body).fontSize(7).fillColor(COLORS.subtle)
        .text(str(item.sublabel), cxBox + 6, startY + 85, { width: cardW - 12, align: 'center', lineBreak: false });
    }
    doc.restore();
  });

  return startY + cardH + 12;
}

/** Render horizontal progress scorecards (domain health, compliance, attendance). */
function drawScorecards(doc, spec, group, startY, contentW, F, theme, ensurePageFn) {
  if (!group || !group.items?.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 64, F, theme);

  doc.save();
  if (group.title) {
    doc.font(F.displayBold).fontSize(10.5).fillColor(theme.primary)
      .text(group.title, MARGIN, y, { width: contentW, lineBreak: false });
    y += 14;
  }
  if (group.subtitle) {
    doc.font(F.body).fontSize(8).fillColor(COLORS.subtle)
      .text(group.subtitle, MARGIN, y, { width: contentW, lineBreak: false });
    y += 12;
  }
  doc.restore();

  group.items.forEach((item) => {
    y = ensurePageFn(doc, spec, y, 30, F, theme);
    const tone = toneStyle(item.tone);
    const barColor = tone ? tone.accent : theme.accent;
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));

    doc.save();
    doc.font(F.displaySemiBold).fontSize(8.5).fillColor(COLORS.ink)
      .text(str(item.label), MARGIN, y, { width: contentW * 0.68, lineBreak: false });
    doc.font(F.displayBold).fontSize(8.5).fillColor(tone ? tone.fg : theme.primary)
      .text(str(item.valueLabel || `${pctVal.toFixed(1)}%`), MARGIN + contentW * 0.68, y, {
        width: contentW * 0.32,
        align: 'right',
        lineBreak: false
      });

    doc.roundedRect(MARGIN, y + 12, contentW, 6, 3).fill(COLORS.surface);
    if (pctVal > 0) {
      doc.roundedRect(MARGIN, y + 12, Math.max(6, (contentW * pctVal) / 100), 6, 3).fill(barColor);
    }

    if (item.detail) {
      doc.font(F.body).fontSize(7.3).fillColor(COLORS.subtle)
        .text(str(item.detail), MARGIN, y + 20, { width: contentW, lineBreak: false });
      y += 32;
    } else {
      y += 24;
    }
    doc.restore();
  });

  return y + 8;
}

function drawHighlights(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = startY;
  if (title) {
    y = ensurePageFn(doc, spec, y, 80, F, theme);
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, lineBreak: false }).restore();
    y += 16;
  }

  const gap = 10;
  for (let i = 0; i < items.length; i += 2) {
    const chunk = items.slice(i, i + 2);
    const boxH = 62;
    y = ensurePageFn(doc, spec, y, boxH + 8, F, theme);
    const cardW = (contentW - gap * (chunk.length - 1)) / chunk.length;

    chunk.forEach((item, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(item.tone || 'info') || toneStyle('info');
      doc.save();
      doc.roundedRect(cx, y, cardW, boxH, 4).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(cx, y, 3.5, boxH).fill(tone.accent);
      doc.font(F.displayBold).fontSize(6.8).fillColor(tone.fg)
        .text(String(item.eyebrow || 'HIGHLIGHT').toUpperCase(), cx + 11, y + 7, { width: cardW * 0.56, lineBreak: false });
      if (item.metric) {
        doc.font(F.displayBold).fontSize(9.5).fillColor(theme.primary)
          .text(str(item.metric), cx + cardW * 0.56, y + 6.5, { width: cardW * 0.40, align: 'right', lineBreak: false });
      }
      doc.font(F.displayBold).fontSize(8.8).fillColor(COLORS.ink)
        .text(str(item.title), cx + 11, y + 20, { width: cardW - 22, lineBreak: false });
      if (item.detail) {
        doc.font(F.body).fontSize(7.6).fillColor(COLORS.body)
          .text(str(item.detail), cx + 11, y + 34, { width: cardW - 22 });
      }
      doc.restore();
    });

    y += boxH + 8;
  }

  return y + 4;
}

/** 2-column structured specification / document control / telemetry fact sheet. */
function drawStatMatrix(doc, title, pairs, startY, contentW, F, theme, ensurePageFn, spec) {
  if (!pairs || !pairs.length) return startY;
  const rows = Math.ceil(pairs.length / 2);
  const boxH = rows * 20 + 18;
  let y = ensurePageFn(doc, spec, startY, Math.min(boxH + 24, 150), F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, lineBreak: false }).restore();
    y += 15;
  }

  const colW = (contentW - 24) / 2;
  doc.save();
  doc.roundedRect(MARGIN, y, contentW, boxH, 4).fillAndStroke(COLORS.zebra, COLORS.border);
  doc.rect(MARGIN, y, 3.5, boxH).fill(theme.primary);

  pairs.forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ix = MARGIN + 13 + col * colW;
    const iy = y + 9 + row * 20;
    doc.font(F.displaySemiBold).fontSize(7.8).fillColor(COLORS.subtle)
      .text(`${str(label)}: `, ix, iy, { continued: true, width: colW - 8 });
    doc.font(F.bodyMedium).fillColor(COLORS.ink)
      .text(str(value), { width: colW - 8, lineBreak: false });
  });
  doc.restore();

  return y + boxH + 12;
}

/** Structured spotlight list for top sorties, featured SOPs, or escalations. */
function drawCardList(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 72, F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, lineBreak: false }).restore();
    y += 16;
  }

  items.forEach((item) => {
    doc.font(F.body).fontSize(8);
    const detailH = item.detail ? doc.heightOfString(str(item.detail), { width: contentW - 24 }) : 0;
    const cardH = Math.max(40, 28 + detailH + (item.meta ? 12 : 0));
    y = ensurePageFn(doc, spec, y, cardH + 6, F, theme);

    const tone = toneStyle(item.badgeTone || 'info') || toneStyle('info');
    doc.save();
    doc.roundedRect(MARGIN, y, contentW, cardH, 4).fillAndStroke(COLORS.white, COLORS.border);
    doc.rect(MARGIN, y, 3.5, cardH).fill(tone.accent);

    let titleX = MARGIN + 12;
    if (item.badge) {
      const bText = String(item.badge).toUpperCase();
      doc.font(F.displayBold).fontSize(6.5);
      const bw = Math.min(82, doc.widthOfString(bText) + 12);
      doc.roundedRect(titleX, y + 7, bw, 13, 3).fill(tone.bg);
      doc.fillColor(tone.fg).text(bText, titleX + 2, y + 10, { width: bw - 4, align: 'center', lineBreak: false });
      titleX += bw + 8;
    }

    const metricW = item.metric ? 90 : 0;
    doc.font(F.displayBold).fontSize(9.2).fillColor(COLORS.ink)
      .text(str(item.title), titleX, y + 8, { width: contentW - (titleX - MARGIN) - metricW - 12, lineBreak: false });

    if (item.metric) {
      doc.font(F.displayBold).fontSize(9.5).fillColor(theme.primary)
        .text(str(item.metric), MARGIN + contentW - 100, y + 8, { width: 88, align: 'right', lineBreak: false });
    }

    let nextY = y + 23;
    if (item.meta) {
      doc.font(F.displaySemiBold).fontSize(7.5).fillColor(COLORS.subtle)
        .text(str(item.meta), MARGIN + 12, nextY, { width: contentW - 24, lineBreak: false });
      nextY += 12;
    }
    if (item.detail) {
      doc.font(F.body).fontSize(8).fillColor(COLORS.body)
        .text(str(item.detail), MARGIN + 12, nextY, { width: contentW - 24 });
    }
    doc.restore();
    y += cardH + 6;
  });

  return y + 6;
}

function drawAlerts(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 56, F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, lineBreak: false }).restore();
    y += 16;
  }

  items.forEach((item) => {
    const tone = toneStyle(item.severity || 'info') || toneStyle('info');
    doc.font(F.body).fontSize(8.2);
    const detailH = item.detail ? doc.heightOfString(str(item.detail), { width: contentW - 26, lineGap: 1.5 }) : 0;
    const boxH = Math.max(30, 21 + detailH);
    y = ensurePageFn(doc, spec, y, boxH + 7, F, theme);

    doc.save();
    doc.roundedRect(MARGIN, y, contentW, boxH, 4).fillAndStroke(tone.bg, tone.border);
    doc.rect(MARGIN, y, 4, boxH).fill(tone.accent);
    doc.font(F.displayBold).fontSize(8.6).fillColor(tone.fg)
      .text(str(item.title), MARGIN + 12, y + 6.5, { width: contentW - 22 });
    if (item.detail) {
      doc.font(F.body).fontSize(8.1).fillColor(COLORS.body)
        .text(str(item.detail), MARGIN + 12, y + 18, { width: contentW - 22, lineGap: 1.5 });
    }
    doc.restore();

    y += boxH + 7;
  });

  return y + 4;
}

module.exports = {
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
};
