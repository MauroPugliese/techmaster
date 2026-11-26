// =============================================================================
// exports/__tests__/export-engine.test.js
// Comprehensive verification suite for CAE SMaRT Report Engine v4 (A4 Composable)
// Run inside backend/: npm test (node --test src/exports/__tests__/*.test.js)
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PizZip = require('pizzip');
const ExcelJS = require('exceljs');
const { Packer } = require('docx');

const { verifyBundledFonts } = require('../core/fonts');
const { THEMES, CAE_A4_THEME, MODULE_THEMES, resolveTheme } = require('../core/themes');
const { MODULES } = require('../modules');
const { normalizeSpec, collectSpecData } = require('../core/export.service');
const { parseMarkdownBlocks } = require('../core/markdown.parser');
const {
  normalizeOccurrence,
  taskOccursOnDate
} = require('../../services/planned-recurrence.service');
const {
  buildTemplateData,
  renderTemplateDocx,
  renderDailyNativePdf
} = require('../core/planned-daily-template.service');
const { buildPdfBuffer } = require('../renderers/pdf.renderer');
const { buildDocument } = require('../renderers/docx.renderer');
const { buildPptxBuffer } = require('../renderers/pptx.renderer');
const { buildWorkbook } = require('../renderers/xlsx.renderer');

function sampleOpsTable(name = 'Operations Detail') {
  return {
    name,
    priority: true,
    note: 'Primary work orders for the reporting window.',
    columns: [
      { key: 'code', header: 'ID', type: 'mono', width: 62 },
      { key: 'title', header: 'Operation Title', type: 'text', width: 155 },
      { key: 'secretNote', header: 'Secret Excel Audit', type: 'text', width: 120, printHidden: true },
      { key: 'status', header: 'Status', type: 'badge', width: 78, align: 'center' },
      { key: 'tasks', header: 'Tasks', type: 'number', align: 'right', width: 52, total: 'sum', dataBar: true },
      { key: 'cost', header: 'Cost (USD)', type: 'currency', align: 'right', width: 82, total: 'sum', dataBar: true },
      { key: 'progress', header: 'Progress', type: 'percent', align: 'right', width: 65, total: 'avg' }
    ],
    rows: [
      {
        code: 'OP-101',
        title: 'UPS Bank A Preventive Inspection',
        secretNote: 'EXCEL_ONLY_ROW_1',
        status: 'COMPLETED',
        status_tone: 'success',
        tasks: 5,
        cost: 4250.25,
        progress: 100
      },
      {
        code: 'OP-102',
        title: 'Chiller Loop Flow Balancing',
        secretNote: 'EXCEL_ONLY_ROW_2',
        status: 'IN_PROGRESS',
        status_tone: 'info',
        tasks: 4,
        cost: 6800.0,
        progress: 75
      },
      {
        code: 'OP-103',
        title: 'Switchgear Thermal Imaging Scan',
        secretNote: 'EXCEL_ONLY_ROW_3',
        status: 'CRITICAL',
        status_tone: 'danger',
        tasks: 3,
        cost: 3200.25,
        progress: 25
      }
    ]
  };
}

