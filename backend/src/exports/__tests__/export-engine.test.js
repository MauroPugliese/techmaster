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
const { buildDocxBuffer } = require('../renderers/docx.renderer');
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

test('DOCX renderer builds concise, data-first, section-tailored CAE Navy Blue Word reports with zero generic audit boilerplate', async () => {
  const { DOCX_SECTION_PROFILES } = require('../renderers/docx-section-profiles');
  const { buildTemplateContent } = require('../renderers/docx-content.mapper');

  // 1. Verify all 15 platform sections define unique primary headings & descriptions
  const allModuleKeys = Object.keys(DOCX_SECTION_PROFILES);
  assert.equal(allModuleKeys.length, 15, 'Expected dedicated Word profiles for all 15 platform sections');

  const seenPrimaryTitles = new Set();
  const seenDescriptions = new Set();
  const sampleCtx = { specTitle: 'Sample', periodLabel: 'Weekly Report', alertCount: 2, totalRows: 10 };

  for (const mk of allModuleKeys) {
    const prof = DOCX_SECTION_PROFILES[mk];
    const firstSlot = prof.order[0];
    const firstSec = prof.sections[firstSlot];
    assert.ok(firstSec?.title, `${mk}: primary section must have a title`);
    assert.ok(!seenPrimaryTitles.has(firstSec.title), `Duplicate primary Word heading "${firstSec.title}" in ${mk}`);
    seenPrimaryTitles.add(firstSec.title);

    const desc = typeof firstSec.desc === 'function' ? firstSec.desc(sampleCtx) : firstSec.desc;
    assert.ok(desc && desc.length >= 25 && desc.length <= 200, `${mk}: primary description must be concise (25..200 chars), got ${desc?.length}`);
    assert.ok(!seenDescriptions.has(desc), `Duplicate primary Word description in ${mk}: "${desc}"`);
    seenDescriptions.add(desc);
  }

  // 2. Verify all 4 distinct blueprints render cleanly inside the official CAE Navy Blue template
  const specs = [
    ['briefing', createCommandBriefingSpec(), true, 'Control Room Snapshot'],
    ['telemetry', createTelemetrySpec(), true, 'Peak Demand &amp; Runtime Telemetry'],
    ['dossier', createMissionDossierSpec(), true, 'Sortie Volume &amp; Dispatch Metrics'],
    ['sop', createFormalSopSpec(), false, 'Document Control Metadata']
  ];

  for (const [label, spec, hasHiddenCol, expectedHeading] of specs) {
    const buffer = await buildDocxBuffer(spec);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 80000, `Expected full template-backed DOCX for ${label}, got ${buffer.length} bytes`);

    const zip = new PizZip(buffer);
    const stylesXml = zip.file('word/styles.xml')?.asText() || '';
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const chartXml = zip.file('word/charts/chart1.xml')?.asText() || '';
    const footer1Xml = zip.file('word/footer1.xml')?.asText() || '';
    const footer2Xml = zip.file('word/footer2.xml')?.asText() || '';
    const settingsXml = zip.file('word/settings.xml')?.asText() || '';

    // Exact official CAE Navy Blue template styles, media & theme preserved
    assert.match(stylesXml, /Titre-Title/);
    assert.match(stylesXml, /SousTitre-01/);
    assert.match(stylesXml, /Appendix-SousTitre/);
    assert.match(stylesXml, /Red Hat Display/);
    assert.match(stylesXml, /Arial/);
    assert.ok(zip.file('word/media/image1.png'), 'Cover CAE PNG logo must be preserved');
    assert.ok(zip.file('word/media/image2.svg'), 'Cover CAE SVG logo must be preserved');
    assert.ok(zip.file('word/media/image3.png'), 'Footer CAE PNG logo must be preserved');
    assert.ok(zip.file('word/embeddings/Microsoft_Excel_Worksheet.xlsx'), 'Embedded chart Excel sheet must exist');
    assert.match(settingsXml, /<w:updateFields w:val="true"\/>/);

    // Tailored section heading + template structural guarantees
    assert.match(documentXml, /r:embed="rId11"/, 'Cover logo rId11 must remain intact');
    assert.match(documentXml, /Table of Contents/);
    assert.ok(documentXml.includes(expectedHeading), `${label}: expected tailored heading "${expectedHeading}"`);
    assert.match(documentXml, /w:titlePg/);
    assert.match(documentXml, /w:cantSplit/);
    assert.match(documentXml, /w:tblHeader/);

    // ZERO bloated generic audit essay sections!
    for (const verboseBoilerplate of [
      /Objectives and Scope/,
      /Audit Approach/,
      /Root Causes and Risk Ratings/,
      /Acknowledgment/,
      /Detailed Audit Findings/,
      /Primary Root Cause/,
      /Management Comments &amp; Action Plans/,
      /Appendix 1/
    ]) {
      assert.doesNotMatch(documentXml, verboseBoilerplate, `${label}: must NOT contain generic audit boilerplate ${verboseBoilerplate}`);
    }

    // ZERO leftover Lorem Ipsum / template placeholder text anywhere
    for (const bad of [/Lorem ipsum/i, /Insert title here/i, /Insérer le titre/i, /Insert Text/i, /Insert Date/i, /Name, Title/, /Month day/i, /Chart Title/, /Category 1/, /Series 1/]) {
      assert.doesNotMatch(documentXml, bad, `Found leftover placeholder ${bad} in document.xml (${label})`);
      assert.doesNotMatch(chartXml, bad, `Found leftover placeholder ${bad} in chart1.xml (${label})`);
      assert.doesNotMatch(footer1Xml, bad, `Found leftover placeholder ${bad} in footer1.xml (${label})`);
      assert.doesNotMatch(footer2Xml, bad, `Found leftover placeholder ${bad} in footer2.xml (${label})`);
    }
    assert.match(footer1Xml, /Publication date:/);
    assert.match(footer2Xml, /Publication date:/);

    // Every bookmarkStart must have a matching bookmarkEnd
    const starts = [...documentXml.matchAll(/<w:bookmarkStart w:id="(\d+)"/g)].map((m) => m[1]);
    const ends = [...documentXml.matchAll(/<w:bookmarkEnd w:id="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual([...starts].sort(), [...ends].sort(), `${label}: balanced bookmarks required`);

    if (hasHiddenCol) {
      assert.match(documentXml, /TOTAL \(3\)/);
      assert.doesNotMatch(documentXml, /Secret Excel Audit/, `printHidden column must stay hidden in DOCX ${label}`);
    } else {
      assert.match(documentXml, /Standard Operating Procedure/);
      assert.match(documentXml, /Lockout-Tagout/);
      assert.doesNotMatch(documentXml, /r:id="rId13"/, 'Standalone SOP without charts should not embed a dummy bar chart');
    }

    // Ensure generated Word content stays lean and concise (not wordy essays)
    const contentModel = buildTemplateContent(spec, { hasRealChart: hasHiddenCol });
    assert.ok(contentModel.sections.length >= 2 && contentModel.sections.length <= 5, `${label}: expected 2..5 clean sections`);
  }
});

test('PPTX renderer produces 13.333x7.5 Widescreen slides with native charts, Red Hat typography & ZERO out-of-bounds shapes or tables', async () => {
  const SLIDE_W_EMU = 12192000; // 13.333"
  const SLIDE_H_EMU = 6858000;  // 7.500"
  const FOOTER_Y_EMU = Math.round(6.98 * 914400);

  const assertStrictSlideBounds = (zip, label) => {
    const presXml = zip.file('ppt/presentation.xml')?.asText() || '';
    assert.match(
      presXml,
      /<p:sldSz[^>]*cx="12192000"[^>]*cy="6858000"/,
      `${label}: PPTX must use 13.333" x 7.5" Widescreen canvas (12192000 x 6858000 EMU)`
    );

    const slideFiles = Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    assert.ok(slideFiles.length >= 2, `${label}: Expected >= 2 slides`);

    for (const sf of slideFiles) {
      const xml = zip.file(sf).asText();
      // Check every shape / picture / graphicFrame xfrm bounding box
      const xfrmMatches = [...xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g)];
      for (const m of xfrmMatches) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const cx = Number(m[3]);
        const cy = Number(m[4]);
        assert.ok(x >= -1000 && x + cx <= SLIDE_W_EMU + 2000, `${label} ${sf}: horizontal overflow x=${x}, cx=${cx}, sum=${x + cx} > ${SLIDE_W_EMU}`);
        assert.ok(y >= -1000 && y + cy <= SLIDE_H_EMU + 2000, `${label} ${sf}: vertical overflow y=${y}, cy=${cy}, sum=${y + cy} > ${SLIDE_H_EMU}`);
      }

      // Check every table graphicFrame: y + sum(row heights) must stay strictly above footer line!
      const graphicFrames = [...xml.matchAll(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g)];
      for (const gf of graphicFrames) {
        const chunk = gf[0];
        if (!chunk.includes('<a:tbl>')) continue;
        const offMatch = chunk.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
        const rowHeights = [...chunk.matchAll(/<a:tr h="(\d+)"/g)].map((r) => Number(r[1]));
        const colWidths = [...chunk.matchAll(/<a:gridCol w="(\d+)"/g)].map((c) => Number(c[1]));
        const tblX = Number(offMatch?.[1] || 0);
        const tblY = Number(offMatch?.[2] || 0);
        const sumH = rowHeights.reduce((a, b) => a + b, 0);
        const sumW = colWidths.reduce((a, b) => a + b, 0);
        assert.ok(
          tblX + sumW <= SLIDE_W_EMU + 2000,
          `${label} ${sf}: table width overflow x=${tblX} + sumW=${sumW} > ${SLIDE_W_EMU}`
        );
        assert.ok(
          tblY + sumH <= FOOTER_Y_EMU,
          `${label} ${sf}: table height crosses footer line! y=${tblY} + sumH=${sumH} (${((tblY + sumH) / 914400).toFixed(2)}") > 6.98"`
        );
      }
    }
    return slideFiles;
  };

  const briefing = createCommandBriefingSpec();
  const buffer = await buildPptxBuffer(briefing);
  assert.ok(Buffer.isBuffer(buffer));

  const zip = new PizZip(buffer);
  assert.ok(zip.file('ppt/charts/chart1.xml'), 'Expected editable native chart1.xml inside PPTX');
  const slideFiles = assertStrictSlideBounds(zip, 'CommandBriefing');
  assert.ok(slideFiles.length >= 4, `Expected >= 4 slides for command briefing, got ${slideFiles.length}`);

  const slide1Xml = zip.file('ppt/slides/slide1.xml')?.asText() || '';
  assert.match(slide1Xml, /Red Hat Display/);
  assert.match(slide1Xml, /Executive Command Center Briefing/);

  const allSlidesXml = slideFiles.map((k) => zip.file(k).asText()).join('\n');
  assert.match(allSlidesXml, /Slide \d+ of \d+/);
  assert.doesNotMatch(allSlidesXml, /Secret Excel Audit/, 'printHidden column should be omitted from PPTX slides');

  // Verify minimal SOP spec without charts or KPIs also renders cleanly within bounds
  const sopBuf = await buildPptxBuffer(createFormalSopSpec());
  assert.ok(Buffer.isBuffer(sopBuf));
  assertStrictSlideBounds(new PizZip(sopBuf), 'FormalSOP');

  // Stress-test heavy dense operational spec (18 rows with 260-char notes, 9 cols, 6 alerts, 7 scorecards, 5 highlights)
  const heavySpec = normalizeSpec({
    moduleKey: 'daily-station-ops',
    title: 'High-Density Fleet Operations, Maintenance & Handover Stress-Test Report',
    subtitle: 'Automated overflow stress test verifying strict pagination across dense tables, alerts, scorecards, and stat matrices',
    executiveBrief: 'Fleet readiness remained steady at 96.4% across 18 scheduled stations while maintenance crews completed corrective work orders on cooling loop sensors, motion control actuators, and projector calibration rigs without exceeding daily operational windows.',
    kpis: [
      { label: 'Availability', value: '96.4%', sublabel: 'Target >= 95%', tone: 'success' },
      { label: 'Training Hours', value: '342.5 h', sublabel: '18 active bays', tone: 'info' },
      { label: 'Open Work Orders', value: '14', sublabel: '3 high priority', tone: 'warning' },
      { label: 'Maintenance Cost', value: '$48,920.50', sublabel: 'MTD actuals', tone: 'primary' },
      { label: 'Critical Faults', value: '2', sublabel: 'Under repair', tone: 'danger' }
    ],
    insights: Array.from({ length: 6 }, (_, i) => ({
      severity: i % 2 === 0 ? 'danger' : 'warning',
      title: `Priority Escalation #${i + 1} — Subsystem Actuator Variance on Bay SIM-0${i + 1}`,
      detail: 'Hydraulic servo feedback exceeded nominal tolerance during evening QTG check. Engineering scheduled replacement cartridge installation during overnight window with zero lost crew training slots.'
    })),
    scorecards: [{
      title: 'Fleet Subsystem Health Matrix',
      items: Array.from({ length: 7 }, (_, i) => ({
        label: `Subsystem Group ${i + 1} — Motion & Visual Calibration`,
        percent: 98 - i * 4,
        valueLabel: `${98 - i * 4}.0%`,
        tone: i > 4 ? 'warning' : 'success'
      }))
    }],
    highlights: Array.from({ length: 5 }, (_, i) => ({
      eyebrow: 'SHIFT SPOTLIGHT',
      metric: `${18 + i}h`,
      title: `Bay SIM-0${i + 1} Continuous Mission Run`,
      detail: 'Zero unscheduled interruptions across morning, afternoon, and night training blocks with full QTG validation completed ahead of handover.',
      tone: 'info'
    })),
    pages: [{
      blocks: [{
        type: 'statMatrix',
        title: 'Control & Shift Configuration',
        pairs: Array.from({ length: 10 }, (_, i) => [
          `Operational Parameter ${i + 1}`,
          `Verified baseline threshold and extended shift handover configuration string for station cluster ${i + 1} (${i + 6}:00 UTC)`
        ])
      }]
    }],
    tables: [{
      name: 'Dense Station Handover Ledger',
      note: 'Comprehensive multi-shift log covering all 18 training bays including extended technician handover narratives and corrective maintenance notes.',
      columns: [
        { header: 'Bay ID', key: 'id', type: 'mono', width: 9 },
        { header: 'Simulator', key: 'sim', type: 'text', width: 12 },
        { header: 'Shift', key: 'shift', type: 'text', width: 8 },
        { header: 'Status', key: 'status', type: 'badge', width: 10 },
        { header: 'Hours', key: 'hours', type: 'number', decimals: 1, width: 8, total: 'sum' },
        { header: 'Util %', key: 'util', type: 'percent', decimals: 1, width: 8, total: 'avg' },
        { header: 'Cost', key: 'cost', type: 'currency', width: 10, total: 'sum' },
        { header: 'Lead Tech', key: 'tech', type: 'text', width: 12 },
        { header: 'Handover Notes', key: 'notes', type: 'text', width: 26 }
      ],
      rows: Array.from({ length: 18 }, (_, i) => ({
        id: `SIM-${String(i + 1).padStart(2, '0')}`,
        sim: `Full Flight Level-D Unit ${i + 1}`,
        shift: i % 2 === 0 ? 'Morning' : 'Night',
        status: i % 5 === 0 ? 'MAINTENANCE' : 'OPERATIONAL',
        status_tone: i % 5 === 0 ? 'warning' : 'success',
        hours: 14.5 + (i % 4),
        util: 86.2 + (i % 10),
        cost: 1250.75 * (i + 1),
        tech: `Engineer ${i + 1}`,
        notes: `Completed pre-flight visual collimation alignment, verified host network latency < 2ms, inspected motion hydraulic accumulators, and documented follow-up preventive lubrication checklist item #${i + 100} for incoming night-shift lead engineer.`
      }))
    }]
  });

  const heavyBuf = await buildPptxBuffer(heavySpec);
  const heavyZip = new PizZip(heavyBuf);
  const heavySlides = assertStrictSlideBounds(heavyZip, 'HeavyStressTest');
  assert.ok(heavySlides.length >= 8, `Expected multi-slide pagination for stress test, got ${heavySlides.length}`);
});

