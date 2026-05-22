// =============================================================================
// routes/task.routes.js  — FIXED: added GET /:id (needed by addSubtaskToEditing)
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, User, TaskComment, Notification } = require('../models');
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

// GET /:id/comments — Retrieve all comments for a task
router.get('/:id/comments', async (req, res, next) => {
  try {
    const comments = await TaskComment.findAll({
      where: { task_id: req.params.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url'] }],
      order: [['created_at', 'ASC']]
    });
    res.json({ success: true, data: comments });
  } catch (err) { next(err); }
});

// POST /:id/comments — Add a comment and parse mentions
router.post('/:id/comments', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Content is required' });

    const comment = await TaskComment.create({
      task_id: task.id,
      user_id: req.user.id,
      content
    });

    // Parse mentions: @username
    const mentionRegex = /@([a-zA-Z0-9_\-]+)/g;
    let match;
    const usernames = new Set();
    while ((match = mentionRegex.exec(content)) !== null) {
      usernames.add(match[1]);
    }

    if (usernames.size > 0) {
      const mentionedUsers = await User.findAll({
        where: {
          username: { [Op.in]: Array.from(usernames) }
        }
      });

      const io = req.app.get('io');

      for (const user of mentionedUsers) {
        // Don't notify yourself
        if (user.id === req.user.id) continue;

        const notif = await Notification.create({
          user_id: user.id,
          type: 'MENTION',
          title: `Mentioned in Task: ${task.title}`,
          body: `${req.user.first_name} ${req.user.last_name} (@${req.user.username}) mentioned you in a comment on task "${task.title}": "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
          link: `/tasks?id=${task.id}`
        });

        // Real-time emit if Socket.io is configured
        if (io) {
          io.to(`user_${user.id}`).emit('notification', notif);
        }
      }
    }

    // Load author details to return
    const commentWithAuthor = await TaskComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url'] }]
    });

    res.status(201).json({ success: true, data: commentWithAuthor });
  } catch (err) { next(err); }
});

module.exports = router;

