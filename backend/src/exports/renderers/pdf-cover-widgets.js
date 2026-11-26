// =============================================================================
// exports/renderers/pdf-cover-widgets.js — CAE A4 Cover & Composable Widgets (v5)
// -----------------------------------------------------------------------------
// Zero-blank-page, spacious executive CAE diagonal-hero Cover Page (Portrait &
// Landscape) + overlap-free composable widgets (`brief`, `kpis`, `gaugeBand`,
// `scorecard`, `highlights`, `statMatrix`, `cardList`, `alerts`).
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

/** Fit a single-line value cleanly inside maxW by scaling fontSize down when needed. */
function fitFontSize(doc, fontName, text, maxW, maxPt, minPt = 8.5) {
  let pt = maxPt;
  doc.font(fontName);
  while (pt > minPt) {
    doc.fontSize(pt);
    if (doc.widthOfString(text) <= maxW) return pt;
    pt -= 0.75;
  }
  return minPt;
}

/** Draw a bounded "Label: Value" pair with guaranteed zero bleed into adjacent columns. */
function drawBoundedKeyValue(doc, label, value, x, y, maxW, F, labelSize = 7.8, valSize = 8) {
  const lbl = `${str(label)}: `;
  doc.font(F.displaySemiBold).fontSize(labelSize);
  const rawLblW = doc.widthOfString(lbl);
  const maxLblW = Math.min(rawLblW + 1, maxW * 0.48);
  doc.fillColor(COLORS.subtle)
    .text(lbl, x, y, { width: maxLblW, height: labelSize + 4, lineBreak: false, ellipsis: true });

  const valX = x + maxLblW + 2;
  const valW = Math.max(24, maxW - maxLblW - 4);
  doc.font(F.bodyMedium).fontSize(valSize).fillColor(COLORS.ink)
    .text(str(value), valX, y, { width: valW, height: valSize + 4, lineBreak: false, ellipsis: true });
}

function drawCoverHighlightsStrip(doc, highlights, x, y, w, F, theme, compact = false) {
  if (!highlights || !highlights.length) return y;
  const shown = highlights.slice(0, 3);
  const gap = 12;
  const cardW = (w - gap * (shown.length - 1)) / shown.length;
  const cardH = compact ? 52 : 60;

  shown.forEach((h, i) => {
    const cx = x + i * (cardW + gap);
    const innerW = cardW - 22;
    const valText = str(h.value);
    const valPt = fitFontSize(doc, F.displayBold, valText, innerW, compact ? 13.5 : 15.5, 9.5);

    doc.save();
    doc.roundedRect(cx, y, cardW, cardH, 5).fillAndStroke(COLORS.white, COLORS.border);
    doc.rect(cx, y, cardW, 3.2).fill(theme.accent);
    doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
      .text(String(h.label || '').toUpperCase(), cx + 11, y + (compact ? 9 : 11), {
        width: innerW,
        height: 11,
        lineBreak: false,
        ellipsis: true
      });
    doc.font(F.displayBold).fontSize(valPt).fillColor(theme.primary)
      .text(valText, cx + 11, y + (compact ? 25 : 29), {
        width: innerW,
        height: valPt + 6,
        lineBreak: false,
        ellipsis: true
      });
    doc.restore();
  });

  return y + cardH + (compact ? 14 : 22);
}

function drawCoverContentsOutline(doc, pages, x, y, w, F, theme, singleCol = false) {
  const named = (pages || []).filter((p) => p && p.title).slice(0, 6);
  if (!named.length) return y;

  const cols = singleCol ? 1 : 2;
  const colGap = 18;
  const colW = cols === 2 ? (w - colGap) / 2 : w;
  const rowH = singleCol ? 20 : 22;

  doc.save();
  doc.font(F.displayBold).fontSize(7.8).fillColor(theme.cobalt || theme.primary)
    .text('REPORT CONTENTS & STRUCTURE', x, y, { width: w, height: 12, lineBreak: false });
  doc.lineWidth(0.75).strokeColor(COLORS.border)
    .moveTo(x, y + 14).lineTo(x + w, y + 14).stroke();

  named.forEach((p, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ix = x + col * (colW + colGap);
    const iy = y + 24 + row * rowH;
    const num = String(idx + 1).padStart(2, '0');

    doc.font(F.displayBold).fontSize(8.2).fillColor(theme.accent)
      .text(`${num}.`, ix, iy, { width: 20, height: 12, lineBreak: false });
    doc.font(F.bodyMedium).fontSize(8.3).fillColor(COLORS.ink)
      .text(str(p.title), ix + 20, iy, {
        width: Math.max(40, colW - 24),
        height: 12,
        lineBreak: false,
        ellipsis: true
      });
  });
  doc.restore();

  const rows = Math.ceil(named.length / cols);
  return y + 26 + rows * rowH + 18;
}

