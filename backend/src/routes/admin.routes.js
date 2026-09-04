// =============================================================================
// routes/admin.routes.js — Admin Panel API (pure JavaScript)
// =============================================================================
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Op }  = require('sequelize');
const {
  sequelize, User, Role,
  OperationType, ShiftType,
  AssetCategory, WikiCategory,
} = require('../models');

const CUSTOMIZABLE_TABLES = new Set([
  'operations',
  'maintenance_records',
  'planned_maintenance_tasks',
  'planned_maintenance_task_instances',
  'assets',
  'inventory_items',
  'stock_movements',
  'tasks',
  'shifts',
  'wiki_articles',
  'warehouse_locations',
  'item_categories'
]);

const SYSTEM_COLUMN_DENYLIST = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateIdentifier(name, kind) {
  if (!name || typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
    const err = new Error('Invalid ' + kind + ' name');
    err.status = 400;
    throw err;
  }
  return name;
}

function assertCustomizableTable(tableName) {
  validateIdentifier(tableName, 'table');
  if (!CUSTOMIZABLE_TABLES.has(tableName)) {
    const err = new Error('This table is not customizable from Admin Settings');
    err.status = 403;
    throw err;
  }
}

function buildColumnTypeSql(type, length) {
  const t = String(type || '').trim().toUpperCase();
  const len = length === undefined || length === null || length === '' ? null : Number(length);
  const lengthTypes = new Set(['VARCHAR', 'CHAR', 'DECIMAL']);
  const plainTypes = new Set(['TEXT', 'LONGTEXT', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'JSON']);

  if (lengthTypes.has(t)) {
    if (!Number.isFinite(len) || len <= 0) {
      const err = new Error('Length is required and must be greater than zero for type ' + t);
      err.status = 400;
      throw err;
    }
    if (t === 'DECIMAL') {
      return 'DECIMAL(' + len + ',2)';
    }
    return t + '(' + len + ')';
  }

  if (!plainTypes.has(t)) {
    const err = new Error('Unsupported column type');
    err.status = 400;
    throw err;
  }

  return t;
}

