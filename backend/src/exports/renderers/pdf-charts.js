// =============================================================================
// exports/renderers/pdf-charts.js — Native Vector Charts for PDFKit (v4)
// -----------------------------------------------------------------------------
// Draws crisp, vector-resolution charts (Donut, Horizontal Bar, Lollipop,
// Vertical / Grouped / Stacked Bar, Multi-Series Line/Area) supporting both
// single full-width charts and compact 2-column `chartPair` comparisons.
// =============================================================================

const { COLORS, CHART_PALETTE } = require('../core/branding');
const { fmtNumber, fmtMoney, fmtPercent, toNumber } = require('../core/helpers');

function formatChartValue(val, valueFormat) {
  const n = toNumber(val, 0);
  if (valueFormat === 'currency') return fmtMoney(n);
  if (valueFormat === 'percent') return fmtPercent(n, 1);
  if (valueFormat === 'hours') return `${n.toFixed(1)}h`;
  return Number.isInteger(n) ? fmtNumber(n, 0) : fmtNumber(n, 1);
}

function truncateText(str, maxLen) {
  const s = String(str ?? '');
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

function computeNiceScale(rawMax, tickCount = 4) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) {
    return { max: tickCount, step: 1, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i) };
  }
  const roughStep = rawMax / tickCount;
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const frac = roughStep / pow10;
  let niceFrac = 10;
  if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 2.5) niceFrac = 2.5;
  else if (frac <= 5) niceFrac = 5;

  const step = niceFrac * pow10;
  const max = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.01; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { max: ticks[ticks.length - 1] || max, step, ticks };
}

function extractSeries(chart, palette) {
  const pal = Array.isArray(palette) && palette.length ? palette : CHART_PALETTE;
  if (Array.isArray(chart.series) && chart.series.length) {
    return chart.series.map((s, idx) => ({
      name: s.name || `Series ${idx + 1}`,
      data: (s.data || []).map((v) => toNumber(v, 0)),
      color: s.color || pal[idx % pal.length]
    }));
  }
  if (Array.isArray(chart.values)) {
    return [{
      name: chart.seriesName || 'Value',
      data: chart.values.map((v) => toNumber(v, 0)),
      color: chart.color || pal[0]
    }];
  }
  return [];
}

function hasChartData(chart, palette) {
  const labels = chart?.labels || [];
  const series = extractSeries(chart || {}, palette);
  if (!labels.length || !series.length) return false;
  return series.some((s) => s.data.some((v) => v > 0));
}

function drawArcSlice(doc, cx, cy, rOuter, rInner, startAngle, endAngle, color) {
  const span = endAngle - startAngle;
  if (span <= 0.001) return;

  doc.save();
  if (span >= Math.PI * 2 - 0.001) {
    doc.circle(cx, cy, rOuter).fill(color);
    doc.circle(cx, cy, rInner).fill(COLORS.white);
    doc.restore();
    return;
  }

  const steps = Math.max(12, Math.ceil(span * 28));
  doc.moveTo(cx + rOuter * Math.cos(startAngle), cy + rOuter * Math.sin(startAngle));
  for (let i = 1; i <= steps; i += 1) {
    const a = startAngle + (span * i) / steps;
    doc.lineTo(cx + rOuter * Math.cos(a), cy + rOuter * Math.sin(a));
  }
  for (let i = steps; i >= 0; i -= 1) {
    const a = startAngle + (span * i) / steps;
    doc.lineTo(cx + rInner * Math.cos(a), cy + rInner * Math.sin(a));
  }
  doc.closePath();
  doc.fillColor(color).strokeColor(COLORS.white).lineWidth(1.2).fillAndStroke();
  doc.restore();
}