function drawCoverControlBox(doc, spec, x, y, w, F, theme, maxBottomY, singleCol = false) {
  const meta = spec.meta || {};
  const entries = [
    ['Document ID', theme.docCode || spec.docCode || 'CAE-RPT'],
    ['Generated', formatGeneratedDate(meta)],
    ...(meta.generatedBy ? [['Prepared By', meta.generatedBy]] : []),
    ...(meta.filters || []).slice(0, 5).map((f) => [f.label, str(f.value)])
  ];

  const cols = singleCol ? 1 : 2;
  const maxEntries = singleCol ? 5 : 8;
  const shown = entries.slice(0, maxEntries);
  const rows = Math.ceil(shown.length / cols);
  const headerH = 26;
  const rowH = 21;
  const desiredH = headerH + rows * rowH + 10;
  const availH = Math.max(64, maxBottomY - y);
  const effectiveRowH = desiredH <= availH ? rowH : Math.max(16, Math.floor((availH - headerH - 8) / Math.max(rows, 1)));
  const boxH = Math.min(availH, headerH + rows * effectiveRowH + 10);
  const colGap = 16;
  const colW = cols === 2 ? (w - 28 - colGap) / 2 : (w - 28);

  doc.save();
  doc.roundedRect(x, y, w, boxH, 5).fillAndStroke(COLORS.zebra, COLORS.border);
  doc.rect(x, y, 4, boxH).fill(theme.primary);
  doc.font(F.displayBold).fontSize(7.4).fillColor(theme.primary)
    .text('DOCUMENT CONTROL & ACTIVE SCOPE', x + 15, y + 9, { width: w - 30, height: 11, lineBreak: false });
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .moveTo(x + 15, y + 21).lineTo(x + w - 14, y + 21).stroke();

  shown.forEach(([k, v], idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ix = x + 15 + col * (colW + colGap);
    const iy = y + headerH + 2 + row * effectiveRowH;
    if (iy + 12 <= y + boxH) {
      drawBoundedKeyValue(doc, k, v, ix, iy, colW, F, 7.6, 7.8);
    }
  });
  doc.restore();

  return y + boxH;
}

/**
 * Draw the unified official CAE A4 Cover (`diagonal-hero`), adapting cleanly
 * to BOTH Portrait and Landscape while staying strictly inside `doc.page.maxY()`
 * so PDFKit NEVER emits a trailing blank Page 2.
 */