test('XLSX renderer creates simple pure rows-and-columns sheets starting at Row 1 with AutoFilter, gridlines ON, zero merged cells, and ALL exported data', async () => {
  const spec = createCommandBriefingSpec();
  const wb = buildWorkbook(spec);
  const rawBuffer = await wb.xlsx.writeBuffer();

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(rawBuffer);

  // Data sheet must come FIRST for immediate tabular analysis
  assert.equal(loaded.worksheets[0].name, 'Operations Detail', 'Primary data table must be the first worksheet');

  // Every worksheet must be pure flat rows & columns: Row 1 headers, frozen Row 1, gridlines ON, ZERO merged cells, ZERO floating images
  loaded.worksheets.forEach((ws) => {
    assert.equal(ws.views?.[0]?.showGridLines, true, `${ws.name}: gridlines must be ON`);
    assert.equal(ws.views?.[0]?.state, 'frozen', `${ws.name}: Row 1 must be frozen`);
    assert.equal(ws.views?.[0]?.ySplit, 1, `${ws.name}: freeze pane must be on Row 1`);
    assert.equal(ws.pageSetup?.paperSize, 9, `${ws.name}: paperSize must be A4`);
    assert.ok(ws.autoFilter, `${ws.name}: AutoFilter must be enabled on Row 1`);
    assert.equal(ws.model.merges?.length || 0, 0, `${ws.name}: pure tabular Excel must contain ZERO merged cells`);
    assert.equal(ws.getImages().length, 0, `${ws.name}: pure tabular Excel must contain ZERO floating images`);
  });

  const detailSheet = loaded.getWorksheet('Operations Detail');
  assert.ok(detailSheet, 'Expected Operations Detail sheet');
  assert.equal(detailSheet.getRow(1).getCell(1).value, 'ID', 'Row 1 must start immediately with table column headers');

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

  // Clean flat Summary & Chart Data sheets preserve ALL non-table report data
  const summarySheet = loaded.getWorksheet('Summary');
  assert.ok(summarySheet, 'Expected flat Summary worksheet');
  assert.equal(summarySheet.getRow(1).getCell(1).value, 'Section');

  const chartSheet = loaded.getWorksheet('Chart Data');
  assert.ok(chartSheet, 'Expected flat Chart Data worksheet');
  assert.equal(chartSheet.getRow(1).getCell(1).value, 'Chart');
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
    const pageCount = (latin1.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(pageCount, 1, `Daily template PDF with 6 tasks must fit on exactly 1 page with ZERO blank pages, got ${pageCount}`);
    assert.match(latin1, /RedHatDisplay/);
    assert.match(latin1, /RedHatText/);
    assert.doesNotMatch(latin1, /\/BaseFont\s+\/Helvetica\b/);
  }

  // Stress-test multi-page daily checklist & report (20 tasks -> exactly 2 pages, ZERO blank pages)
  const manyTasks = Array.from({ length: 20 }, (_, i) => ({
    subsystem: `Subsystem ${i + 1}`,
    task: `Preventive verification and calibration task #${i + 1} on simulator bay`,
    operationDateStart: '2026-04-15T08:00:00.000Z',
    operationDateEnd: '2026-04-15T08:30:00.000Z',
    status: i % 2 === 0 ? 'DONE' : 'TODO',
    reportTemplate: `Verified telemetry reading #${i + 1}`
  }));
  const manyData = buildTemplateData(manyTasks, '2026-04-15', { first_name: 'Alex', last_name: 'Tech' });
  for (const kind of ['checklist', 'report']) {
    const buf = await renderDailyNativePdf(kind, manyData, '2026-04-15');
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(pageCount, 2, `20-task daily ${kind} PDF must be exactly 2 pages with zero blank pages, got ${pageCount}`);
  }
});
