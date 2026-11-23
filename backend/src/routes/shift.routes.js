// =============================================================================
// routes/shift.routes.js — Shifts, Custom Hours, Leave, Bulk & Types CRUD
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { Shift, ShiftType, User } = require('../models');
const { authorize } = require('../middleware/auth.middleware');
const { parseDateFilter } = require('../middleware/error.middleware');
const { validateIdParam } = require('../middleware/validation.middleware');
const {
  VALID_STATUSES,
  VALID_ENTRY_KINDS,
  isValidIsoDate,
  resolveEffectiveTiming,
  sanitizeShiftPayload,
  checkLaborLawCompliance,
  sanitizeShiftTypePayload,
  expandDateSelection,
} = require('../services/shift-schedule.service');

const EMPLOYEE_ATTRS = ['id', 'first_name', 'last_name', 'department', 'job_title', 'avatar_url'];
const SUPERVISOR_ATTRS = ['id', 'first_name', 'last_name'];

function buildShiftInclude(department) {
  const employeeInclude = { model: User, as: 'employee', attributes: EMPLOYEE_ATTRS };
  if (department) {
    employeeInclude.where = { department };
    employeeInclude.required = true;
  }
  return [
    { model: ShiftType, as: 'shiftType' },
    employeeInclude,
    { model: User, as: 'supervisor', attributes: SUPERVISOR_ATTRS },
  ];
}

async function clearSoftDeletedTombstone(userId, date) {
  const tombstone = await Shift.findOne({
    where: { user_id: userId, date },
    paranoid: false,
  });
  if (tombstone && tombstone.deleted_at) {
    await tombstone.destroy({ force: true });
  }
}

