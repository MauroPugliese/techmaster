// =============================================================================
// services/proactive-alerts.service.js — Real-time Operational & AOG Alerts
// Emits DB notifications + Socket.IO pushes to admins/managers/engineers.
// =============================================================================
'use strict';

const { Op } = require('sequelize');
const { Notification, User, Role } = require('../models');
const logger = require('../config/logger');

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

    const targetIds = [...new Set(
      recipients
        .map(u => Number(u.id))
        .filter(id => id > 0 && id !== Number(excludeUserId || 0))
    )];

    if (!targetIds.length) return 0;

    const cleanType = String(type).slice(0, 80);
    const cleanTitle = String(title).slice(0, 200);
    const cleanBody = body ? String(body).slice(0, 1000) : null;
    const cleanLink = link ? String(link).slice(0, 500) : null;

    const created = await Notification.bulkCreate(
      targetIds.map(userId => ({
        user_id: userId,
        type: cleanType,
        title: cleanTitle,
        body: cleanBody,
        link: cleanLink
      })),
      { returning: true }
    );

    const io = req?.app?.get ? req.app.get('io') : null;
    if (io) {
      for (const notif of created) {
        const plain = typeof notif.get === 'function' ? notif.get({ plain: true }) : notif;
        io.to(`user_${plain.user_id}`).emit('notification', plain);
      }
    }

    return created.length;
  } catch (err) {
    logger.warn(`[ProactiveAlerts] Failed to broadcast alert "${title}": ${err?.message || err}`);
    return 0;
  }
}

module.exports = {
  broadcastOperationalAlert
};
