// =============================================================================
// exports/modules/index.js — Module registry
// -----------------------------------------------------------------------------
// Central registry of every exportable module. Each entry exposes:
//   key          unique route segment
//   title        document title
//   subtitle     document subtitle
//   orientation  'portrait' | 'landscape'
//   roles        optional array of roles allowed to export (admin always allowed)
//   build(req)   async → { filters, tables, [subtitle], [orientation], [filename] }
// =============================================================================

const operations = require('./operations');
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
