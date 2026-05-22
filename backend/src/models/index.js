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
  last_login:    { type: DataTypes.DATE }
}, { tableName: 'users' });

// ── Operation ────────────────────────────────────────────────────────────────
const OperationType = sequelize.define('OperationType', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  color:       { type: DataTypes.STRING(7), defaultValue: '#1565C0' },
  icon:        { type: DataTypes.STRING(50) },
  description: { type: DataTypes.TEXT }
}, { tableName: 'operation_types', timestamps: false });

const Operation = sequelize.define('Operation', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  type_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  created_by:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  title:           { type: DataTypes.STRING(200), allowNull: false },
  description:     { type: DataTypes.TEXT },
  status:          { type: DataTypes.ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','ON_HOLD'), defaultValue: 'PLANNED' },
  priority:        { type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'), defaultValue: 'MEDIUM' },
  location:        { type: DataTypes.STRING(200) },
  start_date:      { type: DataTypes.DATE, allowNull: false },
  end_date:        { type: DataTypes.DATE },
  actual_end_date: { type: DataTypes.DATE },
  notes:           { type: DataTypes.TEXT },
  metadata:        { type: DataTypes.JSON }
}, { tableName: 'operations' });

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
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  asset_id:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  performed_by:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  type:           { type: DataTypes.ENUM('PREVENTIVE','CORRECTIVE','PREDICTIVE','UPGRADE','INSPECTION'), allowNull: false },
  title:          { type: DataTypes.STRING(200), allowNull: false },
  description:    { type: DataTypes.TEXT, allowNull: false },
  status:         { type: DataTypes.ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','DEFERRED'), defaultValue: 'SCHEDULED' },
  priority:       { type: DataTypes.ENUM('LOW','MEDIUM','HIGH','CRITICAL'), defaultValue: 'MEDIUM' },
  scheduled_date: { type: DataTypes.DATE, allowNull: false },
  completed_date: { type: DataTypes.DATE },
  downtime_hours: { type: DataTypes.DECIMAL(6,2) },
  cost:           { type: DataTypes.DECIMAL(10,2) },
  parts_used:     { type: DataTypes.JSON },
  findings:       { type: DataTypes.TEXT },
  next_scheduled: { type: DataTypes.DATE },
  deleted_at:     { type: DataTypes.DATE }
}, { tableName: 'maintenance_records', paranoid: true, deletedAt: 'deleted_at' });

// ── Planned Maintenance Tasks ────────────────────────────────────────────────
const PlannedMaintenanceTask = sequelize.define('PlannedMaintenanceTask', {
  id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  system:              { type: DataTypes.STRING(150), allowNull: false },
  subsystem:           { type: DataTypes.STRING(150), allowNull: false },
  task:                { type: DataTypes.TEXT, allowNull: false },
  reference:           { type: DataTypes.STRING(200) },
  operation_date_start:{ type: DataTypes.DATE, allowNull: false },
  operation_date_end:  { type: DataTypes.DATE, allowNull: false },
  repeat_task_type:    { type: DataTypes.ENUM('DAY', 'WEEK', 'MONTH'), allowNull: false, defaultValue: 'WEEK' },
  repeat_task_number:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  report_template:     { type: DataTypes.STRING(300) },
  status:              { type: DataTypes.ENUM('TODO', 'DONE'), allowNull: false, defaultValue: 'TODO' },
  optional:            { type: DataTypes.BOOLEAN, defaultValue: false },
  created_by:          { type: DataTypes.INTEGER.UNSIGNED },
  deleted_at:          { type: DataTypes.DATE }
}, { tableName: 'planned_maintenance_tasks', paranoid: true, deletedAt: 'deleted_at' });

// ── Inventory Categories ─────────────────────────────────────────────────────
const ItemCategory = sequelize.define('ItemCategory', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(100), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  color:       { type: DataTypes.STRING(7), defaultValue: '#1565C0' }
}, { tableName: 'item_categories', timestamps: false });

