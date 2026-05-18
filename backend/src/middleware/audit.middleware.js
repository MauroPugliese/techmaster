// =============================================================================
// middleware/audit.middleware.js — Audit Logging for Critical Operations
// =============================================================================
const logger = require('../config/logger');

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

const auditLog = (req, res, next) => {
  // Override res.json to capture response after it's sent
  const originalJson = res.json;
  res.json = function(data) {
    // Only log if method and path should be audited
    if (shouldAudit(req.method, req.path)) {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        action: `${req.method} ${req.path}`,
        user_id: req.user?.id || 'unauthenticated',
        username: req.user?.username || 'anonymous',
        ip: req.ip,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        details: {
          body_keys: Object.keys(req.body || {}),
          params: req.params,
          query: req.query
        }
      };
      
      // Log success if status 200-299
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.info(`AUDIT: ${auditEntry.action}`, auditEntry);
      } else if (res.statusCode >= 400) {
        // Log failures for warnings
        logger.warn(`AUDIT: ${auditEntry.action} (${res.statusCode})`, auditEntry);
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = { auditLog, shouldAudit };
