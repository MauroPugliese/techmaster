// =============================================================================
// exports/renderers/docx-chart.updater.js
// -----------------------------------------------------------------------------
// Dynamically populates the CAE Word template's native embedded bar chart
// (`word/charts/chart1.xml` + `word/embeddings/Microsoft_Excel_Worksheet.xlsx`)
// with real live analytical data from any ReportSpec, keeping the exact CAE
// Navy/Electric-Blue/Accent theme and editable Excel backing workbook.
// =============================================================================
'use strict';

const ExcelJS = require('exceljs');
const { toNumber, cleanText } = require('../core/helpers');
const { escXml } = require('./docx-xml-helpers');

const SERIES_ACCENTS = ['accent1', 'accent2', 'accent6'];
const SERIES_UUIDS = [
  '{00000000-5E6A-4B17-8B7A-08F813788EA1}',
  '{00000001-5E6A-4B17-8B7A-08F813788EA1}',
  '{00000002-5E6A-4B17-8B7A-08F813788EA1}'
];

function colLetter(idx) {
  return String.fromCharCode(65 + idx); // 0->A, 1->B, 2->C, 3->D
}

/**
 * Normalize a chart specification (or synthesize one from KPIs/scorecards/tables)
 * into `{ title, labels: string[], series: [{ name, data: number[] }] }`.
 */
function resolvePrimaryChartData(collected, spec) {
  const indexedCandidates = (collected.charts || [])
    .map((ch, idx) => ({ ch, idx }))
    .filter(({ ch }) => {
      if (!ch || !Array.isArray(ch.labels) || !ch.labels.length) return false;
      const rawSeries = Array.isArray(ch.series) && ch.series.length
        ? ch.series
        : [{ name: ch.seriesName || 'Count', data: ch.values || [] }];
      return rawSeries.some((s) => (s.data || []).some((v) => toNumber(v, 0) > 0));
    });

  if (indexedCandidates.length > 0) {
    const { ch, idx: usedChartIndex } = indexedCandidates[0];
    const labels = ch.labels.slice(0, 8).map((l) => cleanText(String(l || 'Item'), 28));
    const rawSeries = (Array.isArray(ch.series) && ch.series.length
      ? ch.series
      : [{ name: ch.seriesName || 'Value', data: ch.values || [] }]
    ).slice(0, 3);

    const series = rawSeries.map((s, idx) => ({
      name: cleanText(s.name || `Series ${idx + 1}`, 28),
      data: labels.map((_, li) => Number(toNumber(s.data?.[li], 0).toFixed(2)))
    }));

    return {
      title: cleanText(ch.title || `${spec.title} — Overview`, 68),
      labels,
      series,
      hasRealChart: true,
      usedChartIndex
    };
  }

  // Fallback 1: Scorecards percentage chart
  const firstScorecard = (collected.scorecards || []).find((sc) => sc.items && sc.items.length);
  if (firstScorecard) {
    const items = firstScorecard.items.slice(0, 8);
    return {
      title: cleanText(firstScorecard.title || 'Compliance & Readiness Scorecard (%)', 68),
      labels: items.map((it) => cleanText(it.label || 'Pillar', 28)),
      series: [{
        name: 'Score (%)',
        data: items.map((it) => Number(toNumber(it.percent, 0).toFixed(1)))
      }],
      hasRealChart: true,
      usedChartIndex: -1
    };
  }

  // Fallback 2: Numeric KPIs
  const numericKpis = (collected.kpis || [])
    .map((k) => {
      const parsed = k.rawValue !== undefined
        ? toNumber(k.rawValue, NaN)
        : Number(String(k.value || '').replace(/[^0-9.-]/g, ''));
      return { label: cleanText(k.label || 'KPI', 24), val: Number.isFinite(parsed) ? parsed : 0 };
    })
    .filter((k) => k.val > 0)
    .slice(0, 6);

  if (numericKpis.length > 0) {
    return {
      title: cleanText(`${spec.title} — Key Performance Indicators`, 68),
      labels: numericKpis.map((k) => k.label),
      series: [{ name: 'Metric Value', data: numericKpis.map((k) => Number(k.val.toFixed(2))) }],
      hasRealChart: false
    };
  }

  // Fallback 3: Minimal structural metrics (keeps chart1.xml placeholder-free without forcing display)
  const tblRows = (collected.tables || []).reduce((acc, t) => acc + (t.rows?.length || 0), 0);
  return {
    title: cleanText(`${spec.title} — Summary`, 68),
    labels: ['Sections', 'Tables', 'Records'],
    series: [{
      name: 'Count',
      data: [
        Math.max(1, (spec.pages || []).length || 1),
        (collected.tables || []).length,
        tblRows
      ]
    }],
    hasRealChart: false
  };
}

