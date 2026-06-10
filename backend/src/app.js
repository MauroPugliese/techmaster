// =============================================================================
// app.js — Express Application Setup
// =============================================================================
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

// Route imports
const authRoutes              = require('./routes/auth.routes');
const userRoutes              = require('./routes/user.routes');
const dashboardRoutes         = require('./routes/dashboard.routes');
const operationRoutes         = require('./routes/operation.routes');
const maintenanceRoutes       = require('./routes/maintenance.routes');
const plannedMaintenanceRoutes = require('./routes/planned-maintenance.routes');
const warehouseRoutes         = require('./routes/warehouse.routes');
const shiftRoutes             = require('./routes/shift.routes');
const taskRoutes              = require('./routes/task.routes');
const wikiRoutes              = require('./routes/wiki.routes');
const analyticsRoutes         = require('./routes/analytics.routes');
const adminRoutes             = require('./routes/admin.routes');
const notificationRoutes      = require('./routes/notification.routes');
const exportRoutes            = require('./routes/export.routes');

const { errorHandler } = require('./middleware/error.middleware');
const { authenticate, authorize } = require('./middleware/auth.middleware');
const { auditLog } = require('./middleware/audit.middleware');

const app = express();

// Trust first proxy (required for correct client IP behind reverse proxies/load balancers)
app.set('trust proxy', 1);

// ── Security & Performance ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "http://localhost:3000", "http://127.0.0.1:3000"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true
}));
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Date-From', 'X-Date-To']
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
const authLimiter   = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' }
});
app.use('/api/', globalLimiter);

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// ── Audit Logging ─────────────────────────────────────────────────────────────
app.use(auditLog);

// ── Public Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);

// ── Protected Routes ──────────────────────────────────────────────────────────
app.use('/api/users',       authenticate, userRoutes);
app.use('/api/dashboard',   authenticate, dashboardRoutes);
app.use('/api/operations',  authenticate, operationRoutes);
app.use('/api/maintenance/planned', authenticate, plannedMaintenanceRoutes);
app.use('/api/maintenance', authenticate, maintenanceRoutes);
app.use('/api/warehouse',   authenticate, warehouseRoutes);
app.use('/api/shifts',      authenticate, shiftRoutes);
app.use('/api/tasks',       authenticate, taskRoutes);
app.use('/api/wiki',        authenticate, wikiRoutes);
app.use('/api/analytics',   authenticate, analyticsRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/export',        exportRoutes);
app.use('/api/admin', authenticate, authorize('admin'), adminRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { sequelize } = require('./config/database');
    await sequelize.authenticate();
    res.json({
      status: 'OK',
      database: 'connected',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (err) {
    res.status(503).json({
      status: 'ERROR',
      database: 'disconnected',
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;

