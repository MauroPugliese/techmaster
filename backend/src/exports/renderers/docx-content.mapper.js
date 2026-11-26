// =============================================================================
// exports/renderers/docx-content.mapper.js
// -----------------------------------------------------------------------------
// Pure, data-first content mapper transforming ANY normalized SMaRT ReportSpec
// into concise, section-specific Word document sections using the module's
// dedicated profile (`docx-section-profiles.js`).
// Zero repetitive audit boilerplate, zero fabricated filler, 100% live data.
// =============================================================================
'use strict';

const { COMPANY } = require('../core/branding');
const { collectSpecData } = require('../core/spec-collector');
const { str, cleanText, toNumber, fmtNumber, fmtMoney, fmtPercent } = require('../core/helpers');
const { getDocxSectionProfile } = require('./docx-section-profiles');

function formatLongDate(dt) {
  const d = dt ? new Date(dt) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function severityLabel(tone) {
  const t = String(tone || '').toLowerCase();
  if (t === 'danger' || t === 'critical' || t === 'high') return 'High';
  if (t === 'warning' || t === 'medium' || t === 'amber') return 'Medium';
  return 'Info';
}

/** Convert a secondary chart into a clean compact breakdown table. */
function chartToBreakdownTable(chart) {
  if (!chart || !Array.isArray(chart.labels) || !chart.labels.length) return null;
  const series = Array.isArray(chart.series) && chart.series.length
    ? chart.series
    : [{ name: chart.seriesName || 'Value', data: chart.values || [] }];
  const vals = (series[0]?.data || []).map((v) => toNumber(v, 0));
  const total = vals.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return null;

  const fmtVal = (v) => {
    if (chart.valueFormat === 'currency') return fmtMoney(v);
    if (chart.valueFormat === 'percent') return fmtPercent(v, 1);
    if (chart.valueFormat === 'hours') return `${v.toFixed(1)} h`;
    return Number.isInteger(v) ? fmtNumber(v, 0) : fmtNumber(v, 1);
  };

  return {
    name: chart.title || 'Quantitative Breakdown',
    columns: [
      { key: 'category', header: 'Category', type: 'text', width: 45 },
      ...series.slice(0, 3).map((s, idx) => ({
        key: `s${idx}`,
        header: s.name || `Series ${idx + 1}`,
        type: 'text',
        align: 'right',
        width: 20
      })),
      { key: 'share', header: 'Share (%)', type: 'text', align: 'right', width: 15 }
    ],
    rows: chart.labels.slice(0, 12).map((lbl, idx) => {
      const row = { category: str(lbl) };
      series.slice(0, 3).forEach((s, sIdx) => {
        row[`s${sIdx}`] = fmtVal(toNumber(s.data?.[idx], 0));
      });
      row.share = fmtPercent((Math.max(0, vals[idx] || 0) / total) * 100, 1);
      return row;
    })
  };
}

/** Build a compact metadata context strip (Period, Filters, Author) for Section 1. */
function buildMetaContextPairs(spec) {
  const pairs = [];
  const period = spec.meta?.period;
  if (period && period.type && period.type !== 'all') {
    const pText = [period.label, period.rangeText].filter(Boolean).join(' — ');
    if (pText) pairs.push(['Period', pText]);
  }
  const filters = (spec.meta?.filters || []).slice(0, 4);
  filters.forEach((f) => {
    if (f?.label && f?.value) pairs.push([str(f.label), str(f.value)]);
  });
  if (spec.meta?.generatedBy) {
    pairs.push(['Prepared By', str(spec.meta.generatedBy)]);
  }
  return pairs;
}

/** Build concise 1-sentence description for a section without redundant prose. */
function resolveSectionDescription(profile, slotKey, ctx, overrideText = '') {
  const custom = cleanText(overrideText, 240);
  if (custom) return custom;
  const def = profile.sections?.[slotKey];
  if (!def) return '';
  const text = typeof def.desc === 'function' ? def.desc(ctx) : String(def.desc || '');
  return cleanText(text, 220);
}

/**
 * Transform a ReportSpec into a lean, data-first, section-tailored structure
 * ready for `docx.renderer.js`.
 */
function buildTemplateContent(spec, { hasRealChart = false, usedChartIndex = 0 } = {}) {
  const collected = collectSpecData(spec);
  const profile = getDocxSectionProfile(spec.moduleKey, spec);

  const pubDateLong = formatLongDate(spec.meta?.generatedAt);
  const period = spec.meta?.period;
  const periodLabel = period && period.type && period.type !== 'all'
    ? [period.label, period.rangeText].filter(Boolean).join(' · ')
    : '';
  const periodBanner = period && period.type && period.type !== 'all'
    ? `${String(period.label || '').toUpperCase()}${period.rangeText ? `  ·  ${period.rangeText}` : ''}`
    : '';

  const visibleTables = (collected.tables || []).filter(
    (t) => Array.isArray(t.columns) && t.columns.some((c) => !c.printHidden)
  );
  const totalRows = visibleTables.reduce((a, t) => a + (t.rows?.length || 0), 0);

  const ctx = {
    specTitle: spec.title || 'Operational Report',
    periodLabel,
    alertCount: (collected.insights || []).length,
    totalRows
  };

  // Pre-build reusable data tables for each slot
  const kpiCols = profile.kpiColumns || ['Metric', 'Value', 'Context'];
  const kpiTable = collected.kpis.length
    ? {
        name: 'Key Metrics',
        columns: [
          { key: 'metric', header: kpiCols[0], type: 'text', width: 38 },
          { key: 'value', header: kpiCols[1], type: 'text', align: 'right', width: 22 },
          { key: 'context', header: kpiCols[2], type: 'text', width: 40 }
        ],
        rows: collected.kpis.slice(0, 12).map((k) => ({
          metric: str(k.label),
          value: str(k.value),
          context: str(k.sublabel || '—'),
          _flag: k.tone === 'danger' || k.tone === 'warning' ? k.tone : undefined
        }))
      }
    : null;

  const scorecardTables = (collected.scorecards || [])
    .filter((sc) => sc.items && sc.items.length)
    .map((sc) => ({
      name: sc.title || 'Readiness Scorecard',
      columns: [
        { key: 'pillar', header: 'Domain / Item', type: 'text', width: 44 },
        { key: 'score', header: 'Score', type: 'text', align: 'right', width: 20 },
        { key: 'status', header: 'Status', type: 'badge', width: 16 },
        { key: 'detail', header: 'Detail', type: 'text', width: 20 }
      ],
      rows: sc.items.map((it) => {
        const p = toNumber(it.percent, 0);
        const tone = it.tone || (p >= 90 ? 'success' : (p >= 75 ? 'warning' : 'danger'));
        return {
          pillar: str(it.label),
          score: str(it.valueLabel || fmtPercent(p, 1)),
          status: p >= 90 ? 'ON TARGET' : (p >= 75 ? 'WATCH' : 'ATTENTION'),
          status_tone: tone,
          detail: str(it.detail || '—')
        };
      })
    }));

  const secondaryChartTables = (collected.charts || [])
    .filter((_, idx) => !(profile.showChart && hasRealChart && idx === usedChartIndex))
    .map(chartToBreakdownTable)
    .filter(Boolean);

  const alertCols = profile.alertColumns || ['Notice', 'Severity', 'Details'];
  const alertItems = (collected.insights || []).slice(0, 12).map((ins) => ({
    title: cleanText(ins.title || 'Notice', 100),
    severity: severityLabel(ins.severity),
    tone: ins.severity || 'info',
    detail: cleanText(ins.detail || '—', 240)
  }));

  const hlCols = profile.highlightColumns || ['Highlight', 'Metric', 'Details'];
  const highlightTable = (collected.highlights || []).length
    ? {
        name: 'Highlights',
        columns: [
          { key: 'item', header: hlCols[0], type: 'text', width: 34 },
          { key: 'metric', header: hlCols[1], type: 'text', align: 'right', width: 18 },
          { key: 'detail', header: hlCols[2], type: 'text', width: 48 }
        ],
        rows: collected.highlights.slice(0, 10).map((h) => ({
          item: cleanText(h.title || h.eyebrow || 'Item', 90),
          metric: str(h.metric || '—'),
          detail: cleanText([h.eyebrow && h.title ? h.eyebrow : '', h.detail].filter(Boolean).join(' · ') || '—', 200)
        }))
      }
    : null;

  const statMatrixBlocks = (collected.statMatrices || []).map((sm) => ({
    kind: 'table',
    subTitle: sm.title || '',
    table: {
      name: sm.title || 'Parameters',
      columns: [
        { key: 'param', header: 'Parameter', type: 'text', width: 38 },
        { key: 'val', header: 'Value', type: 'text', width: 62 }
      ],
      rows: (sm.pairs || []).map(([k, v]) => ({
        param: str(k),
        val: str(v ?? '—')
      }))
    }
  }));

  // Assemble ONLY populated sections following the module's tailored order
  const sections = [];
  let secIdx = 0;

  const pushSection = (slotKey, blocks, { customDesc = '', startOnNewPage = false } = {}) => {
    if (!blocks.length) return;
    secIdx += 1;
    const secDef = profile.sections?.[slotKey] || { title: 'Report Data' };
    sections.push({
      id: slotKey,
      bookmark: `_Sec${secIdx}`,
      title: secDef.title,
      description: resolveSectionDescription(profile, slotKey, ctx, customDesc),
      startOnNewPage,
      blocks
    });
  };

  for (const slot of profile.order) {
    if (slot === 'summary') {
      const blocks = [];
      if (kpiTable) blocks.push({ kind: 'table', table: kpiTable });
      if (!blocks.length && collected.executiveBrief) {
        blocks.push({ kind: 'note', text: cleanText(collected.executiveBrief, 600) });
      }
      if (blocks.length) {
        // Prefer the module's concise brief (clamped to 1 short sentence) if present, else profile's tailored 1-liner
        const briefOneLiner = kpiTable && collected.executiveBrief
          ? cleanText(collected.executiveBrief.split(/(?<=[.!?])\s+/)[0], 210)
          : '';
        pushSection('summary', blocks, { customDesc: briefOneLiner });
      }
    } else if (slot === 'specs') {
      if (statMatrixBlocks.length) {
        pushSection('specs', statMatrixBlocks);
      }
    } else if (slot === 'scorecards') {
      if (scorecardTables.length) {
        pushSection(
          'scorecards',
          scorecardTables.map((tbl) => ({
            kind: 'table',
            subTitle: scorecardTables.length > 1 ? tbl.name : '',
            table: tbl
          }))
        );
      }
    } else if (slot === 'alerts') {
      if (alertItems.length) {
        pushSection('alerts', [{ kind: 'alerts', columns: alertCols, items: alertItems }]);
      }
    } else if (slot === 'highlights') {
      if (highlightTable) {
        pushSection('highlights', [{ kind: 'table', table: highlightTable }]);
      }
    } else if (slot === 'charts') {
      const blocks = [];
      if (profile.showChart && hasRealChart) {
        blocks.push({ kind: 'chart', relId: 'rId13' });
      }
      secondaryChartTables.forEach((tbl) => {
        blocks.push({ kind: 'table', subTitle: tbl.name, table: tbl });
      });
      if (blocks.length) {
        pushSection('charts', blocks);
      }
    } else if (slot === 'document') {
      if (collected.documentBlocks.length) {
        pushSection('document', [{ kind: 'markdown', blocks: collected.documentBlocks }]);
      }
    } else if (slot === 'tables') {
      if (visibleTables.length) {
        const tblBlocks = visibleTables.map((tbl) => ({
          kind: 'table',
          subTitle: visibleTables.length > 1 ? (tbl.name || '') : '',
          note: tbl.note ? cleanText(tbl.note, 180) : '',
          table: tbl
        }));
        pushSection('tables', tblBlocks, { startOnNewPage: sections.length >= 2 });
      }
    }
  }

  // Safety net: ensure even a minimal empty spec renders one clean section
  if (!sections.length) {
    pushSection('summary', [{
      kind: 'note',
      text: 'No records matched the selected reporting window and active filters.'
    }]);
  }

  return {
    collected,
    profile,
    cover: {
      title: spec.title || 'Operational Report',
      subtitle: spec.subtitle || spec.theme?.reportType || 'Operations Data Report',
      periodBanner,
      teamLine: `${profile.coverTeam}  |  ${spec.docCode || spec.theme?.docCode || 'CAE-RPT'}`,
      dateLine: pubDateLong,
      pubDateShort: pubDateLong,
      confidentiality: spec.meta?.confidentiality || COMPANY.confidentiality
    },
    metaPairs: buildMetaContextPairs(spec),
    sections
  };
}

module.exports = {
  buildTemplateContent,
  formatLongDate
};
