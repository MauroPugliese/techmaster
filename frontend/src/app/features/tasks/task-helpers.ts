// =============================================================================
// task-helpers.ts — Pure domain helpers, filtering, sorting & layout weights
// =============================================================================
import { IntervalType, Priority, Task, TaskAssignee, TaskStatus } from '../../core/models/interfaces';

export interface TaskColumn {
  status: TaskStatus;
  label: string;
  color: string;
  icon: string;
}

export type TaskViewMode   = 'kanban' | 'list' | 'swimlanes';
export type SwimlaneBy     = 'assignee' | 'priority';
export type SortKey        = 'due' | 'priority' | 'created' | 'title';
export type Density        = 'comfortable' | 'compact';
export type StatFilterKey  = 'all' | 'in_progress' | 'overdue' | 'done';

export interface TaskFilterState {
  priority: Priority | '';
  assigneeId: number | 'unassigned' | '';
  simulatorId?: number | '';
  statFilter: StatFilterKey;
  searchTerm: string;
  sortKey: SortKey;
  sortAsc: boolean;
}

export interface HoursProgress {
  estimated: number;
  actual: number;
  percent: number;
  isOverrun: boolean;
  isWarning: boolean;
}

export interface SwimlaneGroup {
  key: string;
  label: string;
  sublabel?: string;
  color: string;
  initials?: string;
  tasks: Task[];
}

export interface CommentSegment {
  text: string;
  isMention: boolean;
}

export const KANBAN_COLUMNS: TaskColumn[] = [
  { status: 'TODO',        label: 'To Do',       color: '#64748B', icon: 'radio_button_unchecked' },
  { status: 'IN_PROGRESS', label: 'In Progress', color: '#0288D1', icon: 'play_circle' },
  { status: 'REVIEW',      label: 'In Review',   color: '#F59E0B', icon: 'rate_review' },
  { status: 'DONE',        label: 'Done',        color: '#10B981', icon: 'check_circle' },
];

export const DEFAULT_COL_WEIGHTS: number[] = [1, 1, 1, 1];

export const TASK_INTERVAL_TABS: Array<{ value: IntervalType | ''; label: string; icon: string }> = [
  { value: '',        label: 'All',     icon: 'apps' },
  { value: 'DAILY',   label: 'Daily',   icon: 'today' },
  { value: 'WEEKLY',  label: 'Weekly',  icon: 'view_week' },
  { value: 'MONTHLY', label: 'Monthly', icon: 'calendar_month' },
  { value: 'YEARLY',  label: 'Yearly',  icon: 'event' },
  { value: 'ONCE',    label: 'Once',    icon: 'looks_one' },
];

const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH:     1,
  MEDIUM:   2,
  LOW:      3,
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW:      '#10B981',
  MEDIUM:   '#F59E0B',
  HIGH:     '#EF4444',
  CRITICAL: '#9D174D',
};

const PRIORITY_BADGES: Record<string, string> = {
  LOW:      'badge-low',
  MEDIUM:   'badge-medium',
  HIGH:     'badge-high',
  CRITICAL: 'badge-critical',
};

const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  TODO:        { label: 'To Do',       color: '#64748B' },
  IN_PROGRESS: { label: 'In Progress', color: '#0288D1' },
  REVIEW:      { label: 'In Review',   color: '#F59E0B' },
  DONE:        { label: 'Done',        color: '#10B981' },
  OVERDUE:     { label: 'Overdue',     color: '#EF4444' },
  CANCELLED:   { label: 'Cancelled',   color: '#6B7280' },
};

/**
 * Map a task's workflow status to one of the 4 Kanban display columns.
 * OVERDUE tasks map into TODO so they remain visible on the board.
 */
export function resolveDisplayColumn(task: Task): TaskStatus | null {
  if (task.status === 'OVERDUE') return 'TODO';
  if (
    task.status === 'TODO' ||
    task.status === 'IN_PROGRESS' ||
    task.status === 'REVIEW' ||
    task.status === 'DONE'
  ) {
    return task.status;
  }
  return null;
}