function buildDefaultSql(defaultValue) {
  if (defaultValue === undefined || defaultValue === null || defaultValue === '') {
    return 'DEFAULT NULL';
  }

  const raw = String(defaultValue).trim();
  const upper = raw.toUpperCase();

  if (upper === 'CURRENT_TIMESTAMP') {
    return 'DEFAULT CURRENT_TIMESTAMP';
  }

  const escaped = raw.replace(/'/g, "''");
  return "DEFAULT '" + escaped + "'";
}

async function ensureCustomizationPrefsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ui_table_column_preferences (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      table_name VARCHAR(100) NOT NULL,
      column_name VARCHAR(100) NOT NULL,
      label VARCHAR(150) NULL,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INT NOT NULL DEFAULT 0,
      width VARCHAR(20) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_table_column_pref (table_name, column_name)
    ) ENGINE=InnoDB;
  `);
}

async function getColumnMetadata(tableName) {
  const [columns] = await sequelize.query(
    `SELECT
      c.COLUMN_NAME as column_name,
      c.COLUMN_TYPE as column_type,
      c.DATA_TYPE as data_type,
      c.IS_NULLABLE as is_nullable,
      c.COLUMN_DEFAULT as column_default,
      c.COLUMN_KEY as column_key,
      c.EXTRA as extra,
      c.ORDINAL_POSITION as ordinal_position,
      CASE WHEN c.COLUMN_NAME IN ('id','created_at','updated_at','deleted_at') THEN 1 ELSE 0 END as is_system,
      CASE
        WHEN c.COLUMN_KEY = 'PRI' OR c.EXTRA LIKE '%auto_increment%' OR c.COLUMN_NAME IN ('id','created_at','updated_at','deleted_at') THEN 1
        ELSE 0
      END as is_protected
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
    ORDER BY c.ORDINAL_POSITION ASC`,
    { replacements: [tableName] }
  );

  return columns;
}

// =============================================================================
// SYSTEM OVERVIEW
// =============================================================================
router.get('/system', async (req, res, next) => {
  try {
    const [
      userCount, activeUsers,
      opCount, maintCount,
      itemCount, shiftCount,
      taskCount, articleCount,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { is_active: true } }),
      sequelize.models.Operation.count(),
      sequelize.models.MaintenanceRecord.count(),
      sequelize.models.InventoryItem.count({ where: { is_active: true } }),
      sequelize.models.Shift.count(),
      sequelize.models.Task.count(),
      sequelize.models.WikiArticle.count({ where: { status: 'PUBLISHED' } }),
    ]);

    const [[dbRow]] = await sequelize.query('SELECT VERSION() as version');

    const roleBreakdown = await User.findAll({
      attributes: [
        'role_id',
        [sequelize.fn('COUNT', sequelize.col('User.id')), 'count']
      ],
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
      group: ['role_id', 'role.id'],
      raw: false,
    });

    res.json({
      success: true,
      data: {
        db_version:   dbRow ? dbRow.version : 'unknown',
        uptime:       process.uptime(),
        node_version: process.version,
        counts: {
          users: userCount, active_users: activeUsers,
          operations: opCount, maintenance: maintCount,
          inventory_items: itemCount, shifts: shiftCount,
          tasks: taskCount, wiki_articles: articleCount,
        },
        role_breakdown: roleBreakdown.map(r => ({
          role:  r.role ? r.role.name : 'unknown',
          count: parseInt(r.get('count')),
        })),
      }
    });
  } catch (err) { next(err); }
});

// =============================================================================
// ROLES — read only
// =============================================================================
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await Role.findAll({ order: [['id', 'ASC']] });
    res.json({ success: true, data: roles });
  } catch (err) { next(err); }
});

// =============================================================================
// USERS
// =============================================================================
router.get('/users', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const where = {};
    if (search) {
      where[Op.or] = [
        { first_name: { [Op.like]: '%' + search + '%' } },
        { last_name:  { [Op.like]: '%' + search + '%' } },
        { email:      { [Op.like]: '%' + search + '%' } },
        { username:   { [Op.like]: '%' + search + '%' } },
      ];
    }
    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }],
      order: [['first_name', 'ASC']],
      limit: +limit,
      offset: (+page - 1) * +limit,
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/users', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password required' });
    const payload = Object.assign({}, req.body);
    delete payload.password;
    payload.password_hash = await bcrypt.hash(password, 12);
    const user = await User.create(payload);
    const created = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }],
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    const updates = Object.assign({}, req.body);
    if (updates.password) {
      updates.password_hash = await bcrypt.hash(updates.password, 12);
    }
    delete updates.password;
    await user.update(updates);
    const updated = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }],
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (+req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    await User.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch('/users/:id/toggle', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    await user.update({ is_active: !user.is_active });
    res.json({ success: true, data: { is_active: user.is_active } });
  } catch (err) { next(err); }
});

router.patch('/users/:id/reset-password', async (req, res, next) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    await user.update({ password_hash: await bcrypt.hash(new_password, 12) });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { next(err); }
});

// =============================================================================
// OPERATION TYPES
// =============================================================================
router.get('/operation-types', async (req, res, next) => {
  try {
    const types = await OperationType.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

router.post('/operation-types', async (req, res, next) => {
  try {
    const t = await OperationType.create(req.body);
    res.status(201).json({ success: true, data: t });
  } catch (err) { next(err); }
});

router.put('/operation-types/:id', async (req, res, next) => {
  try {
    const t = await OperationType.findByPk(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    await t.update(req.body);
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
});

router.delete('/operation-types/:id', async (req, res, next) => {
  try {
    const used = await sequelize.models.Operation.count({ where: { type_id: req.params.id } });
    if (used > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used + ' operations' });
    }
    await OperationType.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// SHIFT TYPES
// =============================================================================
router.get('/shift-types', async (req, res, next) => {
  try {
    const types = await ShiftType.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

router.post('/shift-types', async (req, res, next) => {
  try {
    const t = await ShiftType.create(req.body);
    res.status(201).json({ success: true, data: t });
  } catch (err) { next(err); }
});

router.put('/shift-types/:id', async (req, res, next) => {
  try {
    const t = await ShiftType.findByPk(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    await t.update(req.body);
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
});

router.delete('/shift-types/:id', async (req, res, next) => {
  try {
    const used = await sequelize.models.Shift.count({ where: { shift_type_id: req.params.id } });
    if (used > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used + ' shifts' });
    }
    await ShiftType.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// ASSET CATEGORIES
// =============================================================================
router.get('/asset-categories', async (req, res, next) => {
  try {
    const cats = await AssetCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
});

router.post('/asset-categories', async (req, res, next) => {
  try {
    const c = await AssetCategory.create(req.body);
    res.status(201).json({ success: true, data: c });
  } catch (err) { next(err); }
});

router.put('/asset-categories/:id', async (req, res, next) => {
  try {
    const c = await AssetCategory.findByPk(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    await c.update(req.body);
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
});

router.delete('/asset-categories/:id', async (req, res, next) => {
  try {
    const used = await sequelize.models.Asset.count({ where: { category_id: req.params.id } });
    if (used > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used + ' assets' });
    }
    await AssetCategory.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// ITEM CATEGORIES
// =============================================================================
router.get('/item-categories', async (req, res, next) => {
  try {
    const [rows] = await sequelize.query('SELECT * FROM item_categories ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.post('/item-categories', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const [result] = await sequelize.query(
      'INSERT INTO item_categories (name, description) VALUES (?, ?)',
      { replacements: [name, description || null] }
    );
    const [rows] = await sequelize.query(
      'SELECT * FROM item_categories WHERE id = ?',
      { replacements: [result] }
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/item-categories/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    await sequelize.query(
      'UPDATE item_categories SET name = ?, description = ? WHERE id = ?',
      { replacements: [name, description || null, req.params.id] }
    );
    const [rows] = await sequelize.query(
      'SELECT * FROM item_categories WHERE id = ?',
      { replacements: [req.params.id] }
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/item-categories/:id', async (req, res, next) => {
  try {
    const [used] = await sequelize.query(
      'SELECT COUNT(*) as c FROM inventory_items WHERE category_id = ?',
      { replacements: [req.params.id] }
    );
    if (used[0].c > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used[0].c + ' items' });
    }
    await sequelize.query(
      'DELETE FROM item_categories WHERE id = ?',
      { replacements: [req.params.id] }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// WIKI CATEGORIES
// =============================================================================
router.get('/wiki-categories', async (req, res, next) => {
  try {
    const cats = await WikiCategory.findAll({ order: [['sort_order', 'ASC']] });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
});

router.post('/wiki-categories', async (req, res, next) => {
  try {
    const slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const c = await WikiCategory.create(Object.assign({}, req.body, { slug }));
    res.status(201).json({ success: true, data: c });
  } catch (err) { next(err); }
});

router.put('/wiki-categories/:id', async (req, res, next) => {
  try {
    const c = await WikiCategory.findByPk(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    const updates = Object.assign({}, req.body);
    if (updates.name) {
      updates.slug = updates.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    await c.update(updates);
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
});

router.delete('/wiki-categories/:id', async (req, res, next) => {
  try {
    const used = await sequelize.models.WikiArticle.count({ where: { category_id: req.params.id } });
    if (used > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used + ' articles' });
    }
    await WikiCategory.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// WAREHOUSE LOCATIONS
// =============================================================================
router.get('/warehouse-locations', async (req, res, next) => {
  try {
    const [rows] = await sequelize.query('SELECT * FROM warehouse_locations ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.post('/warehouse-locations', async (req, res, next) => {
  try {
    const { name, code, description } = req.body;
    const [result] = await sequelize.query(
      'INSERT INTO warehouse_locations (name, code, description, is_active) VALUES (?, ?, ?, 1)',
      { replacements: [name, code, description || null] }
    );
    const [rows] = await sequelize.query(
      'SELECT * FROM warehouse_locations WHERE id = ?',
      { replacements: [result] }
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/warehouse-locations/:id', async (req, res, next) => {
  try {
    const { name, code, description, is_active } = req.body;
    await sequelize.query(
      'UPDATE warehouse_locations SET name=?, code=?, description=?, is_active=? WHERE id=?',
      { replacements: [name, code, description || null, is_active !== undefined ? is_active : 1, req.params.id] }
    );
    const [rows] = await sequelize.query(
      'SELECT * FROM warehouse_locations WHERE id = ?',
      { replacements: [req.params.id] }
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/warehouse-locations/:id', async (req, res, next) => {
  try {
    const [used] = await sequelize.query(
      'SELECT COUNT(*) as c FROM inventory_items WHERE location_id = ?',
      { replacements: [req.params.id] }
    );
    if (used[0].c > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete: used by ' + used[0].c + ' items' });
    }
    await sequelize.query(
      'DELETE FROM warehouse_locations WHERE id = ?',
      { replacements: [req.params.id] }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// =============================================================================
// TABLE CUSTOMIZATION
// =============================================================================
router.get('/schema/tables', async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT TABLE_NAME as table_name
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME ASC`
    );

    const data = rows
      .filter(r => CUSTOMIZABLE_TABLES.has(r.table_name))
      .map(r => ({ table_name: r.table_name }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/schema/tables/:table/columns', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    assertCustomizableTable(tableName);

    await ensureCustomizationPrefsTable();
    const columns = await getColumnMetadata(tableName);

    const [prefs] = await sequelize.query(
      `SELECT column_name, label, is_visible, display_order, width
       FROM ui_table_column_preferences
       WHERE table_name = ?`,
      { replacements: [tableName] }
    );

    const prefMap = new Map(prefs.map(p => [p.column_name, p]));

    const data = columns.map(col => {
      const pref = prefMap.get(col.column_name);
      return Object.assign({}, col, {
        label: pref ? pref.label : null,
        is_visible: pref ? !!pref.is_visible : true,
        display_order: pref ? Number(pref.display_order) : Number(col.ordinal_position),
        width: pref ? pref.width : null,
      });
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post('/schema/tables/:table/columns', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    assertCustomizableTable(tableName);

    const name = validateIdentifier(req.body.name, 'column');
    const after = req.body.after ? validateIdentifier(req.body.after, 'after column') : null;
    const nullable = req.body.nullable !== false;
    const columnTypeSql = buildColumnTypeSql(req.body.type, req.body.length);
    const nullSql = nullable ? 'NULL' : 'NOT NULL';
    const defaultSql = buildDefaultSql(req.body.defaultValue);
    const afterSql = after ? ' AFTER `' + after + '`' : '';

    await sequelize.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${name}\` ${columnTypeSql} ${nullSql} ${defaultSql}${afterSql}`
    );

    await ensureCustomizationPrefsTable();
    await sequelize.query(
      `INSERT INTO ui_table_column_preferences (table_name, column_name, label, is_visible, display_order)
       VALUES (?, ?, ?, 1, 999)
       ON DUPLICATE KEY UPDATE label = VALUES(label), is_visible = VALUES(is_visible)`,
      { replacements: [tableName, name, req.body.label || null] }
    );

    const columns = await getColumnMetadata(tableName);
    res.status(201).json({ success: true, data: columns.find(c => c.column_name === name) || null });
  } catch (err) { next(err); }
});

router.patch('/schema/tables/:table/columns/:column', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    assertCustomizableTable(tableName);

    const currentColumn = validateIdentifier(req.params.column, 'column');
    const newName = req.body.newName ? validateIdentifier(req.body.newName, 'new column') : currentColumn;

    if (SYSTEM_COLUMN_DENYLIST.has(currentColumn)) {
      return res.status(400).json({ success: false, message: 'System columns cannot be modified' });
    }

    const [existingRows] = await sequelize.query(
      `SELECT COLUMN_NAME, COLUMN_KEY, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      { replacements: [tableName, currentColumn] }
    );

    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: 'Column not found' });
    }

    const existing = existingRows[0];
    if (existing.COLUMN_KEY === 'PRI' || String(existing.EXTRA || '').includes('auto_increment')) {
      return res.status(400).json({ success: false, message: 'Primary key columns cannot be modified' });
    }

    const columnTypeSql = buildColumnTypeSql(req.body.type, req.body.length);
    const nullable = req.body.nullable !== false;
    const nullSql = nullable ? 'NULL' : 'NOT NULL';
    const defaultSql = buildDefaultSql(req.body.defaultValue);

    await sequelize.query(
      `ALTER TABLE \`${tableName}\` CHANGE COLUMN \`${currentColumn}\` \`${newName}\` ${columnTypeSql} ${nullSql} ${defaultSql}`
    );

    await ensureCustomizationPrefsTable();
    if (newName !== currentColumn) {
      await sequelize.query(
        `UPDATE ui_table_column_preferences
         SET column_name = ?
         WHERE table_name = ? AND column_name = ?`,
        { replacements: [newName, tableName, currentColumn] }
      );
    }

    if (req.body.label !== undefined) {
      await sequelize.query(
        `INSERT INTO ui_table_column_preferences (table_name, column_name, label, is_visible, display_order)
         VALUES (?, ?, ?, 1, 999)
         ON DUPLICATE KEY UPDATE label = VALUES(label)`,
        { replacements: [tableName, newName, req.body.label || null] }
      );
    }

    const columns = await getColumnMetadata(tableName);
    res.json({ success: true, data: columns.find(c => c.column_name === newName) || null });
  } catch (err) { next(err); }
});

