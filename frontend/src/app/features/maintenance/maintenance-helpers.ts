import {
  AssetStatus,
  MaintenanceRecord,
  MaintenanceStatus,
  Priority,
  RepeatTaskType
} from '../../core/models/interfaces';

const OPEN_STATUSES = new Set<MaintenanceStatus>(['SCHEDULED', 'IN_PROGRESS', 'DEFERRED']);

export function formatEnumLabel(value?: string | null): string {
  if (!value) return '—';
  return String(value)
    .toLowerCase()
    .split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

/**
 * Formats decimal hours into explicit human-readable hours & minutes (never "0.2 hrs").
 */
export function formatDowntime(hours: number | string | null | undefined): string {
  if (hours === null || hours === undefined || hours === '') return '—';
  const val = Number(hours);
  if (!Number.isFinite(val) || val <= 0) return '—';

  const totalMinutes = Math.round(val * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function splitDowntimeHours(hours: number | string | null | undefined): { hours: number; minutes: number } {
  const val = Number(hours);
  if (!Number.isFinite(val) || val <= 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.round(val * 60);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60
  };
}

export function combineDowntimeHours(hours: number | null | undefined, minutes: number | null | undefined): number | null {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  const totalMinutes = h * 60 + m;
  if (totalMinutes <= 0) return null;
  return Number((totalMinutes / 60).toFixed(2));
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isMaintenanceOverdue(record: Partial<MaintenanceRecord> | null | undefined): boolean {
  if (!record?.status || !OPEN_STATUSES.has(record.status)) return false;
  if (!record.scheduled_date) return false;
  const sched = new Date(record.scheduled_date);
  if (Number.isNaN(sched.getTime())) return false;
  return sched.getTime() < Date.now();
}

export function getStatusBadgeClass(status?: MaintenanceStatus | string | null): string {
  const map: Record<string, string> = {
    SCHEDULED: 'badge-planned',
    IN_PROGRESS: 'badge-in-progress',
    COMPLETED: 'badge-completed',
    FAILED: 'badge-cancelled',
    DEFERRED: 'badge-on-hold'
  };
  return map[String(status || '').toUpperCase()] || 'badge-planned';
}

export function getPriorityBadgeClass(priority?: Priority | string | null): string {
  const map: Record<string, string> = {
    LOW: 'badge-low',
    MEDIUM: 'badge-medium',
    HIGH: 'badge-high',
    CRITICAL: 'badge-critical'
  };
  return map[String(priority || '').toUpperCase()] || 'badge-medium';
}

export function getAssetStatusMeta(status?: AssetStatus | string | null): { label: string; color: string; bg: string } {
  switch (String(status || '').toUpperCase()) {
    case 'ACTIVE':
      return { label: 'Active', color: '#15803D', bg: '#DCFCE7' };
    case 'UNDER_MAINTENANCE':
      return { label: 'Under Maintenance', color: '#B45309', bg: '#FEF3C7' };
    case 'INACTIVE':
      return { label: 'Inactive', color: '#475569', bg: '#F1F5F9' };
    case 'RETIRED':
      return { label: 'Retired', color: '#64748B', bg: '#E2E8F0' };
    case 'LOST':
      return { label: 'Lost', color: '#DC2626', bg: '#FEE2E2' };
    default:
      return { label: formatEnumLabel(status), color: '#475569', bg: '#F1F5F9' };
  }
}

export function formatRecurrenceText(type?: RepeatTaskType | string | null, everyN?: number | null): string {
  const n = Math.max(1, Number(everyN) || 1);
  const t = String(type || 'WEEK').toUpperCase();
  if (t === 'DAY') return n === 1 ? 'Daily' : `Every ${n} days`;
  if (t === 'MONTH') return n === 1 ? 'Monthly' : `Every ${n} months`;
  return n === 1 ? 'Weekly' : `Every ${n} weeks`;
}

export function computeNextCycleDate(baseDate: Date | string | null | undefined, daysOffset: number): Date {
  const base = baseDate ? new Date(baseDate) : new Date();
  const valid = Number.isNaN(base.getTime()) ? new Date() : new Date(base.getTime());
  valid.setDate(valid.getDate() + daysOffset);
  return valid;
}

export function formatTechnicianName(tech?: { first_name?: string; last_name?: string; username?: string } | null): string {
  if (!tech) return 'Unassigned';
  const full = `${tech.first_name || ''} ${tech.last_name || ''}`.trim();
  return full || tech.username || 'Unassigned';
}
