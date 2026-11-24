// =============================================================================
// dashboard-helpers.ts — Pure formatting & badge utilities for Command Center
// =============================================================================

export function formatRelativeTime(input?: string | Date | null, now: Date = new Date()): string {
  if (!input) return '—';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';

  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 0) {
    const absMin = Math.round(Math.abs(diffSec) / 60);
    if (absMin < 60) return `in ${Math.max(1, absMin)}m`;
    const absHr = Math.round(absMin / 60);
    if (absHr < 24) return `in ${absHr}h`;
    return `in ${Math.round(absHr / 24)}d`;
  }

  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatCurrency(value?: number | null): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: num >= 1000 ? 0 : 2,
    maximumFractionDigits: num >= 1000 ? 0 : 2
  }).format(num);
}

export function formatShortTime(timeStr?: string | null): string {
  if (!timeStr) return '—';
  const parts = String(timeStr).trim().split(':');
  if (parts.length < 2) return timeStr;
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
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

export function getOperationStatusBadge(status?: string | null): string {
  const map: Record<string, string> = {
    PLANNED: 'badge-planned',
    IN_PROGRESS: 'badge-in-progress',
    ON_HOLD: 'badge-on-hold',
    COMPLETED: 'badge-completed',
    CANCELLED: 'badge-cancelled'
  };
  return (status && map[status]) || 'badge-planned';
}

export function getMaintenanceStatusBadge(status?: string | null): string {
  const map: Record<string, string> = {
    SCHEDULED: 'badge-planned',
    IN_PROGRESS: 'badge-in-progress',
    COMPLETED: 'badge-completed',
    FAILED: 'badge-cancelled',
    DEFERRED: 'badge-on-hold'
  };
  return (status && map[status]) || 'badge-planned';
}

export function getPriorityBadge(priority?: string | null): string {
  const map: Record<string, string> = {
    LOW: 'badge-low',
    MEDIUM: 'badge-medium',
    HIGH: 'badge-high',
    CRITICAL: 'badge-critical'
  };
  return (priority && map[priority]) || 'badge-medium';
}

export function getTaskStatusBadge(status?: string | null): string {
  const map: Record<string, string> = {
    TODO: 'badge-planned',
    IN_PROGRESS: 'badge-in-progress',
    REVIEW: 'badge-on-hold',
    DONE: 'badge-completed',
    CANCELLED: 'badge-cancelled',
    OVERDUE: 'badge-cancelled'
  };
  return (status && map[status]) || 'badge-planned';
}

export function getShiftStatusBadge(status?: string | null): string {
  const map: Record<string, string> = {
    SCHEDULED: 'badge-planned',
    CONFIRMED: 'badge-in-progress',
    IN_PROGRESS: 'badge-in-progress',
    COMPLETED: 'badge-completed',
    ABSENT: 'badge-cancelled',
    SWAPPED: 'badge-on-hold',
    ON_LEAVE: 'badge-on-hold'
  };
  return (status && map[status]) || 'badge-planned';
}

export function getMovementBadge(type?: string | null): string {
  switch (type) {
    case 'IN':
    case 'RETURN':
      return 'dash-badge-in';
    case 'OUT':
    case 'TRANSFER':
      return 'dash-badge-out';
    default:
      return 'dash-badge-adj';
  }
}

export function getMovementIcon(type?: string | null): string {
  switch (type) {
    case 'IN':
    case 'RETURN':
      return 'south_west';
    case 'OUT':
    case 'TRANSFER':
      return 'north_east';
    default:
      return 'sync_alt';
  }
}