function drawDonutChart(doc, chart, box, fonts, theme) {
  const pal = theme?.chartPalette || CHART_PALETTE;
  const labels = chart.labels || [];
  const series = extractSeries(chart, pal);
  const values = series[0]?.data || [];
  const colors = labels.map((_, i) => chart.colors?.[i] || pal[i % pal.length]);
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  const compact = box.w < 260;

  const donutZoneW = compact ? Math.min(box.w * 0.44, box.h) : Math.min(box.w * 0.44, box.h + 16);
  const rOuter = Math.max(22, Math.min(donutZoneW * 0.43, box.h * 0.45));
  const rInner = rOuter * 0.58;
  const cx = box.x + donutZoneW * 0.5;
  const cy = box.y + box.h * 0.5;

  let angle = -Math.PI / 2;
  values.forEach((val, idx) => {
    if (val <= 0) return;
    const slice = (val / total) * Math.PI * 2;
    drawArcSlice(doc, cx, cy, rOuter, rInner, angle, angle + slice, colors[idx]);
    angle += slice;
  });

  const totalLabel = formatChartValue(total, chart.valueFormat);
  doc.save();
  doc.font(fonts.displayBold).fontSize(compact ? 9.5 : (totalLabel.length > 6 ? 11 : 13.5)).fillColor(theme?.primary || COLORS.navy)
    .text(totalLabel, cx - rInner + 2, cy - (compact ? 6 : 9), { width: (rInner - 2) * 2, align: 'center', lineBreak: false });
  doc.font(fonts.displaySemiBold).fontSize(compact ? 5.8 : 7).fillColor(COLORS.subtle)
    .text('TOTAL', cx - rInner + 2, cy + (compact ? 4 : 7), { width: (rInner - 2) * 2, align: 'center', lineBreak: false });
  doc.restore();

  const legendX = box.x + donutZoneW + (compact ? 6 : 14);
  const legendW = box.w - donutZoneW - (compact ? 6 : 14);
  const items = labels
    .map((lbl, i) => ({ label: String(lbl), value: values[i] || 0, color: colors[i] }))
    .filter((item) => item.value > 0)
    .slice(0, compact ? 6 : 8);

  const lineH = Math.min(compact ? 16 : 20, (box.h - 4) / Math.max(items.length, 1));
  let ly = box.y + Math.max(2, (box.h - items.length * lineH) / 2);

  items.forEach((item) => {
    const share = total > 0 ? ((item.value / total) * 100).toFixed(0) : '0';
    const valStr = compact ? `${formatChartValue(item.value, chart.valueFormat)}` : `${formatChartValue(item.value, chart.valueFormat)} (${share}%)`;
    doc.save();
    doc.circle(legendX + 4, ly + 5.5, compact ? 2.8 : 3.6).fill(item.color);
    doc.font(fonts.bodyMedium).fontSize(compact ? 7 : 8.2).fillColor(COLORS.body)
      .text(truncateText(item.label, compact ? 13 : 26), legendX + (compact ? 10 : 14), ly + 1, { width: legendW * 0.58, lineBreak: false });
    doc.font(fonts.displayBold).fontSize(compact ? 7 : 8.2).fillColor(COLORS.ink)
      .text(valStr, legendX + legendW * 0.58, ly + 1, { width: legendW * 0.42, align: 'right', lineBreak: false });
    doc.restore();
    ly += lineH;
  });
}

