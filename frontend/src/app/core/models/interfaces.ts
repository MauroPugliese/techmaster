// =============================================================================
// core/models/interfaces.ts — All TypeScript interfaces
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
  department?: string;
  job_title?: string;
  phone?: string;
  is_active: boolean;
  last_login?: string;
  role: Role;
  created_at: string;
}

export interface Role {
  id: number;
  name: 'admin' | 'manager' | 'tech' | 'viewer';
  description: string;
  permissions: string[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface LoginPayload { email: string; password: string; }
export interface RegisterPayload {
  username: string; email: string; password: string;
  first_name: string; last_name: string; department?: string; job_title?: string;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export interface DashboardKPIs {
  totalOps: number;
  activeOps: number;
  pendingMaint: number;
  lowStockCount: number;
  openTasks: number;
  activeUsers: number;
}

export interface TrendPoint { date: string; count: number; status: string; }

// ── Operations ───────────────────────────────────────────────────────────────
export type OperationStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface OperationType {
  id: number; name: string; color: string; icon: string; description: string;
}

export interface Operation {
  id: number;
  type_id: number;
  created_by: number;
  title: string;
  description?: string;
  status: OperationStatus;
  priority: Priority;
  location?: string;
  start_date: string;
  end_date?: string;
  notes?: string;
  type?: OperationType;
  creator?: Partial<User>;
  created_at: string;
}

// ── Maintenance ──────────────────────────────────────────────────────────────
export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE' | 'UPGRADE' | 'INSPECTION';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'DEFERRED';

export interface Asset {
  id: number;
  name: string;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UNDER_MAINTENANCE' | 'RETIRED' | 'LOST';
  category?: { id: number; name: string; type: string; };
  assigned_to?: number;
  location?: string;
  warranty_expiry?: string;
}

export interface MaintenanceRecord {
  id: number;
  asset_id: number;
  performed_by?: number;
  type: MaintenanceType;
  title: string;
  description: string;
  status: MaintenanceStatus;
  priority: Priority;
  scheduled_date: string;
  completed_date?: string;
  downtime_hours?: number;
  cost?: number;
  findings?: string;
  parts_used?: any[];
  next_scheduled?: string;
  asset?: Asset;
  technician?: Partial<User>;
}

// ── Planned Maintenance ──────────────────────────────────────────────────────
export type RepeatTaskType = 'DAY' | 'WEEK' | 'MONTH';
export type PlannedTaskStatus = 'TODO' | 'DONE';

export interface PlannedMaintenanceTask {
  id: number;
  system: string;
  subsystem: string;
  task: string;
  reference?: string;
  operation_date_start: string;
  operation_date_end: string;
  repeat_task_type: RepeatTaskType;
  repeat_task_number: number;
  report_template?: string;
  status: PlannedTaskStatus;
  optional: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CalendarIndicator {
  count: number;
  color: string;
}

export interface CalendarIndicators {
  [day: number]: CalendarIndicator[];
}

// ── Inventory ────────────────────────────────────────────────────────────────
export interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  description?: string;
  unit: string;
  quantity: number;
  min_stock: number;
  max_stock?: number;
  reorder_point: number;
  unit_cost?: number;
  supplier?: string;
  is_active: boolean;
  is_low_stock?: boolean;
}

export type MovementType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN';

export interface StockMovement {
  id: number;
  item_id: number;
  type: MovementType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference?: string;
  reason?: string;
  movement_date: string;
  user?: Partial<User>;
}

// ── Shifts ───────────────────────────────────────────────────────────────────
export type ShiftStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABSENT' | 'SWAPPED';

export interface ShiftType {
  id: number; name: string; code: string; start_time: string; end_time: string; color: string;
}

export interface Shift {
  id: number;
  shift_type_id: number;
  user_id: number;
  date: string;
  status: ShiftStatus;
  check_in?: string;
  check_out?: string;
  overtime_hours: number;
  shiftType?: ShiftType;
  employee?: Partial<User>;
}

// ── Tasks ────────────────────────────────────────────────────────────────────
export type TaskStatus   = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED' | 'OVERDUE';
export type IntervalType = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Task {
  id: number;
  parent_id?: number;
  title: string;
  description?: string;
  interval_type: IntervalType;
  status: TaskStatus;
  priority: Priority;
  due_date?: string;
  completed_at?: string;
  estimated_hours?: number;
  actual_hours?: number;
  tags?: string[];
  subtasks?: Task[];
  assignee?: Partial<User>;
  created_at: string;
}

// ── Wiki ─────────────────────────────────────────────────────────────────────
export type ArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REVIEW';

export interface WikiCategory {
  id: number; parent_id?: number; name: string; slug: string; icon?: string;
  children?: WikiCategory[];
}

export interface WikiArticle {
  id: number;
  category_id?: number;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  status: ArticleStatus;
  is_pinned: boolean;
  view_count: number;
  tags?: string[];
  version: number;
  published_at?: string;
  author?: Partial<User>;
  category?: WikiCategory;
  created_at: string;
  updated_at: string;
}

// ── Date Filter ──────────────────────────────────────────────────────────────
export interface DateRange { from: Date | null; to: Date | null; }
