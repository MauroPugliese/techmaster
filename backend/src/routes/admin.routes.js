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

module.exports = router;