async function validateLaborLawForUser(userId, shiftType, dateStr, proposedData, excludeShiftId = null) {
  const timing = resolveEffectiveTiming(proposedData, shiftType);
  if (timing.isLeave) {
    return { valid: true };
  }

  const parsedDate = new Date(`${dateStr}T00:00:00Z`);
  const dateBefore = new Date(parsedDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateAfter = new Date(parsedDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const whereClause = {
    user_id: userId,
    date: { [Op.between]: [dateBefore, dateAfter] },
  };
  if (excludeShiftId) {
    whereClause.id = { [Op.ne]: excludeShiftId };
  }

  const nearbyShifts = await Shift.findAll({
    where: whereClause,
    include: [{ model: ShiftType, as: 'shiftType' }],
  });

  return checkLaborLawCompliance(
    {
      date: dateStr,
      start_time: timing.effective_start_time,
      end_time: timing.effective_end_time,
      isLeave: false,
    },
    nearbyShifts
  );
}

async function hydrateShift(id) {
  return Shift.findByPk(id, { include: buildShiftInclude() });
}

async function upsertSingleShift({ body, shiftType, overwrite = false }) {
  const sanitized = sanitizeShiftPayload(body, shiftType, { isCreate: true });
  if (sanitized.error) {
    return { outcome: 'error', statusCode: 400, message: sanitized.error };
  }

  const { data } = sanitized;
  const existingActive = await Shift.findOne({
    where: { user_id: data.user_id, date: data.date },
  });

  if (existingActive && !overwrite) {
    return {
      outcome: 'conflict',
      statusCode: 409,
      message: `Employee already has a shift scheduled on ${data.date}`,
    };
  }

  const lawCheck = await validateLaborLawForUser(
    data.user_id,
    shiftType,
    data.date,
    data,
    existingActive ? existingActive.id : null
  );
  if (!lawCheck.valid) {
    return { outcome: 'error', statusCode: 400, message: lawCheck.message };
  }

  if (existingActive && overwrite) {
    await existingActive.update(data);
    return { outcome: 'updated', shift: await hydrateShift(existingActive.id) };
  }

  await clearSoftDeletedTombstone(data.user_id, data.date);
  const created = await Shift.create(data);
  return { outcome: 'created', shift: await hydrateShift(created.id) };
}

function addDaysToIsoDate(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// ── Shift Types CRUD ──────────────────────────────────────────────────────────
router.get('/types', async (req, res, next) => {
  try {
    const types = await ShiftType.findAll({ order: [['category', 'ASC'], ['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

router.post('/types', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const sanitized = sanitizeShiftTypePayload(req.body, { isCreate: true });
    if (sanitized.error) {
      return res.status(400).json({ success: false, message: sanitized.error });
    }

    const dup = await ShiftType.findOne({ where: { code: sanitized.data.code } });
    if (dup) {
      return res.status(409).json({ success: false, message: `Shift type code "${sanitized.data.code}" already exists` });
    }

    const created = await ShiftType.create(sanitized.data);
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

router.put('/types/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const shiftType = await ShiftType.findByPk(req.params.id);
    if (!shiftType) {
      return res.status(404).json({ success: false, message: 'Shift type not found' });
    }

    const sanitized = sanitizeShiftTypePayload(req.body, { isCreate: false, existing: shiftType });
    if (sanitized.error) {
      return res.status(400).json({ success: false, message: sanitized.error });
    }

    if (sanitized.data.code !== shiftType.code) {
      const dup = await ShiftType.findOne({
        where: { code: sanitized.data.code, id: { [Op.ne]: shiftType.id } },
      });
      if (dup) {
        return res.status(409).json({ success: false, message: `Shift type code "${sanitized.data.code}" already exists` });
      }
    }

    await shiftType.update(sanitized.data);
    res.json({ success: true, data: shiftType });
  } catch (err) { next(err); }
});

router.delete('/types/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const shiftType = await ShiftType.findByPk(req.params.id);
    if (!shiftType) {
      return res.status(404).json({ success: false, message: 'Shift type not found' });
    }

    const used = await Shift.count({ where: { shift_type_id: shiftType.id }, paranoid: false });
    if (used > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete shift type "${shiftType.name}": used by ${used} shift record(s)`,
      });
    }

    await shiftType.destroy();
    res.json({ success: true, message: 'Shift type deleted' });
  } catch (err) { next(err); }
});

// ── Active Roster Employees ──────────────────────────────────────────────────
router.get('/employees', async (req, res, next) => {
  try {
    const { page = 1, limit = 200, search, department } = req.query;
    const safeLimit = Math.min(Math.max(+limit || 200, 1), 500);
    const safePage = Math.max(+page || 1, 1);

    const where = { is_active: true };
    if (department) where.department = department;
    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { first_name: { [Op.like]: term } },
        { last_name: { [Op.like]: term } },
        { department: { [Op.like]: term } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: EMPLOYEE_ATTRS,
      order: [['first_name', 'ASC'], ['last_name', 'ASC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

// ── Shift Queries & Mutations ────────────────────────────────────────────────
router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { page = 1, limit = 500, user_id, user_ids, shift_type_id, status, entry_kind, department } = req.query;
    const safeLimit = Math.min(Math.max(+limit || 500, 1), 2000);
    const safePage = Math.max(+page || 1, 1);

    const fromVal = req.query.from ? new Date(req.query.from) : req.dateRange.from;
    const toVal = req.query.to ? new Date(req.query.to) : req.dateRange.to;

    const where = {};
    if (fromVal || toVal) {
      where.date = {};
      if (fromVal && !Number.isNaN(fromVal.getTime())) where.date[Op.gte] = fromVal.toISOString().slice(0, 10);
      if (toVal && !Number.isNaN(toVal.getTime())) where.date[Op.lte] = toVal.toISOString().slice(0, 10);
    }

    if (user_id) {
      where.user_id = Number(user_id);
    } else if (user_ids) {
      const parsedIds = String(user_ids)
        .split(',')
        .map(v => Number(v.trim()))
        .filter(n => Number.isInteger(n) && n > 0);
      if (parsedIds.length) {
        where.user_id = { [Op.in]: parsedIds };
      }
    }

    if (shift_type_id) where.shift_type_id = Number(shift_type_id);
    if (status && VALID_STATUSES.includes(String(status).toUpperCase())) {
      where.status = String(status).toUpperCase();
    }
    if (entry_kind && VALID_ENTRY_KINDS.includes(String(entry_kind).toUpperCase())) {
      where.entry_kind = String(entry_kind).toUpperCase();
    }

    const { count, rows } = await Shift.findAndCountAll({
      where,
      include: buildShiftInclude(department),
      order: [['date', 'ASC'], ['id', 'ASC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const shiftType = req.body.shift_type_id ? await ShiftType.findByPk(req.body.shift_type_id) : null;
    if (!shiftType) {
      return res.status(400).json({ success: false, message: 'Valid shift_type_id required' });
    }

    const result = await upsertSingleShift({ body: req.body, shiftType, overwrite: false });
    if (result.outcome !== 'created') {
      return res.status(result.statusCode || 400).json({ success: false, message: result.message });
    }

    res.status(201).json({ success: true, data: result.shift });
  } catch (err) { next(err); }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const {
      user_id,
      shift_type_id,
      date,
      dates,
      start_date,
      end_date,
      skip_weekends = false,
      overwrite = false,
    } = req.body || {};

    const shiftType = shift_type_id ? await ShiftType.findByPk(shift_type_id) : null;
    if (!shiftType) {
      return res.status(400).json({ success: false, message: 'Valid shift_type_id required' });
    }

    const expanded = expandDateSelection({ date, dates, start_date, end_date, skip_weekends });
    if (expanded.error) {
      return res.status(400).json({ success: false, message: expanded.error });
    }

    const created = [];
    const updated = [];
    const skipped = [];

    for (const targetDate of expanded.dates) {
      const dayPayload = { ...req.body, user_id, shift_type_id, date: targetDate };
      const result = await upsertSingleShift({ body: dayPayload, shiftType, overwrite: Boolean(overwrite) });

      if (result.outcome === 'created') created.push(result.shift);
      else if (result.outcome === 'updated') updated.push(result.shift);
      else skipped.push({ date: targetDate, reason: result.message });
    }

    if (created.length === 0 && updated.length === 0 && skipped.length > 0) {
      return res.status(400).json({
        success: false,
        message: skipped[0].reason,
        data: { created, updated, skipped },
      });
    }

    res.status(201).json({
      success: true,
      data: {
        created,
        updated,
        skipped,
        createdCount: created.length,
        updatedCount: updated.length,
        skippedCount: skipped.length,
      },
    });
  } catch (err) { next(err); }
});

router.post('/copy-week', async (req, res, next) => {
  try {
    const {
      source_from,
      source_to,
      target_from,
      include_leave = false,
      overwrite = false,
      user_ids,
    } = req.body || {};

    if (!isValidIsoDate(source_from) || !isValidIsoDate(source_to) || !isValidIsoDate(target_from)) {
      return res.status(400).json({
        success: false,
        message: 'Valid source_from, source_to, and target_from (YYYY-MM-DD) dates are required',
      });
    }

    const sourceStartMs = new Date(`${source_from}T00:00:00Z`).getTime();
    const targetStartMs = new Date(`${target_from}T00:00:00Z`).getTime();
    const dayShiftDelta = Math.round((targetStartMs - sourceStartMs) / (1000 * 60 * 60 * 24));

    const where = {
      date: { [Op.between]: [source_from, source_to] },
    };
    if (Array.isArray(user_ids) && user_ids.length > 0) {
      const validIds = user_ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
      if (validIds.length) where.user_id = { [Op.in]: validIds };
    }

    const sourceShifts = await Shift.findAll({
      where,
      include: [{ model: ShiftType, as: 'shiftType' }],
      order: [['date', 'ASC'], ['user_id', 'ASC']],
    });

    if (!sourceShifts.length) {
      return res.status(400).json({
        success: false,
        message: 'No shifts found in the source week to copy',
      });
    }

    const created = [];
    const updated = [];
    const skipped = [];

    for (const src of sourceShifts) {
      const isLeave = src.entry_kind === 'LEAVE' || src.status === 'ON_LEAVE' || src.shiftType?.category === 'LEAVE';
      if (isLeave && !include_leave) {
        skipped.push({
          date: addDaysToIsoDate(src.date, dayShiftDelta),
          user_id: src.user_id,
          reason: 'Leave entry skipped',
        });
        continue;
      }

      const targetDate = addDaysToIsoDate(src.date, dayShiftDelta);
      const copyBody = {
        user_id: src.user_id,
        shift_type_id: src.shift_type_id,
        supervisor_id: src.supervisor_id,
        date: targetDate,
        entry_kind: src.entry_kind,
        leave_type: src.leave_type,
        custom_start_time: src.custom_start_time,
        custom_end_time: src.custom_end_time,
        status: isLeave ? 'ON_LEAVE' : 'SCHEDULED',
        overtime_hours: src.overtime_hours,
        adjustment_reason: src.adjustment_reason,
        notes: src.notes,
      };

      const result = await upsertSingleShift({
        body: copyBody,
        shiftType: src.shiftType,
        overwrite: Boolean(overwrite),
      });

      if (result.outcome === 'created') created.push(result.shift);
      else if (result.outcome === 'updated') updated.push(result.shift);
      else skipped.push({ date: targetDate, user_id: src.user_id, reason: result.message });
    }

    res.json({
      success: true,
      data: {
        createdCount: created.length,
        updatedCount: updated.length,
        skippedCount: skipped.length,
        skipped,
      },
    });
  } catch (err) { next(err); }
});

router.put('/:id', validateIdParam, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });

    const targetTypeId = req.body.shift_type_id || shift.shift_type_id;
    const shiftType = await ShiftType.findByPk(targetTypeId);
    if (!shiftType) {
      return res.status(400).json({ success: false, message: 'Valid shift_type_id required' });
    }

    const sanitized = sanitizeShiftPayload(req.body, shiftType, { isCreate: false, existing: shift });
    if (sanitized.error) {
      return res.status(400).json({ success: false, message: sanitized.error });
    }

    const { data } = sanitized;

    if (data.user_id !== shift.user_id || data.date !== shift.date) {
      const collision = await Shift.findOne({
        where: {
          user_id: data.user_id,
          date: data.date,
          id: { [Op.ne]: shift.id },
        },
      });
      if (collision) {
        return res.status(409).json({
          success: false,
          message: `Employee already has a shift scheduled on ${data.date}`,
        });
      }
      await clearSoftDeletedTombstone(data.user_id, data.date);
    }

    const lawCheck = await validateLaborLawForUser(data.user_id, shiftType, data.date, data, shift.id);
    if (!lawCheck.valid) {
      return res.status(400).json({ success: false, message: lawCheck.message });
    }

    await shift.update(data);
    res.json({ success: true, data: await hydrateShift(shift.id) });
  } catch (err) { next(err); }
});

router.delete('/:id', validateIdParam, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    await shift.destroy();
    res.json({ success: true, message: 'Shift deleted' });
  } catch (err) { next(err); }
});

router.post('/:id/checkin', validateIdParam, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    if (shift.entry_kind === 'LEAVE' || shift.status === 'ON_LEAVE') {
      return res.status(400).json({ success: false, message: 'Cannot check in to a leave entry' });
    }
    await shift.update({ check_in: new Date(), status: 'IN_PROGRESS' });
    res.json({ success: true, data: await hydrateShift(shift.id) });
  } catch (err) { next(err); }
});

router.post('/:id/checkout', validateIdParam, async (req, res, next) => {
  try {
    const shift = await Shift.findByPk(req.params.id);
    if (!shift) return res.status(404).json({ success: false, message: 'Not found' });
    if (shift.entry_kind === 'LEAVE' || shift.status === 'ON_LEAVE') {
      return res.status(400).json({ success: false, message: 'Cannot check out of a leave entry' });
    }
    await shift.update({ check_out: new Date(), status: 'COMPLETED' });
    res.json({ success: true, data: await hydrateShift(shift.id) });
  } catch (err) { next(err); }
});

module.exports = router;
