// =============================================================================
// services/proactive-alerts.service.js — Real-time Operational & AOG Alerts
// Emits DB notifications + Socket.IO pushes to admins/managers/engineers.
// =============================================================================
'use strict';

const { Op } = require('sequelize');
const { Notification, User, Role } = require('../models');

/**
 * Notify active admins & managers (and optionally a specific user) with DB + Socket.IO push.
 * Never throws so callers' main transactional workflow cannot fail due to notification issues.
 */
async function broadcastOperationalAlert({
  req,
  type = 'SYSTEM_ALERT',
  title,
  body = null,
  link = '/dashboard',
  excludeUserId = null,
  roles = ['admin', 'manager']
}) {
  try {
    if (!title) return 0;

    const recipients = await User.findAll({
      where: { is_active: true },
      include: [
        {
          model: Role,
          as: 'role',
          where: { name: { [Op.in]: roles } },
          attributes: ['id', 'name']
        }
      ],
      attributes: ['id']
    });

    const targetIds = recipients
      .map(u => Number(u.id))
      .filter(id => id > 0 && id !== Number(excludeUserId || 0));

    if (!targetIds.length) return 0;

    const io = req?.app?.get ? req.app.get('io') : null;
    let sent = 0;

    for (const userId of targetIds) {
      const notif = await Notification.create({
        user_id: userId,
        type: String(type).slice(0, 80),
        title: String(title).slice(0, 200),
        body: body ? String(body).slice(0, 1000) : null,
        link: link ? String(link).slice(0, 500) : null
      });
      if (io) {
        io.to(`user_${userId}`).emit('notification', notif);
      }
      sent += 1;
    }

    return sent;
  } catch {
    return 0;
  }
}

module.exports = {
  broadcastOperationalAlert
};
