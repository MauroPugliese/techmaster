const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { User, Role, RefreshToken, sequelize } = require('../models');
const { Op } = require('sequelize');
const { recordFailedAttempt, checkBruteForce, clearLoginAttempts } = require('../middleware/auth.middleware');

const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

const generateTokens = async (userId, transaction = null) => {
  const access = jwt.sign(
    { id: userId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const refresh = jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Store SHA-256 hash of refresh token in DB for secure revocation tracking
  await RefreshToken.create({
    user_id: userId,
    token: hashRefreshToken(refresh),
    expires_at: refreshExpiry,
    is_revoked: false
  }, transaction ? { transaction } : undefined);

  return { access, refresh };
};

const userFields = ['id','username','email','first_name','last_name','avatar_url','department','job_title','is_active','last_login'];

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    if (String(process.env.ALLOW_SELF_REGISTRATION || '').toLowerCase() !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Self-registration is disabled. Please contact your platform administrator to provision an account.'
      });
    }

    const { username, email, password, first_name, last_name, department, job_title, phone } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUsername = String(username || '').trim();

    const existing = await User.findOne({ where: { [Op.or]: [{ email: normalizedEmail }, { username: normalizedUsername }] } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email or username already in use' });
    }

    let viewerRole = await Role.findOne({ where: { name: 'viewer' } });
    if (!viewerRole) {
      viewerRole = await Role.create({
        name: 'viewer',
        description: 'Read-only viewer role',
        permissions: []
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await User.create({
      role_id: viewerRole.id,
      username: normalizedUsername,
      email: normalizedEmail,
      password_hash: hash,
      first_name, last_name, department, job_title, phone,
      is_active: false
    });

    const created = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });

    res.status(201).json({
      success: true,
      message: 'Account created and pending administrator activation.',
      data: { user: created, pending_activation: true }
    });
  } catch (err) { next(err); }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const clientIp = req.ip || req.socket?.remoteAddress || '';

    // Check brute-force protection keyed by (ip, email)
    const bruteForceStatus = checkBruteForce(normalizedEmail, clientIp);
    if (bruteForceStatus && bruteForceStatus.locked) {
      return res.status(429).json({ success: false, message: bruteForceStatus.message });
    }

    const user = await User.findOne({
      where: { email: normalizedEmail },
      include: [{ model: Role, as: 'role' }],
      attributes: [...userFields, 'password_hash', 'role_id']
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      recordFailedAttempt(normalizedEmail, clientIp);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is disabled' });
    }

    clearLoginAttempts(normalizedEmail, clientIp);

    await user.update({ last_login: new Date() });
    const tokens = await generateTokens(user.id);

    const { password_hash: _, ...safeUser } = user.toJSON();

    res.json({
      success: true,
      data: { user: safeUser, access_token: tokens.access, refresh_token: tokens.refresh }
    });
  } catch (err) { next(err); }
};

// POST /api/auth/refresh — atomic token rotation + active user verification
exports.refresh = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'No refresh token' });
    }

    const decoded = jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    if (decoded?.type !== 'refresh') {
      await transaction.rollback();
      return res.status(401).json({ success: false, message: 'Invalid refresh token type' });
    }

    const hashed = hashRefreshToken(refresh_token);
    const storedToken = await RefreshToken.findOne({
      where: {
        token: { [Op.in]: [hashed, refresh_token] },
        user_id: decoded.id,
        is_revoked: false,
        expires_at: { [Op.gte]: new Date() }
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!storedToken) {
      await transaction.rollback();
      return res.status(401).json({ success: false, message: 'Invalid or revoked refresh token' });
    }

    const user = await User.findByPk(decoded.id, { attributes: ['id', 'is_active'], transaction });
    if (!user || !user.is_active) {
      await storedToken.update({ is_revoked: true }, { transaction });
      await transaction.commit();
      return res.status(403).json({ success: false, message: 'Account is disabled' });
    }

    // Revoke consumed refresh token atomically before minting replacement
    await storedToken.update({ is_revoked: true }, { transaction });
    const tokens = await generateTokens(decoded.id, transaction);
    await transaction.commit();

    return res.json({ success: true, data: { access_token: tokens.access, refresh_token: tokens.refresh } });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
};

// POST /api/auth/logout — works even if access token has expired
exports.logout = async (req, res, next) => {
  try {
    let targetUserId = req.user?.id || null;
    const rawRefresh = req.body?.refresh_token ? String(req.body.refresh_token) : '';

    if (!targetUserId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET, { ignoreExpiration: true });
          if (decoded?.id) targetUserId = decoded.id;
        } catch { /* ignore invalid access token */ }
      }
    }

    if (rawRefresh) {
      const hashed = hashRefreshToken(rawRefresh);
      await RefreshToken.update(
        { is_revoked: true },
        { where: { token: { [Op.in]: [hashed, rawRefresh] }, is_revoked: false } }
      );
    }

    if (targetUserId) {
      await RefreshToken.update(
        { is_revoked: true },
        { where: { user_id: targetUserId, is_revoked: false } }
      );
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

    let passwordChanged = false;
    if (req.body.current_password && req.body.new_password) {
      const user = await User.findByPk(req.user.id, { attributes: ['password_hash'] });
      const valid = await bcrypt.compare(req.body.current_password, user.password_hash);
      if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      updates.password_hash = await bcrypt.hash(req.body.new_password, 12);
      passwordChanged = true;
    }

    await req.user.update(updates);
    if (passwordChanged) {
      await RefreshToken.update(
        { is_revoked: true },
        { where: { user_id: req.user.id, is_revoked: false } }
      );
    }

    const updatedUser = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [{ model: Role, as: 'role' }]
    });
    res.json({ success: true, message: 'Profile updated', data: updatedUser });
  } catch (err) { next(err); }
};

// GET /api/auth/sessions
exports.getSessions = async (req, res, next) => {
  try {
    const sessions = await RefreshToken.findAll({
      where: {
        user_id: req.user.id,
        is_revoked: false,
        expires_at: { [Op.gte]: new Date() }
      },
      attributes: ['id', 'created_at', 'expires_at'],
      order: [['created_at', 'DESC']]
    });
    res.json({
      success: true,
      data: {
        active_count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          created_at: s.created_at,
          expires_at: s.expires_at
        }))
      }
    });
  } catch (err) { next(err); }
};

// POST /api/auth/revoke-sessions
exports.revokeSessions = async (req, res, next) => {
  try {
    const [revokedCount] = await RefreshToken.update(
      { is_revoked: true },
      { where: { user_id: req.user.id, is_revoked: false } }
    );
    res.json({
      success: true,
      message: 'All active sessions revoked',
      data: { revoked_count: revokedCount }
    });
  } catch (err) { next(err); }
};
