const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { User, Role, RefreshToken } = require('../models');
const { Op } = require('sequelize');
const { recordFailedAttempt, checkBruteForce, clearLoginAttempts } = require('../middleware/auth.middleware');

const generateTokens = async (userId) => {
  const access = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  
  const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const refresh = jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  // Store refresh token in DB for revocation tracking
  await RefreshToken.create({
    user_id: userId,
    token: refresh,
    expires_at: refreshExpiry,
    is_revoked: false
  });
  
  return { access, refresh };
};

const userFields = ['id','username','email','first_name','last_name','avatar_url','department','job_title','is_active','last_login'];

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { username, email, password, first_name, last_name, department, job_title, phone } = req.body;

    const existing = await User.findOne({ where: { [Op.or]: [{ email }, { username }] } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email or username already in use' });
    }

    const techRole = await Role.findOne({ where: { name: 'tech' } });
    const hash = await bcrypt.hash(password, 12);

    const user = await User.create({
      role_id: techRole.id,
      username, email, password_hash: hash,
      first_name, last_name, department, job_title, phone
    });

    const tokens = await generateTokens(user.id);
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: { id: user.id, username: user.username, email: user.email, first_name, last_name },
        access_token: tokens.access,
        refresh_token: tokens.refresh
      }
    });
  } catch (err) { next(err); }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Check brute-force protection
    const bruteForceStatus = checkBruteForce(email);
    if (bruteForceStatus && bruteForceStatus.locked) {
      return res.status(429).json({ success: false, message: bruteForceStatus.message });
    }

    const user = await User.findOne({
      where: { email },
      include: [{ model: Role, as: 'role' }],
      attributes: [...userFields, 'password_hash', 'role_id']
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      recordFailedAttempt(email);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is disabled' });
    }

    // Clear failed attempts on successful login
    clearLoginAttempts(email);

    await user.update({ last_login: new Date() });
    const tokens = await generateTokens(user.id);

    const { password_hash: _, ...safeUser } = user.toJSON();

    res.json({
      success: true,
      data: { user: safeUser, access_token: tokens.access, refresh_token: tokens.refresh }
    });
  } catch (err) { next(err); }
};

// POST /api/auth/refresh
exports.refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ success: false, message: 'No refresh token' });

    // Verify token signature
    const decoded = jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    // Check if token exists in DB and not revoked
    const storedToken = await RefreshToken.findOne({
      where: {
        token: refresh_token,
        user_id: decoded.id,
        is_revoked: false,
        expires_at: { [Op.gte]: new Date() }
      }
    });

    if (!storedToken) {
      return res.status(401).json({ success: false, message: 'Invalid or revoked refresh token' });
    }

    const tokens = await generateTokens(decoded.id);

    res.json({ success: true, data: { access_token: tokens.access, refresh_token: tokens.refresh } });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
};

// POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Optionally revoke all tokens for this user
        await RefreshToken.update(
          { is_revoked: true },
          { where: { user_id: req.user.id, is_revoked: false } }
        );
      } catch (e) {
        // Token might be expired, that's ok
      }
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { next(err); }
};

// GET /api/auth/me
exports.me = async (req, res) => {
  const { password_hash: _, ...user } = req.user.toJSON();
  res.json({ success: true, data: user });
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const allowed = ['first_name','last_name','department','job_title','phone','avatar_url'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (req.body.current_password && req.body.new_password) {
      const user = await User.findByPk(req.user.id, { attributes: ['password_hash'] });
      const valid = await bcrypt.compare(req.body.current_password, user.password_hash);
      if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      updates.password_hash = await bcrypt.hash(req.body.new_password, 12);
    }

    await req.user.update(updates);
    res.json({ success: true, message: 'Profile updated', data: req.user });
  } catch (err) { next(err); }
};