/** Blueprint 1: Command Briefing with radial gauges, scorecard, chartPair & curated table. */
function createCommandBriefingSpec() {
  return normalizeSpec({
    moduleKey: 'dashboard',
    docCode: 'CAE-EXEC-01',
    theme: 'dashboard',
    title: 'Executive Command Center Briefing',
    subtitle: 'Cross-module readiness gauges, pillar scorecards and escalations',
    category: 'EXECUTIVE COMMAND BRIEFING',
    orientation: 'portrait',
    filename: 'exec_command_briefing',
    meta: {
      generatedBy: 'Lead Reliability Engineer',
      generatedAt: new Date('2026-04-15T10:30:00Z'),
      filters: [{ label: 'Window', value: '2026-04-01 to 2026-04-15' }]
    },
    coverHighlights: [
      { label: 'Fleet Readiness', value: '94.2%' },
      { label: 'Total Spend', value: '$14,250.50' },
      { label: 'Critical Alerts', value: '2' }
    ],
    pages: [
      {
        title: 'Enterprise Readiness & Governance',
        subtitle: 'Core readiness gauges, executive narrative and pillar scorecards',
        blocks: [
          {
            type: 'gaugeBand',
            items: [
              { label: 'Fleet Readiness', valueLabel: '94.2%', percent: 94.2, sublabel: '49/52 operational', tone: 'success' },
              { label: 'PM Adherence', valueLabel: '87.5%', percent: 87.5, sublabel: '42/48 closed', tone: 'info' },
              { label: 'SLA Compliance', valueLabel: '91.0%', percent: 91.0, sublabel: 'Within target', tone: 'primary' }
            ]
          },
          {
            type: 'brief',
            title: 'Command Summary',
            text: 'Plant availability remains above the 90% operational threshold across primary subsystems, with two electrical feeder escalations prioritized for containment.'
          },
          {
            type: 'scorecard',
            title: 'Domain Health Scorecard',
            subtitle: 'Weighted compliance per functional pillar',
            items: [
              { label: 'Electrical Power Distribution', valueLabel: '96.0% (24/25)', percent: 96.0, tone: 'success', detail: 'UPS strings nominal' },
              { label: 'Cooling & HVAC Loop', valueLabel: '78.5% (11/14)', percent: 78.5, tone: 'warning', detail: 'Chiller #2 flow balancing scheduled' }
            ]
          }
        ]
      },
      {
        title: 'Cross-Domain Visual Analytics',
        subtitle: 'Status lifecycle split vs subsystem workload ranking',
        blocks: [
          {
            type: 'chartPair',
            height: 200,
            left: {
              type: 'donut',
              title: 'Operations by Status',
              labels: ['Completed', 'In Progress', 'Planned'],
              values: [28, 12, 8],
              valueFormat: 'count'
            },
            right: {
              type: 'lollipop',
              title: 'Workload by Subsystem',
              labels: ['Electrical', 'HVAC', 'Networking', 'Security'],
              values: [125.5, 84.0, 42.5, 19.0],
              valueFormat: 'hours'
            }
          },
          {
            type: 'highlights',
            title: 'Key Cost & Activity Drivers',
            items: [
              { eyebrow: 'COST DRIVER', metric: '$6,800.00', title: 'Chiller Loop Overhaul', detail: 'Largest maintenance allocation in period.', tone: 'warning' },
              { eyebrow: 'TOP SITE', metric: '18 sorties', title: 'Bay 01 · Main Hall', detail: 'Highest concentration of scheduled sorties.', tone: 'info' }
            ]
          }
        ]
      },
      {
        title: 'Operations Work Order Ledger',
        subtitle: 'Filtered command ledger (audit note preserved in Excel)',
        blocks: [{ type: 'table', showHeading: false, table: sampleOpsTable('Operations Detail') }]
      }
    ]
  });
}

