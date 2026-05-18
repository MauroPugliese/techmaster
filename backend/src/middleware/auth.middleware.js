// =============================================================================
// middleware/auth.middleware.js — Authentication & Authorization
// =============================================================================
const jwt    = require('jsonwebtoken');
const { User, Role, RefreshToken } = require('../models');
const { Op } = require('sequelize');

// In-memory brute force tracker (use Redis in production)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const recordFailedAttempt = (email) => {
  const now = Date.now();
  const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  
  // Reset if outside the window
  if (now - attempts.firstAttempt > ATTEMPT_WINDOW_MS) {
    attempts.count = 1;
    attempts.firstAttempt = now;
    attempts.lockedUntil = 0;
  } else {
    attempts.count++;
    if (attempts.count >= MAX_ATTEMPTS) {
      attempts.lockedUntil = now + LOCKOUT_TIME_MS;
    }
  }
  
  loginAttempts.set(email, attempts);
};

const checkBruteForce = (email) => {
  const attempts = loginAttempts.get(email);
  if (!attempts) return null; // No attempts recorded
  
  const now = Date.now();
  if (now < attempts.lockedUntil) {
    const remainingMs = attempts.lockedUntil - now;
    return {
      locked: true,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      message: `Account temporarily locked. Try again in ${Math.ceil(remainingMs / 1000)}s`
    };
  }
  
  return null;
};

const clearLoginAttempts = (email) => {
  loginAttempts.delete(email);
};

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id, {
      include: [{ model: Role, as: 'role' }],
      attributes: { exclude: ['password_hash'] }
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role.name) && req.user.role.name !== 'admin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  recordFailedAttempt,
  checkBruteForce,
  clearLoginAttempts
};
