// =============================================================================
// routes/maintenance.routes.js  — FIXED
//
// Bug fixes:
//  1. Moved GET /assets and POST /assets BEFORE the /:id routes
//     (Express matches routes in order — if /:id came first, "assets" string
//      would be treated as an id on any future GET /:id route)
//  2. Added GET /:id to retrieve a single record (was missing)
// =============================================================================
const router = require('express').Router();
const { Op }  = require('sequelize');
const { MaintenanceRecord, Asset, AssetCategory, User } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');

// ── Asset sub-routes  ← MOVED BEFORE /:id to avoid route shadowing ──────────

router.get('/assets', async (req, res, next) => {
  try {
    const assets = await Asset.findAll({
      where: { status: { [Op.ne]: 'RETIRED' } },   // hide retired assets
      include: [{ model: AssetCategory, as: 'category' }],
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: assets });
  } catch (err) { next(err); }
});

router.post('/assets', async (req, res, next) => {
  try {
    const asset = await Asset.create(req.body);
    res.status(201).json({ success: true, data: asset });
  } catch (err) { next(err); }
});

// ── Maintenance records ───────────────────────────────────────────────────────

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const { status, priority, asset_id, page = 1, limit = 20 } = req.query;
    const where = {};
    if (from || to) {
      where.scheduled_date = {};
      if (from) where.scheduled_date[Op.gte] = from;
      if (to)   where.scheduled_date[Op.lte] = to;
    }
    if (status)   where.status   = status;
    if (priority) where.priority = priority;
    if (asset_id) where.asset_id = asset_id;

    const { count, rows } = await MaintenanceRecord.findAndCountAll({
      where,
      include: [
        { model: Asset,  as: 'asset',      include: [{ model: AssetCategory, as: 'category' }] },
        { model: User,   as: 'technician', attributes: ['id','first_name','last_name'] }
      ],
      limit: +limit, offset: (+page-1)*+limit,
      order: [['scheduled_date', 'ASC']]
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.create({
      ...req.body,
      performed_by: req.user.id
    });
    res.status(201).json({ success: true, data: rec });
  } catch (err) { next(err); }
});

// ADDED: GET /:id — retrieve single record
router.get('/:id', async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id, {
      include: [
        { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }] },
        { model: User,  as: 'technician', attributes: ['id','first_name','last_name'] }
      ]
    });
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rec });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    
    const previousStatus = rec.status;
    await rec.update(req.body);

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

    res.json({ success: true, data: rec });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await MaintenanceRecord.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