/** Blueprint 2: Telemetry Study with Line Chart FIRST, statMatrix peak metrics, and inline table. */
function createTelemetrySpec() {
  return normalizeSpec({
    moduleKey: 'operations-analytics',
    docCode: 'CAE-TEL-04',
    theme: 'operations-analytics',
    title: 'Throughput & Time Telemetry Study',
    subtitle: 'Operational volume curves, peak demand windows and effort split',
    category: 'OPERATIONS TELEMETRY',
    orientation: 'portrait',
    coverHighlights: [
      { label: 'Peak Daily Sorties', value: '14' },
      { label: 'Total Effort', value: '271.0 h' },
      { label: 'Completion Rate', value: '88.0%' }
    ],
    pages: [
      {
        title: 'Volume Curves & Peak Telemetry',
        subtitle: 'Hero demand trend followed by quantitative peak parameters',
        blocks: [
          {
            type: 'chart',
            height: 224,
            chart: {
              type: 'line',
              title: 'Daily Operational Sortie Throughput',
              subtitle: 'Created vs Completed sorties',
              labels: ['04-10', '04-11', '04-12', '04-13', '04-14', '04-15'],
              series: [
                { name: 'Created', data: [6, 9, 14, 8, 11, 10] },
                { name: 'Completed', data: [5, 8, 12, 8, 10, 9] }
              ]
            }
          },
          {
            type: 'statMatrix',
            title: 'Peak Demand & Efficiency Parameters',
            pairs: [
              ['Peak Day', '2026-04-12 (14 sorties)'],
              ['Rolling Daily Mean', '9.7 sorties/day'],
              ['Mean Resolution', '4.2 hours'],
              ['Total Logged Effort', '271.0 h']
            ]
          }
        ]
      },
      {
        title: 'Discipline Effort & Execution Ledger',
        blocks: [{ type: 'table', showHeading: true, table: sampleOpsTable('Telemetry Orders') }]
      }
    ]
  });
}

/** Blueprint 3: Mission & Operations Dossier with hero-split KPIs, alerts, cardList spotlights & groupedBar. */
function createMissionDossierSpec() {
  return normalizeSpec({
    moduleKey: 'operations',
    docCode: 'CAE-OPS-03',
    theme: 'operations',
    title: 'Operations & Sorties Report',
    subtitle: 'Operational lifecycle, duration analysis and priority execution',
    category: 'OPERATIONS INTELLIGENCE',
    orientation: 'portrait',
    coverHighlights: [
      { label: 'Total Operations', value: '48' },
      { label: 'On-Schedule Rate', value: '87.5%' },
      { label: 'Critical Sorties', value: '2' }
    ],
    pages: [
      {
        title: 'Mission Profile & Alerts',
        blocks: [
          {
            type: 'alerts',
            title: 'Operational Risk Escalations',
            items: [{ severity: 'danger', title: '2 Critical Operations Active', detail: 'Requires immediate signoff from Bay 01 Lead.' }]
          },
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Total Operations', value: '48', rawValue: 48, sublabel: '12 active in window', tone: 'primary' },
              { label: 'Completion Rate', value: '87.5%', rawValue: 87.5, sublabel: '42 closed', tone: 'success' },
              { label: 'Median Duration', value: '3h 20m', sublabel: 'Planned vs actual', tone: 'info' },
              { label: 'Critical Open', value: '2', rawValue: 2, sublabel: 'Immediate escalation', tone: 'danger' },
              { label: 'On Hold', value: '1', rawValue: 1, sublabel: 'Awaiting spares', tone: 'warning' }
            ]
          },
          {
            type: 'cardList',
            title: 'Featured & Critical Sorties',
            items: [
              {
                badge: 'CRITICAL',
                badgeTone: 'danger',
                title: 'Switchgear Thermal Imaging Scan',
                metric: '3h 45m',
                meta: 'Bay 01 · Main Hall · Owner: M. Rossi',
                detail: 'Infrared survey under full feeder load prior to scheduled shutdown.'
              }
            ]
          }
        ]
      },
      {
        title: 'Cadence Mix & Sorties Register',
        blocks: [
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'groupedBar',
              title: 'Cadence Execution (Total vs Done)',
              labels: ['Daily', 'Weekly', 'Monthly'],
              series: [
                { name: 'Total', data: [20, 14, 6] },
                { name: 'Done', data: [19, 12, 5] }
              ]
            }
          },
          { type: 'table', showHeading: true, table: sampleOpsTable('Sorties Ledger') }
        ]
      }
    ]
  });
}

