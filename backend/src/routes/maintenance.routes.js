// =============================================================================
// routes/maintenance.routes.js — Work Orders, Assets & Stock Integration
// =============================================================================
const router = require('express').Router();
const { Op, col, where: sqlWhere } = require('sequelize');
const {
  MaintenanceRecord,
  Asset,
  AssetCategory,
  InventoryItem,
  StockMovement,
  User,
  sequelize
} = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { validateIdParam } = require('../middleware/validation.middleware');
const {
  sanitizeMaintenancePayload,
  sanitizeAssetPayload,
  sanitizeBulkMaintenanceAction,
  buildMaintenanceSortOrder,
  summarizeMaintenanceRows
} = require('../services/maintenance-helpers.service');

const RECORD_INCLUDES = [
  { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }] },
  { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name', 'username'] }
];

const ASSET_INCLUDES = [
  { model: AssetCategory, as: 'category' },
  { model: User, as: 'assignedUser', attributes: ['id', 'first_name', 'last_name', 'username'] }
];

// ── Static routes MUST stay BEFORE /:id ──────────────────────────────────────

// GET /maintenance/asset-categories — hardware/software/network asset categories
router.get('/asset-categories', async (req, res, next) => {
  try {
    const categories = await AssetCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
});

// GET /maintenance/assets — list assets with optional search/status/category & open maintenance count
router.get('/assets', async (req, res, next) => {
  try {
    const { include_retired, search, status, category_id } = req.query;
    const where = {};

    if (status) {
      where.status = String(status).toUpperCase();
    } else if (include_retired !== 'true') {
      where.status = { [Op.ne]: 'RETIRED' };
    }

    if (category_id && Number.isInteger(Number(category_id)) && Number(category_id) > 0) {
      where.category_id = Number(category_id);
    }

    const q = String(search || '').trim();
    if (q) {
      const like = `%${q}%`;
      where[Op.or] = [
        { name: { [Op.like]: like } },
        { serial_number: { [Op.like]: like } },
        { manufacturer: { [Op.like]: like } },
        { model: { [Op.like]: like } },
        { location: { [Op.like]: like } }
      ];
    }

    const [assets, [openRows]] = await Promise.all([
      Asset.findAll({
        where,
        include: ASSET_INCLUDES,
        order: [['name', 'ASC']]
      }),
      sequelize.query(
        `SELECT asset_id, COUNT(*) AS cnt
         FROM maintenance_records
         WHERE deleted_at IS NULL AND status IN ('SCHEDULED', 'IN_PROGRESS', 'DEFERRED')
         GROUP BY asset_id`
      ).catch(() => [[]])
    ]);

    const openMap = new Map(openRows.map(r => [Number(r.asset_id), Number(r.cnt) || 0]));
    const data = assets.map(a => ({
      ...a.get({ plain: true }),
      open_maintenance_count: openMap.get(Number(a.id)) || 0
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /maintenance/assets — create asset
router.post('/assets', async (req, res, next) => {
  try {
    const { data, error } = sanitizeAssetPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await Asset.create(data);
    const full = await Asset.findByPk(created.id, { include: ASSET_INCLUDES });
    res.status(201).json({ success: true, data: full || created });
  } catch (err) { next(err); }
});

// PUT /maintenance/assets/:id — update asset
router.put('/assets/:id', validateIdParam, async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const { data, error } = sanitizeAssetPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    await asset.update(data);
    const full = await Asset.findByPk(asset.id, { include: ASSET_INCLUDES });
    res.json({ success: true, data: full || asset });
  } catch (err) { next(err); }
});

// DELETE /maintenance/assets/:id — retire if referenced by records, otherwise delete
router.delete('/assets/:id', validateIdParam, async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const linkedCount = await MaintenanceRecord.count({
      where: { asset_id: asset.id },
      paranoid: false
    });

    if (linkedCount > 0) {
      await asset.update({ status: 'RETIRED' });
      return res.json({ success: true, data: { id: asset.id, retired: true } });
    }

    await asset.destroy();
    res.json({ success: true, data: { id: asset.id, retired: false } });
  } catch (err) { next(err); }
});

// GET /maintenance/summary — global DB KPI counts, overdue, total cost & downtime
router.get('/summary', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = {};
    if (from || to) {
      where.scheduled_date = {};
      if (from) where.scheduled_date[Op.gte] = from;
      if (to) where.scheduled_date[Op.lte] = to;
    }

    const rows = await MaintenanceRecord.findAll({
      where,
      attributes: ['id', 'status', 'scheduled_date', 'cost', 'downtime_hours']
    });

    res.json({
      success: true,
      data: summarizeMaintenanceRows(rows.map(r => r.get({ plain: true })))
    });
  } catch (err) { next(err); }
});

// PATCH /maintenance/bulk — bulk status, priority, or soft-delete
router.patch('/bulk', async (req, res, next) => {
  try {
    const { data, error } = sanitizeBulkMaintenanceAction(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const { ids, action, value } = data;
    let affected = 0;

    if (action === 'status') {
      const updateFields = { status: value };
      if (value === 'COMPLETED') {
        updateFields.completed_date = new Date();
      }
      const [count] = await MaintenanceRecord.update(updateFields, {
        where: { id: { [Op.in]: ids } }
      });
      affected = count;
    } else if (action === 'priority') {
      const [count] = await MaintenanceRecord.update(
        { priority: value },
        { where: { id: { [Op.in]: ids } } }
      );
      affected = count;
    } else if (action === 'delete') {
      affected = await MaintenanceRecord.destroy({ where: { id: { [Op.in]: ids } } });
    }

    res.json({ success: true, data: { affected, ids, action, value } });
  } catch (err) { next(err); }
});

// ── Maintenance Work Orders CRUD ─────────────────────────────────────────────

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const {
      status,
      priority,
      type,
      asset_id,
      search,
      sort_by,
      sort_dir,
      page = 1,
      limit = 20
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const where = {};
    const andConditions = [];

    if (from || to) {
      where.scheduled_date = {};
      if (from) where.scheduled_date[Op.gte] = from;
      if (to) where.scheduled_date[Op.lte] = to;
    }

    const normalizedStatus = String(status || '').trim().toUpperCase();
    if (normalizedStatus === 'OVERDUE') {
      andConditions.push({
        status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] },
        scheduled_date: { [Op.lt]: new Date() }
      });
    } else if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    if (priority) where.priority = String(priority).trim().toUpperCase();
    if (type) where.type = String(type).trim().toUpperCase();
    if (asset_id && Number.isInteger(Number(asset_id)) && Number(asset_id) > 0) {
      where.asset_id = Number(asset_id);
    }

    if (search?.trim()) {
      const searchTerm = `%${search.trim()}%`;
      andConditions.push({
        [Op.or]: [
          { title: { [Op.like]: searchTerm } },
          { description: { [Op.like]: searchTerm } },
          { findings: { [Op.like]: searchTerm } },
          sqlWhere(col('asset.name'), { [Op.like]: searchTerm }),
          sqlWhere(col('asset.serial_number'), { [Op.like]: searchTerm })
        ]
      });
    }

    if (andConditions.length) {
      where[Op.and] = andConditions;
    }

    const order = buildMaintenanceSortOrder(sort_by, sort_dir, { Asset, User });

    const { count, rows } = await MaintenanceRecord.findAndCountAll({
      where,
      distinct: true,
      subQuery: false,
      include: RECORD_INCLUDES,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const shouldDeduct = req.body?.deduct_stock === true && Array.isArray(req.body?.parts_used) && req.body.parts_used.length > 0;
  const transaction = shouldDeduct ? await sequelize.transaction() : null;

  try {
    const { data, error } = sanitizeMaintenancePayload(req.body, { isCreate: true });
    if (error) {
      if (transaction) await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const rec = await MaintenanceRecord.create(
      { ...data, performed_by: req.user.id },
      transaction ? { transaction } : undefined
    );

    if (shouldDeduct && data.parts_used?.length) {
      for (const part of data.parts_used) {
        if (!part.item_id) continue;
        const item = await InventoryItem.findByPk(part.item_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!item) {
          await transaction.rollback();
          return res.status(404).json({ success: false, message: `Warehouse item #${part.item_id} not found.` });
        }
        const qtyBefore = Number(item.quantity) || 0;
        const qtyAfter = qtyBefore - part.quantity;
        if (qtyAfter < 0) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient warehouse stock for "${item.name}" (${item.sku}): available ${qtyBefore}, requested ${part.quantity}.`
          });
        }
        await StockMovement.create({
          item_id: item.id,
          user_id: req.user.id,
          type: 'OUT',
          quantity: part.quantity,
          quantity_before: qtyBefore,
          quantity_after: qtyAfter,
          reference: `MAINT-#${rec.id}`,
          reason: `Used in maintenance: ${rec.title}`
        }, { transaction });
        await item.update({ quantity: qtyAfter }, { transaction });
      }
    }

    if (transaction) await transaction.commit();

    const full = await MaintenanceRecord.findByPk(rec.id, { include: RECORD_INCLUDES });
    res.status(201).json({ success: true, data: full || rec });
  } catch (err) {
    if (transaction) await transaction.rollback();
    next(err);
  }
});

