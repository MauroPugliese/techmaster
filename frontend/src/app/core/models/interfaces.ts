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

// ── Auth ──────────────────────────────────────────────────────────────────────
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

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardKPIs {
  totalOps: number;
  activeOps: number;
  pendingMaint: number;
  lowStockCount: number;
  openTasks: number;
  activeUsers: number;
  totalAssets?: number;
  activeAssets?: number;
  maintenanceAssets?: number;
  overdueTasks?: number;
  criticalMaint?: number;
}

export interface DashboardUrgentAlerts {
  overdueTasks: Task[];
  criticalMaintenance: MaintenanceRecord[];
  outOfStock: InventoryItem[];
}

export interface TrendPoint { date: string; count: number; status: string; }

// ── Operations ────────────────────────────────────────────────────────────────
export type OperationStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface OperationType {
  id: number; name: string; color: string; icon: string; description: string;
}

export interface OperationMember {
  operation_id: number;
  user_id: number;
  role_in_op?: string | null;
  joined_at?: string;
  user?: Partial<User>;
}

export interface OperationLog {
  id: number;
  operation_id: number;
  user_id: number;
  action: string;
  details?: string | null;
  logged_at: string;
  user?: Partial<User>;
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
  actual_end_date?: string | null;
  notes?: string;
  metadata?: any;
  type?: OperationType;
  creator?: Partial<User>;
  members?: OperationMember[];
  logs?: OperationLog[];
  created_at: string;
}

export interface OperationSummary {
  total: number;
  planned_count: number;
  in_progress_count: number;
  on_hold_count: number;
  completed_count: number;
  cancelled_count: number;
  overdue_count: number;
  completion_rate: number;
  avg_duration_minutes: number;
}

// ── Maintenance ───────────────────────────────────────────────────────────────
export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE' | 'UPGRADE' | 'INSPECTION';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'DEFERRED';
export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNDER_MAINTENANCE' | 'RETIRED' | 'LOST';

export interface AssetCategory {
  id: number;
  name: string;
  type: 'HARDWARE' | 'SOFTWARE' | 'NETWORK' | 'OTHER';
  description?: string;
}

export interface Asset {
  id: number;
  category_id?: number;
  name: string;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  purchase_date?: string;
  status: AssetStatus;
  category?: AssetCategory;
  assigned_to?: number;
  assignedUser?: Partial<User>;
  location?: string;
  warranty_expiry?: string;
  notes?: string;
  open_maintenance_count?: number;
}

export interface MaintenancePartUsage {
  item_id?: number | null;
  sku?: string | null;
  name: string;
  quantity: number;
  unit?: string;
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
  downtime_hours?: number | null;
  cost?: number | null;
  findings?: string | null;
  parts_used?: MaintenancePartUsage[];
  next_scheduled?: string | null;
  asset?: Asset;
  technician?: Partial<User>;
  created_at?: string;
}

export interface MaintenanceSummary {
  total: number;
  scheduled_count: number;
  in_progress_count: number;
  completed_count: number;
  failed_count: number;
  deferred_count: number;
  overdue_count: number;
  total_cost: number;
  total_downtime_hours: number;
}

// ── Planned Maintenance ───────────────────────────────────────────────────────
export type RepeatTaskType = 'DAY' | 'WEEK' | 'MONTH';
export type PlannedTaskStatus = 'TODO' | 'DONE';

export interface PlannedMaintenanceTask {
  id: number;
  system: string;
  subsystem: string;
  task: string;
  reference?: string;
  operationDateStart: string;
  operationDateEnd: string;
  repeatTaskType: RepeatTaskType;
  repeatTaskNumber: number;
  recurrenceEndDate?: string | null;
  reportTemplate?: string;
  status: PlannedTaskStatus;
  optional?: boolean;
  masterId?: number;
  instanceId?: number | null;
  occurrenceDate?: string | null;
  isOccurrence?: boolean;
  exceptionType?: 'OVERRIDE' | 'DELETED' | null;
}

export interface PlannedMaintenanceSummary {
  total_series: number;
  active_series: number;
  optional_series: number;
  due_today_count: number;
  due_today_todo: number;
  month_total_occurrences: number;
  month_done_occurrences: number;
  month_completion_pct: number;
}

export interface CalendarIndicator {
  count: number;
  color: string;
}