function drawCoverPage(doc, spec, F, theme) {
  const W = doc.page.width;
  const H = doc.page.height;
  const contentW = W - MARGIN * 2;
  const isLandscape = W > H;
  const tagline = theme.coverTagline || COMPANY.tagline;
  const conf = spec.meta?.confidentiality || COMPANY.confidentiality;
  const lightLogo = getLogoBuffer('light');
  const periodInfo = spec.meta?.period;
  const periodPillText = periodInfo && periodInfo.type && periodInfo.type !== 'all'
    ? String(periodInfo.label || '').toUpperCase()
    : '';

  const heroRightY = isLandscape ? 212 : 292;
  const heroLeftY = isLandscape ? 248 : 344;
  const ribbonH = isLandscape ? 7 : 9;
  const cyanH = 3.5;

  // Background + Diagonal Hero Geometry
  doc.save();
  doc.rect(0, 0, W, H).fill(COLORS.white);
  doc.moveTo(0, 0).lineTo(W, 0).lineTo(W, heroRightY).lineTo(0, heroLeftY).closePath().fill(theme.primary);
  doc.moveTo(0, heroLeftY).lineTo(W, heroRightY).lineTo(W, heroRightY + ribbonH).lineTo(0, heroLeftY + ribbonH).closePath().fill(theme.accent);
  doc.moveTo(0, heroLeftY + ribbonH).lineTo(W, heroRightY + ribbonH)
    .lineTo(W, heroRightY + ribbonH + cyanH).lineTo(0, heroLeftY + ribbonH + cyanH).closePath()
    .fill(theme.secondary || COLORS.cyan);
  doc.restore();

  // Top Header Row: Logo + DocCode Badge + Optional Periodicity Badge
  const topY = isLandscape ? 28 : 38;
  if (lightLogo) {
    doc.image(lightLogo, MARGIN, topY, { width: isLandscape ? 98 : 110, height: isLandscape ? 37 : 41 });
  }

  doc.save();
  const docCode = String(theme.docCode || spec.docCode || 'CAE-RPT');
  doc.font(F.displayBold).fontSize(8.2);
  const codePillW = Math.max(92, Math.min(188, doc.widthOfString(docCode) + 24));
  const codePillX = W - MARGIN - codePillW;
  const pillY = topY + 6;
  doc.roundedRect(codePillX, pillY, codePillW, 22, 4).fill(COLORS.navyLight);
  doc.font(F.displayBold).fontSize(8.2).fillColor(theme.secondary || COLORS.cyan)
    .text(docCode, codePillX + 6, pillY + 6, { width: codePillW - 12, height: 12, align: 'center', lineBreak: false, ellipsis: true });

  if (periodPillText) {
    doc.font(F.displayBold).fontSize(7.6);
    const perPillW = Math.max(88, Math.min(160, doc.widthOfString(periodPillText) + 20));
    const perPillX = codePillX - perPillW - 8;
    doc.roundedRect(perPillX, pillY, perPillW, 22, 4).fill(theme.accent);
    doc.font(F.displayBold).fontSize(7.6).fillColor(COLORS.white)
      .text(periodPillText, perPillX + 6, pillY + 6.5, { width: perPillW - 12, height: 12, align: 'center', lineBreak: false, ellipsis: true });
  }

  // Category Eyebrow + Auto-Fitted Title + Non-Colliding Subtitle
  const catY = isLandscape ? 90 : 114;
  doc.font(F.displaySemiBold).fontSize(9).fillColor(theme.secondary || COLORS.cyan)
    .text(String(spec.category || 'OPERATIONS INTELLIGENCE').toUpperCase(), MARGIN, catY, {
      width: contentW,
      height: 14,
      lineBreak: false,
      ellipsis: true
    });

  const titleY = catY + 20;
  const maxTitleBoxH = isLandscape ? 64 : 96;
  let titlePt = isLandscape ? 23 : 26;
  doc.font(F.displayBold).fontSize(titlePt);
  while (titlePt > 17 && doc.heightOfString(str(spec.title), { width: contentW }) > maxTitleBoxH) {
    titlePt -= 1.5;
    doc.fontSize(titlePt);
  }
  const actualTitleH = Math.min(maxTitleBoxH + 8, doc.heightOfString(str(spec.title), { width: contentW }));
  doc.font(F.displayBold).fontSize(titlePt).fillColor(COLORS.white)
    .text(str(spec.title), MARGIN, titleY, { width: contentW, height: maxTitleBoxH + 8, ellipsis: true });

  if (spec.subtitle) {
    const subY = titleY + actualTitleH + 10;
    const subMaxH = Math.max(18, (heroRightY - 14) - subY);
    doc.font(F.displayLight).fontSize(isLandscape ? 10 : 10.8).fillColor('#CBD5E1')
      .text(str(spec.subtitle), MARGIN, subY, { width: contentW, height: subMaxH, lineGap: 2, ellipsis: true });
  }
  doc.restore();

  // Safe bottom boundary STRICTLY inside doc.page.maxY() (H - MARGIN)
  const footerY = H - MARGIN - 13;
  const maxControlBottomY = footerY - 14;

  // Lower White Zone with Spacious Layout
  let lowerY = heroLeftY + ribbonH + cyanH + (isLandscape ? 16 : 26);
  lowerY = drawCoverHighlightsStrip(doc, spec.coverHighlights, MARGIN, lowerY, contentW, F, theme, isLandscape);

  if (isLandscape) {
    const colGap = 18;
    const halfW = (contentW - colGap) / 2;
    drawCoverContentsOutline(doc, spec.pages, MARGIN, lowerY, halfW, F, theme, true);
    drawCoverControlBox(doc, spec, MARGIN + halfW + colGap, lowerY, halfW, F, theme, maxControlBottomY, true);
  } else {
    lowerY = drawCoverContentsOutline(doc, spec.pages, MARGIN, lowerY, contentW, F, theme, false);
    const controlY = Math.min(lowerY + 4, maxControlBottomY - 84);
    drawCoverControlBox(doc, spec, MARGIN, Math.max(lowerY, controlY), contentW, F, theme, maxControlBottomY, false);
  }

  // Cover Footer strictly inside margins (never triggers PDFKit auto-addPage!)
  doc.save();
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .moveTo(MARGIN, footerY - 6).lineTo(MARGIN + contentW, footerY - 6).stroke();
  doc.font(F.body).fontSize(7.6).fillColor(COLORS.subtle)
    .text(`${COMPANY.name}  ·  ${tagline}  ·  ${conf}`, MARGIN, footerY, {
      width: contentW,
      height: 11,
      lineBreak: false,
      ellipsis: true
    });
  doc.restore();
}

