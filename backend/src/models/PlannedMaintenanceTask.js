// =============================================================================
// models/PlannedMaintenanceTask.js — Sequelize model for planned_maintenance_tasks
// =============================================================================
const { sequelize, Sequelize } = require('../config/database');
const { DataTypes } = Sequelize;

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
  created_by:          { type: DataTypes.INTEGER.UNSIGNED }
}, {
  tableName: 'planned_maintenance_tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = PlannedMaintenanceTask;