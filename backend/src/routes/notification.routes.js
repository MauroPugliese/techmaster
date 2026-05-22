// =============================================================================
// routes/notification.routes.js — In-App Notifications API
// =============================================================================
const router = require('express').Router();
const { Notification } = require('../models');

// GET /api/notifications — Get all notifications for current user
router.get('/', async (req, res, next) => {
  try {
    const list = await Notification.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 50
    });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

// PUT /api/notifications/:id/read — Mark a notification as read
router.put('/:id/read', async (req, res, next) => {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id }
    });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    
    await notif.update({ is_read: true });
    res.json({ success: true, data: notif });
  } catch (err) { next(err); }
});

// PUT /api/notifications/read-all — Mark all as read
router.put('/read-all', async (req, res, next) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } }
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) { next(err); }
});

module.exports = router;
