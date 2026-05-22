// =============================================================================
// backend/src/config/socket.js — Socket.io Server & Setup with JWT Handshake
// =============================================================================
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { User, Role } = require('../models');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:4200',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // JWT Authentication Middleware for Handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
      logger.error('Socket.io auth failure:', err);
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userRoom = `user_${socket.user.id}`;
    socket.join(userRoom);
    logger.info(`🔌 User connected to Socket.io: ${socket.user.username} (Room: ${userRoom})`);

    // Standard client notifications room or other rooms could go here
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

module.exports = {
  initSocket,
  getIO
};
