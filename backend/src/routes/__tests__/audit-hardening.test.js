// =============================================================================
// routes/__tests__/audit-hardening.test.js
// Regression tests covering Phase 1–3 audit fixes:
//   - RBAC authorize() enforcement
//   - parseDateFilter inclusive UTC date-only boundaries
//   - validation middleware sensitive field redaction (express-validator v7 path)
//   - Excel formula-injection neutralization & composite KPI string preservation
//   - Planned daily template hasShutdown / hasRestore accuracy
//   - DOCX wiki executiveBrief retention & non-duplicated multi-chart embedding
// =============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');

const { authorize } = require('../../middleware/auth.middleware');
const { parseDateFilter } = require('../../middleware/error.middleware');
const { validateLogin } = require('../../middleware/validation.middleware');
const { buildWorkbook } = require('../../exports/renderers/xlsx.renderer');
const { buildDocxBuffer } = require('../../exports/renderers/docx.renderer');
const { normalizeSpec } = require('../../exports/core/export.service');
const { buildTemplateData } = require('../../exports/core/planned-daily-template.service');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('authorize enforces allowed roles and permits admin override', () => {
  const mw = authorize('manager', 'tech');

  let called = false;
  const resDenied = createMockRes();
  mw({ user: { role: { name: 'viewer' } } }, resDenied, () => { called = true; });
  assert.equal(called, false);
  assert.equal(resDenied.statusCode, 403);

  called = false;
  const resTech = createMockRes();
  mw({ user: { role: { name: 'tech' } } }, resTech, () => { called = true; });
  assert.equal(called, true);

  called = false;
  const resAdmin = createMockRes();
  mw({ user: { role: { name: 'admin' } } }, resAdmin, () => { called = true; });
  assert.equal(called, true);
});

test('parseDateFilter expands YYYY-MM-DD boundaries to inclusive UTC start/end of day', () => {
  const req = { headers: {}, query: { from: '2026-11-20', to: '2026-11-20' } };
  const res = createMockRes();
  let nextCalled = false;

  parseDateFilter(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.dateRange.from.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(req.dateRange.to.toISOString(), '2026-11-20T23:59:59.999Z');

  // Invalid date yields 400
  const badReq = { headers: {}, query: { from: 'not-a-date' } };
  const badRes = createMockRes();
  let badNext = false;
  parseDateFilter(badReq, badRes, () => { badNext = true; });
  assert.equal(badNext, false);
  assert.equal(badRes.statusCode, 400);
});

test('validation middleware redacts password values and reports express-validator v7 field path', async () => {
  const req = {
    body: { email: 'not-an-email', password: '' },
    query: {},
    params: {},
    headers: {}
  };
  const res = createMockRes();

  for (const fn of validateLogin) {
    let proceeded = false;
    await new Promise((resolve) => {
      const result = fn(req, res, () => { proceeded = true; resolve(); });
      if (result && typeof result.then === 'function') {
        result.then(resolve);
      } else if (!proceeded) {
        resolve();
      }
    });
    if (res.body) break;
  }

  assert.equal(res.statusCode, 422);
  assert.ok(Array.isArray(res.body?.errors));
  const pwErr = res.body.errors.find((e) => e.field === 'password');
  assert.ok(pwErr, 'password validation error must expose field="password"');
  assert.equal(pwErr.value, '[REDACTED]');
});

test('xlsx.renderer neutralizes spreadsheet formula injection while preserving numeric values and composite KPIs', async () => {
  const spec = normalizeSpec({
    moduleKey: 'maintenance',
    title: 'Formula Safety Audit',
    filename: 'Formula_Safety',
    pages: [
      {
        title: 'Summary',
        blocks: [
          {
            type: 'kpis',
            items: [
              { label: 'Bays Ready', value: '14 / 16', sublabel: 'Live fraction must not parse as 14' },
              { label: 'Formula KPI', value: '=CMD|" /C calc"!A0', sublabel: 'Must be escaped' }
            ]
          },
          {
            type: 'table',
            table: {
              name: 'Audit Rows',
              columns: [
                { key: 'title', header: 'Title', type: 'text' },
                { key: 'delta', header: 'Delta', type: 'number' },
                { key: 'note', header: 'Note', type: 'text' }
              ],
              rows: [
                { title: '=SUM(A1:A5)', delta: -12.5, note: '+1+1' },
                { title: '@IMPORTXML("http://evil")', delta: 42, note: '-2+3' }
              ]
            }
          }
        ]
      }
    ]
  });

  const wb = buildWorkbook(spec);
  const buf = await wb.xlsx.writeBuffer();
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(buf);

  const dataWs = parsed.getWorksheet('Audit Rows');
  assert.ok(dataWs);
  assert.equal(dataWs.getCell('A2').value, "'=SUM(A1:A5)");
  assert.equal(dataWs.getCell('B2').value, -12.5);
  assert.equal(dataWs.getCell('C2').value, "'+1+1");
  assert.equal(dataWs.getCell('A3').value, "'@IMPORTXML(\"http://evil\")");
  assert.equal(dataWs.getCell('C3').value, "'-2+3");

  const summaryWs = parsed.getWorksheet('Summary');
  assert.ok(summaryWs);
  let foundComposite = false;
  let foundEscapedKpi = false;
  summaryWs.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value === '14 / 16') foundComposite = true;
      if (cell.value === '\'=CMD|" /C calc"!A0') foundEscapedKpi = true;
    });
  });
  assert.equal(foundComposite, true, 'Composite KPI string "14 / 16" must remain intact');
  assert.equal(foundEscapedKpi, true, 'Formula-like KPI string must be prefixed with apostrophe');
});

