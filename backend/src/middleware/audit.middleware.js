// =============================================================================
// middleware/audit.middleware.js — Audit Logging for Critical Operations
// =============================================================================
const logger = require('../config/logger');
const { AuditLog } = require('../models');

// List of endpoints that should be audited (sensitive operations)
const AUDIT_PATTERNS = [
  /^POST\s+\/api\/auth\/login$/,
  /^POST\s+\/api\/auth\/register$/,
  /^POST\s+\/api\/auth\/logout$/,
  /^POST\s+\/api\/auth\/revoke-sessions$/,
  /^PUT\s+\/api\/auth\/profile$/,
  /^POST\s+\/api\/warehouse\/\d+\/movement$/,
  /^POST\s+\/api\/warehouse\/\d+\/restock-task$/,
  /^POST\s+\/api\/warehouse\/(categories|locations)\/?$/,
  /^PUT\s+\/api\/warehouse\/\d+$/,
  /^PATCH\s+\/api\/warehouse\/bulk$/,
  /^POST\s+\/api\/warehouse\/?$/,
  /^POST\s+\/api\/maintenance\/?$/,
  /^PUT\s+\/api\/maintenance\/\d+$/,
  /^PATCH\s+\/api\/maintenance\/bulk$/,
  /^POST\s+\/api\/maintenance\/assets\/?$/,
  /^PUT\s+\/api\/maintenance\/assets\/\d+$/,
  /^POST\s+\/api\/maintenance\/planned\/?$/,
  /^POST\s+\/api\/maintenance\/planned\/\d+\/work-order$/,
  /^PUT\s+\/api\/maintenance\/planned\/\d+/,
  /^POST\s+\/api\/operations\/?$/,
  /^PUT\s+\/api\/operations\/\d+$/,
  /^PATCH\s+\/api\/operations\/bulk$/,
  /^POST\s+\/api\/operations\/\d+\/(duplicate|members|logs|debrief|snag)$/,
  /^(POST|PUT|PATCH)\s+\/api\/simulators(\/|$)/,
  /^(POST|PUT|PATCH)\s+\/api\/wiki(\/|$)/,
  /^GET\s+\/api\/export\/.+/,
  /^(PUT|PATCH)\s+\/api\/users\/\d+/,
  /^POST\s+\/api\/users/,
  /^DELETE\s+\/api\//,
  /^PUT\s+\/api\/admin\//,
  /^PATCH\s+\/api\/admin\//,
  /^POST\s+\/api\/admin\//,
  /^DELETE\s+\/api\/admin\//,
  /^POST\s+\/api\/tasks(\/|$)/,
  /^PATCH\s+\/api\/tasks\/bulk$/,
  /^PUT\s+\/api\/tasks\/\d+/,
  /^DELETE\s+\/api\/tasks\/\d+/,
  /^POST\s+\/api\/shifts(\/|$)/,
  /^PUT\s+\/api\/shifts\/\d+/,
  /^PATCH\s+\/api\/shifts\/handovers\/\d+\/acknowledge$/
];

const shouldAudit = (method, path) => {
  const signature = `${method} ${path}`;
  return AUDIT_PATTERNS.some(pattern => pattern.test(signature));
};

const SENSITIVE_KEY_RE = /password|token|secret|authorization|cookie/i;
const MAX_AUDIT_BODY_BYTES = 4096;

const sanitizeRecursive = (val, depth = 0) => {
  if (val === null || val === undefined) return val;
  if (depth > 4) return '[TRUNCATED]';
  if (typeof val === 'string') {
    return val.length > 500 ? `${val.slice(0, 500)}…[TRUNCATED]` : val;
  }
  if (Array.isArray(val)) {
    return val.slice(0, 30).map((item) => sanitizeRecursive(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : sanitizeRecursive(v, depth + 1);
    }
    return out;
  }
  return val;
};

const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return null;
  const cleaned = sanitizeRecursive(body, 0);
  try {
    const serialized = JSON.stringify(cleaned);
    if (serialized.length > MAX_AUDIT_BODY_BYTES) {
      return { _truncated: true, bytes: serialized.length, keys: Object.keys(cleaned).slice(0, 25) };
    }
  } catch {
    return { _truncated: true };
  }
  return cleaned;
};

const auditLog = (req, res, next) => {
  let recorded = false;

  const recordAudit = (data = null) => {
    if (recorded) return;
    const routePath = `${req.baseUrl || ''}${req.path || ''}`;
    if (!shouldAudit(req.method, routePath)) return;
    recorded = true;

    let resolvedUserId = req.user?.id || null;
    let resolvedUsername = req.user?.username || 'anonymous';

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
      username: String(resolvedUsername || 'anonymous').slice(0, 60),
      action: `${req.method} ${routePath}`.slice(0, 100),
      ip: String(req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').slice(0, 45) || null,
      method: String(req.method || '').slice(0, 10),
      path: String(routePath || '').slice(0, 255),
      status: res.statusCode,
      details: {
        body: sanitizeBody(req.body),
        params: req.params,
        query: req.query
      }
    };

    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.info(`AUDIT: ${auditEntry.action}`, auditEntry);
    } else if (res.statusCode >= 400) {
      logger.warn(`AUDIT: ${auditEntry.action} (${res.statusCode})`, auditEntry);
    }

    AuditLog.create(auditEntry).catch(err => {
      logger.error('❌ Failed to save AuditLog to database:', err);
    });
  };

  // Override res.json to capture JSON payloads (e.g., login/register identity)
  const originalJson = res.json;
  res.json = function(data) {
    recordAudit(data);
    return originalJson.call(this, data);
  };

  // Capture binary/stream responses (e.g., /api/export/*) when finish fires without res.json
  if (typeof res.on === 'function') {
    res.on('finish', () => recordAudit(null));
  }

  next();
};

module.exports = { auditLog, shouldAudit };