router.delete('/schema/tables/:table/columns/:column', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    assertCustomizableTable(tableName);
    const column = validateIdentifier(req.params.column, 'column');

    if (SYSTEM_COLUMN_DENYLIST.has(column)) {
      return res.status(400).json({ success: false, message: 'System columns cannot be deleted' });
    }

    const [existingRows] = await sequelize.query(
      `SELECT COLUMN_NAME, COLUMN_KEY, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      { replacements: [tableName, column] }
    );

    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: 'Column not found' });
    }

    const existing = existingRows[0];
    if (existing.COLUMN_KEY === 'PRI' || String(existing.EXTRA || '').includes('auto_increment')) {
      return res.status(400).json({ success: false, message: 'Primary key columns cannot be deleted' });
    }

    await sequelize.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${column}\``);

    await ensureCustomizationPrefsTable();
    await sequelize.query(
      `DELETE FROM ui_table_column_preferences WHERE table_name = ? AND column_name = ?`,
      { replacements: [tableName, column] }
    );

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/schema/tables/:table/preferences', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    assertCustomizableTable(tableName);

    const columns = Array.isArray(req.body.columns) ? req.body.columns : [];
    await ensureCustomizationPrefsTable();

    for (const c of columns) {
      const colName = validateIdentifier(c.column_name, 'column');
      const order = Number.isFinite(Number(c.display_order)) ? Number(c.display_order) : 0;
      await sequelize.query(
        `INSERT INTO ui_table_column_preferences
          (table_name, column_name, label, is_visible, display_order, width)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          label = VALUES(label),
          is_visible = VALUES(is_visible),
          display_order = VALUES(display_order),
          width = VALUES(width)`,
        {
          replacements: [
            tableName,
            colName,
            c.label || null,
            c.is_visible === false ? 0 : 1,
            order,
            c.width || null,
          ]
        }
      );
    }

    const [prefs] = await sequelize.query(
      `SELECT column_name, label, is_visible, display_order, width
       FROM ui_table_column_preferences
       WHERE table_name = ?
       ORDER BY display_order ASC, column_name ASC`,
      { replacements: [tableName] }
    );

    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
});

module.exports = router;