function drawHorizontalBarChart(doc, chart, box, fonts, theme) {
  const pal = theme?.chartPalette || CHART_PALETTE;
  const labels = chart.labels || [];
  const series = extractSeries(chart, pal);
  const values = series[0]?.data || [];
  const compact = box.w < 260;
  const maxItems = Math.min(labels.length, compact ? 6 : 8);
  const items = labels.slice(0, maxItems).map((lbl, i) => ({
    label: String(lbl),
    value: values[i] || 0,
    color: chart.colors?.[i] || series[0]?.color || pal[i % pal.length]
  }));

  const maxVal = Math.max(...items.map((x) => x.value), 1);
  const labelW = Math.min(compact ? 82 : 148, box.w * 0.36);
  const valW = Math.min(compact ? 46 : 72, box.w * 0.21);
  const trackX = box.x + labelW + 6;
  const trackW = Math.max(30, box.w - labelW - valW - 12);
  const rowH = Math.min(24, box.h / Math.max(items.length, 1));
  const barH = Math.min(11, rowH * 0.52);

  let ry = box.y + Math.max(2, (box.h - items.length * rowH) / 2);
  items.forEach((item) => {
    const barY = ry + (rowH - barH) / 2;
    const fillW = item.value > 0 ? Math.max(4, (item.value / maxVal) * trackW) : 0;

    doc.save();
    doc.font(fonts.bodyMedium).fontSize(compact ? 7 : 8).fillColor(COLORS.body)
      .text(truncateText(item.label, compact ? 15 : 28), box.x, barY - 0.5, { width: labelW, lineBreak: false });

    doc.roundedRect(trackX, barY, trackW, barH, 3).fill(COLORS.surface);
    if (fillW > 0) {
      doc.roundedRect(trackX, barY, fillW, barH, 3).fill(item.color);
    }

    doc.font(fonts.displayBold).fontSize(compact ? 7 : 8).fillColor(COLORS.ink)
      .text(formatChartValue(item.value, chart.valueFormat), trackX + trackW + 6, barY - 0.5, {
        width: valW,
        align: 'right',
        lineBreak: false
      });
    doc.restore();
    ry += rowH;
  });
}

function drawLollipopChart(doc, chart, box, fonts, theme) {
  const pal = theme?.chartPalette || CHART_PALETTE;
  const labels = chart.labels || [];
  const series = extractSeries(chart, pal);
  const values = series[0]?.data || [];
  const compact = box.w < 260;
  const maxItems = Math.min(labels.length, compact ? 6 : 8);
  const items = labels.slice(0, maxItems).map((lbl, i) => ({
    label: String(lbl),
    value: values[i] || 0,
    color: chart.colors?.[i] || pal[i % pal.length]
  }));

  const maxVal = Math.max(...items.map((x) => x.value), 1);
  const labelW = Math.min(compact ? 86 : 156, box.w * 0.36);
  const valW = Math.min(compact ? 48 : 72, box.w * 0.21);
  const trackX = box.x + labelW + 8;
  const trackW = Math.max(32, box.w - labelW - valW - 18);
  const rowH = Math.min(24, box.h / Math.max(items.length, 1));

  let ry = box.y + Math.max(2, (box.h - items.length * rowH) / 2);
  items.forEach((item) => {
    const midY = ry + rowH / 2;
    const dotX = trackX + (item.value / maxVal) * trackW;

    doc.save();
    doc.font(fonts.bodyMedium).fontSize(compact ? 7 : 8).fillColor(COLORS.body)
      .text(truncateText(item.label, compact ? 15 : 30), box.x, midY - 4.5, { width: labelW, lineBreak: false });

    doc.lineWidth(0.75).strokeColor(COLORS.border)
      .moveTo(trackX, midY).lineTo(trackX + trackW, midY).stroke();

    if (item.value > 0) {
      doc.lineWidth(2.4).strokeColor(item.color)
        .moveTo(trackX, midY).lineTo(dotX, midY).stroke();
      doc.circle(dotX, midY, compact ? 3.8 : 4.8).fill(item.color);
      doc.circle(dotX, midY, compact ? 1.5 : 2).fill(COLORS.white);
    }

    doc.font(fonts.displayBold).fontSize(compact ? 7 : 8).fillColor(COLORS.ink)
      .text(formatChartValue(item.value, chart.valueFormat), trackX + trackW + 10, midY - 4.5, {
        width: valW,
        align: 'right',
        lineBreak: false
      });
    doc.restore();
    ry += rowH;
  });
}

