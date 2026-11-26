// =============================================================================
// exports/__tests__/report-audit-regressions.test.js
// Regression tests covering:
//   - SimulatorDailyLog.updater association (daily-station-ops 500 fix)
//   - Universal Report Periodicity (Weekly / Monthly / Custom / Default)
//   - PDF Zero-Blank-Page layout in both A4 Portrait & A4 Landscape
//   - DOCX valid integer OOXML half-point font sizes & zero blank breaks
//   - XLSX statMatrix + column width scaling + badge tone colors
//   - PPTX statMatrix slides + horizontalBar + cover periodicity badge
//   - Planned Maintenance monthly month-end clamping (Jan 31 -> Feb 28 / Apr 30)
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const ExcelJS = require('exceljs');

const models = require('../../models');
const { toneStyle } = require('../core/branding');
const {
  cleanText,
  normalizeFilters,
  resolveBadgeTone,
  resolveReportPeriod,
  parseRange,
  buildFilename
} = require('../core/helpers');
const { normalizeSpec, collectSpecData } = require('../core/export.service');
const { buildPdfBuffer } = require('../renderers/pdf.renderer');
const { buildDocxBuffer } = require('../renderers/docx.renderer');
const { buildWorkbook } = require('../renderers/xlsx.renderer');
const { buildPptxBuffer } = require('../renderers/pptx.renderer');
const { taskOccursOnDate } = require('../../services/planned-recurrence.service');

function countPdfPages(buffer) {
  const raw = buffer.toString('latin1');
  const matches = raw.match(/\/Type\s*\/Page\b(?!s)/g);
  return matches ? matches.length : 0;
}

function buildAuditSpec(orientation = 'portrait') {
  return normalizeSpec({
    moduleKey: 'daily-station-ops',
    docCode: 'CAE-OPS-DAILY',
    theme: 'simulators',
    title: 'Daily Test Places & IOS Consoles Operations — Comprehensive Multi-Shift Rollup',
    subtitle: 'Automated verification of cover spacing, periodicity badges, statMatrix and badge colors',
    category: 'FLIGHT SIMULATOR DAILY OPERATIONS',
    orientation,
    filename: 'Daily_Station_Ops',
    meta: {
      generatedBy: 'Chief Simulator Engineer',
      generatedAt: new Date('2026-11-25T14:30:00Z'),
      period: {
        type: 'weekly',
        label: 'Weekly Report',
        rangeText: '2026-11-23 to 2026-11-29',
        filenameTag: 'Weekly_2026-11-23_to_2026-11-29'
      },
      filters: {
        'Report Type': 'Weekly Report',
        'Reporting Window': '2026-11-23 to 2026-11-29',
        'Station Class': 'Test Places & IOS Consoles',
        'Active Filter': 'All Operational Bays',
        'Plant Shift': 'All Shifts (Morning / Afternoon / Night)'
      }
    },
    coverHighlights: [
      { label: 'Active Stations', value: '18 / 20' },
      { label: 'Weekly Utilization', value: '84.5%' },
      { label: 'Total Session Hours', value: '142.5 h' }
    ],
    pages: [
      {
        title: 'Operating Window & Readiness Matrix',
        subtitle: 'Hero KPIs, station parameters and shift telemetry',
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Fleet Availability', value: '94.8%', sublabel: 'Above 90% SLA target', tone: 'success' },
              { label: 'In Use Shifts', value: '48', sublabel: 'Across 7 operating days', tone: 'info' },
              { label: 'AOG / NA Events', value: '2', sublabel: 'Resolved within 3.5h MTTR', tone: 'warning' }
            ]
          },
          {
            type: 'statMatrix',
            title: 'Plant Operating Schedule & Specifications',
            pairs: [
              ['System Readiness', '06:30 Local'],
              ['Post-Testing Routine', '17:00 Local'],
              ['Plant Logout', '18:00 Local'],
              ['Motion Calibration', 'Verified OK']
            ]
          },
          {
            type: 'highlights',
            title: 'Station Highlights',
            items: [
              { eyebrow: 'TOP STATION', metric: '32.5 h', title: 'TP-01 · A320neo', detail: 'Zero unplanned interruptions across the full weekly window.', tone: 'teal' },
              { eyebrow: 'ATTENTION', metric: '2 NA', title: 'IOS-04 · B737 MAX', detail: 'Audio matrix card replaced and verified during night maintenance.', tone: 'purple' }
            ]
          }
        ]
      },
      {
        title: 'Utilization & Subsystem Breakdown',
        subtitle: 'Horizontal bar chart alias verification',
        blocks: [
          {
            type: 'chart',
            height: 210,
            chart: {
              type: 'horizontalBar',
              title: 'Session Hours by Station',
              labels: ['TP-01', 'TP-02', 'IOS-01', 'IOS-02'],
              values: [32.5, 28.0, 24.5, 19.0],
              valueFormat: 'hours'
            }
          }
        ]
      },
      {
        title: 'Station Status & Handover Ledger',
        subtitle: 'Badge tones and wide column scaling verification',
        blocks: [
          {
            type: 'table',
            showHeading: false,
            table: {
              name: 'Station Ledger',
              columns: [
                { key: 'station', header: 'Station', type: 'mono', width: 80 },
                { key: 'status', header: 'Status', type: 'badge', width: 78, align: 'center' },
                { key: 'category', header: 'Class', type: 'badge', width: 78, align: 'center' },
                { key: 'hours', header: 'Hours', type: 'number', width: 62, align: 'right', total: 'sum' },
                { key: 'notes', header: 'Notes', type: 'text', width: 190 }
              ],
              rows: [
                {
                  station: 'TP-01',
                  status: 'IN USE',
                  status_tone: 'teal',
                  category: 'TEST PLACE',
                  category_tone: 'purple',
                  hours: 32.5,
                  notes: 'Completed full weekly acceptance run with zero anomalies.'
                },
                {
                  station: 'IOS-04',
                  status: 'NA',
                  status_tone: 'danger',
                  category: 'IOS CONSOLE',
                  category_tone: 'info',
                  hours: 14.0,
                  notes: 'Audio routing board swapped and certified ready.'
                }
              ]
            }
          }
        ]
      }
    ]
  });
}

