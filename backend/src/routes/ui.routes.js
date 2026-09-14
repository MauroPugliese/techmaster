const router = require('express').Router();
const { sequelize } = require('../models');

let sectionAccessTableInitPromise = null;

const UI_SECTION_CATALOG = {
  operations: {
    table: ['id', 'title', 'type', 'status', 'priority', 'location', 'start_date', 'creator'],
    form: ['title', 'type_id', 'priority', 'status', 'location', 'start_date', 'end_date', 'description', 'notes']
  },
  maintenance: {
    table: ['title', 'asset', 'type', 'status', 'priority', 'scheduled_date', 'technician', 'cost'],
    form: ['title', 'asset_id', 'type', 'priority', 'status', 'scheduled_date', 'downtime_hours', 'cost', 'description', 'findings']
  },
  warehouse: {
    table: ['sku', 'part_number', 'name', 'category', 'quantity', 'stock_status', 'reorder_point', 'unit_cost', 'supplier'],
    form: ['category_id', 'sku', 'part_number', 'name', 'unit', 'quantity', 'min_stock', 'reorder_point', 'max_stock', 'unit_cost', 'supplier', 'description']
  },
  wiki: {
    table: ['title', 'category', 'status', 'author', 'views', 'updated_at'],
    form: ['status', 'title', 'category_id', 'tags', 'excerpt', 'content']
  },
  shifts: {
    table: ['employee', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    form: ['user_id', 'shift_type_id', 'date', 'status', 'notes']
  },
  tasks: {
    table: ['kanban'],
    form: ['title', 'interval_type', 'priority', 'status', 'estimated_hours', 'due_date', 'parent_id', 'description', 'tags']
  },
  planned_maintenance: {
    table: ['system', 'subsystem', 'task', 'start_date', 'repeat_type', 'every_n', 'repeat_until', 'status'],
    form: ['system', 'subsystem', 'task', 'operationDateStart', 'operationDateEnd', 'repeatTaskType', 'repeatTaskNumber', 'recurrenceEndDate', 'reference', 'reportTemplate', 'status', 'optional']
  },
  dashboard: {
    table: ['item', 'sku', 'current_stock', 'reorder_point', 'status'],
    form: []
  },
  analytics: {
    table: ['type', 'count', 'avg_downtime', 'total_cost', 'completion_rate'],
    form: []
  }
};

const NAV_SECTION_CATALOG = {
  dashboard: {
    path: '/dashboard',
    label: 'Dashboard',
    group: 'Overview',
    icon: 'dashboard'
  },
  operations: {
    path: '/operations',
    label: 'Operations & Sorties',
    group: 'Operations',
    icon: 'rocket_launch'
  },
  maintenance: {
    path: '/maintenance',
    label: 'Maintenance',
    group: 'Operations',
    icon: 'build_circle'
  },
  warehouse: {
    path: '/warehouse',
    label: 'Warehouse',
    group: 'Operations',
    icon: 'inventory_2'
  },
  shifts: {
    path: '/shifts',
    label: 'Shifts',
    group: 'Operations',
    icon: 'schedule'
  },
  analytics: {
    path: '/analytics',
    label: 'Analytics & Reports',
    group: 'Intelligence',
    icon: 'insights'
  },
  operations_analytics: {
    path: '/analytics/operations',
    label: 'Operations Analytics',
    group: 'Intelligence',
    icon: 'analytics'
  },
  tasks: {
    path: '/tasks',
    label: 'Task Manager',
    group: 'Intelligence',
    icon: 'task_alt'
  },
  wiki: {
    path: '/wiki',
    label: 'Wiki & Docs',
    group: 'Knowledge',
    icon: 'menu_book'
  },
  admin: {
    path: '/admin',
    label: 'Admin Settings',
    group: 'Administration',
    icon: 'admin_panel_settings'
  }
};

async function ensureSectionPrefsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ui_section_field_preferences (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(60) NOT NULL,
      scope ENUM('table', 'form') NOT NULL,
      field_key VARCHAR(100) NOT NULL,
      label VARCHAR(150) NULL,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_section_scope_field (section_key, scope, field_key)
    ) ENGINE=InnoDB;
  `);
}

async function ensureSectionRolePrefsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ui_section_field_role_preferences (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(60) NOT NULL,
      scope ENUM('table', 'form') NOT NULL,
      role_name VARCHAR(60) NOT NULL,
      field_key VARCHAR(100) NOT NULL,
      label VARCHAR(150) NULL,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_section_scope_role_field (section_key, scope, role_name, field_key)
    ) ENGINE=InnoDB;
  `);
}

async function ensureSectionAccessPrefsTable() {
  if (!sectionAccessTableInitPromise) {
    sectionAccessTableInitPromise = sequelize.query(`
      CREATE TABLE IF NOT EXISTS ui_section_access_preferences (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        section_key VARCHAR(60) NOT NULL,
        subject_type ENUM('global', 'role', 'user') NOT NULL DEFAULT 'global',
        subject_key VARCHAR(120) NOT NULL,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_section_subject_pref (section_key, subject_type, subject_key)
      ) ENGINE=InnoDB;
    `).catch((err) => {
      sectionAccessTableInitPromise = null;
      throw err;
    });
  }

  await sectionAccessTableInitPromise;
}

