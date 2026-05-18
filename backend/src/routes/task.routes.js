// =============================================================================
// routes/task.routes.js  — FIXED: added GET /:id (needed by addSubtaskToEditing)
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, User } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const { interval_type, status, assigned_to, page = 1, limit = 30 } = req.query;
    const where = { parent_id: null }; // top-level only
    if (from || to) {
      where.due_date = {};
      if (from) where.due_date[Op.gte] = from;
      if (to)   where.due_date[Op.lte] = to;
    }
    if (interval_type) where.interval_type = interval_type;
    if (status)        where.status        = status;
    if (assigned_to)   where.assigned_to   = assigned_to;

    const { count, rows } = await Task.findAndCountAll({
      where,
      include: [
        { model: Task, as: 'subtasks' },
        { model: User, as: 'assignee', attributes: ['id','first_name','last_name','avatar_url'] }
      ],
      limit: +limit,
      offset: (+page - 1) * +limit,
      order: [['due_date', 'ASC']]
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

// ADDED: GET /:id — was missing, broke addSubtaskToEditing() in the frontend
router.get('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id, {
      include: [
        { model: Task, as: 'subtasks' },
        { model: User, as: 'assignee', attributes: ['id','first_name','last_name','avatar_url'] }
      ]
    });
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const task = await Task.create({ ...req.body, created_by: req.user.id });
    res.status(201).json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    if (req.body.status === 'DONE') req.body.completed_at = new Date();
    await task.update(req.body);
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Task.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