export interface CalendarIndicators {
  [day: number]: CalendarIndicator[];
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export type WarehouseStockStatus = 'out' | 'low' | 'healthy' | 'overstock';

export interface WarehouseLocation {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  is_active?: boolean;
}

export interface InventoryItem {
  id: number;
  category_id: number;
  location_id?: number | null;
  sku: string;
  part_number?: string;
  name: string;
  description?: string;
  unit: string;
  quantity: number;
  min_stock: number;
  max_stock?: number | null;
  reorder_point: number;
  unit_cost?: number | null;
  supplier?: string;
  is_active: boolean;
  is_low_stock?: boolean;
  updated_at?: string;
  category?: { id: number; name: string; color?: string };
  location?: WarehouseLocation | null;
}

export interface WarehouseBreakdownEntry {
  id: number | null;
  code?: string | null;
  name: string;
  color?: string;
  items_count: number;
  units: number;
  total_value: number;
}

export interface WarehouseSummary {
  total_skus: number;
  total_units: number;
  healthy_count: number;
  low_count: number;
  out_of_stock_count: number;
  overstock_count: number;
  total_value: number;
  estimated_restock_cost: number;
  movements_7d: number;
  category_breakdown: WarehouseBreakdownEntry[];
  location_breakdown: WarehouseBreakdownEntry[];
}

export interface WarehouseReorderMetrics {
  threshold: number;
  target_qty: number;
  deficit: number;
  estimated_cost: number | null;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface WarehouseReorderItem extends InventoryItem {
  reorder_metrics: WarehouseReorderMetrics;
}

export type MovementType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN';

export interface WarehouseMovementTypeCounts {
  ALL: number;
  IN: number;
  OUT: number;
  TRANSFER: number;
  ADJUSTMENT: number;
  RETURN: number;
}

export interface StockMovement {
  id: number;
  item_id: number;
  type: MovementType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference?: string;
  reason?: string;
  destination?: string | null;
  movement_date: string;
  user?: Partial<User>;
  item?: Partial<InventoryItem>;
}

// ── Shifts ────────────────────────────────────────────────────────────────────
export type ShiftStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ABSENT'
  | 'SWAPPED'
  | 'ON_LEAVE';

export type ShiftTypeCategory = 'WORK' | 'LEAVE';
export type ShiftEntryKind = 'WORK' | 'CUSTOM' | 'LEAVE';
export type ShiftLeaveType = 'SICK' | 'VACATION' | 'HOLIDAY' | 'PERSONAL' | 'OTHER';

export interface ShiftType {
  id: number;
  name: string;
  code: string;
  start_time: string;
  end_time: string;
  color: string;
  category?: ShiftTypeCategory;
  description?: string | null;
}

export interface ShiftEmployee {
  id: number;
  first_name: string;
  last_name: string;
  department?: string | null;
  job_title?: string | null;
  avatar_url?: string | null;
}

export interface Shift {
  id: number;
  shift_type_id: number;
  user_id: number;
  supervisor_id?: number | null;
  date: string;
  entry_kind?: ShiftEntryKind;
  leave_type?: ShiftLeaveType | null;
  custom_start_time?: string | null;
  custom_end_time?: string | null;
  status: ShiftStatus;
  check_in?: string;
  check_out?: string;
  notes?: string | null;
  overtime_hours: number;
  adjustment_reason?: string | null;
  shiftType?: ShiftType;
  employee?: Partial<User>;
  supervisor?: Partial<User>;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export type TaskStatus   = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED' | 'OVERDUE';
export type IntervalType = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface TaskAssignee {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  department?: string;
  job_title?: string;
  avatar_url?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  created_at: string;
  author?: TaskAssignee;
}

export interface Task {
  id: number;
  parent_id?: number | null;
  assigned_to?: number | null;
  created_by?: number;
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
  assignee?: Partial<TaskAssignee> | null;
  creator?: Partial<TaskAssignee>;
  comments_count?: number;
  created_at: string;
}

// ── Wiki ──────────────────────────────────────────────────────────────────────
export type ArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REVIEW';

export interface WikiCategory {
  id: number;
  parent_id?: number | null;
  name: string;
  slug: string;
  icon?: string;
  sort_order?: number;
  article_count?: number;
  total_count?: number;
  parent?: { id: number; name: string; icon?: string } | null;
  children?: WikiCategory[];
}

export interface WikiArticle {
  id: number;
  category_id?: number | null;
  author_id?: number;
  last_editor_id?: number | null;
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
  lastEditor?: Partial<User> | null;
  category?: WikiCategory | null;
  created_at: string;
  updated_at: string;
}

// ── Date Filter ───────────────────────────────────────────────────────────────
export interface DateRange { from: Date | null; to: Date | null; }

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}