function drawVerticalBarChart(doc, chart, box, fonts, theme) {
  const pal = theme?.chartPalette || CHART_PALETTE;
  const labels = (chart.labels || []).slice(0, 12);
  const series = extractSeries(chart, pal);
  const isStacked = chart.type === 'stackedBar';
  const compact = box.w < 260;

  const hasLegend = series.length > 1;
  const legendH = hasLegend ? 16 : 0;
  const leftPad = compact ? 28 : 36;
  const bottomPad = 20;
  const plotX = box.x + leftPad;
  const plotY = box.y + legendH + 4;
  const plotW = Math.max(40, box.w - leftPad - 6);
  const plotH = Math.max(36, box.h - legendH - bottomPad - 6);

  if (hasLegend) {
    let lx = plotX;
    series.forEach((s) => {
      doc.save();
      doc.rect(lx, box.y + 3, 7, 7).fill(s.color);
      doc.font(fonts.bodyMedium).fontSize(compact ? 6.8 : 7.5).fillColor(COLORS.subtle)
        .text(truncateText(s.name, compact ? 12 : 20), lx + 10, box.y + 2, { lineBreak: false });
      doc.restore();
      lx += Math.min(compact ? 85 : 125, doc.widthOfString(truncateText(s.name, 20)) + 22);
    });
  }

  let rawMax = 0;
  if (isStacked) {
    for (let i = 0; i < labels.length; i += 1) {
      const stackSum = series.reduce((sum, s) => sum + (s.data[i] || 0), 0);
      if (stackSum > rawMax) rawMax = stackSum;
    }
  } else {
    series.forEach((s) => {
      labels.forEach((_, i) => {
        if ((s.data[i] || 0) > rawMax) rawMax = s.data[i] || 0;
      });
    });
  }

  const scale = computeNiceScale(rawMax, 4);

  scale.ticks.forEach((tv) => {
    const ty = plotY + plotH - (tv / scale.max) * plotH;
    doc.save();
    doc.lineWidth(0.45).strokeColor(tv === 0 ? COLORS.borderStrong : COLORS.border);
    if (tv > 0) doc.dash(2, { space: 2 });
    doc.moveTo(plotX, ty).lineTo(plotX + plotW, ty).stroke();
    doc.undash();
    doc.font(fonts.body).fontSize(compact ? 6.2 : 7).fillColor(COLORS.subtle)
      .text(fmtNumber(tv, 0), box.x, ty - 4.5, { width: leftPad - 4, align: 'right', lineBreak: false });
    doc.restore();
  });

  const groupW = plotW / Math.max(labels.length, 1);
  const barGroupPad = Math.max(4, groupW * 0.24);
  const availGroupW = Math.max(6, groupW - barGroupPad);

  labels.forEach((lbl, i) => {
    const gx = plotX + i * groupW + barGroupPad / 2;

    if (isStacked) {
      const bw = Math.min(28, availGroupW);
      const bx = gx + (availGroupW - bw) / 2;
      let accY = plotY + plotH;
      series.forEach((s) => {
        const val = s.data[i] || 0;
        const bh = (val / scale.max) * plotH;
        if (bh > 0.5) {
          accY -= bh;
          doc.save().rect(bx, accY, bw, bh).fill(s.color).restore();
        }
      });
    } else {
      const bw = Math.min(24, availGroupW / Math.max(series.length, 1));
      const totalBarsW = bw * series.length;
      const startBx = gx + (availGroupW - totalBarsW) / 2;
      series.forEach((s, si) => {
        const val = s.data[i] || 0;
        const bh = (val / scale.max) * plotH;
        const bx = startBx + si * bw;
        const by = plotY + plotH - bh;
        const barColor = (series.length === 1 && (chart.colors?.[i] || pal[i % pal.length])) || s.color;
        if (bh > 0.5) {
          doc.save().rect(bx, by, Math.max(3, bw - 2), bh).fill(barColor).restore();
        }
        if (series.length === 1 && val > 0 && groupW > 22) {
          doc.save().font(fonts.displayBold).fontSize(compact ? 6.2 : 7).fillColor(COLORS.ink)
            .text(formatChartValue(val, chart.valueFormat), bx - 6, Math.max(plotY - 2, by - 10), {
              width: bw + 12,
              align: 'center',
              lineBreak: false
            }).restore();
        }
      });
    }

    const maxChars = Math.max(5, Math.floor(groupW / 4.2));
    doc.save().font(fonts.body).fontSize(compact ? 6.2 : 7).fillColor(COLORS.subtle)
      .text(truncateText(String(lbl), maxChars), plotX + i * groupW, plotY + plotH + 5, {
        width: groupW,
        align: 'center',
        lineBreak: false
      }).restore();
  });
}