export function isTaskOverdue(task: Task): boolean {
  if (task.status === 'DONE' || task.status === 'CANCELLED') return false;
  if (task.status === 'OVERDUE') return true;
  if (!task.due_date) return false;
  return new Date(task.due_date).getTime() < Date.now();
}

export function daysUntilDue(task: Task): number | null {
  if (!task.due_date) return null;
  const ms = new Date(task.due_date).getTime() - Date.now();
  return Math.round(ms / 86_400_000);
}

export function formatDueLabel(task: Task): string {
  if (!task.due_date) return 'No due date';
  const d = daysUntilDue(task);
  if (d === null) return 'No due date';
  if (d < 0)  return `Overdue ${-d}d`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d <= 7)  return `In ${d} days`;
  return new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getDoneSubtasks(task: Task): number {
  return task.subtasks?.filter(s => s.status === 'DONE').length ?? 0;
}

export function getHoursProgress(task: Partial<Task> | null | undefined): HoursProgress {
  const estimated = Math.max(0, Number(task?.estimated_hours) || 0);
  const actual    = Math.max(0, Number(task?.actual_hours) || 0);
  if (estimated <= 0) {
    return {
      estimated,
      actual,
      percent: actual > 0 ? 100 : 0,
      isOverrun: false,
      isWarning: false,
    };
  }
  const rawPct = Math.round((actual / estimated) * 100);
  return {
    estimated,
    actual,
    percent: Math.min(100, rawPct),
    isOverrun: actual > estimated,
    isWarning: rawPct >= 85 && actual <= estimated,
  };
}

export function sumEstimatedHours(tasks: Task[]): number {
  const sum = tasks.reduce((acc, t) => acc + (Number(t.estimated_hours) || 0), 0);
  return Math.round(sum * 10) / 10;
}

export function getPriorityColor(p: Priority): string {
  return PRIORITY_COLORS[p] || '#F59E0B';
}

export function getPriorityBadge(p: Priority): string {
  return PRIORITY_BADGES[p] || 'badge-medium';
}

export function getStatusLabel(s: TaskStatus): string {
  return STATUS_META[s]?.label || s;
}

export function getStatusColor(s: TaskStatus): string {
  return STATUS_META[s]?.color || '#64748B';
}

export function getInitials(user: Partial<TaskAssignee> | null | undefined): string {
  if (!user) return '?';
  const a = user.first_name?.[0] || '';
  const b = user.last_name?.[0] || '';
  return (a + b).toUpperCase() || user.username?.[0]?.toUpperCase() || '?';
}

export function getUserDisplayName(user: Partial<TaskAssignee> | null | undefined): string {
  if (!user) return 'Unassigned';
  const full = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return full || user.username || 'User';
}

