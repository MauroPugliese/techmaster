import { Operation, OperationStatus, Priority, User } from '../../core/models/interfaces';

const OPEN_OP_STATUSES = new Set<OperationStatus>(['PLANNED', 'IN_PROGRESS', 'ON_HOLD']);

export const CREW_ROLE_SUGGESTIONS = [
  'Mission Lead',
  'Pilot / Operator',
  'Tech Support',
  'Safety Officer',
  'Observer'
];

export const DURATION_PRESETS = [
  { label: '+1h', hours: 1 },
  { label: '+2h', hours: 2 },
  { label: '+4h', hours: 4 },
  { label: '+1d', hours: 24 }
];

export function formatEnumLabel(value?: string | null): string {
  if (!value) return '—';
  return String(value)
    .toLowerCase()
    .split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

/**
 * Formats integer minutes into explicit human-readable durations ("1d 2h", "2h 30m", "45 min").
 */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return '—';
  }
  const rounded = Math.round(minutes);
  if (rounded === 0) return '0 min';

  const days = Math.floor(rounded / 1440);
  const remAfterDays = rounded % 1440;
  const hrs = Math.floor(remAfterDays / 60);
  const mins = remAfterDays % 60;

  if (days > 0) {
    return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
  }
  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function formatDurationRange(
  start?: string | Date | null,
  end?: string | Date | null
): string {
  if (!start || !end) return '—';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—';
  const diffMs = e.getTime() - s.getTime();
  if (diffMs < 0) return '—';
  return formatDurationMinutes(Math.round(diffMs / 60000));
}

export function addHoursToDate(base: Date | string | null | undefined, hours: number): Date {
  const origin = base ? new Date(base) : new Date();
  const safe = Number.isNaN(origin.getTime()) ? new Date() : new Date(origin.getTime());
  return new Date(safe.getTime() + hours * 60 * 60 * 1000);
}

export function isOperationOverdue(op: Partial<Operation> | null | undefined): boolean {
  if (!op?.status || !OPEN_OP_STATUSES.has(op.status)) return false;
  if (!op.end_date) return false;
  const end = new Date(op.end_date);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

export function getStatusBadgeClass(status?: OperationStatus | string | null): string {
  const m: Record<string, string> = {
    PLANNED: 'badge-planned',
    IN_PROGRESS: 'badge-in-progress',
    COMPLETED: 'badge-completed',
    CANCELLED: 'badge-cancelled',
    ON_HOLD: 'badge-on-hold'
  };
  return m[String(status || '').toUpperCase()] || 'badge-planned';
}

export function getPriorityBadgeClass(priority?: Priority | string | null): string {
  const m: Record<string, string> = {
    LOW: 'badge-low',
    MEDIUM: 'badge-medium',
    HIGH: 'badge-high',
    CRITICAL: 'badge-critical'
  };
  return m[String(priority || '').toUpperCase()] || 'badge-medium';
}

export function getUserDisplayName(user?: Partial<User> | null): string {
  if (!user) return 'System';
  const full = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return full || user.username || 'System';
}

export function getUserInitials(user?: Partial<User> | null): string {
  if (!user) return '?';
  const first = user.first_name?.[0] || '';
  const last = user.last_name?.[0] || '';
  if (first || last) return `${first}${last}`.toUpperCase();
  return (user.username?.[0] || '?').toUpperCase();
}
