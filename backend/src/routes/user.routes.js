const router = require('express').Router();
const { sequelize, User, Role, RefreshToken } = require('../models');
const { authorize } = require('../middleware/auth.middleware');
const { guardSelfOrLastAdminAction } = require('../services/admin-helpers.service');
const { disconnectUserSockets } = require('../config/socket');

router.get('/', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { rows: users, count: total } = await User.findAndCountAll({
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }],
      order: [['first_name', 'ASC']],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      distinct: true
    });
    res.json({ success: true, data: { items: users, total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const roleName = req.user?.role?.name;
    const isSelf = Number(req.user?.id) === targetId;
    if (!isSelf && roleName !== 'admin' && roleName !== 'manager') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const user = await User.findByPk(targetId, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

router.patch('/:id/status', authorize('admin'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const targetId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetId)) {
      await transaction.rollback().catch(() => {});
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const user = await User.findByPk(targetId, {
      include: [{ model: Role, as: 'role' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!user) {
      await transaction.rollback().catch(() => {});
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const nextActive = Boolean(req.body.is_active);
    if (!nextActive && user.is_active) {
      const activeAdmins = await User.findAll({
        where: { is_active: true },
        include: [{ model: Role, as: 'role', where: { name: 'admin' } }],
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const guard = guardSelfOrLastAdminAction({
        actorId: req.user?.id,
        targetUser: user,
        action: 'deactivate',
        activeAdminCount: activeAdmins.length
      });
      if (!guard.allowed) {
        await transaction.rollback().catch(() => {});
        return res.status(guard.status).json({ success: false, message: guard.message });
      }
    }

    await user.update({ is_active: nextActive }, { transaction });
    if (!nextActive) {
      await RefreshToken.update(
        { is_revoked: true },
        { where: { user_id: user.id, is_revoked: false }, transaction }
      );
    }
    await transaction.commit();

    if (!nextActive) {
      disconnectUserSockets(user.id);
    }

    const updated = await User.findByPk(targetId, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    next(err);
  }
});

module.exports = router;
