// =============================================================================
// models/index.js — Sequelize Models & Associations
// =============================================================================
const { sequelize, Sequelize } = require('../config/database');
const { DataTypes } = Sequelize;

// ── Role ─────────────────────────────────────────────────────────────────────
const Role = sequelize.define('Role', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(50), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  permissions: { type: DataTypes.JSON }
}, { tableName: 'roles', updatedAt: false });

// ── User ─────────────────────────────────────────────────────────────────────
const User = sequelize.define('User', {
  id:            { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  role_id:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  username:      { type: DataTypes.STRING(60), allowNull: false, unique: true },
  email:         { type: DataTypes.STRING(120), allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  first_name:    { type: DataTypes.STRING(80), allowNull: false },
  last_name:     { type: DataTypes.STRING(80), allowNull: false },
  avatar_url:    { type: DataTypes.STRING(500) },
  department:    { type: DataTypes.STRING(100) },
  job_title:     { type: DataTypes.STRING(100) },
  phone:         { type: DataTypes.STRING(30) },
  is_active:     { type: DataTypes.BOOLEAN, defaultValue: true },
  certifications:{ type: DataTypes.JSON },
  last_login:    { type: DataTypes.DATE }
}, { tableName: 'users' });

// ── Flight Simulators Fleet & Qualification ───────────────────────────────────
const Simulator = sequelize.define('Simulator', {
  id:                    { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  code:                  { type: DataTypes.STRING(40), allowNull: false, unique: true },
  name:                  { type: DataTypes.STRING(200), allowNull: false },
  bay_code:              { type: DataTypes.STRING(40), allowNull: false },
  station_kind:          { type: DataTypes.ENUM('FFS_BAY','TEST_PLACE','IOS_CONSOLE'), defaultValue: 'FFS_BAY' },
  sort_order:            { type: DataTypes.INTEGER, defaultValue: 0 },
  platform_category:     { type: DataTypes.ENUM('COMMERCIAL_FIXED_WING','ROTORCRAFT','DEFENSE_FMS','FTD_FNPT'), defaultValue: 'COMMERCIAL_FIXED_WING' },
  aircraft_type:         { type: DataTypes.STRING(120), allowNull: false },
  manufacturer:          { type: DataTypes.STRING(120), defaultValue: 'CAE' },
  serial_number:         { type: DataTypes.STRING(100) },
  authority:             { type: DataTypes.STRING(60), defaultValue: 'EASA' },
  qualification_level:   { type: DataTypes.STRING(60), defaultValue: 'CS-FSTD Level D' },
  certificate_code:      { type: DataTypes.STRING(100) },
  certificate_expiry:    { type: DataTypes.DATEONLY },
  last_eval_date:        { type: DataTypes.DATEONLY },
  daily_available_hours: { type: DataTypes.DECIMAL(4,1), defaultValue: 20.0 },
  engine_avionics:       { type: DataTypes.STRING(200) },
  software_load:         { type: DataTypes.STRING(120) },
  airac_cycle:           { type: DataTypes.STRING(60) },
  visual_system:         { type: DataTypes.STRING(160) },
  motion_system:         { type: DataTypes.STRING(120) },
  control_loading:       { type: DataTypes.STRING(120) },
  ios_config:            { type: DataTypes.STRING(120) },
  status:                { type: DataTypes.ENUM('READY','IN_SORTIE','PRE_FLIGHT','MAINTENANCE','DEGRADED','AOG'), defaultValue: 'READY' },
  power_on_hours:        { type: DataTypes.DECIMAL(10,1), defaultValue: 0 },
  motion_hours:          { type: DataTypes.DECIMAL(10,1), defaultValue: 0 },
  visual_lamp_hours:     { type: DataTypes.DECIMAL(10,1), defaultValue: 0 },
  limitations_mel:       { type: DataTypes.TEXT },
  notes:                 { type: DataTypes.TEXT },
  asset_id:              { type: DataTypes.INTEGER.UNSIGNED }
}, { tableName: 'simulators' });

const SimulatorSubsystem = sequelize.define('SimulatorSubsystem', {
  id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  simulator_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  subsystem_code:      { type: DataTypes.ENUM('VISUAL','MOTION','CONTROL_LOADING','AVIONICS_COCKPIT','IOS','HOST_COMPUTE','SOUND','HVAC_POWER'), allowNull: false },
  name:                { type: DataTypes.STRING(150), allowNull: false },
  part_number:         { type: DataTypes.STRING(100) },
  serial_number:       { type: DataTypes.STRING(100) },
  firmware_version:    { type: DataTypes.STRING(80) },
  status:              { type: DataTypes.ENUM('NOMINAL','DEGRADED','FAULT','MAINTENANCE'), defaultValue: 'NOMINAL' },
  operating_hours:     { type: DataTypes.DECIMAL(10,1), defaultValue: 0 },
  last_calibrated_at:  { type: DataTypes.DATEONLY },
  next_calibration_due:{ type: DataTypes.DATEONLY },
  notes:               { type: DataTypes.TEXT }
}, { tableName: 'simulator_subsystems' });

const SimulatorQtgRecord = sequelize.define('SimulatorQtgRecord', {
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  simulator_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  test_code:      { type: DataTypes.STRING(60), allowNull: false },
  title:          { type: DataTypes.STRING(220), allowNull: false },
  category:       { type: DataTypes.ENUM('PERFORMANCE','HANDLING','MOTION_CUEING','VISUAL_SYSTEM','SOUND','IOS_NAV'), defaultValue: 'PERFORMANCE' },
  quarter:        { type: DataTypes.ENUM('Q1','Q2','Q3','Q4'), defaultValue: 'Q1' },
  year:           { type: DataTypes.INTEGER, allowNull: false },
  mode:           { type: DataTypes.ENUM('AUTO','MANUAL'), defaultValue: 'AUTO' },
  status:         { type: DataTypes.ENUM('PENDING','PASSED','TOLERANCE_WARN','FAILED'), defaultValue: 'PENDING' },
  due_date:       { type: DataTypes.DATEONLY },
  executed_at:    { type: DataTypes.DATE },
  executed_by:    { type: DataTypes.INTEGER.UNSIGNED },
  measured_delta: { type: DataTypes.STRING(120) },
  notes:          { type: DataTypes.TEXT }
}, { tableName: 'simulator_qtg_records' });

// ── Multi-Station Daily Operating Hours, Shifts & Bulk Testing Sheet ─────────
const SimulatorDailyLog = sequelize.define('SimulatorDailyLog', {
  id:                    { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  log_date:              { type: DataTypes.DATEONLY, allowNull: false },
  station_kind:          { type: DataTypes.ENUM('FFS_BAY','TEST_PLACE','IOS_CONSOLE'), defaultValue: 'TEST_PLACE' },
  system_readiness_time: { type: DataTypes.STRING(8), defaultValue: '06:30' },
  post_testing_time:     { type: DataTypes.STRING(8), defaultValue: '17:00' },
  logout_time:           { type: DataTypes.STRING(8), defaultValue: '18:00' },
  general_notes:         { type: DataTypes.TEXT },
  updated_by:            { type: DataTypes.INTEGER.UNSIGNED }
}, { tableName: 'simulator_daily_logs' });

const SimulatorDailyShift = sequelize.define('SimulatorDailyShift', {
  id:                   { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  daily_log_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  shift_number:         { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  shift_name:           { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'SHIFT 1' },
  pre_flight_test_time: { type: DataTypes.STRING(8), defaultValue: '06:40' },
  lead_user_id:         { type: DataTypes.INTEGER.UNSIGNED },
  signed_off_at:        { type: DataTypes.DATE },
  signed_off_by:        { type: DataTypes.INTEGER.UNSIGNED }
}, { tableName: 'simulator_daily_shifts' });

const SimulatorShiftEntry = sequelize.define('SimulatorShiftEntry', {
  id:                { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  shift_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  simulator_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  usage_status:      { type: DataTypes.ENUM('READY','IN_USE','NA'), defaultValue: 'READY' },
  sim_testing_start: { type: DataTypes.STRING(8), defaultValue: '00:00' },
  sim_testing_end:   { type: DataTypes.STRING(8), defaultValue: '00:00' },
  notes:             { type: DataTypes.TEXT },
  updated_by:        { type: DataTypes.INTEGER.UNSIGNED }
}, { tableName: 'simulator_shift_entries' });

// ── Operation ────────────────────────────────────────────────────────────────
const OperationType = sequelize.define('OperationType', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  color:       { type: DataTypes.STRING(7), defaultValue: '#1565C0' },
  icon:        { type: DataTypes.STRING(50) },
  description: { type: DataTypes.TEXT }
}, { tableName: 'operation_types', timestamps: false });

const Operation = sequelize.define('Operation', {
  id:                    { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  sortie_code:           { type: DataTypes.STRING(50) },
  type_id:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  simulator_id:          { type: DataTypes.INTEGER.UNSIGNED },
  created_by:            { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  title:                 { type: DataTypes.STRING(200), allowNull: false },
  customer_operator:     { type: DataTypes.STRING(120) },
  scenario_code:         { type: DataTypes.STRING(120) },
  weather_profile:       { type: DataTypes.STRING(80) },
  motion_required:       { type: DataTypes.BOOLEAN, defaultValue: true },
  scheduled_hours:       { type: DataTypes.DECIMAL(5,2) },
  actual_flight_hours:   { type: DataTypes.DECIMAL(5,2) },
  lost_training_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
  outcome:               { type: DataTypes.ENUM('PENDING','CLEAN','COMPLETED_WITH_SNAGS','INTERRUPTED_TECH','NO_SHOW','CANCELLED'), defaultValue: 'PENDING' },
  snag_summary:          { type: DataTypes.TEXT },
  description:           { type: DataTypes.TEXT },
  status:                { type: DataTypes.ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','ON_HOLD'), defaultValue: 'PLANNED' },
  priority:              { type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'), defaultValue: 'MEDIUM' },
  location:              { type: DataTypes.STRING(200) },
  start_date:            { type: DataTypes.DATE, allowNull: false },
  end_date:              { type: DataTypes.DATE },
  actual_end_date:       { type: DataTypes.DATE },
  notes:                 { type: DataTypes.TEXT },
  metadata:              { type: DataTypes.JSON }
}, { tableName: 'operations' });

const OperationMember = sequelize.define('OperationMember', {
  operation_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true },
  user_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true },
  role_in_op:   { type: DataTypes.STRING(100) },
  joined_at:    { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'operation_members', timestamps: false });

const OperationLog = sequelize.define('OperationLog', {
  id:           { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  operation_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  action:       { type: DataTypes.STRING(200), allowNull: false },
  details:      { type: DataTypes.TEXT },
  logged_at:    { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'operation_logs', timestamps: false });

// ── Asset / Maintenance ──────────────────────────────────────────────────────
const AssetCategory = sequelize.define('AssetCategory', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  type:        { type: DataTypes.ENUM('HARDWARE','SOFTWARE','NETWORK','OTHER'), allowNull: false },
  description: { type: DataTypes.TEXT }
}, { tableName: 'asset_categories', timestamps: false });

const Asset = sequelize.define('Asset', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  category_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  assigned_to:     { type: DataTypes.INTEGER.UNSIGNED },
  name:            { type: DataTypes.STRING(200), allowNull: false },
  serial_number:   { type: DataTypes.STRING(100), unique: true },
  model:           { type: DataTypes.STRING(150) },
  manufacturer:    { type: DataTypes.STRING(150) },
  purchase_date:   { type: DataTypes.DATEONLY },
  warranty_expiry: { type: DataTypes.DATEONLY },
  location:        { type: DataTypes.STRING(200) },
  status:          { type: DataTypes.ENUM('ACTIVE','INACTIVE','UNDER_MAINTENANCE','RETIRED','LOST'), defaultValue: 'ACTIVE' },
  specs:           { type: DataTypes.JSON },
  notes:           { type: DataTypes.TEXT }
}, { tableName: 'assets' });

const MaintenanceRecord = sequelize.define('MaintenanceRecord', {
  id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  asset_id:            { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  simulator_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  sortie_id:           { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  subsystem_code:      { type: DataTypes.STRING(60) },
  severity:            { type: DataTypes.ENUM('MINOR','DEGRADED','AOG'), defaultValue: 'MINOR' },
  lost_training_hours: { type: DataTypes.DECIMAL(5,2), defaultValue: 0 },
  is_snag:             { type: DataTypes.BOOLEAN, defaultValue: false },
  performed_by:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  type:                { type: DataTypes.ENUM('PREVENTIVE','CORRECTIVE','PREDICTIVE','UPGRADE','INSPECTION'), allowNull: false },
  title:               { type: DataTypes.STRING(200), allowNull: false },
  description:         { type: DataTypes.TEXT, allowNull: false },
  status:              { type: DataTypes.ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','DEFERRED'), defaultValue: 'SCHEDULED' },
  priority:            { type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'), defaultValue: 'MEDIUM' },
  scheduled_date:      { type: DataTypes.DATE, allowNull: false },
  completed_date:      { type: DataTypes.DATE },
  downtime_hours:          { type: DataTypes.DECIMAL(6,2) },
  cost:                    { type: DataTypes.DECIMAL(10,2) },
  parts_cost:              { type: DataTypes.DECIMAL(10,2) },
  labor_cost:              { type: DataTypes.DECIMAL(10,2) },
  parts_used:              { type: DataTypes.JSON },
  stock_deducted_snapshot: { type: DataTypes.JSON },
  mel_category:            { type: DataTypes.ENUM('NONE','CAT_A','CAT_B','CAT_C','CAT_D'), defaultValue: 'NONE' },
  mel_expiry_date:         { type: DataTypes.DATEONLY },
  wiki_article_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  findings:                { type: DataTypes.TEXT },
  next_scheduled:          { type: DataTypes.DATE },
  deleted_at:              { type: DataTypes.DATE }
}, { tableName: 'maintenance_records', paranoid: true, deletedAt: 'deleted_at' });

// ── Planned Maintenance Tasks ────────────────────────────────────────────────
const PlannedMaintenanceTask = sequelize.define('PlannedMaintenanceTask', {
  id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  simulator_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  system:              { type: DataTypes.STRING(150), allowNull: false },
  subsystem:           { type: DataTypes.STRING(150), allowNull: false },
  task:                { type: DataTypes.TEXT, allowNull: false },
  reference:           { type: DataTypes.STRING(200) },
  operation_date_start:{ type: DataTypes.DATE, allowNull: false },
  operation_date_end:  { type: DataTypes.DATE, allowNull: false },
  repeat_task_type:    { type: DataTypes.ENUM('DAY', 'WEEK', 'MONTH'), allowNull: false, defaultValue: 'WEEK' },
  repeat_task_number:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  recurrence_end_date: { type: DataTypes.DATE },
  report_template:     { type: DataTypes.STRING(300) },
  status:              { type: DataTypes.ENUM('TODO', 'DONE'), allowNull: false, defaultValue: 'TODO' },
  optional:            { type: DataTypes.BOOLEAN, defaultValue: false },
  created_by:          { type: DataTypes.INTEGER.UNSIGNED },
  deleted_at:          { type: DataTypes.DATE }
}, { tableName: 'planned_maintenance_tasks', paranoid: true, deletedAt: 'deleted_at' });

const PlannedMaintenanceTaskInstance = sequelize.define('PlannedMaintenanceTaskInstance', {
  id:                   { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  planned_task_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  occurrence_date:      { type: DataTypes.DATEONLY, allowNull: false },
  exception_type:       { type: DataTypes.ENUM('OVERRIDE', 'DELETED'), allowNull: false, defaultValue: 'OVERRIDE' },
  system:               { type: DataTypes.STRING(150) },
  subsystem:            { type: DataTypes.STRING(150) },
  task:                 { type: DataTypes.TEXT },
  reference:            { type: DataTypes.STRING(200) },
  operation_date_start: { type: DataTypes.DATE },
  operation_date_end:   { type: DataTypes.DATE },
  repeat_task_type:     { type: DataTypes.ENUM('DAY', 'WEEK', 'MONTH') },
  repeat_task_number:   { type: DataTypes.INTEGER },
  recurrence_end_date:  { type: DataTypes.DATE },
  report_template:      { type: DataTypes.STRING(300) },
  status:               { type: DataTypes.ENUM('TODO', 'DONE'), defaultValue: 'TODO' },
  optional:             { type: DataTypes.BOOLEAN, defaultValue: false },
  created_by:           { type: DataTypes.INTEGER.UNSIGNED }
}, {
  tableName: 'planned_maintenance_task_instances',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, name: 'uniq_pmti_task_date', fields: ['planned_task_id', 'occurrence_date'] }]
});

// ── Warehouse Locations & Inventory Categories ──────────────────────────────
const WarehouseLocation = sequelize.define('WarehouseLocation', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  code:        { type: DataTypes.STRING(20), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  is_active:   { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'warehouse_locations', timestamps: false });

const ItemCategory = sequelize.define('ItemCategory', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  color:       { type: DataTypes.STRING(7), defaultValue: '#1565C0' }
}, { tableName: 'item_categories', timestamps: false });

// ── Inventory ────────────────────────────────────────────────────────────────
const InventoryItem = sequelize.define('InventoryItem', {
  id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  category_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  location_id:         { type: DataTypes.INTEGER.UNSIGNED },
  sku:                 { type: DataTypes.STRING(80), allowNull: false, unique: true },
  part_number:         { type: DataTypes.STRING(120) },
  name:                { type: DataTypes.STRING(200), allowNull: false },
  description:         { type: DataTypes.TEXT },
  unit:                { type: DataTypes.STRING(30), defaultValue: 'pcs' },
  part_classification:    { type: DataTypes.ENUM('CONSUMABLE','ROTATABLE_LRU','TOOL_CALIBRATED'), defaultValue: 'CONSUMABLE' },
  subsystem_code:         { type: DataTypes.STRING(60) },
  aog_critical:           { type: DataTypes.BOOLEAN, defaultValue: false },
  serial_number:          { type: DataTypes.STRING(100) },
  lru_status:             { type: DataTypes.ENUM('SERVICEABLE','INSTALLED','UNSERVICEABLE','IN_REPAIR_RMA','QUARANTINE'), defaultValue: 'SERVICEABLE' },
  installed_simulator_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  rma_reference:          { type: DataTypes.STRING(100) },
  on_order_qty:           { type: DataTypes.INTEGER, defaultValue: 0 },
  expected_delivery_date: { type: DataTypes.DATEONLY },
  lead_time_days:         { type: DataTypes.INTEGER, defaultValue: 7 },
  compatible_models:   { type: DataTypes.JSON },
  unserviceable_qty:   { type: DataTypes.INTEGER, defaultValue: 0 },
  quantity:            { type: DataTypes.INTEGER, defaultValue: 0 },
  min_stock:           { type: DataTypes.INTEGER, defaultValue: 0 },
  max_stock:           { type: DataTypes.INTEGER },
  reorder_point:       { type: DataTypes.INTEGER, defaultValue: 0 },
  unit_cost:           { type: DataTypes.DECIMAL(10,2) },
  supplier:            { type: DataTypes.STRING(200) },
  is_active:           { type: DataTypes.BOOLEAN, defaultValue: true },
  deleted_at:          { type: DataTypes.DATE }
}, { tableName: 'inventory_items', paranoid: true, deletedAt: 'deleted_at' });

const StockMovement = sequelize.define('StockMovement', {
  id:                    { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  item_id:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  simulator_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  maintenance_record_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  type:                  { type: DataTypes.ENUM('IN','OUT','TRANSFER','ADJUSTMENT','RETURN'), allowNull: false },
  quantity:        { type: DataTypes.INTEGER, allowNull: false },
  quantity_before: { type: DataTypes.INTEGER, allowNull: false },
  quantity_after:  { type: DataTypes.INTEGER, allowNull: false },
  reference:       { type: DataTypes.STRING(100) },
  reason:          { type: DataTypes.TEXT },
  destination:     { type: DataTypes.STRING(200) },
  movement_date:   { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'stock_movements', timestamps: false });

// ── Shifts ───────────────────────────────────────────────────────────────────
const ShiftType = sequelize.define('ShiftType', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(80), allowNull: false },
  code:        { type: DataTypes.STRING(10), allowNull: false, unique: true },
  start_time:  { type: DataTypes.TIME, allowNull: false },
  end_time:    { type: DataTypes.TIME, allowNull: false },
  color:       { type: DataTypes.STRING(7), defaultValue: '#1565C0' },
  category:    { type: DataTypes.ENUM('WORK', 'LEAVE'), allowNull: false, defaultValue: 'WORK' },
  description: { type: DataTypes.TEXT }
}, { tableName: 'shift_types', timestamps: false });

const Shift = sequelize.define('Shift', {
  id:                { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  shift_type_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:           { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  supervisor_id:     { type: DataTypes.INTEGER.UNSIGNED },
  date:              { type: DataTypes.DATEONLY, allowNull: false },
  entry_kind:        { type: DataTypes.ENUM('WORK', 'CUSTOM', 'LEAVE'), allowNull: false, defaultValue: 'WORK' },
  leave_type:        { type: DataTypes.STRING(40), allowNull: true },
  custom_start_time: { type: DataTypes.TIME, allowNull: true },
  custom_end_time:   { type: DataTypes.TIME, allowNull: true },
  status:            { type: DataTypes.ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED','ON_LEAVE'), defaultValue: 'SCHEDULED' },
  check_in:          { type: DataTypes.DATE },
  check_out:         { type: DataTypes.DATE },
  notes:             { type: DataTypes.TEXT },
  overtime_hours:    { type: DataTypes.DECIMAL(5,2), defaultValue: 0 },
  adjustment_reason: { type: DataTypes.STRING(120), allowNull: true },
  deleted_at:        { type: DataTypes.DATE }
}, { tableName: 'shifts', paranoid: true, deletedAt: 'deleted_at' });

const ShiftHandover = sequelize.define('ShiftHandover', {
  id:                        { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  shift_date:                { type: DataTypes.DATEONLY, allowNull: false },
  from_shift_code:           { type: DataTypes.STRING(20), allowNull: false },
  to_shift_code:             { type: DataTypes.STRING(20), allowNull: false },
  authored_by:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  acknowledged_by:           { type: DataTypes.INTEGER.UNSIGNED },
  acknowledged_at:           { type: DataTypes.DATE },
  simulators_status_summary: { type: DataTypes.TEXT },
  open_drs_summary:          { type: DataTypes.TEXT },
  pending_actions:           { type: DataTypes.TEXT },
  safety_loto_notes:         { type: DataTypes.TEXT }
}, { tableName: 'shift_handovers' });

// ── Tasks ────────────────────────────────────────────────────────────────────
const Task = sequelize.define('Task', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  parent_id:       { type: DataTypes.INTEGER.UNSIGNED },
  category_id:     { type: DataTypes.INTEGER.UNSIGNED },
  simulator_id:    { type: DataTypes.INTEGER.UNSIGNED },
  created_by:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  assigned_to:     { type: DataTypes.INTEGER.UNSIGNED },
  title:           { type: DataTypes.STRING(300), allowNull: false },
  description:     { type: DataTypes.TEXT },
  interval_type:   { type: DataTypes.ENUM('ONCE','DAILY','WEEKLY','MONTHLY','YEARLY'), defaultValue: 'ONCE' },
  status:          { type: DataTypes.ENUM('TODO','IN_PROGRESS','REVIEW','DONE','CANCELLED','OVERDUE'), defaultValue: 'TODO' },
  priority:        { type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'), defaultValue: 'MEDIUM' },
  due_date:        { type: DataTypes.DATE },
  completed_at:    { type: DataTypes.DATE },
  estimated_hours: { type: DataTypes.DECIMAL(6,2) },
  actual_hours:    { type: DataTypes.DECIMAL(6,2) },
  tags:            { type: DataTypes.JSON },
  attachments:     { type: DataTypes.JSON }
}, { tableName: 'tasks' });

// ── Wiki ─────────────────────────────────────────────────────────────────────
const WikiCategory = sequelize.define('WikiCategory', {
  id:         { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  parent_id:  { type: DataTypes.INTEGER.UNSIGNED },
  name:       { type: DataTypes.STRING(150), allowNull: false },
  slug:       { type: DataTypes.STRING(150), allowNull: false, unique: true },
  icon:       { type: DataTypes.STRING(50) },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { tableName: 'wiki_categories', timestamps: false });

const WikiArticle = sequelize.define('WikiArticle', {
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  category_id:    { type: DataTypes.INTEGER.UNSIGNED },
  author_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  last_editor_id: { type: DataTypes.INTEGER.UNSIGNED },
  title:          { type: DataTypes.STRING(300), allowNull: false },
  slug:           { type: DataTypes.STRING(300), allowNull: false, unique: true },
  content:        { type: DataTypes.TEXT('long'), allowNull: false },
  excerpt:        { type: DataTypes.TEXT },
  status:         { type: DataTypes.ENUM('DRAFT','PUBLISHED','ARCHIVED','REVIEW'), defaultValue: 'DRAFT' },
  is_pinned:      { type: DataTypes.BOOLEAN, defaultValue: false },
  view_count:     { type: DataTypes.INTEGER, defaultValue: 0 },
  tags:           { type: DataTypes.JSON },
  version:        { type: DataTypes.INTEGER, defaultValue: 1 },
  published_at:   { type: DataTypes.DATE }
}, { tableName: 'wiki_articles' });

// ── Notifications ────────────────────────────────────────────────────────────
const Notification = sequelize.define('Notification', {
  id:         { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  user_id:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  type:       { type: DataTypes.STRING(80), allowNull: false },
  title:      { type: DataTypes.STRING(200), allowNull: false },
  body:       { type: DataTypes.TEXT },
  link:       { type: DataTypes.STRING(500) },
  is_read:    { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'notifications', updatedAt: false });

// ── RefreshToken ─────────────────────────────────────────────────────────────
const RefreshToken = sequelize.define('RefreshToken', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  user_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  token:       { type: DataTypes.TEXT, allowNull: false },
  expires_at:  { type: DataTypes.DATE, allowNull: false },
  is_revoked:  { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'refresh_tokens' });

// ── TaskComment ──────────────────────────────────────────────────────────────
const TaskComment = sequelize.define('TaskComment', {
  id:      { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  task_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false }
}, { tableName: 'task_comments' });

// ── AuditLog ─────────────────────────────────────────────────────────────────
const AuditLog = sequelize.define('AuditLog', {
  id:        { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  user_id:   { type: DataTypes.INTEGER.UNSIGNED },
  username:  { type: DataTypes.STRING },
  action:    { type: DataTypes.STRING },
  ip:        { type: DataTypes.STRING },
  method:    { type: DataTypes.STRING },
  path:      { type: DataTypes.STRING },
  status:    { type: DataTypes.INTEGER },
  details:   { type: DataTypes.JSON }
}, { tableName: 'audit_logs', updatedAt: false });

// =============================================================================
// ASSOCIATIONS
// =============================================================================
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });
Role.hasMany(User, { foreignKey: 'role_id' });

Operation.belongsTo(OperationType, { foreignKey: 'type_id', as: 'type' });
Operation.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
Simulator.hasMany(Operation, { foreignKey: 'simulator_id', as: 'sorties' });
Operation.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Operation.hasMany(OperationMember, { foreignKey: 'operation_id', as: 'members', onDelete: 'CASCADE' });
OperationMember.belongsTo(Operation, { foreignKey: 'operation_id', as: 'operation' });
OperationMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Operation.hasMany(OperationLog, { foreignKey: 'operation_id', as: 'logs', onDelete: 'CASCADE' });
OperationLog.belongsTo(Operation, { foreignKey: 'operation_id', as: 'operation' });
OperationLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Simulator.belongsTo(Asset, { foreignKey: 'asset_id', as: 'asset' });
Simulator.hasMany(SimulatorSubsystem, { foreignKey: 'simulator_id', as: 'subsystems', onDelete: 'CASCADE' });
SimulatorSubsystem.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
Simulator.hasMany(SimulatorQtgRecord, { foreignKey: 'simulator_id', as: 'qtgRecords', onDelete: 'CASCADE' });
SimulatorQtgRecord.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
SimulatorQtgRecord.belongsTo(User, { foreignKey: 'executed_by', as: 'executor' });

SimulatorDailyLog.belongsTo(User, { foreignKey: 'updated_by', as: 'updater' });
SimulatorDailyLog.hasMany(SimulatorDailyShift, { foreignKey: 'daily_log_id', as: 'shifts', onDelete: 'CASCADE' });
SimulatorDailyShift.belongsTo(SimulatorDailyLog, { foreignKey: 'daily_log_id', as: 'dailyLog' });
SimulatorDailyShift.belongsTo(User, { foreignKey: 'lead_user_id', as: 'lead' });
SimulatorDailyShift.belongsTo(User, { foreignKey: 'signed_off_by', as: 'signer' });
SimulatorDailyShift.hasMany(SimulatorShiftEntry, { foreignKey: 'shift_id', as: 'entries', onDelete: 'CASCADE' });
SimulatorShiftEntry.belongsTo(SimulatorDailyShift, { foreignKey: 'shift_id', as: 'shift' });
SimulatorShiftEntry.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
Simulator.hasMany(SimulatorShiftEntry, { foreignKey: 'simulator_id', as: 'shiftEntries', onDelete: 'CASCADE' });
SimulatorShiftEntry.belongsTo(User, { foreignKey: 'updated_by', as: 'updater' });

Asset.belongsTo(AssetCategory, { foreignKey: 'category_id', as: 'category' });
Asset.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignedUser' });
MaintenanceRecord.belongsTo(Asset, { foreignKey: 'asset_id', as: 'asset' });
MaintenanceRecord.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
Simulator.hasMany(MaintenanceRecord, { foreignKey: 'simulator_id', as: 'maintenanceRecords' });
MaintenanceRecord.belongsTo(Operation, { foreignKey: 'sortie_id', as: 'sortie' });
MaintenanceRecord.belongsTo(User, { foreignKey: 'performed_by', as: 'technician' });
MaintenanceRecord.belongsTo(WikiArticle, { foreignKey: 'wiki_article_id', as: 'wikiArticle' });

PlannedMaintenanceTask.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
PlannedMaintenanceTask.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
PlannedMaintenanceTask.hasMany(PlannedMaintenanceTaskInstance, { foreignKey: 'planned_task_id', as: 'occurrences' });
PlannedMaintenanceTaskInstance.belongsTo(PlannedMaintenanceTask, { foreignKey: 'planned_task_id', as: 'master' });
PlannedMaintenanceTaskInstance.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

InventoryItem.belongsTo(Simulator, { foreignKey: 'installed_simulator_id', as: 'installedSimulator' });
InventoryItem.hasMany(StockMovement, { foreignKey: 'item_id', as: 'movements' });
StockMovement.belongsTo(InventoryItem, { foreignKey: 'item_id', as: 'item' });
StockMovement.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
StockMovement.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
StockMovement.belongsTo(MaintenanceRecord, { foreignKey: 'maintenance_record_id', as: 'maintenanceRecord' });

Shift.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });
Shift.belongsTo(User, { foreignKey: 'user_id', as: 'employee' });
Shift.belongsTo(User, { foreignKey: 'supervisor_id', as: 'supervisor' });
ShiftHandover.belongsTo(User, { foreignKey: 'authored_by', as: 'author' });
ShiftHandover.belongsTo(User, { foreignKey: 'acknowledged_by', as: 'acknowledger' });

Task.belongsTo(Task, { foreignKey: 'parent_id', as: 'parent' });
Task.hasMany(Task, { foreignKey: 'parent_id', as: 'subtasks' });
Task.belongsTo(Simulator, { foreignKey: 'simulator_id', as: 'simulator' });
Task.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Task.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignee' });

WikiArticle.belongsTo(WikiCategory, { foreignKey: 'category_id', as: 'category' });
WikiArticle.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
WikiArticle.belongsTo(User, { foreignKey: 'last_editor_id', as: 'lastEditor' });
WikiCategory.belongsTo(WikiCategory, { foreignKey: 'parent_id', as: 'parent' });
WikiCategory.hasMany(WikiCategory, { foreignKey: 'parent_id', as: 'children' });

Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

RefreshToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });

Task.hasMany(TaskComment, { foreignKey: 'task_id', as: 'comments' });
TaskComment.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
TaskComment.belongsTo(User, { foreignKey: 'user_id', as: 'author' });

AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

ItemCategory.hasMany(InventoryItem, { foreignKey: 'category_id', as: 'items' });
InventoryItem.belongsTo(ItemCategory, { foreignKey: 'category_id', as: 'category' });
WarehouseLocation.hasMany(InventoryItem, { foreignKey: 'location_id', as: 'items' });
InventoryItem.belongsTo(WarehouseLocation, { foreignKey: 'location_id', as: 'location' });

module.exports = {
  sequelize, User, Role,
  Simulator, SimulatorSubsystem, SimulatorQtgRecord,
  SimulatorDailyLog, SimulatorDailyShift, SimulatorShiftEntry,
  Operation, OperationType, OperationMember, OperationLog,
  Asset, AssetCategory, MaintenanceRecord,
  PlannedMaintenanceTask, PlannedMaintenanceTaskInstance,
  WarehouseLocation, ItemCategory, InventoryItem, StockMovement,
  Shift, ShiftType, ShiftHandover,
  Task, TaskComment,
  WikiArticle, WikiCategory,
  Notification,
  RefreshToken, AuditLog
};
