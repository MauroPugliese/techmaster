// =============================================================================
// routes/warehouse.routes.js  — FIXED:
//   • low_stock filter: replaced broken Op.col() with sequelize.literal()
//   • Added GET /categories so the frontend form can load item categories
// =============================================================================
const router = require('express').Router();
const { Op, literal } = require('sequelize');
const { InventoryItem, StockMovement, ItemCategory, User, sequelize, Notification, Task } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { validateInventoryItem, validateStockMovement, validateIdParam } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');

// GET /warehouse/categories — needed for the create/edit item form
router.get('/categories', async (req, res, next) => {
  try {
    const cats = await ItemCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { low_stock, page = 1, limit = 20, search } = req.query;
    const where = { is_active: true };

    // FIXED: Op.col() doesn't work in a plain where object.
    // Use sequelize.literal() for column-to-column comparisons.
    if (low_stock === 'true') {
      where[Op.and] = literal('quantity <= reorder_point');
    }
    if (search) where.name = { [Op.like]: `%${search}%` };

    const { count, rows } = await InventoryItem.findAndCountAll({
      where,
      limit: +limit,
      offset: (+page - 1) * +limit,
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', authenticate, validateInventoryItem, async (req, res, next) => {
  try {
    const item = await InventoryItem.create(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, validateIdParam, validateInventoryItem, async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    await item.update(req.body);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
});

router.post('/:id/movement', authenticate, validateIdParam, validateStockMovement, async (req, res, next) => {
  const { sequelize } = require('../models');
  const transaction = await sequelize.transaction();
  
  try {
    const item = await InventoryItem.findByPk(req.params.id, { transaction });
    if (!item) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const { type, quantity, reference, reason, destination } = req.body;
    const qty_before = item.quantity;
    let qty_after = qty_before;

    if (['IN','RETURN'].includes(type))        qty_after = qty_before + quantity;
    else if (['OUT','TRANSFER'].includes(type)) qty_after = qty_before - quantity;
    else if (type === 'ADJUSTMENT')            qty_after = quantity;

    if (qty_after < 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient stock' });
    }

    // Create movement and update item atomically within transaction
    const movement = await StockMovement.create({
      item_id: item.id, user_id: req.user.id, type, quantity,
      quantity_before: qty_before, quantity_after: qty_after,
      reference, reason, destination
    }, { transaction });
    
    await item.update({ quantity: qty_after }, { transaction });
    
    await transaction.commit();

    // Automated Low Stock Warning
    if (qty_after < item.min_stock && qty_before >= item.min_stock) {
      try {
        const staffToNotify = await User.findAll({
          where: { role_id: { [Op.in]: [1, 2] } }
        });
        const notifications = staffToNotify.map(u => ({
          user_id: u.id,
          type: 'LOW_STOCK',
          title: `Low Stock Warning: ${item.name}`,
          body: `Stock for item "${item.name}" (SKU: ${item.sku}) is now at ${qty_after}, below the minimum limit of ${item.min_stock}.`,
          link: `/warehouse?search=${item.sku}`
        }));

        if (!staffToNotify.some(u => u.id === req.user.id)) {
          notifications.push({
            user_id: req.user.id,
            type: 'LOW_STOCK',
            title: `Low Stock Warning: ${item.name}`,
            body: `Stock for item "${item.name}" (SKU: ${item.sku}) is now at ${qty_after}, below the minimum limit of ${item.min_stock}.`,
            link: `/warehouse?search=${item.sku}`
          });
        }
        await Notification.bulkCreate(notifications);

        await Task.create({
          created_by: req.user.id,
          category_id: 1, // General Infrastructure
          title: `Restock Request: ${item.name}`,
          description: `Automated restock request: Inventory item "${item.name}" (SKU: ${item.sku}) has fallen below minimum stock level.\n\nCurrent Stock: ${qty_after}\nMinimum Required: ${item.min_stock}`,
          status: 'TODO',
          priority: 'HIGH',
          due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        });

        // Emit real-time WebSocket notifications if active
        if (req.app.get('io')) {
          notifications.forEach(n => {
            req.app.get('io').to(`user_${n.user_id}`).emit('notification', n);
          });
        }
      } catch (errCheck) {
        console.error('Failed to run automated low-stock warnings:', errCheck);
      }
    }

    res.status(201).json({ success: true, data: { movement, new_quantity: qty_after } });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

router.get('/:id/movements', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = { item_id: req.params.id };
    if (from || to) {
      where.movement_date = {};
      if (from) where.movement_date[Op.gte] = from;
      if (to)   where.movement_date[Op.lte] = to;
    }
    const movements = await StockMovement.findAll({
      where,
      order: [['movement_date', 'DESC']],
      include: [{ model: User, as: 'user', attributes: ['id','first_name','last_name'] }]
    });
    res.json({ success: true, data: movements });
  } catch (err) { next(err); }
});

module.exports = router;
