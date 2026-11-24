// =============================================================================
// analytics-helpers.ts — Shared types & formatters for Analytics & Reports
// =============================================================================

export type AnalyticsTab = 'overview' | 'operations' | 'maintenance' | 'workforce' | 'reports';
export type AnalyticsPeriod = 'all' | '7d' | '30d' | '90d' | 'ytd' | 'custom';
export type AnalyticsGranularity = 'hour' | 'day' | 'week' | 'month';

export interface AnalyticsOverviewKpis {
  totalOperations: number;
  completedOperations: number;
  overdueOperations: number;
  operationCompletionRate: number;
  totalMaintenanceRecords: number;
  completedMaintenanceRecords: number;
  totalMaintenanceCost: number;
  totalDowntimeHours: number;
  avgDowntimeHours: number;
  totalAssets: number;
  activeAssets: number;
  fleetReadinessPct: number;
  stockIn: number;
  stockOut: number;
  totalMovements: number;
  netStockFlow: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  taskCompletionRate: number;
  workShifts: number;
  totalAbsences: number;
  shiftAttendanceRate: number;
}

export interface AnalyticsPeriodDeltas {
  totalOperations: number | null;
  operationCompletionRate: number | null;
  totalMaintenanceCost: number | null;
  totalDowntimeHours: number | null;
  netStockFlow: number | null;
  taskCompletionRate: number | null;
  shiftAttendanceRate: number | null;
}

export interface AnalyticsInsight {
  id: string;
  domain: string;
  title: string;
  value: string;
  detail: string;
  tone: 'info' | 'ok' | 'warn' | 'danger' | 'neutral';
}

export interface AnalyticsOpsTypeRow {
  type_id: number;
  type: string;
  color: string;
  count: number;
  completed: number;
  in_progress: number;
  planned: number;
  total_minutes: number;
}

export interface AnalyticsStatusBucket {
  status: string;
  count: number;
}

export interface AnalyticsMaintSummaryRow {
  type: string;
  count: number;
  completed_count: number;
  open_count: number;
  total_downtime: number;
  avg_downtime: number;
  total_cost: number;
  completion_rate: number;
}

export interface AnalyticsTopAsset {
  id: number;
  name: string;
  serial_number?: string | null;
  category_name?: string | null;
  records_count: number;
  total_cost: number;
  total_downtime: number;
}

export interface AnalyticsStockByTypeRow {
  type: string;
  moves: number;
  total_qty: number;
}

export interface AnalyticsTaskCadenceRow {
  interval_type: string;
  label: string;
  total: number;
  completed: number;
  pending: number;
  cancelled: number;
  completion_rate: number;
  avg_completion_hours: number;
}

export interface AnalyticsOverview {
  generatedAt: string;
  period: AnalyticsPeriod;
  granularity: AnalyticsGranularity;
  hasComparison: boolean;
  seriesStartDate: string;
  seriesEndDate: string;
  kpis: AnalyticsOverviewKpis;
  deltas: AnalyticsPeriodDeltas | null;
  insights: AnalyticsInsight[];
  opsByType: AnalyticsOpsTypeRow[];
  opsByStatus: AnalyticsStatusBucket[];
  activityTrend: {
    dates: string[];
    operations: number[];
    maintenance: number[];
    tasks: number[];
  };
  maintSummary: AnalyticsMaintSummaryRow[];
  topAssets: AnalyticsTopAsset[];
  stockFlow: {
    dates: string[];
    in: number[];
    out: number[];
  };
  stockByType: AnalyticsStockByTypeRow[];
  shiftCoverage: {
    dates: string[];
    series: Array<{ name: string; color: string; data: number[] }>;
    absences: number[];
  };
  taskCadence: AnalyticsTaskCadenceRow[];
  peak: {
    dayName: string;
    hour: number | null;
    peakHourFormatted: string;
    count: number;
  };
}

export interface OperationsMetricsPayload {
  period: string;
  granularity: AnalyticsGranularity;
  dateRange: { from: string | null; to: string | null };
  metrics: {
    totalOperations: number;
    totalMinutes: number;
    totalHours: number;
    remainingMinutes: number;
    avgDuration: number;
    maxDuration: number;
    minDuration: number;
    overdueCount: number;
    overdueRate: number;
    completionRate: number;
  };
  charts: {
    trend: Array<{ date: string; count: number; avgDuration: number }>;
    timeDistribution: Array<{ type: string; color: string; count: number; totalMinutes: number }>;
    statusBreakdown: AnalyticsStatusBucket[];
  };
  insights: {
    peakDay: string;
    peakHour: number | null;
    peakHourFormatted: string;
    mostActiveType: string;
  };
}

export interface ExportModuleCatalogItem {
  key: string;
  docCode: string;
  theme: string;
  title: string;
  subtitle: string;
  category: string;
  formats: Array<'xlsx' | 'pdf' | 'docx' | 'pptx'>;
  restricted: boolean;
  allowed?: boolean;
}

/**
 * Format duration strictly in explicit hours & minutes (never decimal hours).
 */
export function formatDurationMinutes(rawMinutes?: number | null): string {
  const mins = Math.max(0, Math.round(Number(rawMinutes) || 0));
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * Convert stored downtime hours into explicit `Xh Ym` / `Ym` label.
 */
export function formatDowntimeHours(rawHours?: number | null): string {
  const hrs = Number(rawHours);
  if (!Number.isFinite(hrs) || hrs <= 0) return '0m';
  return formatDurationMinutes(Math.round(hrs * 60));
}

export function formatCurrency(value?: number | null): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.abs(num) >= 100 || Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: Math.abs(num) >= 100 || Number.isInteger(num) ? 0 : 2
  }).format(num);
}

export function formatEnumLabel(value?: string | null): string {
  if (!value) return '—';
  return String(value)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDelta(delta?: number | null, suffix = '%'): string {
  if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) return '—';
  const num = Math.round(Number(delta));
  if (num > 0) return `+${num}${suffix}`;
  return `${num}${suffix}`;
}

export function formatShortDateLabel(rawDate?: string | null, granularity: AnalyticsGranularity = 'day'): string {
  if (!rawDate) return '';
  const str = String(rawDate);
  if (granularity === 'hour' && str.includes(' ')) {
    const [datePart, timePart] = str.split(' ');
    const d = new Date(`${datePart}T00:00:00Z`);
    const dayLbl = Number.isNaN(d.getTime())
      ? datePart
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${dayLbl} ${timePart.slice(0, 5)}`;
  }
  if (granularity === 'month' && /^\d{4}-\d{2}/.test(str)) {
    const d = new Date(`${str.slice(0, 7)}-01T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? str
      : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  const normalized = str.length === 10 ? `${str}T00:00:00Z` : str;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
