// =============================================================================
// features/admin/admin-helpers.ts — Shared Admin Settings constants & helpers
// =============================================================================

export type AdminTab =
  | 'overview'
  | 'audit-logs'
  | 'users'
  | 'roles'
  | 'section-access'
  | 'operation-types'
  | 'shift-types'
  | 'asset-categories'
  | 'item-categories'
  | 'wiki-categories'
  | 'warehouse-locations'
  | 'customization';

export interface AdminNavItem {
  id: AdminTab;
  label: string;
  icon: string;
  countKey?: string;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    title: 'Platform',
    items: [
      { id: 'overview',   label: 'System Overview', icon: 'dashboard' },
      { id: 'audit-logs', label: 'Audit Logs',      icon: 'history' },
    ],
  },
  {
    title: 'Users & Access',
    items: [
      { id: 'users',          label: 'Users',               icon: 'group',       countKey: 'users' },
      { id: 'roles',          label: 'Roles & Permissions', icon: 'badge',       countKey: 'roles' },
      { id: 'section-access', label: 'Section Access',      icon: 'visibility' },
    ],
  },
  {
    title: 'Catalogs & Lookups',
    items: [
      { id: 'operation-types',     label: 'Operation Types',  icon: 'rocket_launch', countKey: 'operation_types' },
      { id: 'shift-types',         label: 'Shift Types',      icon: 'schedule',      countKey: 'shift_types' },
      { id: 'asset-categories',    label: 'Asset Categories', icon: 'category',      countKey: 'asset_categories' },
      { id: 'item-categories',     label: 'Item Categories',  icon: 'inventory_2',   countKey: 'item_categories' },
      { id: 'wiki-categories',     label: 'Wiki Categories',  icon: 'menu_book',     countKey: 'wiki_categories' },
      { id: 'warehouse-locations', label: 'Locations',        icon: 'warehouse',     countKey: 'warehouse_locations' },
    ],
  },
  {
    title: 'Customization',
    items: [
      { id: 'customization', label: 'Schema & UI', icon: 'tune' },
    ],
  },
];

export const ALL_ADMIN_TABS: readonly AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap(g => g.items);

export const ICON_PRESETS: readonly string[] = [
  'rocket_launch', 'build', 'warning', 'school', 'fact_check', 'settings',
  'engineering', 'flight_takeoff', 'radar', 'bolt', 'sensors', 'security',
  'folder', 'menu_book', 'description', 'code', 'storage', 'lan',
  'inventory_2', 'local_shipping', 'verified', 'science', 'analytics', 'assignment',
];

export const COLOR_SWATCHES: readonly string[] = [
  '#1565C0', '#0288D1', '#00838F', '#10B981',
  '#2E7D32', '#F59E0B', '#E65100', '#EF4444',
  '#B71C1C', '#8B5CF6', '#5C6BC0', '#9D174D',
];

export interface PasswordStrengthResult {
  score: number; // 0..4
  label: string;
  color: string;
  checks: {
    minLength: boolean;
    hasUpper: boolean;
    hasLower: boolean;
    hasNumber: boolean;
  };
  valid: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const pwd = String(password || '');
  const checks = {
    minLength: pwd.length >= 8,
    hasUpper: /[A-Z]/.test(pwd),
    hasLower: /[a-z]/.test(pwd),
    hasNumber: /\d/.test(pwd),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const valid = checks.minLength && checks.hasUpper && checks.hasLower && checks.hasNumber;

  if (!pwd) {
    return { score: 0, label: 'Enter a password', color: 'var(--text-subtle)', checks, valid: false };
  }
  if (score <= 1) {
    return { score, label: 'Weak', color: '#EF4444', checks, valid };
  }
  if (score === 2) {
    return { score, label: 'Fair', color: '#F59E0B', checks, valid };
  }
  if (score === 3) {
    return { score, label: 'Almost ready', color: '#0288D1', checks, valid };
  }
  return { score, label: 'Strong', color: '#10B981', checks, valid };
}

export function generateStrongPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;

  const pick = (pool: string): string => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return pool[arr[0] % pool.length];
  };

  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < length) {
    chars.push(pick(all));
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

export function formatShiftDuration(startTime?: string | null, endTime?: string | null): string {
  if (!startTime || !endTime) return '—';
  const parseMins = (val: string): number | null => {
    const m = String(val).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const s = parseMins(startTime);
  const e = parseMins(endTime);
  if (s === null || e === null) return '—';
  if (s === 0 && e === 0) return 'Flexible';

  let diff = e - s;
  if (diff <= 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatUptimeDetailed(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} min`;
}

export function getRoleColor(role?: string | null): string {
  const key = String(role || '').trim().toLowerCase();
  const map: Record<string, string> = {
    admin:   '#9D174D',
    manager: '#1565C0',
    tech:    '#047857',
    viewer:  '#475569',
  };
  return map[key] || '#475569';
}

export function getMethodBadgeStyle(method?: string | null): { bg: string; color: string } {
  const m = String(method || '').toUpperCase();
  switch (m) {
    case 'POST':   return { bg: '#DCFCE7', color: '#15803D' };
    case 'PUT':
    case 'PATCH':  return { bg: '#FEF3C7', color: '#B45309' };
    case 'DELETE': return { bg: '#FEE2E2', color: '#B91C1C' };
    default:       return { bg: 'var(--blue-100)', color: 'var(--primary)' };
  }
}

export function getHttpStatusBadgeStyle(status?: number | null): { bg: string; color: string } {
  const code = Number(status) || 0;
  if (code >= 500) return { bg: '#FEE2E2', color: '#991B1B' };
  if (code >= 400) return { bg: '#FFF7ED', color: '#C2410C' };
  if (code >= 200 && code < 400) return { bg: '#DCFCE7', color: '#15803D' };
  return { bg: 'var(--surface-raised)', color: 'var(--text-muted)' };
}