function drawLineChart(doc, chart, box, fonts, theme) {
  const pal = theme?.chartPalette || CHART_PALETTE;
  const labels = chart.labels || [];
  const series = extractSeries(chart, pal);
  const hasLegend = series.length > 1;
  const legendH = hasLegend ? 16 : 0;
  const leftPad = 36;
  const bottomPad = 20;
  const plotX = box.x + leftPad;
  const plotY = box.y + legendH + 4;
  const plotW = Math.max(40, box.w - leftPad - 12);
  const plotH = Math.max(40, box.h - legendH - bottomPad - 6);

  if (hasLegend) {
    let lx = plotX;
    series.forEach((s) => {
      doc.save();
      doc.rect(lx, box.y + 4, 12, 3).fill(s.color);
      doc.font(fonts.bodyMedium).fontSize(7.5).fillColor(COLORS.subtle)
        .text(truncateText(s.name, 22), lx + 16, box.y + 1.5, { lineBreak: false });
      doc.restore();
      lx += Math.min(140, doc.widthOfString(truncateText(s.name, 22)) + 30);
    });
  }

  let rawMax = 0;
  series.forEach((s) => s.data.forEach((v) => { if (v > rawMax) rawMax = v; }));
  const scale = computeNiceScale(rawMax, 4);

  scale.ticks.forEach((tv) => {
    const ty = plotY + plotH - (tv / scale.max) * plotH;
    doc.save();
    doc.lineWidth(0.45).strokeColor(tv === 0 ? COLORS.borderStrong : COLORS.border);
    if (tv > 0) doc.dash(2, { space: 2 });
    doc.moveTo(plotX, ty).lineTo(plotX + plotW, ty).stroke();
    doc.undash();
    doc.font(fonts.body).fontSize(7).fillColor(COLORS.subtle)
      .text(fmtNumber(tv, 0), box.x, ty - 4.5, { width: leftPad - 6, align: 'right', lineBreak: false });
    doc.restore();
  });

  const count = labels.length;
  const stepX = count > 1 ? plotW / (count - 1) : 0;

  series.forEach((s, sIdx) => {
    const pts = labels.map((_, i) => ({
      x: count === 1 ? plotX + plotW / 2 : plotX + i * stepX,
      y: plotY + plotH - ((s.data[i] || 0) / scale.max) * plotH
    }));
    if (!pts.length) return;

    if (sIdx === 0 && pts.length > 1) {
      doc.save();
      doc.moveTo(pts[0].x, plotY + plotH);
      pts.forEach((p) => doc.lineTo(p.x, p.y));
      doc.lineTo(pts[pts.length - 1].x, plotY + plotH);
      doc.closePath();
      doc.fillOpacity(0.11).fillColor(s.color).fill();
      doc.restore();
    }

    if (pts.length > 1) {
      doc.save().lineWidth(1.9).strokeColor(s.color);
      doc.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        doc.lineTo(pts[i].x, pts[i].y);
      }
      doc.stroke().restore();
    }

    if (pts.length <= 24) {
      pts.forEach((p) => {
        doc.save().circle(p.x, p.y, 2.5).fill(s.color).restore();
      });
    }
  });

  const labelStep = Math.max(1, Math.ceil(count / 7));
  labels.forEach((lbl, i) => {
    if (i % labelStep !== 0 && i !== count - 1) return;
    const x = count === 1 ? plotX + plotW / 2 : plotX + i * stepX;
    doc.save().font(fonts.body).fontSize(7).fillColor(COLORS.subtle)
      .text(truncateText(String(lbl), 11), x - 26, plotY + plotH + 5, {
        width: 52,
        align: 'center',
        lineBreak: false
      }).restore();
  });
}