export function getAvatarColor(user: Partial<TaskAssignee> | null | undefined): string {
  const s = `${user?.first_name || ''} ${user?.last_name || ''} ${user?.username || ''}`.trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 55% 44%)`;
}

export function matchesStatFilter(task: Task, stat: StatFilterKey): boolean {
  switch (stat) {
    case 'in_progress': return task.status === 'IN_PROGRESS';
    case 'overdue':     return isTaskOverdue(task);
    case 'done':        return task.status === 'DONE';
    default:            return true;
  }
}

export function filterAndSortTasks(
  tasks: Task[],
  filters: TaskFilterState,
  includeStatFilter = true
): Task[] {
  const q = filters.searchTerm.trim().toLowerCase();
  const list = tasks.filter(t => {
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.assigneeId === 'unassigned') {
      if (t.assigned_to || t.assignee?.id) return false;
    } else if (typeof filters.assigneeId === 'number') {
      const uid = t.assigned_to ?? t.assignee?.id ?? null;
      if (uid !== filters.assigneeId) return false;
    }
    if (typeof filters.simulatorId === 'number') {
      const sid = t.simulator_id ?? t.simulator?.id ?? null;
      if (sid !== filters.simulatorId) return false;
    }
    if (includeStatFilter && !matchesStatFilter(t, filters.statFilter)) return false;
    if (q) {
      const assigneeText = getUserDisplayName(t.assignee).toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc  = (t.description || '').toLowerCase().includes(q);
      const matchTags  = (t.tags || []).some(tag => tag.toLowerCase().includes(q));
      const matchUser  = t.assignee ? assigneeText.includes(q) : false;
      if (!matchTitle && !matchDesc && !matchTags && !matchUser) return false;
    }
    return true;
  });

  const dir = filters.sortAsc ? 1 : -1;
  return [...list].sort((a, b) => {
    let d = 0;
    switch (filters.sortKey) {
      case 'due': {
        const av = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bv = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        d = av - bv;
        break;
      }
      case 'priority':
        d = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
        break;
      case 'created':
        d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case 'title':
        d = a.title.localeCompare(b.title);
        break;
    }
    return d * dir;
  });
}

export function buildSwimlanes(tasks: Task[], by: SwimlaneBy): SwimlaneGroup[] {
  if (by === 'priority') {
    const priorities: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    return priorities.map(p => ({
      key: `priority-${p}`,
      label: p,
      sublabel: 'Priority lane',
      color: getPriorityColor(p),
      tasks: tasks.filter(t => t.priority === p),
    }));
  }

  const byUser = new Map<string, SwimlaneGroup>();
  for (const t of tasks) {
    const uid = t.assigned_to ?? t.assignee?.id ?? null;
    const key = uid ? `user-${uid}` : 'unassigned';
    if (!byUser.has(key)) {
      byUser.set(key, {
        key,
        label: uid ? getUserDisplayName(t.assignee) : 'Unassigned',
        sublabel: t.assignee?.department || (uid ? `@${t.assignee?.username || 'member'}` : 'No owner yet'),
        color: uid ? getAvatarColor(t.assignee) : '#64748B',
        initials: uid ? getInitials(t.assignee) : '—',
        tasks: [],
      });
    }
    byUser.get(key)!.tasks.push(t);
  }

  return Array.from(byUser.values()).sort((a, b) => {
    if (a.key === 'unassigned') return 1;
    if (b.key === 'unassigned') return -1;
    return b.tasks.length - a.tasks.length;
  });
}

/**
 * Rebalance proportional flex weights between adjacent columns `index` and
 * `index + 1` while preserving total sum so columns always fill 100% width.
 */
export function rebalanceWeights(
  weights: number[],
  index: number,
  deltaWeight: number,
  minWeight = 0.55
): number[] {
  if (index < 0 || index >= weights.length - 1) return [...weights];
  const left  = weights[index] ?? 1;
  const right = weights[index + 1] ?? 1;
  const maxIncrease = Math.max(0, right - minWeight);
  const maxDecrease = Math.min(0, -(left - minWeight));
  const clamped = Math.max(maxDecrease, Math.min(maxIncrease, deltaWeight));
  const next = [...weights];
  next[index]     = Number((left + clamped).toFixed(4));
  next[index + 1] = Number((right - clamped).toFixed(4));
  return next;
}

export function parseCommentSegments(content = ''): CommentSegment[] {
  const regex = /(@[a-zA-Z0-9_.-]+)/g;
  const segments: CommentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const prevChar = start > 0 ? content[start - 1] : '';
    const isEmailPart = /[a-zA-Z0-9_.]/.test(prevChar);

    if (isEmailPart) {
      continue;
    }
    if (start > lastIndex) {
      segments.push({ text: content.slice(lastIndex, start), isMention: false });
    }
    segments.push({ text: match[1], isMention: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), isMention: false });
  }

  return segments.length ? segments : [{ text: content, isMention: false }];
}

export function formatRelativeTime(isoDate: string): string {
  const ms = new Date(isoDate).getTime();
  if (Number.isNaN(ms)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60)     return 'just now';
  if (diffSec < 3600)   return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400)  return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
