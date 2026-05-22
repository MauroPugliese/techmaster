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

// Helper to get start and end Datetime objects for a shift (handling midnight cross)
function getShiftInterval(dateStr, start_time, end_time) {
  const start = new Date(`${dateStr}T${start_time}Z`);
  let end = new Date(`${dateStr}T${end_time}Z`);
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

// Validator for labor law compliance (no overlap, minimum 11h rest)
const validateLaborLaw = async (userId, shiftTypeId, dateStr, excludeShiftId = null) => {
  const proposedType = await ShiftType.findByPk(shiftTypeId);
  if (!proposedType) {
    return { valid: false, message: 'Invalid shift type ID' };
  }

  const { start: pStart, end: pEnd } = getShiftInterval(dateStr, proposedType.start_time, proposedType.end_time);

  // Check shifts +/- 2 days around proposed shift
  const parsedDate = new Date(dateStr);
  const dateBefore = new Date(parsedDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateAfter = new Date(parsedDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const whereClause = {
    user_id: userId,
    date: { [Op.between]: [dateBefore, dateAfter] }
  };
  if (excludeShiftId) {
    whereClause.id = { [Op.ne]: excludeShiftId };
  }

  const existingShifts = await Shift.findAll({
    where: whereClause,
    include: [{ model: ShiftType, as: 'shiftType' }]
  });

  for (const s of existingShifts) {
    if (!s.shiftType) continue;
    const { start: eStart, end: eEnd } = getShiftInterval(s.date, s.shiftType.start_time, s.shiftType.end_time);

    // 1. Check for overlapping shifts
    if (pStart < eEnd && eStart < pEnd) {
      return {
        valid: false,
        message: `Labor Law Violation: Overlaps with existing "${s.shiftType.name}" shift on ${s.date} (${s.shiftType.start_time} - ${s.shiftType.end_time}).`
      };
    }

    // 2. Check 11-hour rest period rule
    const restBefore = (eStart.getTime() - pEnd.getTime()) / (1000 * 60 * 60);
    const restAfter = (pStart.getTime() - eEnd.getTime()) / (1000 * 60 * 60);

    if (pStart >= eEnd && restAfter < 11.0) {
      return {
        valid: false,
        message: `Labor Law Violation: Insufficient rest period. Only ${restAfter.toFixed(1)}h rest between shift ending ${s.date} ${s.shiftType.end_time} and proposed shift starting ${dateStr} ${proposedType.start_time}. Minimum required is 11 hours.`
      };
    }

    if (eStart >= pEnd && restBefore < 11.0) {
      return {
        valid: false,
        message: `Labor Law Violation: Insufficient rest period. Only ${restBefore.toFixed(1)}h rest between proposed shift ending ${dateStr} ${proposedType.end_time} and next shift starting ${s.date} ${s.shiftType.start_time}. Minimum required is 11 hours.`
      };
    }
  }

  return { valid: true };
};

router.post('/', validateShift, async (req, res, next) => {
  try {
    const { user_id, shift_type_id, date } = req.body;
    
    // Check labor laws
    const validation = await validateLaborLaw(user_id, shift_type_id, date);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const shift = await Shift.create(req.body);
    res.status(201).json({ success: true, data: shift });
  } catch (err) { next(err); }
});

router.put('/:id', validateIdParam, validateShift, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });

    const { user_id, shift_type_id, date } = req.body;
    
    // Check labor laws
    const validation = await validateLaborLaw(user_id || shift.user_id, shift_type_id || shift.shift_type_id, date || shift.date, shift.id);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

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