router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id, { include: RECORD_INCLUDES });
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rec });
  } catch (err) { next(err); }
});

router.put('/:id', validateIdParam, async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });

    const { data, error } = sanitizeMaintenancePayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    const previousStatus = rec.status;
    await rec.update(data);

    // Cyclic maintenance: auto-generate next scheduled record upon completion
    if (rec.status === 'COMPLETED' && previousStatus !== 'COMPLETED' && rec.next_scheduled) {
      const alreadyScheduled = await MaintenanceRecord.findOne({
        where: {
          asset_id: rec.asset_id,
          scheduled_date: rec.next_scheduled,
          status: 'SCHEDULED'
        }
      });

      if (!alreadyScheduled) {
        await MaintenanceRecord.create({
          asset_id: rec.asset_id,
          performed_by: rec.performed_by || req.user.id,
          type: rec.type,
          title: rec.title,
          description: `Automatically generated recurring maintenance record following the completion of task #${rec.id}.\n\nOriginal description: ${rec.description}`,
          status: 'SCHEDULED',
          priority: rec.priority,
          scheduled_date: rec.next_scheduled,
          cost: 0.00,
          parts_used: []
        });
      }
    }

    const full = await MaintenanceRecord.findByPk(rec.id, { include: RECORD_INCLUDES });
    res.json({ success: true, data: full || rec });
  } catch (err) { next(err); }
});

router.delete('/:id', validateIdParam, async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    await rec.destroy();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
