// =============================================================================
// routes/planned-maintenance.routes.js — Planned Maintenance CRUD + Calendar
// =============================================================================
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/planned-maintenance.controller');

// ── Validation middleware ────────────────────────────────────────────────────
const validateCreate = [
  body('system').notEmpty().withMessage('System is required.'),
  body('subsystem').notEmpty().withMessage('Subsystem is required.'),
  body('task').notEmpty().withMessage('Task description is required.'),
  body('operation_date_start').isISO8601().withMessage('Valid start date required.'),
  body('operation_date_end').isISO8601().withMessage('Valid end date required.'),
  body('repeat_task_type').isIn(['DAY', 'WEEK', 'MONTH']).withMessage('repeat_task_type must be DAY, WEEK, or MONTH.'),
  body('repeat_task_number').isInt({ min: 1 }).withMessage('repeat_task_number must be >= 1.'),
  body('recurrence_end_date').optional({ nullable: true }).isISO8601().withMessage('recurrence_end_date must be a valid date.')
];

const validateUpdate = [
  body('system').optional().notEmpty(),
  body('subsystem').optional().notEmpty(),
  body('task').optional().notEmpty(),
  body('operation_date_start').optional().isISO8601(),
  body('operation_date_end').optional().isISO8601(),
  body('repeat_task_type').optional().isIn(['DAY', 'WEEK', 'MONTH']),
  body('repeat_task_number').optional().isInt({ min: 1 }),
  body('recurrence_end_date').optional({ nullable: true }).isISO8601(),
  body('status').optional().isIn(['TODO', 'DONE'])
];

const validateOccurrenceUpdate = [
  body('operation_date_start').optional().isISO8601(),
  body('operation_date_end').optional().isISO8601(),
  body('status').optional().isIn(['TODO', 'DONE']),
  body('repeat_task_type').optional().isIn(['DAY', 'WEEK', 'MONTH']),
  body('repeat_task_number').optional().isInt({ min: 1 }),
  body('recurrence_end_date').optional({ nullable: true }).isISO8601()
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

// GET /api/maintenance/planned/systems — distinct system values for filters
router.get('/systems', ctrl.getSystems);

// GET /api/maintenance/planned/summary — monthly planned maintenance KPIs
router.get('/summary', ctrl.getSummary);

// GET /api/maintenance/planned/calendar/:year/:month — calendar indicators
router.get('/calendar/:year/:month', ctrl.getCalendarIndicators);

// GET /api/maintenance/planned/date/:date — tasks for specific date (YYYY-MM-DD)
router.get('/date/:date', ctrl.getByDate);

// POST /api/maintenance/planned/:id/work-order — create work order from planned task
router.post('/:id/work-order', authorize('admin', 'manager', 'tech'), ctrl.createWorkOrder);

// PUT /api/maintenance/planned/:id/occurrence/:date — update a single occurrence
router.put('/:id/occurrence/:date', authorize('admin', 'manager', 'tech'), validateOccurrenceUpdate, handleValidation, ctrl.updateOccurrence);

// DELETE /api/maintenance/planned/:id/occurrence/:date — delete one occurrence only
router.delete('/:id/occurrence/:date', authorize('admin', 'manager'), ctrl.deleteOccurrence);

// GET /api/maintenance/planned/:id — single task
router.get('/:id', ctrl.getById);

// POST /api/maintenance/planned — create
router.post('/', authorize('admin', 'manager', 'tech'), validateCreate, handleValidation, ctrl.create);

// PUT /api/maintenance/planned/:id — update
router.put('/:id', authorize('admin', 'manager', 'tech'), validateUpdate, handleValidation, ctrl.update);

// DELETE /api/maintenance/planned/:id — delete
router.delete('/:id', authorize('admin', 'manager'), ctrl.remove);

module.exports = router;
