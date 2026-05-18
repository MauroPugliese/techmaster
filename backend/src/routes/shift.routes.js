// =============================================================================
// routes/shift.routes.js  — FIXED: added DELETE /:id route
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { Shift, ShiftType, User } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { validateShift, validateIdParam } = require('../middleware/validation.middleware');

router.get('/types', async (req, res, next) => {
  try {
    const types = await ShiftType.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const { page = 1, limit = 100 } = req.query;
    const where = {};
    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from.toISOString().slice(0, 10);
      if (to)   where.date[Op.lte] = to.toISOString().slice(0, 10);
    }
    if (req.query.user_id) where.user_id = req.query.user_id;

    const offset = (+page - 1) * +limit;
    const { count, rows } = await Shift.findAndCountAll({
      where,
      include: [
        { model: ShiftType, as: 'shiftType' },
        { model: User, as: 'employee', attributes: ['id','first_name','last_name','department'] }
      ],
      order: [['date', 'ASC']],
      limit: +limit,
      offset
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', validateShift, async (req, res, next) => {
  try {
    const shift = await Shift.create(req.body);
    res.status(201).json({ success: true, data: shift });
  } catch (err) { next(err); }
});

router.put('/:id', validateIdParam, validateShift, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    await shift.update(req.body);
    res.json({ success: true, data: shift });
  } catch (err) { next(err); }
});

// ADDED: DELETE /:id — was completely missing
router.delete('/:id', async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    await shift.destroy();
    res.json({ success: true, message: 'Shift deleted' });
  } catch (err) { next(err); }
});

router.post('/:id/checkin', async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    await shift.update({ check_in: new Date(), status: 'IN_PROGRESS' });
    res.json({ success: true, data: shift });
  } catch (err) { next(err); }
});

router.post('/:id/checkout', async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    await shift.update({ check_out: new Date(), status: 'COMPLETED' });
    res.json({ success: true, data: shift });
  } catch (err) { next(err); }
});

module.exports = router;
