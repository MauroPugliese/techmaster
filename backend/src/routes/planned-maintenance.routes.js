// =============================================================================
// routes/planned-maintenance.routes.js — Planned Maintenance CRUD + Calendar
// =============================================================================
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const ctrl = require('../controllers/planned-maintenance.controller');

// ── Validation middleware ────────────────────────────────────────────────────
const validateCreate = [
  body('system').notEmpty().withMessage('System is required.'),
  body('subsystem').notEmpty().withMessage('Subsystem is required.'),
  body('task').notEmpty().withMessage('Task description is required.'),
  body('operation_date_start').isISO8601().withMessage('Valid start date required.'),
  body('operation_date_end').isISO8601().withMessage('Valid end date required.'),
  body('repeat_task_type').isIn(['DAY', 'WEEK', 'MONTH']).withMessage('repeat_task_type must be DAY, WEEK, or MONTH.'),
  body('repeat_task_number').isInt({ min: 1 }).withMessage('repeat_task_number must be >= 1.')
];

const validateUpdate = [
  body('system').optional().notEmpty(),
  body('subsystem').optional().notEmpty(),
  body('task').optional().notEmpty(),
  body('operation_date_start').optional().isISO8601(),
  body('operation_date_end').optional().isISO8601(),
  body('repeat_task_type').optional().isIn(['DAY', 'WEEK', 'MONTH']),
  body('repeat_task_number').optional().isInt({ min: 1 }),
  body('status').optional().isIn(['TODO', 'DONE'])
];

// ── Validation error handler ─────────────────────────────────────────────────
const { validationResult } = require('express-validator');
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/maintenance/planned — list all (with search, pagination, filters)
router.get('/', ctrl.getAll);

// GET /api/maintenance/planned/calendar/:year/:month — calendar indicators
router.get('/calendar/:year/:month', ctrl.getCalendarIndicators);

// GET /api/maintenance/planned/date/:date — tasks for specific date (YYYY-MM-DD)
router.get('/date/:date', ctrl.getByDate);

// GET /api/maintenance/planned/:id — single task
router.get('/:id', ctrl.getById);

// POST /api/maintenance/planned — create
router.post('/', validateCreate, handleValidation, ctrl.create);

// PUT /api/maintenance/planned/:id — update
router.put('/:id', validateUpdate, handleValidation, ctrl.update);

// DELETE /api/maintenance/planned/:id — delete
router.delete('/:id', ctrl.remove);

module.exports = router;