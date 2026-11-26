// =============================================================================
// exports/core/spec-collector.js — Unified ReportSpec Artifact Collector
// -----------------------------------------------------------------------------
// Single source of truth for collecting deduplicated analytical artifacts from
// both top-level ReportSpec fields and composable `spec.pages` blueprints.
// Used by export.service.js, xlsx.renderer.js, and pptx.renderer.js.
// =============================================================================

/**
 * Collect deduplicated analytical artifacts from BOTH top-level fields and any
 * composable `spec.pages` blocks without mutating the incoming spec.
 */
function collectSpecData(spec = {}) {
  const briefParts = [];
  if (spec.executiveBrief) briefParts.push(spec.executiveBrief);

  const kpis = [...(spec.kpis || [])];
  const scorecards = [...(spec.scorecards || [])];
  const highlights = [...(spec.highlights || [])];
  const insights = [...(spec.insights || [])];
  const statMatrices = [...(spec.statMatrices || [])];
  const charts = [...(spec.charts || [])];
  const tables = [...(spec.tables || [])];
  const documentBlocks = [...(spec.documentBlocks || [])];

  const seenTables = new Set(tables.map((t) => t.name).filter(Boolean));
  const seenCharts = new Set(charts.map((c) => c.title).filter(Boolean));
  const seenMatrices = new Set(statMatrices.map((m) => m.title).filter(Boolean));

  (spec.pages || []).forEach((page) => {
    (page.blocks || []).forEach((block) => {
      if (!block) return;

      switch (block.type) {
        case 'brief':
          if (block.text && !briefParts.includes(block.text)) briefParts.push(block.text);
          break;
        case 'kpis':
          if (Array.isArray(block.items) && block.includeInSummary !== false) {
            block.items.forEach((it) => {
              if (!kpis.some((k) => k.label === it.label)) kpis.push(it);
            });
          }
          break;
        case 'gaugeBand':
          if (Array.isArray(block.items) && !kpis.length) {
            block.items.forEach((it) => {
              kpis.push({
                label: it.label,
                value: it.valueLabel || `${Number(it.percent || 0).toFixed(1)}%`,
                rawValue: Number(it.percent || 0),
                numFmt: '0.0"%"',
                sublabel: it.sublabel || '',
                tone: it.tone
              });
            });
          }
          break;
        case 'scorecard':
          if ((block.title || block.items?.length) && !scorecards.some((s) => s.title === block.title)) {
            scorecards.push({ title: block.title, subtitle: block.subtitle, items: block.items || [] });
          }
          break;
        case 'highlights':
          (block.items || []).forEach((it) => {
            if (!highlights.some((h) => h.title === it.title && h.eyebrow === it.eyebrow)) highlights.push(it);
          });
          break;
        case 'cardList':
          (block.items || []).forEach((it) => {
            if (!highlights.some((h) => h.title === it.title)) {
              highlights.push({
                eyebrow: it.badge || block.title || 'FEATURED',
                metric: it.metric || '',
                title: it.title,
                detail: [it.meta, it.detail].filter(Boolean).join(' · '),
                tone: it.badgeTone || 'info'
              });
            }
          });
          break;
        case 'alerts':
          (block.items || []).forEach((it) => {
            if (!insights.some((ins) => ins.title === it.title)) insights.push(it);
          });
          break;
        case 'statMatrix':
          if (Array.isArray(block.pairs) && block.pairs.length) {
            const title = block.title || 'Control & Specification Summary';
            if (!seenMatrices.has(title)) {
              statMatrices.push({ title, pairs: block.pairs });
              seenMatrices.add(title);
            }
          }
          break;
        case 'chart':
          if (block.chart && (!block.chart.title || !seenCharts.has(block.chart.title))) {
            charts.push(block.chart);
            if (block.chart.title) seenCharts.add(block.chart.title);
          }
          break;
        case 'chartPair':
          [block.left, block.right].filter(Boolean).forEach((ch) => {
            if (!ch.title || !seenCharts.has(ch.title)) {
              charts.push(ch);
              if (ch.title) seenCharts.add(ch.title);
            }
          });
          break;
        case 'table':
          if (block.table && (!block.table.name || !seenTables.has(block.table.name))) {
            tables.push(block.table);
            if (block.table.name) seenTables.add(block.table.name);
          }
          break;
        case 'markdown':
          if (Array.isArray(block.blocks)) {
            block.blocks.forEach((mb) => documentBlocks.push(mb));
          }
          break;
      }
    });
  });

  return {
    executiveBrief: briefParts[0] || '',
    kpis,
    scorecards,
    highlights,
    insights,
    statMatrices,
    charts,
    tables,
    documentBlocks
  };
}

module.exports = { collectSpecData };