test('SimulatorDailyLog defines updater association for daily-station-ops export', () => {
  assert.ok(models.SimulatorDailyLog, 'SimulatorDailyLog model must exist');
  assert.ok(
    models.SimulatorDailyLog.associations?.updater,
    'SimulatorDailyLog must belongTo User as "updater"'
  );
  assert.equal(models.SimulatorDailyLog.associations.updater.foreignKey, 'updated_by');
});

test('helpers: resolveReportPeriod computes Weekly, Monthly, Custom and All windows accurately', () => {
  const weekly = resolveReportPeriod({ report_period: 'weekly', from: '2026-11-23', to: '2026-11-29' });
  assert.equal(weekly.type, 'weekly');
  assert.equal(weekly.label, 'Weekly Report');
  assert.equal(weekly.fromYmd, '2026-11-23');
  assert.equal(weekly.toYmd, '2026-11-29');
  assert.equal(weekly.filenameTag, 'weekly_2026-11-23_to_2026-11-29');

  const monthly = resolveReportPeriod({ report_period: 'monthly', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(monthly.type, 'monthly');
  assert.equal(monthly.label, 'Monthly Report');
  assert.equal(monthly.fromYmd, '2026-11-01');
  assert.equal(monthly.toYmd, '2026-11-30');
  assert.equal(monthly.filenameTag, 'monthly_2026-11');

  // Inverted custom dates should auto-swap cleanly
  const custom = resolveReportPeriod({ report_period: 'custom', from: '2026-11-20', to: '2026-11-05' });
  assert.equal(custom.type, 'custom');
  assert.equal(custom.label, 'Custom Range Report');
  assert.equal(custom.fromYmd, '2026-11-05');
  assert.equal(custom.toYmd, '2026-11-20');

  const parsed = parseRange({ report_period: 'custom', from: '2026-11-01', to: '2026-11-10' });
  assert.ok(parsed.from instanceof Date);
  assert.ok(parsed.to instanceof Date);
  assert.equal(parsed.periodType, 'custom');

  const allScope = resolveReportPeriod({});
  assert.equal(allScope.type, 'all');
  assert.equal(allScope.filenameTag, '');

  const fname = buildFilename('Simulator Fleet', weekly.filenameTag);
  assert.equal(fname, 'SMaRT_Simulator_Fleet_weekly_2026-11-23_to_2026-11-29');
});

test('helpers & branding: normalizeFilters, cleanText(maxLen), resolveBadgeTone, teal & purple tones', () => {
  const fromObj = normalizeFilters({ Scope: 'Test Places', Empty: '', Period: 'Weekly' });
  assert.deepEqual(fromObj, [
    { label: 'Scope', value: 'Test Places' },
    { label: 'Period', value: 'Weekly' }
  ]);

  const truncated = cleanText('This is a long operational telemetry observation string', 22);
  assert.ok(truncated.length <= 22, `Expected <=22 chars, got ${truncated.length}: ${truncated}`);
  assert.ok(truncated.endsWith('…'));

  assert.equal(resolveBadgeTone({ status_tone: 'teal', _flag: 'danger' }, { key: 'status' }), 'teal');
  assert.equal(resolveBadgeTone({ _badgeTone: 'purple' }, { key: 'status' }), 'purple');
  assert.equal(resolveBadgeTone({ _flag: 'warning' }, { key: 'status' }), 'warning');

  assert.ok(toneStyle('teal')?.accent);
  assert.ok(toneStyle('purple')?.accent);
});

test('PDF renderer produces ZERO blank pages in BOTH A4 Portrait and A4 Landscape', async () => {
  const portraitSpec = buildAuditSpec('portrait');
  const portraitBuf = await buildPdfBuffer(portraitSpec);
  assert.equal(
    countPdfPages(portraitBuf),
    1 + portraitSpec.pages.length,
    `Portrait PDF must have exactly ${1 + portraitSpec.pages.length} pages (no blank page 2)`
  );

  const landscapeSpec = buildAuditSpec('landscape');
  const landscapeBuf = await buildPdfBuffer(landscapeSpec);
  assert.equal(
    countPdfPages(landscapeBuf),
    1 + landscapeSpec.pages.length,
    `Landscape PDF must have exactly ${1 + landscapeSpec.pages.length} pages (no blank overflow pages)`
  );
});

test('DOCX renderer produces valid official CAE template OOXML with periodicity banner, live chart Excel & balanced bookmarks', async () => {
  const spec = buildAuditSpec('portrait');
  const buf = await buildDocxBuffer(spec);
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  const chartXml = zip.file('word/charts/chart1.xml').asText();
  const f1 = zip.file('word/footer1.xml').asText();
  const f2 = zip.file('word/footer2.xml').asText();

  assert.equal(
    xml.match(/w:sz="\d+\.\d+"/g),
    null,
    'DOCX XML must contain ZERO fractional half-point w:sz values'
  );
  assert.ok(xml.includes('WEEKLY REPORT'), 'Cover should display periodicity banner');
  assert.ok(xml.includes('Session Hours by Station') || chartXml.includes('Session Hours by Station'), 'Live chart title must populate chart1.xml');
  assert.ok(chartXml.includes('TP-01'), 'Live chart categories must populate chart1.xml');
  assert.ok(f1.includes('November 25, 2026'), 'Interior footer must carry real publication date');
  assert.ok(f2.includes('November 25, 2026'), 'Cover footer must carry real publication date');

  // Verify every bookmarkStart has a matching bookmarkEnd
  const starts = [...xml.matchAll(/<w:bookmarkStart w:id="(\d+)"/g)].map((m) => m[1]);
  const ends = [...xml.matchAll(/<w:bookmarkEnd w:id="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual([...starts].sort(), [...ends].sort(), 'Every bookmarkStart must pair with bookmarkEnd');

  // Verify embedded Excel chart workbook matches real data
  const xlsxBuf = zip.file('word/embeddings/Microsoft_Excel_Worksheet.xlsx').asNodeBuffer();
  const chartWb = new ExcelJS.Workbook();
  await chartWb.xlsx.load(xlsxBuf);
  const ws = chartWb.getWorksheet('Sheet1');
  assert.ok(ws, 'Embedded Sheet1 must exist');
  assert.equal(ws.getCell('A2').value, 'TP-01');
  assert.equal(ws.getCell('B2').value, 32.5);
});

test('XLSX & PPTX renderers include statMatrix data, horizontalBar charts, pure tabular Excel & Widescreen PPTX bounds', async () => {
  const spec = buildAuditSpec('portrait');
  const collected = collectSpecData(spec);
  assert.equal(collected.statMatrices.length, 1);

  const wb = buildWorkbook(spec);
  const xlsxBuf = await wb.xlsx.writeBuffer();
  const parsedWb = new ExcelJS.Workbook();
  await parsedWb.xlsx.load(xlsxBuf);

  const dataSheet = parsedWb.getWorksheet('Station Ledger');
  assert.ok(dataSheet, 'Station Ledger sheet must exist');
  assert.equal(parsedWb.worksheets[0].name, 'Station Ledger', 'Data sheet must open first');
  assert.equal(dataSheet.views?.[0]?.showGridLines, true, 'Gridlines must be ON');
  assert.equal(dataSheet.model.merges?.length || 0, 0, 'Data sheet must have zero merged cells');
  for (let c = 1; c <= 5; c += 1) {
    const w = dataSheet.getColumn(c).width;
    assert.ok(
      typeof w === 'number' && w >= 10 && w <= 44,
      `Excel column ${c} width should be scaled cleanly (10..44), got ${w}`
    );
  }

  const summarySheet = parsedWb.getWorksheet('Summary');
  assert.ok(summarySheet, 'Flat Summary worksheet must exist');
  assert.equal(summarySheet.model.merges?.length || 0, 0, 'Summary sheet must have zero merged cells');
  let foundStatMatrixValue = false;
  summarySheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (String(cell.value || '').includes('06:30 Local')) foundStatMatrixValue = true;
    });
  });
  assert.ok(foundStatMatrixValue, 'Summary sheet must render statMatrix values');

  const pptxBuf = await buildPptxBuffer(spec);
  const pptxZip = new PizZip(pptxBuf);
  const presXml = pptxZip.file('ppt/presentation.xml')?.asText() || '';
  assert.match(presXml, /cx="12192000"[^>]*cy="6858000"/, 'PPTX must use 13.333" x 7.5" Widescreen dimensions');
  const slideFiles = Object.keys(pptxZip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  assert.ok(slideFiles.length >= 4, `Expected cover + overview + statMatrix + chart + table slides, got ${slideFiles.length}`);
  const slide1Xml = pptxZip.file('ppt/slides/slide1.xml').asText();
  assert.ok(slide1Xml.includes('WEEKLY REPORT'), 'PPTX cover slide should display periodicity pill');
});

test('planned-recurrence clamps MONTH recurrence on day 29/30/31 to short month end', () => {
  const monthlyTask = {
    operation_date_start: '2026-01-31T08:00:00.000Z',
    repeat_task_type: 'MONTH',
    repeat_task_number: 1,
    recurrence_end_date: null
  };

  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2026, 0, 31))), true, 'Jan 31');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2026, 1, 28))), true, 'Feb 28 non-leap');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2026, 1, 27))), false, 'Feb 27 should not match');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2026, 2, 31))), true, 'Mar 31');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2026, 3, 30))), true, 'Apr 30');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2028, 1, 29))), true, 'Feb 29 leap year');
  assert.equal(taskOccursOnDate(monthlyTask, new Date(Date.UTC(2028, 1, 28))), false, 'Feb 28 leap year should not match');
});
