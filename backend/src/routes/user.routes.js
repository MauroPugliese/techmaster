const router = require('express').Router();
const { User, Role } = require('../models');
const { authorize } = require('../middleware/auth.middleware');

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
  try {
    const targetId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const user = await User.findByPk(targetId);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    await user.update({ is_active: Boolean(req.body.is_active) });
    const updated = await User.findByPk(targetId, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

module.exports = router;
