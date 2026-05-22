// =============================================================================
// middleware/audit.middleware.js — Audit Logging for Critical Operations
// =============================================================================
const logger = require('../config/logger');
const { AuditLog } = require('../models');

// List of endpoints that should be audited (sensitive operations)
const AUDIT_PATTERNS = [
  /^POST\s+\/api\/auth\/login$/,
  /^POST\s+\/api\/auth\/register$/,
  /^POST\s+\/api\/warehouse\/\d+\/movement$/,
  /^PUT\s+\/api\/warehouse\/\d+$/,
  /^POST\s+\/api\/warehouse\/$/, // create item
  /^PUT\s+\/api\/users\/\d+/,
  /^POST\s+\/api\/users/,
  /^DELETE\s+\/api\//,
  /^PUT\s+\/api\/admin\//,
  /^POST\s+\/api\/admin\//,
  /^DELETE\s+\/api\/admin\//,
  /^POST\s+\/api\/tasks\//,
  /^PUT\s+\/api\/tasks\/\d+/,
  /^DELETE\s+\/api\/tasks\/\d+/,
  /^POST\s+\/api\/shifts\//,
  /^PUT\s+\/api\/shifts\/\d+/
];

const shouldAudit = (method, path) => {
  const signature = `${method} ${path}`;
  return AUDIT_PATTERNS.some(pattern => pattern.test(signature));
};

const sanitizeBody = (body) => {
  if (!body) return null;
  const copy = { ...body };
  const sensitiveKeys = ['password', 'password_confirm', 'token', 'accessToken', 'refreshToken', 'secret'];
  sensitiveKeys.forEach(k => {
    if (k in copy) copy[k] = '[REDACTED]';
  });
  return copy;
};

const auditLog = (req, res, next) => {
  // Override res.json to capture response after it's sent
  const originalJson = res.json;
  res.json = function(data) {
    // Only log if method and path should be audited
    const routePath = `${req.baseUrl || ''}${req.path || ''}`;

    if (shouldAudit(req.method, routePath)) {
      let resolvedUserId = req.user?.id || null;
      let resolvedUsername = req.user?.username || 'anonymous';

      // Attempt to resolve user info for successful login/registration
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (!resolvedUserId && data?.data?.user) {
          resolvedUserId = data.data.user.id;
          resolvedUsername = data.data.user.username;
        }
      }
      if (resolvedUsername === 'anonymous' && req.body?.username) {
        resolvedUsername = req.body.username;
      }

      const auditEntry = {
        user_id: resolvedUserId,
        username: resolvedUsername,
        action: `${req.method} ${routePath}`,
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        method: req.method,
        path: routePath,
        status: res.statusCode,
        details: {
          body: sanitizeBody(req.body),
          params: req.params,
          query: req.query
        }
      };

      // Write to console/log files
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.info(`AUDIT: ${auditEntry.action}`, auditEntry);
      } else if (res.statusCode >= 400) {
        logger.warn(`AUDIT: ${auditEntry.action} (${res.statusCode})`, auditEntry);
      }

      // Asynchronously persist to database in the background
      AuditLog.create(auditEntry).catch(err => {
        logger.error('❌ Failed to save AuditLog to database:', err);
      });
    }

    return originalJson.call(this, data);
  };

  next();
};

module.exports = { auditLog, shouldAudit };