test('planned-daily-template sets SHUTDOWN_TASK and RESTORE_TASK accurately based on task content', () => {
  const regular = buildTemplateData([
    {
      id: 1,
      system: 'VISUAL',
      subsystem: 'Projector Array',
      task: 'Inspect collimated mirror luminance calibration',
      reference: 'SOP-VIS-01',
      status: 'TODO',
      operationDateStart: '2026-11-26T08:00:00Z',
      operationDateEnd: '2026-11-26T09:00:00Z'
    }
  ], '2026-11-26', null);

  assert.equal(regular.SHUTDOWN_TASK, false);
  assert.equal(regular.RESTORE_TASK, false);

  const withShutdown = buildTemplateData([
    {
      id: 2,
      system: 'ELECTRICAL',
      subsystem: 'Server Room',
      task: 'Shutdown all systems in Server Room',
      reference: 'LOTO-01',
      status: 'TODO',
      operationDateStart: '2026-11-26T08:00:00Z',
      operationDateEnd: '2026-11-26T09:00:00Z'
    },
    {
      id: 3,
      system: 'ELECTRICAL',
      subsystem: 'Server Room',
      task: 'Restore all systems in Server Room',
      reference: 'LOTO-02',
      status: 'TODO',
      operationDateStart: '2026-11-26T09:00:00Z',
      operationDateEnd: '2026-11-26T10:00:00Z'
    }
  ], '2026-11-26', null);

  assert.equal(withShutdown.SHUTDOWN_TASK, true);
  assert.equal(withShutdown.RESTORE_TASK, true);
});

test('docx.renderer preserves wiki-article executiveBrief and never duplicates embedded chart as secondary table', async () => {
  const wikiSpec = normalizeSpec({
    moduleKey: 'wiki-article',
    title: 'HPU Accumulator Isolation SOP',
    subtitle: 'Safety runbook verification',
    pages: [
      {
        title: 'Procedure',
        blocks: [
          {
            type: 'brief',
            text: 'Unique safety isolation runbook summary for HPU maintenance.'
          }
        ]
      }
    ]
  });

  const wikiBuf = await buildDocxBuffer(wikiSpec);
  const wikiZip = new PizZip(wikiBuf);
  const wikiDocXml = wikiZip.file('word/document.xml').asText();
  assert.ok(
    wikiDocXml.includes('Unique safety isolation runbook summary for HPU maintenance.'),
    'wiki-article executiveBrief block must be preserved in DOCX output'
  );

  // Multi-chart spec: chart 0 embedded in chart1.xml must NOT be duplicated as a secondary table
  const multiChartSpec = normalizeSpec({
    moduleKey: 'maintenance',
    title: 'Multi-Chart Deduplication Check',
    pages: [
      {
        title: 'Charts',
        blocks: [
          {
            type: 'chart',
            chart: {
              type: 'bar',
              title: 'Primary Embedded Chart',
              labels: ['Motion', 'Visual'],
              values: [12, 8]
            }
          },
          {
            type: 'chart',
            chart: {
              type: 'bar',
              title: 'Secondary Breakdown Chart',
              labels: ['Preventive', 'Corrective'],
              values: [20, 5]
            }
          }
        ]
      }
    ]
  });

  const chartBuf = await buildDocxBuffer(multiChartSpec);
  const chartZip = new PizZip(chartBuf);
  const chartXml = chartZip.file('word/charts/chart1.xml').asText();
  const docXml = chartZip.file('word/document.xml').asText();
  assert.ok(chartXml.includes('Primary Embedded Chart'), 'First chart must populate chart1.xml');
  assert.ok(!docXml.includes('Primary Embedded Chart'), 'Embedded primary chart must not be duplicated as table in document.xml');
  assert.ok(docXml.includes('Secondary Breakdown Chart'), 'Second chart must render as compact breakdown table');
});