/** Numbered custom page banner with safe wrapping & generous vertical breathing room. */
function drawPageBanner(doc, pageNum, eyebrow, title, subtitle, y, contentW, F, theme) {
  doc.save();
  const eye = eyebrow || `SECTION ${String(pageNum).padStart(2, '0')}`;
  doc.font(F.displayBold).fontSize(7.6).fillColor(theme.accent)
    .text(String(eye).toUpperCase(), MARGIN, y, { width: contentW, height: 11, lineBreak: false, ellipsis: true });

  const titleY = y + 12;
  doc.font(F.displayBold).fontSize(14.5);
  const titleH = Math.min(36, doc.heightOfString(str(title), { width: contentW }));
  doc.fillColor(theme.primary)
    .text(str(title), MARGIN, titleY, { width: contentW, height: 38, ellipsis: true });

  let cursorY = titleY + titleH + 4;
  if (subtitle) {
    doc.font(F.body).fontSize(8.4);
    const subH = Math.min(24, doc.heightOfString(str(subtitle), { width: contentW }));
    doc.fillColor(COLORS.subtle)
      .text(str(subtitle), MARGIN, cursorY, { width: contentW, height: 26, ellipsis: true });
    cursorY += subH + 6;
  } else {
    cursorY += 4;
  }

  doc.rect(MARGIN, cursorY, 54, 2.5).fill(theme.accent);
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .moveTo(MARGIN + 58, cursorY + 1).lineTo(MARGIN + contentW, cursorY + 1).stroke();
  doc.restore();

  return cursorY + 15;
}

/** Narrative executive brief card with spacious padding. */
function drawExecutiveBrief(doc, title, text, y, contentW, F, theme) {
  if (!text) return y;
  doc.font(F.body).fontSize(8.9);
  const textH = doc.heightOfString(str(text), { width: contentW - 28, lineGap: 2.6 });
  const boxH = textH + 30;

  doc.save();
  doc.roundedRect(MARGIN, y, contentW, boxH, 5).fillAndStroke(theme.tint || COLORS.zebra, COLORS.border);
  doc.rect(MARGIN, y, 4, boxH).fill(theme.accent);
  doc.font(F.displayBold).fontSize(7.4).fillColor(theme.primary)
    .text(String(title || 'EXECUTIVE BRIEF').toUpperCase(), MARGIN + 14, y + 9, { width: contentW - 28, height: 11, lineBreak: false, ellipsis: true });
  doc.font(F.body).fontSize(8.9).fillColor(COLORS.body)
    .text(str(text), MARGIN + 14, y + 22, { width: contentW - 28, lineGap: 2.6 });
  doc.restore();

  return y + boxH + 15;
}

/**
 * Draw KPI block in requested layout variant with dynamic font-fit & zero overflow:
 * 'hero-split' | 'compact-row' | 'strips' | 'gauges' | 'grid-2col'
 */
