// =============================================================================
// routes/warehouse.routes.js — Enhanced Warehouse, Locations, Ledger & Reorder
// =============================================================================
const router = require('express').Router();
const { Op, literal, fn, col } = require('sequelize');
const {
  InventoryItem,
  StockMovement,
  ItemCategory,
  WarehouseLocation,
  Simulator,
  User,
  Role,
  sequelize,
  Notification,
  Task
} = require('../models');
const { broadcastOperationalAlert } = require('../services/proactive-alerts.service');
const { parseDateFilter } = require('../middleware/error.middleware');
const {
  validateInventoryItem,
  validateStockMovement,
  validateIdParam
} = require('../middleware/validation.middleware');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  computeReorderMetrics,
  sanitizeInventoryPayload,
  computeMovementTransition,
  buildInventorySortOrder,
  sanitizeBulkWarehouseAction,
  summarizeInventoryRows
} = require('../services/warehouse-helpers.service');

const ITEM_INCLUDES = [
  { model: ItemCategory, as: 'category', attributes: ['id', 'name', 'color'] },
  { model: WarehouseLocation, as: 'location', attributes: ['id', 'name', 'code', 'is_active'] },
  { model: Simulator, as: 'installedSimulator', attributes: ['id', 'bay_code', 'code', 'name'], required: false }
];

// ── Static routes MUST stay before /:id ──────────────────────────────────────

// GET /warehouse/categories — item categories for filters & modals
router.get('/categories', async (req, res, next) => {
  try {
    const cats = await ItemCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
});

// POST /warehouse/categories — quick-create warehouse category from form dropdown
router.post('/categories', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });
    const existing = await ItemCategory.findOne({ where: { name } });
    if (existing) return res.json({ success: true, data: existing });

    const colorRaw = String(req.body?.color || '#1565C0').trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '#1565C0';
    const description = String(req.body?.description || '').trim().slice(0, 500) || null;
    const created = await ItemCategory.create({ name, color, description });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

// GET /warehouse/locations — active (or all) warehouse storage locations
router.get('/locations', async (req, res, next) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const where = includeInactive ? {} : { is_active: true };
    const locations = await WarehouseLocation.findAll({
      where,
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: locations });
  } catch (err) { next(err); }
});

// POST /warehouse/locations — quick-create storage location from form dropdown
router.post('/locations', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: 'Location name is required.' });

    const rawCode = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const baseCode = (rawCode || name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'LOC').slice(0, 16);

    const byName = await WarehouseLocation.findOne({ where: { name } });
    if (byName) return res.json({ success: true, data: byName });

    let code = baseCode;
    let suffix = 1;
    while (await WarehouseLocation.findOne({ where: { code } })) {
      code = `${baseCode.slice(0, 14)}-${suffix++}`;
    }

    const description = String(req.body?.description || '').trim().slice(0, 500) || null;
    const created = await WarehouseLocation.create({ name, code, description, is_active: true });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

