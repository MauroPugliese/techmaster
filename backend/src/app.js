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
const uiRoutes                = require('./routes/ui.routes');
const searchRoutes            = require('./routes/search.routes');
const simulatorRoutes         = require('./routes/simulator.routes');

const { errorHandler } = require('./middleware/error.middleware');
const { authenticate, authorize } = require('./middleware/auth.middleware');
const { requireSectionAccess } = require('./middleware/section-access.middleware');
const { auditLog } = require('./middleware/audit.middleware');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Configurable proxy hop count (1 for Nginx container, 2 behind Synology DSM Reverse Proxy -> Nginx)
const parsedHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', Number.isInteger(parsedHops) && parsedHops >= 0 ? parsedHops : 1);

const allowedOrigins = String(process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:4200')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const corsOriginValidator = (origin, callback) => {
  if (!origin) return callback(null, true);
  const normalized = String(origin).trim().replace(/\/+$/, '');
  if (allowedOrigins.includes('*') || allowedOrigins.includes(normalized)) {
    return callback(null, true);
  }
  return callback(null, false);
};

// ── Security & Performance ────────────────────────────────────────────────────
const connectSrc = ["'self'", 'ws:', 'wss:'];
if (!isProd) {
  connectSrc.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc,
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' },
  hsts: process.env.ENABLE_HSTS === 'true'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  frameguard: { action: 'deny' },
  noSniff: true
}));
app.use(compression());
app.use(cors({
  origin: corsOriginValidator,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Date-From', 'X-Date-To'],
  exposedHeaders: ['Content-Disposition']
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
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Too many session refresh requests. Please try again shortly.' }
});
app.use('/api/', globalLimiter);

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// ── Audit Logging ─────────────────────────────────────────────────────────────
app.use(auditLog);

// ── Public Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
app.post('/api/auth/refresh', refreshLimiter);
app.use('/api/auth', authRoutes);

// ── Protected Routes ──────────────────────────────────────────────────────────
app.use('/api/users',       authenticate, userRoutes);
app.use('/api/dashboard',   authenticate, requireSectionAccess('dashboard'), dashboardRoutes);
app.use('/api/simulators',  authenticate, requireSectionAccess('simulators'), simulatorRoutes);
app.use('/api/operations',  authenticate, requireSectionAccess('operations'), operationRoutes);
app.use('/api/maintenance/planned', authenticate, requireSectionAccess('maintenance'), plannedMaintenanceRoutes);
app.use('/api/maintenance', authenticate, requireSectionAccess('maintenance'), maintenanceRoutes);
app.use('/api/warehouse',   authenticate, requireSectionAccess('warehouse'), warehouseRoutes);
app.use('/api/shifts',      authenticate, requireSectionAccess('shifts'), shiftRoutes);
app.use('/api/tasks',       authenticate, requireSectionAccess('tasks'), taskRoutes);
app.use('/api/wiki',        authenticate, requireSectionAccess('wiki'), wikiRoutes);
app.use('/api/analytics',   authenticate, requireSectionAccess('analytics'), analyticsRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/export',        authenticate, exportRoutes);
app.use('/api/admin', authenticate, authorize('admin'), requireSectionAccess('admin'), adminRoutes);
app.use('/api/ui', authenticate, uiRoutes);
app.use('/api/search', authenticate, searchRoutes);

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
      ...(isProd ? {} : { message: err.message }),
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

