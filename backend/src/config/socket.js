// =============================================================================
// backend/src/config/socket.js — Socket.io Server & Setup with JWT Handshake
// =============================================================================
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { User, Role } = require('../models');

let io = null;

function parseAllowedOrigins() {
  return String(process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function initSocket(server) {
  const allowedOrigins = parseAllowedOrigins();
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const normalized = String(origin).trim().replace(/\/+$/, '');
        if (allowedOrigins.includes('*') || allowedOrigins.includes(normalized)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // JWT Authentication Middleware for Handshake (auth payload only — never query string)
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.type !== 'access') {
        return next(new Error('Authentication error: Invalid token type'));
      }
      const user = await User.findByPk(decoded.id, {
        include: [{ model: Role, as: 'role' }],
        attributes: { exclude: ['password_hash'] }
      });

      if (!user || !user.is_active) {
        return next(new Error('Authentication error: User inactive or not found'));
      }

      // Attach user details to socket
      socket.user = user;
      next();
    } catch (err) {
      if (err?.name === 'TokenExpiredError' || err?.name === 'JsonWebTokenError') {
        logger.warn(`Socket.io auth rejected (${err.name}): ${err.message}`);
      } else {
        logger.error('Socket.io auth failure:', err);
      }
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userRoom = `user_${socket.user.id}`;
    socket.join(userRoom);
    socket.join('authenticated');
    logger.info(`🔌 User connected to Socket.io: ${socket.user.username} (Room: ${userRoom})`);

    socket.on('disconnect', () => {
      logger.info(`🔌 User disconnected from Socket.io: ${socket.user.username}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet!');
  }
  return io;
}

function disconnectUserSockets(userId) {
  if (!io || !userId) return;
  try {
    io.in(`user_${userId}`).disconnectSockets(true);
  } catch (err) {
    logger.warn(`Failed to disconnect sockets for user ${userId}: ${err.message}`);
  }
}

function emitDomainUpdate(payload) {
  if (!io || !payload?.domain) return;
  try {
    io.to('authenticated').emit('domain:updated', {
      ...payload,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.warn(`Failed to emit domain:updated (${payload.domain}): ${err.message}`);
  }
}

module.exports = {
  initSocket,
  getIO,
  disconnectUserSockets,
  emitDomainUpdate
};