// ── Inventory ────────────────────────────────────────────────────────────────
const InventoryItem = sequelize.define('InventoryItem', {
  id:            { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  category_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  location_id:   { type: DataTypes.INTEGER.UNSIGNED },
  sku:           { type: DataTypes.STRING(80), allowNull: false, unique: true },
  name:          { type: DataTypes.STRING(200), allowNull: false },
  description:   { type: DataTypes.TEXT },
  unit:          { type: DataTypes.STRING(30), defaultValue: 'pcs' },
  quantity:      { type: DataTypes.INTEGER, defaultValue: 0 },
  min_stock:     { type: DataTypes.INTEGER, defaultValue: 0 },
  max_stock:     { type: DataTypes.INTEGER },
  reorder_point: { type: DataTypes.INTEGER, defaultValue: 0 },
  unit_cost:     { type: DataTypes.DECIMAL(10,2) },
  supplier:      { type: DataTypes.STRING(200) },
  is_active:     { type: DataTypes.BOOLEAN, defaultValue: true },
  deleted_at:    { type: DataTypes.DATE }
}, { tableName: 'inventory_items', paranoid: true, deletedAt: 'deleted_at' });

const StockMovement = sequelize.define('StockMovement', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  item_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  type:            { type: DataTypes.ENUM('IN','OUT','TRANSFER','ADJUSTMENT','RETURN'), allowNull: false },
  quantity:        { type: DataTypes.INTEGER, allowNull: false },
  quantity_before: { type: DataTypes.INTEGER, allowNull: false },
  quantity_after:  { type: DataTypes.INTEGER, allowNull: false },
  reference:       { type: DataTypes.STRING(100) },
  reason:          { type: DataTypes.TEXT },
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
  description: { type: DataTypes.TEXT }
}, { tableName: 'shift_types', timestamps: false });

const Shift = sequelize.define('Shift', {
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  shift_type_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  supervisor_id:  { type: DataTypes.INTEGER.UNSIGNED },
  date:           { type: DataTypes.DATEONLY, allowNull: false },
  status:         { type: DataTypes.ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED'), defaultValue: 'SCHEDULED' },
  check_in:       { type: DataTypes.DATE },
  check_out:      { type: DataTypes.DATE },
  notes:          { type: DataTypes.TEXT },
  overtime_hours: { type: DataTypes.DECIMAL(5,2), defaultValue: 0 },
  deleted_at:     { type: DataTypes.DATE }
}, { tableName: 'shifts', paranoid: true, deletedAt: 'deleted_at' });

// ── Tasks ────────────────────────────────────────────────────────────────────
const Task = sequelize.define('Task', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  parent_id:       { type: DataTypes.INTEGER.UNSIGNED },
  category_id:     { type: DataTypes.INTEGER.UNSIGNED },
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
Operation.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

Asset.belongsTo(AssetCategory, { foreignKey: 'category_id', as: 'category' });
Asset.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignedUser' });
MaintenanceRecord.belongsTo(Asset, { foreignKey: 'asset_id', as: 'asset' });
MaintenanceRecord.belongsTo(User, { foreignKey: 'performed_by', as: 'technician' });

PlannedMaintenanceTask.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

InventoryItem.hasMany(StockMovement, { foreignKey: 'item_id', as: 'movements' });
StockMovement.belongsTo(InventoryItem, { foreignKey: 'item_id', as: 'item' });
StockMovement.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Shift.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });
Shift.belongsTo(User, { foreignKey: 'user_id', as: 'employee' });
Shift.belongsTo(User, { foreignKey: 'supervisor_id', as: 'supervisor' });

Task.belongsTo(Task, { foreignKey: 'parent_id', as: 'parent' });
Task.hasMany(Task, { foreignKey: 'parent_id', as: 'subtasks' });
Task.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Task.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignee' });

WikiArticle.belongsTo(WikiCategory, { foreignKey: 'category_id', as: 'category' });
WikiArticle.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
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

module.exports = {
  sequelize, User, Role, Operation, OperationType,
  Asset, AssetCategory, MaintenanceRecord,
  PlannedMaintenanceTask,
  ItemCategory, InventoryItem, StockMovement,
  Shift, ShiftType,
  Task, TaskComment,
  WikiArticle, WikiCategory,
  Notification,
  RefreshToken, AuditLog
};