// GET /warehouse/suppliers — distinct active supplier names
router.get('/suppliers', async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT DISTINCT TRIM(supplier) AS supplier
       FROM inventory_items
       WHERE deleted_at IS NULL
         AND is_active = 1
         AND supplier IS NOT NULL
         AND TRIM(supplier) <> ''
       ORDER BY supplier ASC`
    );
    res.json({ success: true, data: rows.map(r => r.supplier) });
  } catch (err) { next(err); }
});

// GET /warehouse/summary — global DB KPIs, stock health & valuation breakdowns
router.get('/summary', async (req, res, next) => {
  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [items, movements7d] = await Promise.all([
      InventoryItem.findAll({
        where: { is_active: true },
        include: ITEM_INCLUDES
      }),
      StockMovement.count({
        where: { movement_date: { [Op.gte]: since7d } }
      })
    ]);

    const summary = summarizeInventoryRows(items.map(i => i.get({ plain: true })));
    const aogCriticalCount = items.filter(i => Boolean(i.aog_critical)).length;
    const aogCriticalLowCount = items.filter(
      i => Boolean(i.aog_critical) && (Number(i.quantity) || 0) <= Math.max(Number(i.reorder_point) || 0, Number(i.min_stock) || 0)
    ).length;
    const rotatableCount = items.filter(i => i.part_classification === 'ROTATABLE_LRU').length;
    const inRmaCount = items.filter(i => i.lru_status === 'IN_REPAIR_RMA' || i.lru_status === 'UNSERVICEABLE').length;
    const onOrderUnits = items.reduce((acc, i) => acc + (Number(i.on_order_qty) || 0), 0);
    const unserviceableUnits = items.reduce((acc, i) => acc + (Number(i.unserviceable_qty) || 0), 0);
    res.json({
      success: true,
      data: {
        ...summary,
        aog_critical_count: aogCriticalCount,
        aog_critical_low_count: aogCriticalLowCount,
        rotatable_count: rotatableCount,
        in_rma_count: inRmaCount,
        on_order_units: onOrderUnits,
        unserviceable_units: unserviceableUnits,
        movements_7d: movements7d
      }
    });
  } catch (err) { next(err); }
});

// GET /warehouse/movements — global stock movements ledger with filtering
router.get('/movements', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const {
      type,
      item_id,
      user_id,
      search,
      page = 1,
      limit = 25
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const baseWhere = {};
    if (from || to) {
      baseWhere.movement_date = {};
      if (from) baseWhere.movement_date[Op.gte] = from;
      if (to) baseWhere.movement_date[Op.lte] = to;
    }
    if (item_id && Number.isInteger(Number(item_id)) && Number(item_id) > 0) {
      baseWhere.item_id = Number(item_id);
    }
    if (user_id && Number.isInteger(Number(user_id)) && Number(user_id) > 0) {
      baseWhere.user_id = Number(user_id);
    }

    const trimmedSearch = String(search || '').trim();
    if (trimmedSearch) {
      const q = `%${trimmedSearch}%`;
      const matchedItems = await InventoryItem.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.like]: q } },
            { sku: { [Op.like]: q } },
            { part_number: { [Op.like]: q } }
          ]
        },
        attributes: ['id'],
        paranoid: false
      });
      const matchedIds = matchedItems.map(m => m.id);
      const orClauses = [
        { reference: { [Op.like]: q } },
        { reason: { [Op.like]: q } },
        { destination: { [Op.like]: q } }
      ];
      if (matchedIds.length) {
        orClauses.push({ item_id: { [Op.in]: matchedIds } });
      }
      baseWhere[Op.or] = orClauses;
    }

    const listWhere = { ...baseWhere };
    const normalizedType = String(type || '').trim().toUpperCase();
    if (normalizedType && normalizedType !== 'ALL') {
      listWhere.type = normalizedType;
    }

    const [{ count, rows }, groupedTypes] = await Promise.all([
      StockMovement.findAndCountAll({
        where: listWhere,
        include: [
          { model: InventoryItem, as: 'item', attributes: ['id', 'sku', 'name', 'unit', 'is_active'], paranoid: false },
          { model: Simulator, as: 'simulator', attributes: ['id', 'bay_code', 'code', 'name'], required: false },
          { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username'] }
        ],
        order: [['movement_date', 'DESC'], ['id', 'DESC']],
        limit: parsedLimit,
        offset: (parsedPage - 1) * parsedLimit
      }),
      StockMovement.findAll({
        attributes: ['type', [fn('COUNT', col('id')), 'cnt']],
        where: baseWhere,
        group: ['type'],
        raw: true
      })
    ]);

    const type_counts = { ALL: 0, IN: 0, OUT: 0, TRANSFER: 0, ADJUSTMENT: 0, RETURN: 0 };
    for (const row of groupedTypes) {
      const cnt = Number(row.cnt) || 0;
      if (row.type in type_counts) type_counts[row.type] = cnt;
      type_counts.ALL += cnt;
    }

    res.json({
      success: true,
      data: {
        movements: rows,
        total: count,
        type_counts
      }
    });
  } catch (err) { next(err); }
});

// GET /warehouse/reorder — low stock & out-of-stock replenishment planner queue
router.get('/reorder', async (req, res, next) => {
  try {
    const items = await InventoryItem.findAll({
      where: {
        is_active: true,
        [Op.and]: [
          literal('quantity <= GREATEST(COALESCE(reorder_point, 0), COALESCE(min_stock, 0))')
        ]
      },
      include: ITEM_INCLUDES
    });

    const rankMap = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    const enriched = items
      .map(item => {
        const plain = item.get({ plain: true });
        return {
          ...plain,
          reorder_metrics: computeReorderMetrics(plain)
        };
      })
      .sort((a, b) => {
        const ra = rankMap[a.reorder_metrics.urgency] ?? 9;
        const rb = rankMap[b.reorder_metrics.urgency] ?? 9;
        if (ra !== rb) return ra - rb;
        if (a.quantity !== b.quantity) return a.quantity - b.quantity;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

    const suppliersSet = new Set();
    let critical_count = 0;
    let total_deficit_units = 0;
    let total_estimated_cost = 0;

    for (const item of enriched) {
      if (item.reorder_metrics.urgency === 'CRITICAL') critical_count += 1;
      total_deficit_units += item.reorder_metrics.deficit;
      if (item.reorder_metrics.estimated_cost != null) {
        total_estimated_cost += item.reorder_metrics.estimated_cost;
      }
      if (item.supplier && String(item.supplier).trim()) {
        suppliersSet.add(String(item.supplier).trim());
      }
    }

    res.json({
      success: true,
      data: {
        items: enriched,
        totals: {
          items_count: enriched.length,
          critical_count,
          total_deficit_units,
          total_estimated_cost: Number(total_estimated_cost.toFixed(2)),
          suppliers_count: suppliersSet.size
        }
      }
    });
  } catch (err) { next(err); }
});

// PATCH /warehouse/bulk — bulk category/location assignment or deactivation
router.patch('/bulk', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { error, data } = sanitizeBulkWarehouseAction(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const { ids, action, value } = data;
    let updateFields = {};

    if (action === 'category') {
      const cat = await ItemCategory.findByPk(value);
      if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
      updateFields = { category_id: value };
    } else if (action === 'location') {
      if (value !== null) {
        const loc = await WarehouseLocation.findByPk(value);
        if (!loc) return res.status(404).json({ success: false, message: 'Location not found.' });
      }
      updateFields = { location_id: value };
    } else if (action === 'deactivate') {
      updateFields = { is_active: false };
    }

    const [affected] = await InventoryItem.update(updateFields, {
      where: { id: { [Op.in]: ids }, is_active: true }
    });

    res.json({ success: true, data: { affected, ids, action, value } });
  } catch (err) { next(err); }
});

// ── Collection & Item CRUD ───────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const {
      low_stock,
      stock_status,
      aog_critical,
      part_classification,
      subsystem_code,
      lru_status,
      page = 1,
      limit = 20,
      search,
      category_id,
      location_id,
      supplier,
      sort_by,
      sort_dir
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const where = { is_active: true };
    if (aog_critical === 'true') where.aog_critical = true;
    if (part_classification && String(part_classification).trim()) {
      where.part_classification = String(part_classification).trim().toUpperCase();
    }
    if (subsystem_code && String(subsystem_code).trim()) {
      where.subsystem_code = String(subsystem_code).trim().toUpperCase();
    }
    if (lru_status && String(lru_status).trim()) {
      where.lru_status = String(lru_status).trim().toUpperCase();
    }
    const andConditions = [];

    const effectiveStatus = String(stock_status || '').trim().toLowerCase();
    if (effectiveStatus === 'out') {
      andConditions.push(literal('quantity <= 0'));
    } else if (effectiveStatus === 'low') {
      andConditions.push(literal('quantity > 0 AND quantity <= GREATEST(COALESCE(reorder_point, 0), COALESCE(min_stock, 0))'));
    } else if (effectiveStatus === 'overstock') {
      andConditions.push(literal('max_stock IS NOT NULL AND max_stock > 0 AND quantity > max_stock'));
    } else if (effectiveStatus === 'healthy') {
      andConditions.push(literal('quantity > GREATEST(COALESCE(reorder_point, 0), COALESCE(min_stock, 0)) AND (max_stock IS NULL OR max_stock <= 0 OR quantity <= max_stock)'));
    } else if (low_stock === 'true') {
      andConditions.push(literal('quantity <= GREATEST(COALESCE(reorder_point, 0), COALESCE(min_stock, 0))'));
    }

    const trimmedSearch = String(search || '').trim();
    if (trimmedSearch) {
      const q = `%${trimmedSearch}%`;
      andConditions.push({
        [Op.or]: [
          { name: { [Op.like]: q } },
          { sku: { [Op.like]: q } },
          { part_number: { [Op.like]: q } },
          { serial_number: { [Op.like]: q } },
          { rma_reference: { [Op.like]: q } },
          { supplier: { [Op.like]: q } }
        ]
      });
    }

    if (category_id) where.category_id = +category_id;

    if (location_id === 'unassigned') {
      where.location_id = null;
    } else if (location_id && Number.isInteger(Number(location_id)) && Number(location_id) > 0) {
      where.location_id = Number(location_id);
    }

    if (supplier === '__unassigned__') {
      andConditions.push({
        [Op.or]: [{ supplier: null }, { supplier: '' }]
      });
    } else if (supplier && String(supplier).trim()) {
      where.supplier = String(supplier).trim();
    }

    if (andConditions.length) {
      where[Op.and] = andConditions;
    }

    const order = buildInventorySortOrder(sort_by, sort_dir, { ItemCategory, WarehouseLocation });

    const { count, rows } = await InventoryItem.findAndCountAll({
      where,
      include: ITEM_INCLUDES,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('admin', 'manager', 'tech'), validateInventoryItem, async (req, res, next) => {
  try {
    const { data, error } = sanitizeInventoryPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    if (data.location_id) {
      const loc = await WarehouseLocation.findByPk(data.location_id);
      if (!loc) return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    const created = await InventoryItem.create(data);
    const full = await InventoryItem.findByPk(created.id, { include: ITEM_INCLUDES });
    res.status(201).json({ success: true, data: full || created });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'tech'), validateIdParam, validateInventoryItem, async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    const { data, error } = sanitizeInventoryPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });
    // Prevent bypassing stock movement audit ledger via direct PUT quantity edits
    delete data.quantity;

    if (data.location_id) {
      const loc = await WarehouseLocation.findByPk(data.location_id);
      if (!loc) return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    await item.update(data);
    const full = await InventoryItem.findByPk(item.id, { include: ITEM_INCLUDES });
    res.json({ success: true, data: full || item });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    await item.update({ is_active: false });
    res.json({ success: true, data: { id: item.id, is_active: false } });
  } catch (err) { next(err); }
});

router.post('/:id/movement', authenticate, authorize('admin', 'manager', 'tech'), validateIdParam, validateStockMovement, async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    const item = await InventoryItem.findByPk(req.params.id, {
      include: [{ model: WarehouseLocation, as: 'location', attributes: ['id', 'name', 'code'] }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!item) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const { type, quantity, reference, reason, destination, to_location_id } = req.body;
    let targetLocation = null;
    if (to_location_id !== null && to_location_id !== undefined && to_location_id !== '') {
      targetLocation = await WarehouseLocation.findByPk(Number(to_location_id), { transaction });
      if (!targetLocation) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Destination warehouse location not found' });
      }
    }

    const fromLabel = item.location
      ? `${item.location.code} (${item.location.name})`
      : 'Unassigned';
    const toLabel = targetLocation
      ? `${targetLocation.code} (${targetLocation.name})`
      : null;

    const transition = computeMovementTransition({
      item,
      type,
      quantity,
      to_location_id,
      fromLocationLabel: fromLabel,
      toLocationLabel: toLabel,
      destination,
      reason
    });

    if (!transition.ok) {
      await transaction.rollback();
      return res.status(transition.status || 400).json({ success: false, message: transition.message });
    }

    const movement = await StockMovement.create({
      item_id: item.id,
      user_id: req.user.id,
      simulator_id: req.body?.simulator_id && Number.isInteger(Number(req.body.simulator_id)) ? Number(req.body.simulator_id) : null,
      maintenance_record_id: req.body?.maintenance_record_id && Number.isInteger(Number(req.body.maintenance_record_id)) ? Number(req.body.maintenance_record_id) : null,
      type,
      quantity: transition.stored_quantity,
      quantity_before: transition.qty_before,
      quantity_after: transition.qty_after,
      reference: reference ? String(reference).trim() : null,
      reason: transition.effective_reason,
      destination: transition.effective_destination
    }, { transaction });

    const itemUpdate = { quantity: transition.qty_after };
    if (transition.next_location_id !== undefined) {
      itemUpdate.location_id = transition.next_location_id;
    }
    if (req.body?.clear_on_order && type === 'IN') {
      const remainingOnOrder = Math.max(0, (Number(item.on_order_qty) || 0) - transition.stored_quantity);
      itemUpdate.on_order_qty = remainingOnOrder;
      if (remainingOnOrder === 0) {
        itemUpdate.expected_delivery_date = null;
      }
    }
    await item.update(itemUpdate, { transaction });

    await transaction.commit();

    // Automated Low Stock & AOG Warning (persisted first so emitted socket rows carry real id & created_at)
    const minStock = Number(item.min_stock) || 0;
    const reorderPoint = Number(item.reorder_point) || 0;
    const crossedMin = minStock > 0 && transition.qty_after < minStock && transition.qty_before >= minStock;
    const crossedReorder = reorderPoint > 0 && transition.qty_after <= reorderPoint && transition.qty_before > reorderPoint;
    const isAogAlert = Boolean(item.aog_critical) && (crossedMin || crossedReorder || transition.qty_after <= 0);

    if (crossedMin || crossedReorder || isAogAlert) {
      try {
        const staffToNotify = await User.findAll({
          where: { is_active: true },
          include: [{ model: Role, as: 'role', where: { name: { [Op.in]: ['admin', 'manager'] } }, required: true }],
          attributes: ['id']
        });
        const recipientIds = new Set(staffToNotify.map(u => Number(u.id)));
        if (req.user?.id) recipientIds.add(Number(req.user.id));

        const thresholdLimit = Math.max(minStock, reorderPoint);
        const notifType = isAogAlert ? 'AOG_SPARE_LOW' : 'LOW_STOCK';
        const notifTitle = isAogAlert
          ? `AOG Critical Spare Alert: ${item.sku}`
          : `Low Stock Warning: ${item.name}`;
        const notifBody = isAogAlert
          ? `"${item.name}" is at ${transition.qty_after} ${item.unit || 'pcs'} (threshold ${thresholdLimit}). Expedite procurement.`
          : `Stock for item "${item.name}" (SKU: ${item.sku}) is now at ${transition.qty_after}, at/below threshold (${thresholdLimit}).`;
        const notifLink = `/warehouse?search=${encodeURIComponent(item.sku)}`;

        const rowsToCreate = [...recipientIds].map(uid => ({
          user_id: uid,
          type: notifType,
          title: notifTitle,
          body: notifBody,
          link: notifLink
        }));

        const createdNotifications = await Notification.bulkCreate(rowsToCreate, { returning: true });

        if (crossedMin || crossedReorder) {
          await Task.create({
            created_by: req.user.id,
            title: `Restock Request: ${item.name}`,
            description: `Automated restock request: Inventory item "${item.name}" (SKU: ${item.sku}) requires replenishment.\n\nCurrent Stock: ${transition.qty_after} ${item.unit || 'pcs'}\nMin Stock: ${minStock}\nReorder Point: ${reorderPoint}`,
            status: 'TODO',
            priority: transition.qty_after <= 0 ? 'CRITICAL' : 'HIGH',
            due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
          });
        }

        const io = req.app.get('io');
        if (io) {
          createdNotifications.forEach(n => {
            const plain = typeof n.get === 'function' ? n.get({ plain: true }) : n;
            io.to(`user_${plain.user_id}`).emit('notification', plain);
          });
        }
      } catch (errCheck) {
        console.error('Failed to run automated low-stock warnings:', errCheck);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        movement,
        new_quantity: transition.qty_after,
        location_id: item.location_id,
        location: targetLocation || item.location || null
      }
    });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// POST /warehouse/:id/restock-task — create an operational restock task for an item
router.post('/:id/restock-task', authenticate, authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const item = await InventoryItem.findByPk(req.params.id, { include: ITEM_INCLUDES });
    if (!item || !item.is_active) {
      return res.status(404).json({ success: false, message: 'Active item not found' });
    }

    const plain = item.get({ plain: true });
    const metrics = computeReorderMetrics(plain);
    const locationLabel = plain.location ? `${plain.location.code} — ${plain.location.name}` : 'Unassigned';
    const costLine = metrics.estimated_cost != null ? `$${metrics.estimated_cost.toFixed(2)}` : 'N/A';

    const task = await Task.create({
      created_by: req.user.id,
      title: `Restock Request: ${plain.name} (${plain.sku})`,
      description: [
        `Replenishment order requested from Warehouse Reorder Planner.`,
        ``,
        `SKU: ${plain.sku}`,
        `Part Number: ${plain.part_number || '—'}`,
        `Category: ${plain.category?.name || '—'}`,
        `Location: ${locationLabel}`,
        `Supplier: ${plain.supplier || '—'}`,
        `Current Stock: ${plain.quantity} ${plain.unit || 'pcs'}`,
        `Target Stock: ${metrics.target_qty} ${plain.unit || 'pcs'}`,
        `Recommended Order Qty: ${metrics.deficit} ${plain.unit || 'pcs'}`,
        `Estimated Cost: ${costLine}`
      ].join('\n'),
      status: 'TODO',
      priority: plain.quantity <= 0 ? 'CRITICAL' : 'HIGH',
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    });

    res.status(201).json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.get('/:id/movements', validateIdParam, parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const rawLimit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : null;
    const limit = rawLimit && rawLimit > 0 ? Math.min(100, rawLimit) : undefined;

    const where = { item_id: req.params.id };
    if (from || to) {
      where.movement_date = {};
      if (from) where.movement_date[Op.gte] = from;
      if (to) where.movement_date[Op.lte] = to;
    }

    const movements = await StockMovement.findAll({
      where,
      order: [['movement_date', 'DESC'], ['id', 'DESC']],
      limit,
      include: [
        { model: Simulator, as: 'simulator', attributes: ['id', 'bay_code', 'code', 'name'], required: false },
        { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username'] }
      ]
    });
    res.json({ success: true, data: movements });
  } catch (err) { next(err); }
});

module.exports = router;
