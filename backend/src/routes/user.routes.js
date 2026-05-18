const router = require('express').Router();
const { User, Role } = require('../models');
const { authorize } = require('../middleware/auth.middleware');

router.get('/', authorize('admin','manager'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const users = await User.findAll({
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }],
      order: [['first_name','ASC']],
      limit: +limit, offset: (+page-1)*+limit
    });
    res.json({ success: true, data: { items: users, total: users.length } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

router.patch('/:id/status', authorize('admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    await user.update({ is_active: req.body.is_active });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

module.exports = router;
