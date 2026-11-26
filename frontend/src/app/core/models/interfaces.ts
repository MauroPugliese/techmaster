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
  certifications?: string[] | null;
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
  overdueOps?: number;
  pendingMaint: number;
  lowStockCount: number;
  outOfStockCount?: number;
  totalSkus?: number;
  inventoryValue?: number;
  openTasks: number;
  completedTasks?: number;
  activeUsers: number;
  totalAssets?: number;
  activeAssets?: number;
  maintenanceAssets?: number;
  overdueTasks?: number;
  criticalMaint?: number;
  overdueMaint?: number;
  shiftsToday?: number;
  shiftsLiveNow?: number;
  plannedDueToday?: number;
}

export interface DashboardUrgentAlerts {
  overdueOperations?: Operation[];
  overdueTasks: Task[];
  criticalMaintenance: MaintenanceRecord[];
  outOfStock: InventoryItem[];
}

export interface DashboardAlertCounts {
  overdueOperations: number;
  criticalMaintenance: number;
  overdueTasks: number;
  outOfStock: number;
  total: number;
}

export interface DashboardFleetHealth {
  totalAssets: number;
  activeAssets: number;
  maintenanceAssets: number;
  inactiveAssets: number;
  readinessPct: number;
  status: 'OPTIMAL' | 'ATTENTION' | 'CRITICAL';
  assetsInMaintenance?: Asset[];
}

export interface DashboardWarehouseCriticalItem {
  id: number;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  reorder_point: number;
  min_stock: number;
  unit_cost: number;
  supplier?: string | null;
  location?: { id: number; code: string; name: string } | null;
  category?: { id: number; name: string; color?: string } | null;
  deficit: number;
  stockRatioPct: number;
}

export interface DashboardWarehouseHealth {
  totalSkus: number;
  healthySkus: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValue: number;
  movements7d: number;
  criticalItems: DashboardWarehouseCriticalItem[];
}

export interface DashboardTrendSeries {
  dates: string[];
  operations: number[];
  maintenance: number[];
  tasks: number[];
  totals: {
    operations: number;
    maintenance: number;
    tasks: number;
  };
  startDate: string;
  endDate: string;
  daysCount: number;
}

export interface DashboardCountBucket {
  label: string;
  count: number;
}

export interface DashboardBreakdowns {
  taskByInterval: DashboardCountBucket[];
  opsByStatus: DashboardCountBucket[];
  maintByStatus: DashboardCountBucket[];
  taskByStatus: DashboardCountBucket[];
}

export interface DashboardPlannedDueItem extends PlannedMaintenanceTask {
  isToday?: boolean;
}

export interface DashboardTodaySchedule {
  operations: Operation[];
  upcomingWorkOrders: MaintenanceRecord[];
  plannedDue: {
    todayTotal: number;
    todayDone: number;
    pendingNext7d: number;
    items: DashboardPlannedDueItem[];
  };
}

export interface DashboardShiftItem extends Shift {
  is_live?: boolean;
}

export interface DashboardShiftSummary {
  totalToday: number;
  liveNow: number;
  workShifts: number;
  leaveCount: number;
  byType: Array<{ name: string; color: string; count: number }>;
}

export interface DashboardRecentActivity {
  operations: Operation[];
  maintenance: MaintenanceRecord[];
  tasks: Task[];
  movements: StockMovement[];
}

export interface StationLiveSummary {
  total: number;
  inUse: number;
  ready: number;
  na: number;
  todayShiftHours: number;
}

export interface SimulatorDashboardSummary {
  totalSimulators: number;
  ffsTotal?: number;
  readyBays: number;
  inSortieBays: number;
  degradedBays: number;
  aogBays: number;
  todayFlightHours: number;
  todayStationHours?: number;
  dispatchReliabilityPct: number;
  openSnagsCount: number;
  qtgCompliancePct: number;
  melActiveCount?: number;
  melExpiringCount?: number;
  aogSparesLowCount?: number;
  testPlaces?: StationLiveSummary;
  iosConsoles?: StationLiveSummary;
}

export interface DashboardOverview {
  generatedAt: string;
  trendDays: 7 | 30 | 90;
  simulators?: Simulator[];
  simulatorSummary?: SimulatorDashboardSummary;
  kpis: DashboardKPIs;
  fleet: DashboardFleetHealth;
  warehouse: DashboardWarehouseHealth;
  trends: DashboardTrendSeries;
  breakdowns: DashboardBreakdowns;
  urgentAlerts: DashboardUrgentAlerts;
  alertCounts: DashboardAlertCounts;
  todaySchedule: DashboardTodaySchedule;
  todayShifts: DashboardShiftItem[];
  shiftSummary: DashboardShiftSummary;
  recentActivity: DashboardRecentActivity;
}

export interface TrendPoint { date: string; count: number; status: string; }