function assertCatalogSection(sectionKey) {
  const key = String(sectionKey || '').trim().toLowerCase();
  if (!UI_SECTION_CATALOG[key]) {
    const err = new Error('Unknown section key');
    err.status = 404;
    throw err;
  }
  return key;
}

function buildEffectiveSectionAccessRows(globalRows, roleRows, userRows) {
  const globalMap = new Map(globalRows.map(r => [r.section_key, r]));
  const roleMap = new Map(roleRows.map(r => [r.section_key, r]));
  const userMap = new Map(userRows.map(r => [r.section_key, r]));

  return Object.entries(NAV_SECTION_CATALOG).map(([sectionKey, meta]) => {
    const userPref = userMap.get(sectionKey);
    const rolePref = roleMap.get(sectionKey);
    const globalPref = globalMap.get(sectionKey);
    const chosen = userPref || rolePref || globalPref || null;

    return {
      section_key: sectionKey,
      path: meta.path,
      label: meta.label,
      group: meta.group,
      icon: meta.icon,
      is_visible: chosen ? chosen.is_visible : 1,
      source: userPref ? 'user' : (rolePref ? 'role' : (globalPref ? 'global' : 'default'))
    };
  });
}

function buildEffectiveScopeRows(defaultKeys, globalRows, roleRows) {
  const globalMap = new Map(globalRows.map(r => [r.field_key, r]));
  const roleMap = new Map(roleRows.map(r => [r.field_key, r]));
  const allKeys = [...new Set([...(defaultKeys || []), ...globalMap.keys(), ...roleMap.keys()])];

  return allKeys.map((fieldKey, idx) => {
    const rolePref = roleMap.get(fieldKey);
    const globalPref = globalMap.get(fieldKey);
    const chosen = rolePref || globalPref || null;
    return {
      field_key: fieldKey,
      label: chosen ? chosen.label : null,
      is_visible: chosen ? chosen.is_visible : 1,
      display_order: chosen ? Number(chosen.display_order) : idx + 1,
      source: rolePref ? 'role' : (globalPref ? 'global' : 'default')
    };
  }).sort((a, b) => Number(a.display_order) - Number(b.display_order));
}

router.get('/sections/:section/preferences', async (req, res, next) => {
  try {
    const sectionKey = assertCatalogSection(req.params.section);
    await ensureSectionPrefsTable();
    await ensureSectionRolePrefsTable();

    const roleName = String(req.user?.role?.name || '').trim().toLowerCase();

    const [globalRows] = await sequelize.query(
      `SELECT scope, field_key, label, is_visible, display_order
       FROM ui_section_field_preferences
       WHERE section_key = ?
       ORDER BY scope ASC, display_order ASC, field_key ASC`,
      { replacements: [sectionKey] }
    );

    let roleRows = [];
    if (roleName) {
      const [rows] = await sequelize.query(
        `SELECT scope, field_key, label, is_visible, display_order
         FROM ui_section_field_role_preferences
         WHERE section_key = ? AND role_name = ?
         ORDER BY scope ASC, display_order ASC, field_key ASC`,
        { replacements: [sectionKey, roleName] }
      );
      roleRows = rows;
    }

    res.json({
      success: true,
      data: {
        section_key: sectionKey,
        role_name: roleName || 'unknown',
        table: buildEffectiveScopeRows(
          UI_SECTION_CATALOG[sectionKey].table,
          globalRows.filter(r => r.scope === 'table'),
          roleRows.filter(r => r.scope === 'table')
        ),
        form: buildEffectiveScopeRows(
          UI_SECTION_CATALOG[sectionKey].form,
          globalRows.filter(r => r.scope === 'form'),
          roleRows.filter(r => r.scope === 'form')
        ),
        defaults: UI_SECTION_CATALOG[sectionKey]
      }
    });
  } catch (err) { next(err); }
});

router.get('/navigation', async (req, res, next) => {
  try {
    await ensureSectionAccessPrefsTable();

    const roleName = String(req.user?.role?.name || '').trim().toLowerCase();
    const userId = req.user?.id ? String(req.user.id) : null;

    const [globalRows] = await sequelize.query(
      `SELECT section_key, is_visible
       FROM ui_section_access_preferences
       WHERE subject_type = 'global' AND subject_key = 'ALL'`,
      { replacements: [] }
    );

    let roleRows = [];
    if (roleName) {
      const [rows] = await sequelize.query(
        `SELECT section_key, is_visible
         FROM ui_section_access_preferences
         WHERE subject_type = 'role' AND subject_key = ?`,
        { replacements: [roleName] }
      );
      roleRows = rows;
    }

    let userRows = [];
    if (userId) {
      const [rows] = await sequelize.query(
        `SELECT section_key, is_visible
         FROM ui_section_access_preferences
         WHERE subject_type = 'user' AND subject_key = ?`,
        { replacements: [userId] }
      );
      userRows = rows;
    }

    res.json({
      success: true,
      data: {
        role_name: roleName || 'unknown',
        user_id: req.user?.id || null,
        sections: buildEffectiveSectionAccessRows(globalRows, roleRows, userRows)
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
