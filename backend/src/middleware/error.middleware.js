const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`, err);

  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const errors = err.errors.map(e => ({ field: e.path, message: e.message }));
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const status  = err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message;

  res.status(status).json({ success: false, message });
};

const parseDateFilter = (req, res, next) => {
  const rawFrom = req.headers['x-date-from'] || req.query.from;
  const rawTo   = req.headers['x-date-to']   || req.query.to;

  const normalizeBoundary = (raw, isEnd) => {
    if (!raw) return null;
    const str = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return new Date(isEnd ? `${str}T23:59:59.999Z` : `${str}T00:00:00.000Z`);
    }
    return new Date(str);
  };

  req.dateRange = {
    from: normalizeBoundary(rawFrom, false),
    to:   normalizeBoundary(rawTo, true)
  };

  if (req.dateRange.from && isNaN(req.dateRange.from)) {
    return res.status(400).json({ success: false, message: 'Invalid date_from format' });
  }
  if (req.dateRange.to && isNaN(req.dateRange.to)) {
    return res.status(400).json({ success: false, message: 'Invalid date_to format' });
  }

  next();
};

module.exports = { errorHandler, parseDateFilter };