// ── Flight Simulators Fleet, Subsystems & QTG ────────────────────────────────
export type SimulatorPlatformCategory = 'COMMERCIAL_FIXED_WING' | 'ROTORCRAFT' | 'DEFENSE_FMS' | 'FTD_FNPT';
export type SimulatorStationKind = 'FFS_BAY' | 'TEST_PLACE' | 'IOS_CONSOLE';
export type ShiftUsageStatus = 'READY' | 'IN_USE' | 'NA';
export type SimulatorStatus = 'READY' | 'IN_SORTIE' | 'PRE_FLIGHT' | 'MAINTENANCE' | 'DEGRADED' | 'AOG';
export type SimulatorSubsystemCode = 'VISUAL' | 'MOTION' | 'CONTROL_LOADING' | 'AVIONICS_COCKPIT' | 'IOS' | 'HOST_COMPUTE' | 'SOUND' | 'HVAC_POWER';
export type SimulatorSubsystemStatus = 'NOMINAL' | 'DEGRADED' | 'FAULT' | 'MAINTENANCE';
export type QtgCategory = 'PERFORMANCE' | 'HANDLING' | 'MOTION_CUEING' | 'VISUAL_SYSTEM' | 'SOUND' | 'IOS_NAV';
export type QtgStatus = 'PENDING' | 'PASSED' | 'TOLERANCE_WARN' | 'FAILED';

export interface SimulatorSubsystem {
  id: number;
  simulator_id: number;
  subsystem_code: SimulatorSubsystemCode;
  name: string;
  part_number?: string | null;
  serial_number?: string | null;
  firmware_version?: string | null;
  status: SimulatorSubsystemStatus;
  operating_hours?: number;
  last_calibrated_at?: string | null;
  next_calibration_due?: string | null;
  notes?: string | null;
}

export interface SimulatorQtgRecord {
  id: number;
  simulator_id: number;
  test_code: string;
  title: string;
  category: QtgCategory;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  year: number;
  mode: 'AUTO' | 'MANUAL';
  status: QtgStatus;
  due_date?: string | null;
  executed_at?: string | null;
  executed_by?: number | null;
  measured_delta?: string | null;
  notes?: string | null;
  simulator?: Partial<Simulator>;
  executor?: Partial<User>;
}

export interface SimulatorTelemetry {
  totalSorties: number;
  todayFlightHours: number;
  dailyAvailableHours: number;
  bayUtilizationPct: number;
  scheduledHoursTotal: number;
  lostTrainingMinutes: number;
  dispatchReliabilityPct: number;
  activeSortie?: { id: number; sortie_code?: string; title: string; customer_operator?: string; start_date: string; end_date?: string } | null;
  nextSortie?: { id: number; sortie_code?: string; title: string; customer_operator?: string; start_date: string; end_date?: string } | null;
  openSnagsCount: number;
  aogSnagsCount: number;
  subsystemCount: number;
  degradedSubsystemsCount: number;
  qtgSummary: {
    total: number;
    passed: number;
    warn: number;
    failed: number;
    pending: number;
    completionPct: number;
  };
  certificate: {
    status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNSET';
    daysRemaining: number | null;
  };
}

export interface Simulator {
  id: number;
  code: string;
  name: string;
  bay_code: string;
  station_kind?: SimulatorStationKind;
  sort_order?: number;
  platform_category: SimulatorPlatformCategory;
  aircraft_type: string;
  manufacturer?: string;
  serial_number?: string | null;
  authority?: string | null;
  qualification_level?: string | null;
  certificate_code?: string | null;
  certificate_expiry?: string | null;
  last_eval_date?: string | null;
  daily_available_hours?: number;
  engine_avionics?: string | null;
  software_load?: string | null;
  airac_cycle?: string | null;
  visual_system?: string | null;
  motion_system?: string | null;
  control_loading?: string | null;
  ios_config?: string | null;
  status: SimulatorStatus;
  power_on_hours?: number;
  motion_hours?: number;
  visual_lamp_hours?: number;
  limitations_mel?: string | null;
  notes?: string | null;
  telemetry?: SimulatorTelemetry;
  subsystems?: SimulatorSubsystem[];
  qtgRecords?: SimulatorQtgRecord[];
  sorties?: Operation[];
  maintenanceRecords?: MaintenanceRecord[];
  compatibleSpares?: InventoryItem[];
}

export interface SimulatorDailyLog {
  id: number;
  log_date: string;
  station_kind: SimulatorStationKind;
  system_readiness_time: string;
  post_testing_time: string;
  logout_time: string;
  general_notes?: string | null;
}

export interface SimulatorShiftEntry {
  id: number;
  shift_id: number;
  simulator_id: number;
  usage_status: ShiftUsageStatus;
  sim_testing_start: string;
  sim_testing_end: string;
  notes?: string | null;
  duration_minutes?: number;
  station?: Partial<Simulator> | null;
}

export interface SimulatorDailyShift {
  id: number;
  daily_log_id: number;
  shift_number: number;
  shift_name: string;
  pre_flight_test_time: string;
  lead_user_id?: number | null;
  signed_off_at?: string | null;
  signed_off_by?: number | null;
  lead?: Partial<User> | null;
  signer?: Partial<User> | null;
  entries: SimulatorShiftEntry[];
}

