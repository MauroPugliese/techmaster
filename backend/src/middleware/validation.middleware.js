// =============================================================================
// middleware/validation.middleware.js — Input Validation Rules & Handlers
// =============================================================================
const { body, query, param, validationResult } = require('express-validator');

// ── Validation Error Handler ──────────────────────────────────────────────────
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.param,
        value: err.value,
        message: err.msg,
        location: err.location
      }))
    });
  }
  next();
};

// ── Auth Register Validation ──────────────────────────────────────────────────
const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 60 })
    .withMessage('Username must be 3-60 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscore, hyphen'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('first_name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('First name is required (max 80 chars)'),
  body('last_name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Last name is required (max 80 chars)'),
  body('department').trim().isLength({ max: 100 }).optional(),
  body('job_title').trim().isLength({ max: 100 }).optional(),
  body('phone').trim().isLength({ max: 30 }).optional(),
  handleValidationErrors
];

// ── Auth Login Validation ─────────────────────────────────────────────────────
const validateLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Invalid email format'),
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required'),
  handleValidationErrors
];

// ── Auth Refresh Validation ──────────────────────────────────────────────────
const validateRefresh = [
  body('refresh_token')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Refresh token is required'),
  handleValidationErrors
];

// ── Auth Profile Update Validation ───────────────────────────────────────────
const validateUpdateProfile = [
  body('first_name').trim().isLength({ max: 80 }).optional(),
  body('last_name').trim().isLength({ max: 80 }).optional(),
  body('department').trim().isLength({ max: 100 }).optional(),
  body('job_title').trim().isLength({ max: 100 }).optional(),
  body('phone').trim().isLength({ max: 30 }).optional(),
  body('avatar_url').trim().isURL().optional({ checkFalsy: true }),
  body('current_password')
    .if(() => body('new_password').exists())
    .isLength({ min: 1 })
    .withMessage('Current password required for password change'),
  body('new_password')
    .if(() => body('current_password').exists())
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  handleValidationErrors
];

// ── Warehouse Item Validation ─────────────────────────────────────────────────
const validateInventoryItem = [
  body('category_id')
    .isInt({ min: 1 })
    .withMessage('Valid category_id required'),
  body('sku')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('SKU required (max 80 chars)'),
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name required (max 200 chars)'),
  body('description').trim().isLength({ max: 1000 }).optional(),
  body('unit').trim().isLength({ min: 1, max: 30 }).optional({ checkFalsy: true }),
  body('quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be non-negative integer'),
  body('min_stock')
    .isInt({ min: 0 })
    .optional({ checkFalsy: true })
    .withMessage('Min stock must be non-negative integer'),
  body('unit_cost')
    .isDecimal({ decimal_digits: '1,2' })
    .optional({ checkFalsy: true })
    .withMessage('Unit cost format invalid'),
  handleValidationErrors
];

// ── Stock Movement Validation ─────────────────────────────────────────────────
const validateStockMovement = [
  body('type')
    .isIn(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'RETURN'])
    .withMessage('Invalid movement type'),
  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be positive integer'),
  body('reason').trim().isLength({ max: 500 }).optional(),
  body('reference').trim().isLength({ max: 100 }).optional(),
  handleValidationErrors
];

// ── Task Validation ──────────────────────────────────────────────────────────
const validateTask = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 300 })
    .withMessage('Title required (max 300 chars)'),
  body('description').trim().isLength({ max: 2000 }).optional(),
  body('priority')
    .isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional(),
  body('interval_type')
    .isIn(['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
    .optional(),
  body('estimated_hours')
    .isDecimal({ decimal_digits: '1,2' })
    .optional({ checkFalsy: true }),
  handleValidationErrors
];

// ── Shift Validation ──────────────────────────────────────────────────────────
const validateShift = [
  body('shift_type_id')
    .isInt({ min: 1 })
    .withMessage('Valid shift_type_id required'),
  body('user_id')
    .isInt({ min: 1 })
    .withMessage('Valid user_id required'),
  body('date')
    .isISO8601()
    .withMessage('Invalid date format'),
  handleValidationErrors
];

// ── Wiki Article Validation ──────────────────────────────────────────────────
const validateWikiArticle = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 300 })
    .withMessage('Title required (max 300 chars)'),
  body('content')
    .trim()
    .isLength({ min: 1, max: 65000 })
    .withMessage('Content required (max 65000 chars)'),
  body('slug')
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be lowercase with hyphens only'),
  body('status')
    .isIn(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'REVIEW'])
    .optional(),
  handleValidationErrors
];

// ── Pagination Validation ────────────────────────────────────────────────────
const validatePagination = [
  query('page')
    .isInt({ min: 1 })
    .optional({ checkFalsy: true })
    .withMessage('Page must be positive integer'),
  query('limit')
    .isInt({ min: 1, max: 100 })
    .optional({ checkFalsy: true })
    .withMessage('Limit must be 1-100'),
  handleValidationErrors
];

// ── ID Parameter Validation ──────────────────────────────────────────────────
const validateIdParam = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid ID'),
  handleValidationErrors
];

module.exports = {
  validateRegister,
  validateLogin,
  validateRefresh,
  validateUpdateProfile,
  validateInventoryItem,
  validateStockMovement,
  validateTask,
  validateShift,
  validateWikiArticle,
  validatePagination,
  validateIdParam,
  handleValidationErrors
};