function drawThemedKpis(doc, spec, kpis, variant, startY, contentW, F, theme, ensurePageFn) {
  if (!kpis || !kpis.length) return startY;
  const style = variant || 'grid-2col';
  let y = startY;

  if (style === 'hero-split' && kpis.length >= 2) {
    const hero = kpis[0];
    const rest = kpis.slice(1, 5);
    const heroW = contentW * 0.41;
    const gap = 10;
    const gridW = contentW - heroW - gap;
    const totalH = rest.length > 2 ? 132 : 72;
    y = ensurePageFn(doc, spec, y, totalH + 14, F, theme);

    const heroInnerW = heroW - 26;
    const heroVal = str(hero.value);
    const heroPt = fitFontSize(doc, F.displayBold, heroVal, heroInnerW, 21, 13);

    doc.save();
    doc.roundedRect(MARGIN, y, heroW, totalH, 5).fill(theme.primary);
    doc.rect(MARGIN, y, heroW, 3.5).fill(theme.accent);
    doc.font(F.displaySemiBold).fontSize(7.4).fillColor(theme.secondary || COLORS.cyan)
      .text(String(hero.label || '').toUpperCase(), MARGIN + 13, y + 14, { width: heroInnerW, height: 11, lineBreak: false, ellipsis: true });
    doc.font(F.displayBold).fontSize(heroPt).fillColor(COLORS.white)
      .text(heroVal, MARGIN + 13, y + 36, { width: heroInnerW, height: heroPt + 8, lineBreak: false, ellipsis: true });
    if (hero.sublabel) {
      doc.font(F.body).fontSize(8).fillColor('#CBD5E1')
        .text(str(hero.sublabel), MARGIN + 13, y + 74, { width: heroInnerW, height: Math.max(16, totalH - 84), lineGap: 1.8, ellipsis: true });
    }
    doc.restore();

    const tileW = (gridW - gap) / 2;
    const tileH = rest.length > 2 ? (totalH - gap) / 2 : totalH;
    const tileInnerW = tileW - 18;
    rest.forEach((k, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const tx = MARGIN + heroW + gap + col * (tileW + gap);
      const ty = y + row * (tileH + gap);
      const tone = toneStyle(k.tone);
      const valCol = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : COLORS.navy;
      const vStr = str(k.value);
      const vPt = fitFontSize(doc, F.displayBold, vStr, tileInnerW, 13.5, 9);

      doc.save();
      doc.roundedRect(tx, ty, tileW, tileH, 4.5).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(tx, ty, tileW, 2.6).fill(tone ? tone.accent : theme.accent);
      doc.font(F.displaySemiBold).fontSize(6.7).fillColor(COLORS.subtle)
        .text(String(k.label || '').toUpperCase(), tx + 9, ty + 8, { width: tileInnerW, height: 10, lineBreak: false, ellipsis: true });
      doc.font(F.displayBold).fontSize(vPt).fillColor(valCol)
        .text(vStr, tx + 9, ty + 21, { width: tileInnerW, height: vPt + 5, lineBreak: false, ellipsis: true });
      if (k.sublabel) {
        doc.font(F.body).fontSize(6.9).fillColor(COLORS.subtle)
          .text(str(k.sublabel), tx + 9, ty + tileH - 17, { width: tileInnerW, height: 11, lineBreak: false, ellipsis: true });
      }
      doc.restore();
    });

    return y + totalH + 16;
  }

  if (style === 'compact-row') {
    const shown = kpis.slice(0, 4);
    const gap = 9;
    const cardH = 60;
    y = ensurePageFn(doc, spec, y, cardH + 12, F, theme);
    const cardW = (contentW - gap * (shown.length - 1)) / shown.length;
    const innerW = cardW - 16;

    shown.forEach((k, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(k.tone);
      const valColor = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : theme.primary;
      const valStr = str(k.value);
      const vPt = fitFontSize(doc, F.displayBold, valStr, innerW, 13.5, 9);

      doc.save();
      doc.roundedRect(cx, y, cardW, cardH, 4.5).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(cx, y, cardW, 2.6).fill(tone ? tone.accent : theme.accent);
      doc.font(F.displaySemiBold).fontSize(6.6).fillColor(COLORS.subtle)
        .text(String(k.label || '').toUpperCase(), cx + 8, y + 8, { width: innerW, height: 10, lineBreak: false, ellipsis: true });
      doc.font(F.displayBold).fontSize(vPt).fillColor(valColor)
        .text(valStr, cx + 8, y + 21, { width: innerW, height: vPt + 5, lineBreak: false, ellipsis: true });
      if (k.sublabel) {
        doc.font(F.body).fontSize(6.8).fillColor(COLORS.subtle)
          .text(str(k.sublabel), cx + 8, y + 43, { width: innerW, height: 11, lineBreak: false, ellipsis: true });
      }
      doc.restore();
    });
    return y + cardH + 16;
  }

  // 2-per-row cards ('grid-2col' | 'strips' | 'gauges')
  const gap = 10;
  for (let i = 0; i < kpis.length; i += 2) {
    const chunk = kpis.slice(i, i + 2);
    const cardH = style === 'strips' ? 52 : 62;
    y = ensurePageFn(doc, spec, y, cardH + 10, F, theme);
    const cardW = (contentW - gap * (chunk.length - 1)) / chunk.length;

    chunk.forEach((k, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(k.tone);
      const accentColor = tone ? tone.accent : theme.accent;
      const valColor = tone && (k.tone === 'danger' || k.tone === 'warning') ? tone.fg : theme.primary;
      const valStr = str(k.value);

      doc.save();
      if (style === 'strips') {
        const leftW = cardW * 0.56;
        const rightW = cardW * 0.36;
        const vPt = fitFontSize(doc, F.displayBold, valStr, rightW, 14.5, 9.5);
        doc.roundedRect(cx, y, cardW, cardH, 4.5).fillAndStroke(COLORS.zebra, COLORS.border);
        doc.rect(cx, y, 4, cardH).fill(accentColor);
        doc.font(F.displaySemiBold).fontSize(7.2).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 12, y + 10, { width: leftW, height: 11, lineBreak: false, ellipsis: true });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7.3).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + 12, y + 27, { width: leftW, height: 12, lineBreak: false, ellipsis: true });
        }
        doc.font(F.displayBold).fontSize(vPt).fillColor(valColor)
          .text(valStr, cx + cardW - rightW - 10, y + 17, { width: rightW, height: vPt + 5, align: 'right', lineBreak: false, ellipsis: true });
      } else if (style === 'gauges') {
        const vPt = fitFontSize(doc, F.displayBold, valStr, cardW * 0.48, 14, 9.5);
        doc.roundedRect(cx, y, cardW, cardH, 5).fillAndStroke(COLORS.white, COLORS.border);
        doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 11, y + 8, { width: cardW - 22, height: 10, lineBreak: false, ellipsis: true });
        doc.font(F.displayBold).fontSize(vPt).fillColor(valColor)
          .text(valStr, cx + 11, y + 21, { width: cardW * 0.48, height: vPt + 4, lineBreak: false, ellipsis: true });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7.2).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + cardW * 0.52, y + 25, { width: cardW * 0.43, height: 11, align: 'right', lineBreak: false, ellipsis: true });
        }
        const pctVal = k.percent !== undefined
          ? Math.max(0, Math.min(100, Number(k.percent)))
          : (String(k.numFmt || '').includes('%') ? Math.max(0, Math.min(100, Number(k.rawValue) || 0)) : 65);
        doc.roundedRect(cx + 11, y + 47, cardW - 22, 5.5, 2.75).fill(COLORS.surface);
        if (pctVal > 0) {
          doc.roundedRect(cx + 11, y + 47, Math.max(6, ((cardW - 22) * pctVal) / 100), 5.5, 2.75).fill(accentColor);
        }
      } else {
        const innerW = cardW - 22;
        const vPt = fitFontSize(doc, F.displayBold, valStr, innerW, 15.5, 9.5);
        doc.roundedRect(cx, y, cardW, cardH, 4.5).fillAndStroke(COLORS.white, COLORS.border);
        doc.rect(cx, y, cardW, 2.8).fill(accentColor);
        doc.font(F.displaySemiBold).fontSize(7).fillColor(COLORS.subtle)
          .text(String(k.label || '').toUpperCase(), cx + 11, y + 9, { width: innerW, height: 10, lineBreak: false, ellipsis: true });
        doc.font(F.displayBold).fontSize(vPt).fillColor(valColor)
          .text(valStr, cx + 11, y + 22, { width: innerW, height: vPt + 5, lineBreak: false, ellipsis: true });
        if (k.sublabel) {
          doc.font(F.body).fontSize(7.3).fillColor(COLORS.subtle)
            .text(str(k.sublabel), cx + 11, y + 44, { width: innerW, height: 11, lineBreak: false, ellipsis: true });
        }
      }
      doc.restore();
    });

    y += cardH + 10;
  }

  return y + 6;
}