function drawChartCard(doc, chart, x, y, w, h, fonts, theme) {
  const accentColor = theme?.accent || COLORS.accent;
  const titleColor = theme?.primary || COLORS.navy;
  const compact = w < 280;

  doc.save();
  doc.roundedRect(x, y, w, h, 5).fillAndStroke(COLORS.white, COLORS.border);
  doc.rect(x + 12, y, 36, 3).fill(accentColor);
  doc.font(fonts.displayBold).fontSize(compact ? 9.5 : 10.5).fillColor(titleColor)
    .text(chart.title || 'Distribution', x + 12, y + 8, { width: w - 24, lineBreak: false });
  if (chart.subtitle) {
    doc.font(fonts.body).fontSize(compact ? 7.2 : 8).fillColor(COLORS.subtle)
      .text(chart.subtitle, x + 12, y + 21, { width: w - 24, lineBreak: false });
  }
  doc.restore();

  const headerOffset = chart.subtitle ? 36 : 26;
  const box = { x: x + 12, y: y + headerOffset, w: w - 24, h: h - headerOffset - 10 };

  if (!hasChartData(chart, theme?.chartPalette)) {
    doc.save().font(fonts.bodyItalic).fontSize(8.2).fillColor(COLORS.subtle)
      .text('No quantitative data available for the selected filters.', box.x, box.y + box.h * 0.42, {
        width: box.w,
        align: 'center'
      }).restore();
    return;
  }

  switch (chart.type) {
    case 'donut':
    case 'pie':
      drawDonutChart(doc, chart, box, fonts, theme);
      break;
    case 'lollipop':
      drawLollipopChart(doc, chart, box, fonts, theme);
      break;
    case 'hbar':
      drawHorizontalBarChart(doc, chart, box, fonts, theme);
      break;
    case 'bar':
    case 'groupedBar':
    case 'stackedBar':
      drawVerticalBarChart(doc, chart, box, fonts, theme);
      break;
    case 'line':
    case 'area':
      drawLineChart(doc, chart, box, fonts, theme);
      break;
    default:
      drawHorizontalBarChart(doc, chart, box, fonts, theme);
  }
}

/** Render two charts cleanly side-by-side inside a blueprint spread. */
function drawChartPair(doc, leftChart, rightChart, margin, contentW, y, height, fonts, theme) {
  const gap = 12;
  if (leftChart && rightChart) {
    const cw = (contentW - gap) / 2;
    drawChartCard(doc, leftChart, margin, y, cw, height, fonts, theme);
    drawChartCard(doc, rightChart, margin + cw + gap, y, cw, height, fonts, theme);
  } else if (leftChart || rightChart) {
    drawChartCard(doc, leftChart || rightChart, margin, y, contentW, height, fonts, theme);
  }
  return y + height + 14;
}

/** Legacy fallback grid when a spec defines top-level `charts` without `pages`. */
function drawChartsGrid(doc, charts, margin, contentW, startY, bottomLimit, onNewPage, fonts, theme) {
  if (!charts || !charts.length) return startY;

  const isPortrait = contentW < 580;
  const gap = isPortrait ? 14 : 12;
  let y = startY;

  if (isPortrait) {
    charts.forEach((c) => {
      const cardH = ['bar', 'groupedBar', 'stackedBar', 'line', 'area'].includes(c.type) ? 236 : 216;
      if (y + cardH > bottomLimit) y = onNewPage();
      drawChartCard(doc, c, margin, y, contentW, cardH, fonts, theme);
      y += cardH + gap;
    });
    return y;
  }

  let i = 0;
  while (i < charts.length) {
    const c = charts[i];
    const isFull = Boolean(c.fullWidth || (c.type === 'line' && (c.labels?.length || 0) > 8) || charts.length === 1);
    const cardH = isFull ? 174 : 168;
    if (y + cardH > bottomLimit) y = onNewPage();
    if (!isFull && i + 1 < charts.length && !charts[i + 1].fullWidth) {
      drawChartPair(doc, c, charts[i + 1], margin, contentW, y, cardH, fonts, theme);
      i += 2;
    } else {
      drawChartCard(doc, c, margin, y, contentW, cardH, fonts, theme);
      i += 1;
    }
    y += cardH + gap;
  }

  return y;
}

module.exports = { drawChartsGrid, drawChartCard, drawChartPair };