export interface SimulatorDailySheetResponse {
  log: SimulatorDailyLog;
  shifts: SimulatorDailyShift[];
  stations: Simulator[];
  summary: {
    total_stations: number;
    in_use_count: number;
    ready_count: number;
    na_count: number;
    total_session_minutes: number;
  };
}

export interface TimelineShiftBlock {
  id: string;
  simulator_id: number;
  station_kind: SimulatorStationKind;
  block_kind: 'SHIFT_IN_USE' | 'SHIFT_READY' | 'SHIFT_NA';
  usage_status: ShiftUsageStatus;
  shift_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  notes?: string | null;
}

export interface TimelineMaintenanceBlock {
  id: string;
  simulator_id: number;
  source: 'PLANNED_MAINT' | 'MAINTENANCE_WO';
  record_id?: number | null;
  title: string;
  subsystem?: string | null;
  start_time: string;
  end_time: string;
  status: string;
  severity?: string;
}

export type MelCategory = 'NONE' | 'CAT_A' | 'CAT_B' | 'CAT_C' | 'CAT_D';
export type LruStatus = 'SERVICEABLE' | 'INSTALLED' | 'UNSERVICEABLE' | 'IN_REPAIR_RMA' | 'QUARANTINE';

export interface SimulatorMntRecord extends MaintenanceRecord {
  record_year?: number;
  is_corrective?: boolean;
  time_window?: string;
}

export interface SimulatorMntRecordsResponse {
  simulator: Partial<Simulator>;
  selectedYear: number | 'ALL';
  availableYears: number[];
  counts: {
    total: number;
    preventive: number;
    corrective: number;
    total_downtime_hours: number;
  };
  records: SimulatorMntRecord[];
}

// ── Operations / Flight Sorties ───────────────────────────────────────────────
export type OperationStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';
export type SortieOutcome = 'PENDING' | 'CLEAN' | 'COMPLETED_WITH_SNAGS' | 'INTERRUPTED_TECH' | 'NO_SHOW' | 'CANCELLED';
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
  sortie_code?: string | null;
  type_id: number;
  simulator_id?: number | null;
  created_by: number;
  title: string;
  customer_operator?: string | null;
  scenario_code?: string | null;
  weather_profile?: string | null;
  motion_required?: boolean;
  scheduled_hours?: number | null;
  actual_flight_hours?: number | null;
  lost_training_minutes?: number;
  outcome?: SortieOutcome;
  snag_summary?: string | null;
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
  simulator?: Partial<Simulator>;
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
  total_scheduled_hours?: number;
  total_actual_hours?: number;
  total_lost_minutes?: number;
  dispatch_reliability_pct?: number;
  snag_sorties_count?: number;
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
  part_number?: string | null;
  broken_serial_number?: string | null;
  new_serial_number?: string | null;
  name: string;
  quantity: number;
  unit?: string;
}

export interface MaintenanceRecord {
  id: number;
  asset_id?: number | null;
  simulator_id?: number | null;
  sortie_id?: number | null;
  subsystem_code?: string | null;
  severity?: 'MINOR' | 'DEGRADED' | 'AOG';
  lost_training_hours?: number | null;
  is_snag?: boolean;
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
  parts_cost?: number | null;
  labor_cost?: number | null;
  mel_category?: MelCategory;
  mel_expiry_date?: string | null;
  wiki_article_id?: number | null;
  wikiArticle?: { id: number; title: string; slug: string } | null;
  findings?: string | null;
  parts_used?: MaintenancePartUsage[];
  part_number?: string | null;
  broken_serial_number?: string | null;
  new_serial_number?: string | null;
  next_scheduled?: string | null;
  asset?: Asset;
  simulator?: Partial<Simulator>;
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
  open_snags_count?: number;
  aog_snags_count?: number;
  lost_training_hours?: number;
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
  part_classification?: 'CONSUMABLE' | 'ROTATABLE_LRU' | 'TOOL_CALIBRATED';
  subsystem_code?: string | null;
  aog_critical?: boolean;
  serial_number?: string | null;
  lru_status?: LruStatus;
  installed_simulator_id?: number | null;
  installedSimulator?: Partial<Simulator> | null;
  rma_reference?: string | null;
  on_order_qty?: number;
  expected_delivery_date?: string | null;
  lead_time_days?: number;
  compatible_models?: string[] | null;
  unserviceable_qty?: number;
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
  aog_critical_count?: number;
  rotatable_count?: number;
  unserviceable_units?: number;
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
  simulator_id?: number | null;
  maintenance_record_id?: number | null;
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
  simulator?: Partial<Simulator> | null;
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
  certifications?: string[] | null;
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

export interface ShiftHandover {
  id: number;
  shift_date: string;
  from_shift_code: string;
  to_shift_code: string;
  authored_by: number;
  acknowledged_by?: number | null;
  acknowledged_at?: string | null;
  simulators_status_summary?: string | null;
  open_drs_summary?: string | null;
  pending_actions?: string | null;
  safety_loto_notes?: string | null;
  created_at?: string;
  author?: Partial<User>;
  acknowledger?: Partial<User>;
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
  simulator_id?: number | null;
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
  simulator?: Partial<Simulator> | null;
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