/** Crisp vector radial gauge rings (2 or 3 side-by-side). */
function drawGaugeBand(doc, items, startY, contentW, F, theme) {
  if (!items || !items.length) return startY;
  const shown = items.slice(0, 3);
  const gap = 12;
  const cardW = (contentW - gap * (shown.length - 1)) / shown.length;
  const cardH = 110;

  shown.forEach((item, idx) => {
    const cxBox = MARGIN + idx * (cardW + gap);
    const centerX = cxBox + cardW / 2;
    const centerY = startY + 40;
    const radius = 25;
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));
    const tone = toneStyle(item.tone);
    const arcCol = tone ? tone.accent : theme.accent;

    doc.save();
    doc.roundedRect(cxBox, startY, cardW, cardH, 5).fillAndStroke(COLORS.white, COLORS.border);
    doc.lineWidth(5.5).strokeColor(COLORS.surface).circle(centerX, centerY, radius).stroke();

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

    doc.font(F.displayBold).fontSize(10.5).fillColor(theme.primary)
      .text(str(item.valueLabel || `${pctVal.toFixed(0)}%`), cxBox + 4, centerY - 6, { width: cardW - 8, height: 14, align: 'center', lineBreak: false, ellipsis: true });

    doc.font(F.displayBold).fontSize(8).fillColor(COLORS.ink)
      .text(str(item.label), cxBox + 8, startY + 75, { width: cardW - 16, height: 12, align: 'center', lineBreak: false, ellipsis: true });

    if (item.sublabel) {
      doc.font(F.body).fontSize(7.1).fillColor(COLORS.subtle)
        .text(str(item.sublabel), cxBox + 8, startY + 90, { width: cardW - 16, height: 11, align: 'center', lineBreak: false, ellipsis: true });
    }
    doc.restore();
  });

  return startY + cardH + 16;
}

