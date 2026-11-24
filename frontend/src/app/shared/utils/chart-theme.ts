// =============================================================================
// shared/utils/chart-theme.ts — Unified Chart.js typography and grid tokens
// =============================================================================
import { Chart } from 'chart.js';

export const SMART_CHART_FONT_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";
export const SMART_CHART_TEXT_COLOR = '#6B7280';
export const SMART_CHART_GRID_COLOR = '#E1EAF5';

/**
 * Applies SMaRT global typography and color defaults to a registered Chart class
 * so tooltips, axis titles, legends, and ticks never fall back to system fonts.
 */
export function applySmartChartDefaults(chartClass: typeof Chart): void {
  chartClass.defaults.font.family = SMART_CHART_FONT_FAMILY;
  chartClass.defaults.font.size = 12;
  chartClass.defaults.color = SMART_CHART_TEXT_COLOR;

  const tooltipDefaults = chartClass.defaults.plugins?.tooltip;
  if (tooltipDefaults) {
    tooltipDefaults.titleFont = {
      family: SMART_CHART_FONT_FAMILY,
      weight: 'bold',
      size: 12
    };
    tooltipDefaults.bodyFont = {
      family: SMART_CHART_FONT_FAMILY,
      size: 12
    };
  }
}