/** Blueprint 4: Formal Standard Operating Procedure matching CAE SOP Template (no dashboard KPIs/charts). */
function createFormalSopSpec() {
  const md = [
    '# 1. Purpose and Scope',
    'Applies to high-voltage UPS preventive shutdown and **Lockout-Tagout (LOTO)** verification in Bay 01.',
    '## 1.1 Safety Prerequisites',
    '- Verify dielectric PPE rating before panel entry.',
    '- Confirm bypass synchronization lock via `STS-PANEL-A`.',
    '1. Isolate main breaker Q1.',
    '2. Apply personal lock and tag.',
    '```bash',
    'smart-cli ups verify --bank=A --mode=loto',
    '```',
    '| Step | Check | Limit |',
    '| --- | --- | --- |',
    '| 1 | Zero Energy Test | < 1 V AC |'
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  return normalizeSpec({
    moduleKey: 'wiki-article',
    docCode: 'CAE-SOP-007',
    theme: 'wiki-article',
    title: 'High-Voltage UPS Lockout-Tagout Procedure',
    subtitle: 'Electrical Safety — Controlled Standard Operating Procedure',
    category: 'STANDARD OPERATING PROCEDURE',
    orientation: 'portrait',
    coverHighlights: [
      { label: 'Revision', value: 'v3' },
      { label: 'Approval Status', value: 'PUBLISHED' },
      { label: 'Consultations', value: '142' }
    ],
    documentBlocks: blocks,
    pages: [
      {
        title: 'Standard Operating Procedure',
        subtitle: 'CAE-SOP-007 · Revision v3 · Prepared by Elena Bianchi',
        blocks: [
          {
            type: 'statMatrix',
            title: 'Document Control Metadata',
            pairs: [
              ['Document Code', 'CAE-SOP-007'],
              ['Version', 'v3'],
              ['Lifecycle Status', 'PUBLISHED'],
              ['Written By', 'Elena Bianchi']
            ]
          },
          { type: 'markdown', blocks }
        ]
      }
    ],
    tables: [{
      name: 'Document Control Record',
      columns: [
        { header: 'Field', key: 'field', width: 150 },
        { header: 'Value', key: 'value', width: 320 }
      ],
      rows: [
        { field: 'Document Code', value: 'CAE-SOP-007' },
        { field: 'Lifecycle Status', value: 'PUBLISHED' }
      ]
    }]
  });
}

test('bundled Red Hat TrueType fonts are present and valid', () => {
  const report = verifyBundledFonts();
  assert.equal(report.allPresent, true);
  assert.equal(report.files.length, 12);

  for (const file of report.files) {
    assert.ok(file.size > 40000, `Expected ${file.filename} > 40KB, got ${file.size}`);
    const header = fs.readFileSync(file.fullPath).subarray(0, 4);
    const isTtf = header.equals(Buffer.from([0x00, 0x01, 0x00, 0x00]));
    const isOtf = header.toString('ascii') === 'OTTO';
    assert.ok(isTtf || isOtf, `Invalid font magic bytes for ${file.filename}`);
  }
});

test('all 14 report modules enforce unified CAE A4 diagonal-hero identity with unique docCodes and bespoke metadata', () => {
  const mods = Object.values(MODULES);
  assert.equal(mods.length, 14);

  const docCodes = new Set();
  for (const mod of mods) {
    assert.equal(mod.orientation, 'portrait', `Expected ${mod.key} orientation === portrait`);
    const resolved = resolveTheme({ moduleKey: mod.key, theme: mod.theme, docCode: mod.docCode });
    assert.equal(resolved.coverStyle, 'diagonal-hero', `Expected diagonal-hero cover for ${mod.key}`);
    assert.equal(resolved.primary, CAE_A4_THEME.primary, `Expected CAE Navy primary for ${mod.key}`);
    assert.equal(resolved.accent, CAE_A4_THEME.accent, `Expected CAE Electric Blue accent for ${mod.key}`);
    assert.ok(resolved.docCode, `Expected docCode for ${mod.key}`);
    assert.ok(resolved.reportType, `Expected reportType for ${mod.key}`);
    assert.equal(docCodes.has(resolved.docCode), false, `Duplicate docCode ${resolved.docCode}`);
    docCodes.add(resolved.docCode);
  }

  assert.equal(Object.keys(THEMES).length, 1);
  assert.ok(MODULE_THEMES['wiki-article'], 'Expected wiki-article theme preset for standalone SOPs');
  assert.ok(MODULE_THEMES['daily-station-ops'], 'Expected daily-station-ops theme preset');
  assert.equal(typeof MODULES.simulators.buildSingleStation, 'function', 'Expected simulators.buildSingleStation for single station dossiers');
});

test('collectSpecData aggregates KPIs, insights, scorecards, highlights, charts & tables across spec.pages', () => {
  const briefing = createCommandBriefingSpec();
  const collected = collectSpecData(briefing);
  assert.equal(collected.scorecards.length, 1);
  assert.equal(collected.highlights.length, 2);
  assert.equal(collected.charts.length, 2);
  assert.equal(collected.tables.length, 1);
  assert.ok(collected.kpis.length >= 3, 'Expected gaugeBand items to feed KPI aggregation');
});

test('planned-recurrence projects occurrence dates, applies overrides, and respects DELETED/endDate', () => {
  const master = {
    id: 42,
    system: 'Electrical',
    subsystem: 'UPS',
    task: 'Inspect UPS',
    reference: 'SOP-10',
    operation_date_start: '2026-04-01T09:30:00.000Z',
    operation_date_end: '2026-04-01T11:00:00.000Z',
    repeat_task_type: 'WEEK',
    repeat_task_number: 2,
    recurrence_end_date: '2026-04-20',
    status: 'TODO',
    optional: false
  };

  assert.equal(taskOccursOnDate(master, '2026-04-01'), true);
  assert.equal(taskOccursOnDate(master, '2026-04-08'), false);
  assert.equal(taskOccursOnDate(master, '2026-04-15'), true);
  assert.equal(taskOccursOnDate(master, '2026-04-29'), false);

  const projected = normalizeOccurrence(master, '2026-04-15', null);
  assert.ok(projected);
  assert.equal(projected.operationDateStart, '2026-04-15T09:30:00.000Z');
  assert.equal(projected.operationDateEnd, '2026-04-15T11:00:00.000Z');
  assert.equal(projected.occurrenceDate, '2026-04-15');
  assert.equal(projected.isOccurrence, false);
  assert.equal(projected.masterId, 42);

  const overridden = normalizeOccurrence(master, '2026-04-15', {
    id: 99,
    status: 'DONE',
    operation_date_start: '2026-04-15T14:00:00.000Z',
    operation_date_end: '2026-04-15T15:15:00.000Z'
  });
  assert.ok(overridden);
  assert.equal(overridden.isOccurrence, true);
  assert.equal(overridden.instanceId, 99);
  assert.equal(overridden.status, 'DONE');

  const deleted = normalizeOccurrence(master, '2026-04-15', { exception_type: 'DELETED' });
  assert.equal(deleted, null);
});

test('markdown.parser converts full Markdown syntax into structured semantic blocks', () => {
  const md = [
    '# Heading One',
    '## Heading Two',
    '### Heading Three',
    '',
    'Text with **bold**, *italic*, and `inline`.',
    '',
    '- Bullet A',
    '',
    '1. First',
    '',
    '> Quote line',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---'
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  const types = blocks.map((b) => b.type);

  assert.deepEqual(types, [
    'h1', 'h2', 'h3', 'paragraph', 'bullets', 'ordered', 'quote', 'code', 'table', 'divider'
  ]);
  const para = blocks.find((b) => b.type === 'paragraph');
  assert.ok(para.runs.some((r) => r.bold && r.text === 'bold'));
  assert.ok(para.runs.some((r) => r.italic && r.text === 'italic'));
  assert.ok(para.runs.some((r) => r.code && r.text === 'inline'));
});

test('PDF renderer executes distinct spec.pages blueprints (Briefing, Telemetry, Dossier, SOP) in A4 Portrait with Red Hat fonts', async () => {
  const blueprints = [
    ['briefing', createCommandBriefingSpec(), 4],
    ['telemetry', createTelemetrySpec(), 3],
    ['dossier', createMissionDossierSpec(), 3],
    ['sop', createFormalSopSpec(), 2]
  ];

  for (const [label, spec, minPages] of blueprints) {
    const buf = await buildPdfBuffer(spec);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(buf.length > 20000, `Expected substantial PDF for ${label}`);

    const latin1 = buf.toString('latin1');
    assert.match(latin1, /RedHatDisplay/, `Missing RedHatDisplay in ${label}`);
    assert.match(latin1, /RedHatText/, `Missing RedHatText in ${label}`);
    assert.doesNotMatch(latin1, /\/BaseFont\s+\/Helvetica\b/, `Unexpected Helvetica fallback in ${label}`);
    assert.match(latin1, /\/MediaBox \[0 0 595\.28 841\.89\]/, `Expected A4 Portrait MediaBox in ${label}`);

    const pagesCountMatch = /\/Count (\d+)/.exec(latin1);
    const pageCount = pagesCountMatch ? Number(pagesCountMatch[1]) : 0;
    assert.ok(pageCount >= minPages, `Expected >= ${minPages} pages for ${label}, got ${pageCount}`);
  }

  // Empty spec still renders cleanly without Helvetica fallback
  const emptyBuf = await buildPdfBuffer(normalizeSpec({ title: 'Empty Operational Report', moduleKey: 'audit', theme: 'audit' }));
  assert.equal(emptyBuf.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('DOCX renderer renders all 4 distinct blueprints on A4 Portrait with Cover Outline, Red Hat Display & Arial, hiding printHidden', async () => {
  const specs = [
    ['briefing', createCommandBriefingSpec(), true],
    ['telemetry', createTelemetrySpec(), true],
    ['dossier', createMissionDossierSpec(), true],
    ['sop', createFormalSopSpec(), false]
  ];

  for (const [label, spec, hasHiddenCol] of specs) {
    const buffer = await Packer.toBuffer(buildDocument(spec));
    assert.ok(Buffer.isBuffer(buffer));

    const zip = new PizZip(buffer);
    const stylesXml = zip.file('word/styles.xml')?.asText() || '';
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    assert.match(stylesXml, /Red Hat Display/, `Missing Red Hat Display in DOCX ${label}`);
    assert.match(stylesXml, /Arial/, `Missing Arial in DOCX ${label}`);
    assert.match(stylesXml, /0C47C7/i);
    assert.match(stylesXml, /082F84/i);

    assert.match(documentXml, /w:w="11906"/);
    assert.match(documentXml, /w:h="16838"/);
    assert.match(documentXml, /w:titlePg/);
    assert.match(documentXml, /w:pageBreakBefore/);
    assert.match(documentXml, /w:cantSplit/);
    assert.match(documentXml, /w:tblHeader/);
    assert.match(documentXml, /REPORT CONTENTS/);
    assert.doesNotMatch(documentXml, /\{[^{}]+\}/);

    if (hasHiddenCol) {
      assert.match(documentXml, /TOTAL \(3\)/);
      assert.doesNotMatch(documentXml, /Secret Excel Audit/, `printHidden column must stay hidden in DOCX ${label}`);
    } else {
      assert.match(documentXml, /Document Control Metadata/);
      assert.match(documentXml, /Lockout-Tagout/);
    }
  }
});

test('PPTX renderer consumes spec.pages via aggregated data with native charts, Red Hat typography & Slide numbering', async () => {
  const briefing = createCommandBriefingSpec();
  const buffer = await buildPptxBuffer(briefing);
  assert.ok(Buffer.isBuffer(buffer));

  const zip = new PizZip(buffer);
  assert.ok(zip.file('ppt/charts/chart1.xml'), 'Expected editable native chart1.xml inside PPTX');

  const slide1Xml = zip.file('ppt/slides/slide1.xml')?.asText() || '';
  assert.match(slide1Xml, /Red Hat Display/);
  assert.match(slide1Xml, /Executive Command Center Briefing/);

  const slideFiles = Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  assert.ok(slideFiles.length >= 4, `Expected >= 4 slides for command briefing, got ${slideFiles.length}`);
  const allSlidesXml = slideFiles.map((k) => zip.file(k).asText()).join('\n');
  assert.match(allSlidesXml, /Slide \d+ of \d+/);
  assert.doesNotMatch(allSlidesXml, /Secret Excel Audit/, 'printHidden column should be omitted from PPTX slides');

  // Verify minimal SOP spec without charts or KPIs also renders cleanly to PPTX
  const sopBuf = await buildPptxBuffer(createFormalSopSpec());
  assert.ok(Buffer.isBuffer(sopBuf));
});

test('XLSX renderer collects spec.pages data into A4 Executive Summary, preserves printHidden audit cols, SUM totals & colorScale XML', async () => {
  const spec = createCommandBriefingSpec();
  const wb = buildWorkbook(spec);
  const rawBuffer = await wb.xlsx.writeBuffer();

  const zip = new PizZip(rawBuffer);
  const sheetXmls = Object.keys(zip.files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .map((k) => zip.file(k).asText());
  const allSheetsXml = sheetXmls.join('\n');
  assert.match(allSheetsXml, /<colorScale>/);
  assert.doesNotMatch(allSheetsXml, /<x14:id>undefined<\/x14:id>/);

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(rawBuffer);

  const execSheet = loaded.getWorksheet('Executive Summary');
  assert.ok(execSheet, 'Expected Executive Summary sheet');
  assert.equal(execSheet.views?.[0]?.showGridLines, false);
  assert.equal(execSheet.pageSetup?.paperSize, 9);
  assert.ok(
    Array.isArray(execSheet.conditionalFormattings) &&
      execSheet.conditionalFormattings.some((cf) => cf.rules?.some((r) => r.type === 'colorScale')),
    'Expected colorScale conditional formatting on Executive Summary'
  );

  const detailSheet = loaded.getWorksheet('Operations Detail');
  assert.ok(detailSheet, 'Expected Operations Detail sheet');
  assert.equal(detailSheet.pageSetup?.paperSize, 9);
  assert.ok(detailSheet.autoFilter, 'Expected autoFilter on Operations Detail');

  let foundNumericCost = false;
  let foundSumFormula = false;
  let foundPrintHiddenAuditCol = false;
  detailSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value === 4250.25) foundNumericCost = true;
      if (cell.value === 'Secret Excel Audit') foundPrintHiddenAuditCol = true;
      if (typeof cell.value === 'object' && cell.value?.formula && /^SUM\(/.test(cell.value.formula)) {
        foundSumFormula = true;
      }
    });
  });

  assert.equal(foundNumericCost, true, 'Expected typed numeric currency cell');
  assert.equal(foundSumFormula, true, 'Expected live SUM() formula row');
  assert.equal(foundPrintHiddenAuditCol, true, 'Expected printHidden columns to be preserved in Excel');
  assert.ok(
    Array.isArray(detailSheet.conditionalFormattings) &&
      detailSheet.conditionalFormattings.some((cf) => cf.rules?.some((r) => r.type === 'colorScale')),
    'Expected colorScale conditional formatting rules on Operations Detail'
  );
});

test('Daily planned maintenance template data preserves LOTO, computes UTC OpsTime, renders clean DOCX & Red Hat PDF', async () => {
  const dayTasks = [
    {
      subsystem: 'Server Room',
      task: 'Shutdown all systems in Server Room',
      operationDateStart: '2026-04-15T08:00:00.000Z',
      operationDateEnd: '2026-04-15T08:30:00.000Z',
      status: 'DONE',
      reportTemplate: 'Checklist §1'
    },
    {
      subsystem: 'Electrical',
      task: 'Apply Lockout-Tagout Procedure to Server Room Electrical Panels',
      operationDateStart: '2026-04-15T08:30:00.000Z',
      operationDateEnd: '2026-04-15T08:45:00.000Z',
      status: 'DONE',
      reportTemplate: 'LOTO Verified'
    },
    {
      subsystem: 'UPS',
      task: 'Test UPS Battery Strings',
      operationDateStart: '2026-04-15T08:30:00.000Z',
      operationDateEnd: '2026-04-15T10:00:00.000Z',
      status: 'DONE',
      reportTemplate: 'Nominal 48V'
    },
    {
      subsystem: 'Cooling',
      task: 'Clean Condenser Filters',
      operationDateStart: '2026-04-15T10:15:00.000Z',
      operationDateEnd: '2026-04-15T11:00:00.000Z',
      status: 'TODO',
      reportTemplate: 'Pending filter delivery'
    },
    {
      subsystem: 'Docs',
      task: 'Archive Night Shift Signoff',
      operationDateStart: '2026-04-15T00:00:00.000Z',
      operationDateEnd: '2026-04-15T00:00:00.000Z',
      status: 'DONE',
      reportTemplate: ''
    },
    {
      subsystem: 'Server Room',
      task: 'Restore all systems in Server Room',
      operationDateStart: '2026-04-15T11:00:00.000Z',
      operationDateEnd: '2026-04-15T11:30:00.000Z',
      status: 'DONE',
      reportTemplate: 'Checklist §3'
    }
  ];

  const data = buildTemplateData(dayTasks, '2026-04-15', { first_name: 'Mario', last_name: 'Rossi' });
  assert.equal(data.DATE, '15/04/2026');
  assert.equal(data.AssignedTo, 'Mario Rossi');
  assert.equal(data.HAS_LOTO, true);
  assert.equal(data.TOTAL_DURATION, '2 h 15 min');
  assert.equal(data.StartOpsTime, '08:00');
  assert.equal(data.EndOpsTime, '11:30');
  assert.ok(data.TASKS.some((t) => t.Task.includes('Lockout-Tagout')));

  const checklistDocx = await renderTemplateDocx('checklist', data);
  const reportDocx = await renderTemplateDocx('report', data);

  for (const [kind, buf] of [['checklist', checklistDocx], ['report', reportDocx]]) {
    const zip = new PizZip(buf);
    const xml = zip.file('word/document.xml')?.asText() || '';
    const plainText = xml.replace(/<[^>]+>/g, '');
    assert.doesNotMatch(plainText, /\{[^{}]+\}/, `Expected no unresolved Docxtemplater tags in ${kind}`);
    assert.match(plainText, /15\/04\/2026/);
    assert.match(plainText, /Test UPS Battery Strings/);
    assert.match(plainText, /2 h 15 min/);
    if (kind === 'report') {
      assert.match(plainText, /Mario Rossi/);
    }
  }

  const checklistPdf = await renderDailyNativePdf('checklist', data, '2026-04-15');
  const reportPdf = await renderDailyNativePdf('report', data, '2026-04-15');

  for (const pdfBuf of [checklistPdf, reportPdf]) {
    assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
    const latin1 = pdfBuf.toString('latin1');
    assert.match(latin1, /RedHatDisplay/);
    assert.match(latin1, /RedHatText/);
    assert.doesNotMatch(latin1, /\/BaseFont\s+\/Helvetica\b/);
  }
});