/** Render horizontal progress scorecards with generous vertical rhythm. */
function drawScorecards(doc, spec, group, startY, contentW, F, theme, ensurePageFn) {
  if (!group || !group.items?.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 68, F, theme);

  doc.save();
  if (group.title) {
    doc.font(F.displayBold).fontSize(10.2).fillColor(theme.primary)
      .text(group.title, MARGIN, y, { width: contentW, height: 14, lineBreak: false, ellipsis: true });
    y += 15;
  }
  if (group.subtitle) {
    doc.font(F.body).fontSize(8).fillColor(COLORS.subtle)
      .text(group.subtitle, MARGIN, y, { width: contentW, height: 12, lineBreak: false, ellipsis: true });
    y += 14;
  }
  doc.restore();

  group.items.forEach((item) => {
    y = ensurePageFn(doc, spec, y, 36, F, theme);
    const tone = toneStyle(item.tone);
    const barColor = tone ? tone.accent : theme.accent;
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));

    doc.save();
    doc.font(F.displaySemiBold).fontSize(8.5).fillColor(COLORS.ink)
      .text(str(item.label), MARGIN, y, { width: contentW * 0.66, height: 12, lineBreak: false, ellipsis: true });
    doc.font(F.displayBold).fontSize(8.5).fillColor(tone ? tone.fg : theme.primary)
      .text(str(item.valueLabel || `${pctVal.toFixed(1)}%`), MARGIN + contentW * 0.67, y, {
        width: contentW * 0.33,
        height: 12,
        align: 'right',
        lineBreak: false,
        ellipsis: true
      });

    doc.roundedRect(MARGIN, y + 13, contentW, 6, 3).fill(COLORS.surface);
    if (pctVal > 0) {
      doc.roundedRect(MARGIN, y + 13, Math.max(6, (contentW * pctVal) / 100), 6, 3).fill(barColor);
    }

    if (item.detail) {
      doc.font(F.body).fontSize(7.4).fillColor(COLORS.subtle)
        .text(str(item.detail), MARGIN, y + 22, { width: contentW, height: 11, lineBreak: false, ellipsis: true });
      y += 36;
    } else {
      y += 26;
    }
    doc.restore();
  });

  return y + 10;
}

/** 2-column highlight cards with dynamic row height so text NEVER overflows borders. */
function drawHighlights(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = startY;
  if (title) {
    y = ensurePageFn(doc, spec, y, 86, F, theme);
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, height: 14, lineBreak: false, ellipsis: true }).restore();
    y += 18;
  }

  const gap = 12;
  for (let i = 0; i < items.length; i += 2) {
    const chunk = items.slice(i, i + 2);
    const cardW = (contentW - gap * (chunk.length - 1)) / chunk.length;
    const innerW = cardW - 24;

    let boxH = 66;
    chunk.forEach((item) => {
      if (item.detail) {
        doc.font(F.body).fontSize(7.7);
        const dh = doc.heightOfString(str(item.detail), { width: innerW, lineGap: 1.8 });
        boxH = Math.max(boxH, 44 + dh);
      }
    });
    boxH = Math.min(boxH, 118);

    y = ensurePageFn(doc, spec, y, boxH + 10, F, theme);

    chunk.forEach((item, idx) => {
      const cx = MARGIN + idx * (cardW + gap);
      const tone = toneStyle(item.tone || 'info') || toneStyle('info');
      doc.save();
      doc.roundedRect(cx, y, cardW, boxH, 4.5).fillAndStroke(COLORS.white, COLORS.border);
      doc.rect(cx, y, 3.5, boxH).fill(tone.accent);
      doc.font(F.displayBold).fontSize(6.8).fillColor(tone.fg)
        .text(String(item.eyebrow || 'HIGHLIGHT').toUpperCase(), cx + 12, y + 8, { width: cardW * 0.54, height: 10, lineBreak: false, ellipsis: true });
      if (item.metric) {
        doc.font(F.displayBold).fontSize(9.2).fillColor(theme.primary)
          .text(str(item.metric), cx + cardW * 0.55, y + 7.5, { width: cardW * 0.40, height: 12, align: 'right', lineBreak: false, ellipsis: true });
      }
      doc.font(F.displayBold).fontSize(8.8).fillColor(COLORS.ink)
        .text(str(item.title), cx + 12, y + 21, { width: innerW, height: 13, lineBreak: false, ellipsis: true });
      if (item.detail) {
        doc.font(F.body).fontSize(7.7).fillColor(COLORS.body)
          .text(str(item.detail), cx + 12, y + 36, { width: innerW, height: boxH - 42, lineGap: 1.8, ellipsis: true });
      }
      doc.restore();
    });

    y += boxH + 10;
  }

  return y + 6;
}

/** 2-column structured specification / telemetry fact sheet with strict column clipping. */
function drawStatMatrix(doc, title, pairs, startY, contentW, F, theme, ensurePageFn, spec) {
  if (!pairs || !pairs.length) return startY;
  const rows = Math.ceil(pairs.length / 2);
  const rowH = 22;
  const boxH = rows * rowH + 20;
  let y = ensurePageFn(doc, spec, startY, Math.min(boxH + 28, 170), F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, height: 14, lineBreak: false, ellipsis: true }).restore();
    y += 17;
  }

  const colGap = 16;
  const colW = (contentW - 28 - colGap) / 2;
  doc.save();
  doc.roundedRect(MARGIN, y, contentW, boxH, 5).fillAndStroke(COLORS.zebra, COLORS.border);
  doc.rect(MARGIN, y, 3.8, boxH).fill(theme.primary);

  pairs.forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ix = MARGIN + 14 + col * (colW + colGap);
    const iy = y + 11 + row * rowH;
    drawBoundedKeyValue(doc, label, value, ix, iy, colW, F, 7.8, 8);
  });
  doc.restore();

  return y + boxH + 15;
}

