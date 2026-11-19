// =============================================================================
// exports/modules/index.js — Export Module Registry
// =============================================================================

const operations = require('./operations');
const operationsAnalytics = require('./operations-analytics');
const maintenance = require('./maintenance');
const plannedMaintenance = require('./planned-maintenance');
const warehouse = require('./warehouse');
const shifts = require('./shifts');
const tasks = require('./tasks');
const wiki = require('./wiki');
const users = require('./users');
const analytics = require('./analytics');
const audit = require('./audit');
const dashboard = require('./dashboard');

const MODULES = {
  operations,
  'operations-analytics': operationsAnalytics,
  maintenance,
  'planned-maintenance': plannedMaintenance,
  warehouse,
  shifts,
  tasks,
  wiki,
  users,
  analytics,
  audit,
  dashboard
};

module.exports = { MODULES, wiki };