/** Build the complete `word/charts/chart1.xml` preserving exact CAE template chart chrome. */
function buildUpdatedChartXml(chartData) {
  const { title, labels, series } = chartData;
  const lastRow = labels.length + 1;
  const catRange = `Sheet1!$A$2:$A$${lastRow}`;

  const catCache = labels
    .map((lbl, idx) => `<c:pt idx="${idx}"><c:v>${escXml(lbl)}</c:v></c:pt>`)
    .join('');

  const seriesXml = series.map((s, sIdx) => {
    const col = colLetter(sIdx + 1); // B, C, D
    const accent = SERIES_ACCENTS[sIdx % SERIES_ACCENTS.length];
    const uuid = SERIES_UUIDS[sIdx % SERIES_UUIDS.length];
    const valCache = s.data
      .map((v, idx) => `<c:pt idx="${idx}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`)
      .join('');

    return `<c:ser><c:idx val="${sIdx}"/><c:order val="${sIdx}"/><c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escXml(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr><c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>${catRange}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${catCache}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${lastRow}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${labels.length}"/>${valCache}</c:numCache></c:numRef></c:val><c:extLst><c:ext uri="{C3380CC4-5D6E-409C-BE32-E72D297353CC}" xmlns:c16="http://schemas.microsoft.com/office/drawing/2014/chart"><c16:uniqueId val="${uuid}"/></c:ext></c:extLst></c:ser>`;
  }).join('');

  const legendEntriesXml = series.map((_, sIdx) => (
    `<c:legendEntry><c:idx val="${sIdx}"/><c:txPr><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill><a:latin typeface="Arial" pitchFamily="34" charset="0"/><a:cs typeface="Arial" pitchFamily="34" charset="0"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:legendEntry>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c16r2="http://schemas.microsoft.com/office/drawing/2015/06/chart">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="c14" xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart"><c14:style val="102"/></mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent>` +
    `<c:chart><c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1" i="0" u="none" strike="noStrike" kern="1200" spc="0" baseline="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${escXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr></c:title><c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${seriesXml}` +
    `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` +
    `<c:gapWidth val="160"/><c:overlap val="-15"/><c:axId val="1178823232"/><c:axId val="1178815328"/></c:barChart>` +
    `<c:catAx><c:axId val="1178823232"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:noFill/><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln><a:effectLst/></c:spPr><c:txPr><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:crossAx val="1178815328"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="1178815328"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln><a:effectLst/></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr><c:txPr><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:crossAx val="1178823232"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr></c:plotArea>` +
    `<c:legend><c:legendPos val="b"/>${legendEntriesXml}<c:overlay val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr></c:legend>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>` +
    `<c:spPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:noFill/><a:round/></a:ln><a:effectLst/></c:spPr>` +
    `<c:externalData r:id="rId3"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

/** Build the matching embedded `Microsoft_Excel_Worksheet.xlsx` so Word "Edit Data" stays live. */
async function buildEmbeddedChartWorkbook(chartData) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['', ...chartData.series.map((s) => s.name)]);
  chartData.labels.forEach((lbl, idx) => {
    ws.addRow([lbl, ...chartData.series.map((s) => s.data[idx] ?? 0)]);
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Mutate the cloned template PizZip in-place with updated chart1.xml & Excel worksheet. */
async function updateTemplateChart(zip, collected, spec) {
  const chartData = resolvePrimaryChartData(collected, spec);
  const chartXml = buildUpdatedChartXml(chartData);
  const xlsxBuf = await buildEmbeddedChartWorkbook(chartData);

  zip.file('word/charts/chart1.xml', chartXml);
  zip.file('word/embeddings/Microsoft_Excel_Worksheet.xlsx', xlsxBuf);
  return chartData;
}

module.exports = {
  resolvePrimaryChartData,
  buildUpdatedChartXml,
  buildEmbeddedChartWorkbook,
  updateTemplateChart
};
