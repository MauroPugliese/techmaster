// =============================================================================
// routes/operation.routes.js  — FIXED: added GET /types route
// =============================================================================
const router = require('express').Router();
const { Op }  = require('sequelize');
const { Operation, OperationType, User } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');

// ── GET /operations/types  ← ADDED (was missing, broke the type dropdown)
router.get('/types', async (req, res, next) => {
  try {
    const types = await OperationType.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const { status, priority, page = 1, limit = 20 } = req.query;
    const where = {};
    if (from || to) {
      where.start_date = {};
      if (from) where.start_date[Op.gte] = from;
      if (to)   where.start_date[Op.lte] = to;
    }
    if (status)   where.status   = status;
    if (priority) where.priority = priority;

    const { count, rows } = await Operation.findAndCountAll({
      where,
      include: [
        { model: OperationType, as: 'type' },
        { model: User, as: 'creator', attributes: ['id','first_name','last_name','avatar_url'] }
      ],
      limit: +limit, offset: (+page - 1) * +limit,
      order: [['start_date','DESC']]
    });
    res.json({ success: true, data: { items: rows, total: count, page: +page, limit: +limit } });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const op = await Operation.create({ ...req.body, created_by: req.user.id });
    res.status(201).json({ success: true, data: op });
  } catch (err) { next(err); }
});

// NOTE: /:id routes MUST come after named routes like /types
router.get('/:id', async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, {
      include: [
        { model: OperationType, as: 'type' },
        { model: User, as: 'creator', attributes: ['id','first_name','last_name'] }
      ]
    });
    if (!op) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: op });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id);
    if (!op) return res.status(404).json({ success: false, message: 'Not found' });
    await op.update(req.body);
    res.json({ success: true, data: op });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Operation.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
