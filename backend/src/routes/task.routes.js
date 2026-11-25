// =============================================================================
// routes/task.routes.js — Enhanced Task Manager API
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, Simulator, User, TaskComment, Notification } = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const {
  sanitizeTaskPayload,
  sanitizeBulkAction,
  extractMentionUsernames
} = require('../services/task-payload.service');

const TASK_INCLUDES = [
  { model: Task, as: 'subtasks' },
  {
    model: Simulator,
    as: 'simulator',
    attributes: ['id', 'code', 'name', 'bay_code', 'aircraft_type', 'status'],
    required: false
  },
  {
    model: User,
    as: 'assignee',
    attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url', 'department']
  },
  {
    model: User,
    as: 'creator',
    attributes: ['id', 'first_name', 'last_name', 'username']
  },
  {
    model: TaskComment,
    as: 'comments',
    attributes: ['id']
  }
];

function serializeTask(taskInstance) {
  const plain = taskInstance.toJSON();
  const subtasks = Array.isArray(plain.subtasks)
    ? [...plain.subtasks].sort((a, b) => a.id - b.id)
    : [];
  const commentsCount = Array.isArray(plain.comments) ? plain.comments.length : 0;
  const { comments: _comments, ...rest } = plain;
  return {
    ...rest,
    subtasks,
    comments_count: commentsCount
  };
}

// ── Static routes MUST stay before /:id ──────────────────────────────────────

// GET /api/tasks/assignees — Lightweight active user list for assignment/mentions
router.get('/assignees', async (req, res, next) => {
  try {
    const users = await User.findAll({
      where: { is_active: true },
      attributes: ['id', 'username', 'first_name', 'last_name', 'department', 'job_title', 'avatar_url'],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']]
    });
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// PATCH /api/tasks/bulk — Batch status / priority / assignment / delete
router.patch('/bulk', async (req, res, next) => {
  try {
    const { error, data } = sanitizeBulkAction(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const { ids, action, value } = data;

    if (action === 'status') {
      await Task.update(
        { status: value, completed_at: value === 'DONE' ? new Date() : null },
        { where: { id: { [Op.in]: ids } } }
      );
    } else if (action === 'priority') {
      await Task.update({ priority: value }, { where: { id: { [Op.in]: ids } } });
    } else if (action === 'assign') {
      await Task.update({ assigned_to: value }, { where: { id: { [Op.in]: ids } } });
    } else if (action === 'delete') {
      const childSubtasks = await Task.findAll({
        where: { parent_id: { [Op.in]: ids } },
        attributes: ['id']
      });
      const childIds = childSubtasks.map(s => s.id);
      const commentTaskIds = [...ids, ...childIds];
      await TaskComment.destroy({ where: { task_id: { [Op.in]: commentTaskIds } } });
      await Task.destroy({ where: { parent_id: { [Op.in]: ids } } });
      await Task.destroy({ where: { id: { [Op.in]: ids } } });
    }

    res.json({ success: true, data: { affected: ids.length, ids, action } });
  } catch (err) { next(err); }
});

// ── Collection & item CRUD ───────────────────────────────────────────────────

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const { interval_type, status, priority, assigned_to, simulator_id, page = 1, limit = 100 } = req.query;

    const where = { parent_id: null }; // top-level only
    if (simulator_id && Number.isInteger(Number(simulator_id)) && Number(simulator_id) > 0) {
      where.simulator_id = Number(simulator_id);
    }
    if (from || to) {
      const dateCond = {};
      if (from) dateCond[Op.gte] = from;
      if (to)   dateCond[Op.lte] = to;
      where[Op.and] = [
        {
          [Op.or]: [
            { due_date: dateCond },
            { due_date: null, created_at: dateCond }
          ]
        }
      ];
    }
    if (interval_type) where.interval_type = interval_type;
    if (status)        where.status        = status;
    if (priority)      where.priority      = priority;
    if (assigned_to === 'unassigned') {
      where.assigned_to = null;
    } else if (assigned_to !== undefined && assigned_to !== '') {
      where.assigned_to = +assigned_to;
    }

    const parsedLimit = Math.min(250, Math.max(1, +limit || 100));
    const parsedPage  = Math.max(1, +page || 1);

    const { count, rows } = await Task.findAndCountAll({
      where,
      include: TASK_INCLUDES,
      distinct: true,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order: [['due_date', 'ASC'], ['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        items: rows.map(serializeTask),
        total: count
      }
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id, { include: TASK_INCLUDES });
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: serializeTask(task) });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { error, data } = sanitizeTaskPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await Task.create({ ...data, created_by: req.user.id });
    const hydrated = await Task.findByPk(created.id, { include: TASK_INCLUDES });
    res.status(201).json({ success: true, data: serializeTask(hydrated || created) });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });

    const { error, data } = sanitizeTaskPayload(req.body, { isCreate: false, taskId: task.id });
    if (error) return res.status(400).json({ success: false, message: error });

    await task.update(data);
    const hydrated = await Task.findByPk(task.id, { include: TASK_INCLUDES });
    res.json({ success: true, data: serializeTask(hydrated || task) });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Not found' });

    const subtasks = await Task.findAll({
      where: { parent_id: task.id },
      attributes: ['id']
    });
    const subtaskIds = subtasks.map(s => s.id);
    await TaskComment.destroy({ where: { task_id: { [Op.in]: [task.id, ...subtaskIds] } } });
    if (subtaskIds.length) {
      await Task.destroy({ where: { parent_id: task.id } });
    }
    await Task.destroy({ where: { id: task.id } });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Comments & @mentions ─────────────────────────────────────────────────────

router.get('/:id/comments', async (req, res, next) => {
  try {
    const comments = await TaskComment.findAll({
      where: { task_id: req.params.id },
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url']
      }],
      order: [['created_at', 'ASC']]
    });
    res.json({ success: true, data: comments });
  } catch (err) { next(err); }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(400).json({ success: false, message: 'Content is required' });
    if (content.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comment must be 2000 characters or fewer' });
    }

    const comment = await TaskComment.create({
      task_id: task.id,
      user_id: req.user.id,
      content
    });

    const usernames = extractMentionUsernames(content);
    if (usernames.length > 0) {
      const mentionedUsers = await User.findAll({
        where: { username: { [Op.in]: usernames } }
      });

      const io = req.app.get('io');
      for (const user of mentionedUsers) {
        if (user.id === req.user.id) continue;

        const notif = await Notification.create({
          user_id: user.id,
          type: 'MENTION',
          title: `Mentioned in Task: ${task.title}`,
          body: `${req.user.first_name} ${req.user.last_name} (@${req.user.username}) mentioned you in a comment on task "${task.title}": "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
          link: `/tasks?id=${task.id}`
        });

        if (io) {
          io.to(`user_${user.id}`).emit('notification', notif);
        }
      }
    }

    const commentWithAuthor = await TaskComment.findByPk(comment.id, {
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url']
      }]
    });

    res.status(201).json({ success: true, data: commentWithAuthor });
  } catch (err) { next(err); }
});

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  try {
    const comment = await TaskComment.findOne({
      where: { id: req.params.commentId, task_id: req.params.id }
    });
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    const roleName = req.user.role?.name || req.user.role;
    const isPrivileged = roleName === 'admin' || roleName === 'manager';
    if (comment.user_id !== req.user.id && !isPrivileged) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions to delete this comment' });
    }

    await comment.destroy();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