/** Structured spotlight list for sorties, featured SOPs, or escalations. */
function drawCardList(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 76, F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, height: 14, lineBreak: false, ellipsis: true }).restore();
    y += 18;
  }

  items.forEach((item) => {
    doc.font(F.body).fontSize(8);
    const detailH = item.detail ? doc.heightOfString(str(item.detail), { width: contentW - 26, lineGap: 1.8 }) : 0;
    const cardH = Math.max(44, 30 + detailH + (item.meta ? 14 : 0));
    y = ensurePageFn(doc, spec, y, cardH + 8, F, theme);

    const tone = toneStyle(item.badgeTone || 'info') || toneStyle('info');
    doc.save();
    doc.roundedRect(MARGIN, y, contentW, cardH, 4.5).fillAndStroke(COLORS.white, COLORS.border);
    doc.rect(MARGIN, y, 3.5, cardH).fill(tone.accent);

    let titleX = MARGIN + 13;
    if (item.badge) {
      const bText = String(item.badge).toUpperCase();
      doc.font(F.displayBold).fontSize(6.5);
      const bw = Math.min(86, doc.widthOfString(bText) + 14);
      doc.roundedRect(titleX, y + 8, bw, 13.5, 3).fill(tone.bg);
      doc.fillColor(tone.fg).text(bText, titleX + 2, y + 11, { width: bw - 4, height: 10, align: 'center', lineBreak: false, ellipsis: true });
      titleX += bw + 8;
    }

    const metricW = item.metric ? 96 : 0;
    doc.font(F.displayBold).fontSize(9.2).fillColor(COLORS.ink)
      .text(str(item.title), titleX, y + 9, {
        width: Math.max(40, contentW - (titleX - MARGIN) - metricW - 14),
        height: 13,
        lineBreak: false,
        ellipsis: true
      });

    if (item.metric) {
      doc.font(F.displayBold).fontSize(9.2).fillColor(theme.primary)
        .text(str(item.metric), MARGIN + contentW - 104, y + 9, { width: 92, height: 13, align: 'right', lineBreak: false, ellipsis: true });
    }

    let nextY = y + 25;
    if (item.meta) {
      doc.font(F.displaySemiBold).fontSize(7.5).fillColor(COLORS.subtle)
        .text(str(item.meta), MARGIN + 13, nextY, { width: contentW - 26, height: 11, lineBreak: false, ellipsis: true });
      nextY += 14;
    }
    if (item.detail) {
      doc.font(F.body).fontSize(8).fillColor(COLORS.body)
        .text(str(item.detail), MARGIN + 13, nextY, { width: contentW - 26, lineGap: 1.8 });
    }
    doc.restore();
    y += cardH + 8;
  });

  return y + 6;
}

function drawAlerts(doc, spec, title, items, startY, contentW, F, theme, ensurePageFn) {
  if (!items || !items.length) return startY;
  let y = ensurePageFn(doc, spec, startY, 62, F, theme);

  if (title) {
    doc.save().font(F.displayBold).fontSize(10).fillColor(theme.primary)
      .text(title, MARGIN, y, { width: contentW, height: 14, lineBreak: false, ellipsis: true }).restore();
    y += 17;
  }

  items.forEach((item) => {
    const tone = toneStyle(item.severity || 'info') || toneStyle('info');
    doc.font(F.displayBold).fontSize(8.6);
    const titleH = doc.heightOfString(str(item.title), { width: contentW - 26 });
    doc.font(F.body).fontSize(8.1);
    const detailH = item.detail ? doc.heightOfString(str(item.detail), { width: contentW - 26, lineGap: 1.8 }) : 0;
    const boxH = Math.max(34, 15 + titleH + (item.detail ? detailH + 5 : 0));
    y = ensurePageFn(doc, spec, y, boxH + 9, F, theme);

    doc.save();
    doc.roundedRect(MARGIN, y, contentW, boxH, 4.5).fillAndStroke(tone.bg, tone.border);
    doc.rect(MARGIN, y, 4, boxH).fill(tone.accent);
    doc.font(F.displayBold).fontSize(8.6).fillColor(tone.fg)
      .text(str(item.title), MARGIN + 13, y + 7.5, { width: contentW - 26 });
    if (item.detail) {
      doc.font(F.body).fontSize(8.1).fillColor(COLORS.body)
        .text(str(item.detail), MARGIN + 13, y + 10.5 + titleH, { width: contentW - 26, lineGap: 1.8 });
    }
    doc.restore();

    y += boxH + 8;
  });

  return y + 6;
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
