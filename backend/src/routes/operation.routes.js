// =============================================================================
// routes/operation.routes.js — Operations, Crew Members, Mission Logs & Bulk Ops
// =============================================================================
const router = require('express').Router();
const { Op } = require('sequelize');
const {
  Operation,
  OperationType,
  OperationMember,
  OperationLog,
  Simulator,
  SimulatorSubsystem,
  MaintenanceRecord,
  User,
  sequelize
} = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { validateIdParam } = require('../middleware/validation.middleware');
const {
  sanitizeMembersInput,
  sanitizeOperationPayload,
  sanitizeBulkOperationAction,
  sanitizeOperationLogPayload,
  buildOperationSortOrder,
  summarizeOperationRows,
  summarizeSortieFleetMetrics
} = require('../services/operation-helpers.service');
const { detectSortieBayConflict } = require('../services/simulator-helpers.service');

const LIST_INCLUDES = [
  { model: OperationType, as: 'type' },
  { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'name', 'bay_code', 'aircraft_type', 'qualification_level', 'status', 'limitations_mel'] },
  { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url'] },
  {
    model: OperationMember,
    as: 'members',
    include: [
      { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url', 'job_title'] }
    ]
  }
];

async function syncOperationMembers(operationId, membersList, transaction) {
  await OperationMember.destroy({ where: { operation_id: operationId }, transaction });
  if (membersList.length > 0) {
    await OperationMember.bulkCreate(
      membersList.map(m => ({
        operation_id: operationId,
        user_id: m.user_id,
        role_in_op: m.role_in_op
      })),
      { transaction }
    );
  }
}

// ── Static routes MUST stay strictly BEFORE /:id ─────────────────────────────

// GET /operations/types — operation categories/types
router.get('/types', async (req, res, next) => {
  try {
    const types = await OperationType.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: types });
  } catch (err) { next(err); }
});

// GET /operations/staff — active users for crew roster assignment
router.get('/staff', async (req, res, next) => {
  try {
    const users = await User.findAll({
      where: { is_active: true },
      attributes: ['id', 'username', 'first_name', 'last_name', 'department', 'job_title', 'avatar_url'],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']]
    });
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// GET /operations/summary — real DB KPI metrics respecting active date range & simulator filter
router.get('/summary', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = {};
    if (from || to) {
      where.start_date = {};
      if (from) where.start_date[Op.gte] = from;
      if (to) where.start_date[Op.lte] = to;
    }
    if (req.query.simulator_id && Number.isInteger(Number(req.query.simulator_id)) && Number(req.query.simulator_id) > 0) {
      where.simulator_id = Number(req.query.simulator_id);
    }

    const rows = await Operation.findAll({
      where,
      attributes: [
        'id', 'status', 'start_date', 'end_date', 'actual_end_date',
        'scheduled_hours', 'actual_flight_hours', 'lost_training_minutes', 'outcome'
      ]
    });

    const plain = rows.map(r => r.get({ plain: true }));
    res.json({
      success: true,
      data: {
        ...summarizeOperationRows(plain),
        ...summarizeSortieFleetMetrics(plain)
      }
    });
  } catch (err) { next(err); }
});

// GET /operations/check-conflict — preflight slot overlap + bay readiness verification
router.get('/check-conflict', async (req, res, next) => {
  try {
    const simId = Number(req.query.simulator_id);
    if (!Number.isInteger(simId) || simId < 1) {
      return res.json({ success: true, data: { hasOverlap: false, overlappingSorties: [], warnings: [] } });
    }

    const [simulator, subsystems, existingSorties] = await Promise.all([
      Simulator.findByPk(simId),
      SimulatorSubsystem.findAll({ where: { simulator_id: simId }, attributes: ['subsystem_code', 'status'] }),
      Operation.findAll({
        where: { simulator_id: simId, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'sortie_code', 'title', 'status', 'start_date', 'end_date']
      })
    ]);

    const result = detectSortieBayConflict(
      {
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        exclude_id: req.query.exclude_id,
        motion_required: req.query.motion_required !== 'false'
      },
      existingSorties.map(s => s.get({ plain: true })),
      simulator ? simulator.get({ plain: true }) : null,
      subsystems.map(s => s.get({ plain: true }))
    );

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// PATCH /operations/bulk — batch status, priority, or delete
router.patch('/bulk', async (req, res, next) => {
  try {
    const { data, error } = sanitizeBulkOperationAction(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const { ids, action, value } = data;
    let affected = 0;

    if (action === 'status') {
      const updateFields = { status: value };
      if (value === 'COMPLETED') {
        updateFields.actual_end_date = new Date();
      }
      const [count] = await Operation.update(updateFields, {
        where: { id: { [Op.in]: ids } }
      });
      affected = count;

      await OperationLog.bulkCreate(
        ids.map(opId => ({
          operation_id: opId,
          user_id: req.user.id,
          action: `Bulk status update: ${value}`
        }))
      ).catch(() => {});
    } else if (action === 'priority') {
      const [count] = await Operation.update(
        { priority: value },
        { where: { id: { [Op.in]: ids } } }
      );
      affected = count;
    } else if (action === 'delete') {
      affected = await Operation.destroy({ where: { id: { [Op.in]: ids } } });
    }

    res.json({ success: true, data: { affected, ids, action, value } });
  } catch (err) { next(err); }
});

// ── Collection & Item CRUD ───────────────────────────────────────────────────

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const {
      status,
      priority,
      type_id,
      simulator_id,
      outcome,
      date,
      search,
      sort_by,
      sort_dir,
      page = 1,
      limit = 20
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));

    const where = {};
    const andConditions = [];

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
      const dayStart = new Date(`${String(date).trim()}T00:00:00.000Z`);
      const dayEnd = new Date(`${String(date).trim()}T23:59:59.999Z`);
      andConditions.push({
        start_date: { [Op.lte]: dayEnd },
        [Op.or]: [
          { end_date: { [Op.gte]: dayStart } },
          { end_date: null, start_date: { [Op.gte]: dayStart } }
        ]
      });
    } else if (from || to) {
      where.start_date = {};
      if (from) where.start_date[Op.gte] = from;
      if (to) where.start_date[Op.lte] = to;
    }

    const normalizedStatus = String(status || '').trim().toUpperCase();
    if (normalizedStatus === 'OVERDUE') {
      andConditions.push({
        status: { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] },
        end_date: { [Op.ne]: null, [Op.lt]: new Date() }
      });
    } else if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    if (priority) where.priority = String(priority).trim().toUpperCase();
    if (outcome) where.outcome = String(outcome).trim().toUpperCase();
    if (type_id && Number.isInteger(Number(type_id)) && Number(type_id) > 0) {
      where.type_id = Number(type_id);
    }
    if (simulator_id && Number.isInteger(Number(simulator_id)) && Number(simulator_id) > 0) {
      where.simulator_id = Number(simulator_id);
    }

    if (search?.trim()) {
      const searchTerm = `%${search.trim()}%`;
      andConditions.push({
        [Op.or]: [
          { title: { [Op.like]: searchTerm } },
          { sortie_code: { [Op.like]: searchTerm } },
          { customer_operator: { [Op.like]: searchTerm } },
          { scenario_code: { [Op.like]: searchTerm } },
          { description: { [Op.like]: searchTerm } },
          { location: { [Op.like]: searchTerm } },
          { notes: { [Op.like]: searchTerm } }
        ]
      });
    }

    if (andConditions.length) {
      where[Op.and] = andConditions;
    }

    const order = buildOperationSortOrder(sort_by, sort_dir, { OperationType, User });

    const { count, rows } = await Operation.findAndCountAll({
      where,
      distinct: true,
      include: LIST_INCLUDES,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order
    });

    res.json({
      success: true,
      data: { items: rows, total: count, page: parsedPage, limit: parsedLimit }
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { data, error } = sanitizeOperationPayload(req.body, { isCreate: true });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const membersRes = sanitizeMembersInput(req.body?.members);
    if (membersRes.error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: membersRes.error });
    }

    if (data.simulator_id && !data.location) {
      const sim = await Simulator.findByPk(data.simulator_id, { attributes: ['id', 'bay_code', 'code'], transaction });
      if (sim) data.location = `${sim.bay_code} · ${sim.code}`;
    }
    if (!data.sortie_code) {
      const ymd = new Date(data.start_date).toISOString().slice(2, 10).replace(/-/g, '');
      const suffix = String(Math.floor(100 + Math.random() * 900));
      data.sortie_code = `SRT-${ymd}-${suffix}`;
    }
    if ((data.scheduled_hours === undefined || data.scheduled_hours === null) && data.start_date && data.end_date) {
      const diffHrs = Math.round(((new Date(data.end_date).getTime() - new Date(data.start_date).getTime()) / 3600000) * 100) / 100;
      if (diffHrs > 0 && diffHrs <= 24) data.scheduled_hours = diffHrs;
    }

    const op = await Operation.create(
      { ...data, created_by: req.user.id },
      { transaction }
    );

    if (membersRes.provided && membersRes.data.length > 0) {
      await syncOperationMembers(op.id, membersRes.data, transaction);
    }

    await OperationLog.create({
      operation_id: op.id,
      user_id: req.user.id,
      action: 'Operation created',
      details: `Initial status: ${op.status}`
    }, { transaction });

    await transaction.commit();

    const full = await Operation.findByPk(op.id, { include: LIST_INCLUDES });
    res.status(201).json({ success: true, data: full || op });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, {
      include: [
        ...LIST_INCLUDES,
        {
          model: OperationLog,
          as: 'logs',
          include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username'] }]
        }
      ],
      order: [[{ model: OperationLog, as: 'logs' }, 'logged_at', 'DESC']]
    });
    if (!op) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: op });
  } catch (err) { next(err); }
});

router.put('/:id', validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const op = await Operation.findByPk(req.params.id, { transaction });
    if (!op) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const { data, error } = sanitizeOperationPayload(req.body, { isCreate: false, existing: op });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const membersRes = sanitizeMembersInput(req.body?.members);
    if (membersRes.error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: membersRes.error });
    }

    const previousStatus = op.status;
    await op.update(data, { transaction });

    if (membersRes.provided) {
      await syncOperationMembers(op.id, membersRes.data, transaction);
    }

    if (data.status && data.status !== previousStatus) {
      await OperationLog.create({
        operation_id: op.id,
        user_id: req.user.id,
        action: `Status changed: ${previousStatus} -> ${data.status}`
      }, { transaction });
    }

    await transaction.commit();

    const full = await Operation.findByPk(op.id, { include: LIST_INCLUDES });
    res.json({ success: true, data: full || op });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// POST /operations/:id/duplicate — clone operation + crew roster into PLANNED draft
router.post('/:id/duplicate', validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const source = await Operation.findByPk(req.params.id, {
      include: [{ model: OperationMember, as: 'members' }],
      transaction
    });
    if (!source) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const copy = await Operation.create({
      sortie_code: `SRT-${String(Date.now()).slice(-6)}`,
      type_id: source.type_id,
      simulator_id: source.simulator_id,
      created_by: req.user.id,
      title: `${source.title} (Copy)`.slice(0, 200),
      customer_operator: source.customer_operator,
      scenario_code: source.scenario_code,
      weather_profile: source.weather_profile,
      motion_required: source.motion_required,
      scheduled_hours: source.scheduled_hours,
      description: source.description,
      status: 'PLANNED',
      priority: source.priority,
      location: source.location,
      start_date: source.start_date,
      end_date: source.end_date,
      actual_end_date: null,
      notes: source.notes
    }, { transaction });

    const existingMembers = (source.members || []).map(m => ({
      operation_id: copy.id,
      user_id: m.user_id,
      role_in_op: m.role_in_op
    }));
    if (existingMembers.length > 0) {
      await OperationMember.bulkCreate(existingMembers, { transaction });
    }

    await OperationLog.create({
      operation_id: copy.id,
      user_id: req.user.id,
      action: `Duplicated from operation #${source.id}`
    }, { transaction });

    await transaction.commit();

    const full = await Operation.findByPk(copy.id, { include: LIST_INCLUDES });
    res.status(201).json({ success: true, data: full || copy });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// ── Crew Members Endpoints ───────────────────────────────────────────────────

router.get('/:id/members', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, { attributes: ['id'] });
    if (!op) return res.status(404).json({ success: false, message: 'Operation not found' });

    const members = await OperationMember.findAll({
      where: { operation_id: op.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url', 'job_title'] }],
      order: [['joined_at', 'ASC']]
    });
    res.json({ success: true, data: members });
  } catch (err) { next(err); }
});

router.post('/:id/members', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, { attributes: ['id'] });
    if (!op) return res.status(404).json({ success: false, message: 'Operation not found' });

    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ success: false, message: 'Valid user_id is required.' });
    }
    const targetUser = await User.findByPk(userId, { attributes: ['id', 'first_name', 'last_name', 'username'] });
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });

    const roleInOp = String(req.body?.role_in_op ?? '').trim().slice(0, 100) || null;
    const [member, created] = await OperationMember.findOrCreate({
      where: { operation_id: op.id, user_id: userId },
      defaults: { operation_id: op.id, user_id: userId, role_in_op: roleInOp }
    });
    if (!created) {
      await member.update({ role_in_op: roleInOp });
    }

    const memberName = `${targetUser.first_name || ''} ${targetUser.last_name || ''}`.trim() || targetUser.username;
    await OperationLog.create({
      operation_id: op.id,
      user_id: req.user.id,
      action: `${created ? 'Assigned crew member' : 'Updated crew role'}: ${memberName}`,
      details: roleInOp ? `Role: ${roleInOp}` : null
    }).catch(() => {});

    const members = await OperationMember.findAll({
      where: { operation_id: op.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username', 'avatar_url', 'job_title'] }],
      order: [['joined_at', 'ASC']]
    });
    res.status(created ? 201 : 200).json({ success: true, data: members });
  } catch (err) { next(err); }
});

router.delete('/:id/members/:userId', validateIdParam, async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid userId.' });
    }
    const deleted = await OperationMember.destroy({
      where: { operation_id: req.params.id, user_id: userId }
    });
    if (!deleted) return res.status(404).json({ success: false, message: 'Member not found on operation.' });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Mission Logs Endpoints ───────────────────────────────────────────────────

router.get('/:id/logs', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, { attributes: ['id'] });
    if (!op) return res.status(404).json({ success: false, message: 'Operation not found' });

    const logs = await OperationLog.findAll({
      where: { operation_id: op.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username'] }],
      order: [['logged_at', 'DESC'], ['id', 'DESC']]
    });
    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
});

router.post('/:id/logs', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id, { attributes: ['id'] });
    if (!op) return res.status(404).json({ success: false, message: 'Operation not found' });

    const { data, error } = sanitizeOperationLogPayload(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const log = await OperationLog.create({
      operation_id: op.id,
      user_id: req.user.id,
      action: data.action,
      details: data.details
    });

    const full = await OperationLog.findByPk(log.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'username'] }]
    });
    res.status(201).json({ success: true, data: full || log });
  } catch (err) { next(err); }
});

// POST /operations/:id/snag — 1-click Post-Sortie Discrepancy Report (DR) linked to Simulator
router.post('/:id/snag', validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const op = await Operation.findByPk(req.params.id, { transaction });
    if (!op) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Sortie not found' });
    }

    const title = String(req.body?.title ?? '').trim().slice(0, 200);
    const description = String(req.body?.description ?? '').trim().slice(0, 4000);
    if (!title || !description) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Snag title and description are required.' });
    }

    const severity = ['MINOR', 'DEGRADED', 'AOG'].includes(String(req.body?.severity || '').toUpperCase())
      ? String(req.body.severity).toUpperCase()
      : 'DEGRADED';
    const subsystemCode = req.body?.subsystem_code ? String(req.body.subsystem_code).trim().toUpperCase().slice(0, 60) : null;
    const lostMinutes = Math.max(0, Math.min(1440, Math.round(Number(req.body?.lost_training_minutes) || 0)));
    const simulatorId = req.body?.simulator_id ? Number(req.body.simulator_id) : op.simulator_id;

    const drRecord = await MaintenanceRecord.create({
      simulator_id: simulatorId || null,
      sortie_id: op.id,
      subsystem_code: subsystemCode,
      severity,
      lost_training_hours: Math.round((lostMinutes / 60) * 100) / 100,
      is_snag: true,
      performed_by: req.user.id,
      type: 'CORRECTIVE',
      title,
      description,
      status: 'SCHEDULED',
      priority: severity === 'AOG' ? 'CRITICAL' : (severity === 'DEGRADED' ? 'HIGH' : 'MEDIUM'),
      scheduled_date: new Date()
    }, { transaction });

    const nextLostMin = (Number(op.lost_training_minutes) || 0) + lostMinutes;
    const nextOutcome = severity === 'AOG' ? 'INTERRUPTED_TECH' : 'COMPLETED_WITH_SNAGS';
    const combinedSummary = op.snag_summary ? `${op.snag_summary}\n• [${severity}] ${title}` : `[${severity}] ${title}`;

    await op.update({
      lost_training_minutes: nextLostMin,
      outcome: nextOutcome,
      snag_summary: combinedSummary
    }, { transaction });

    if (simulatorId && (severity === 'AOG' || severity === 'DEGRADED')) {
      const targetSim = await Simulator.findByPk(simulatorId, { transaction });
      if (targetSim) {
        await targetSim.update({
          status: severity === 'AOG' ? 'AOG' : (targetSim.status === 'AOG' ? 'AOG' : 'DEGRADED'),
          limitations_mel: severity === 'DEGRADED' ? (targetSim.limitations_mel ? `${targetSim.limitations_mel}; ${title}` : title) : targetSim.limitations_mel
        }, { transaction });
      }
    }

    await OperationLog.create({
      operation_id: op.id,
      user_id: req.user.id,
      action: `DR Snag Logged [${severity}]: ${title}`,
      details: subsystemCode ? `Subsystem: ${subsystemCode} · Lost time: ${lostMinutes} min` : `Lost time: ${lostMinutes} min`
    }, { transaction });

    await transaction.commit();
    res.status(201).json({ success: true, data: drRecord });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

router.delete('/:id', validateIdParam, async (req, res, next) => {
  try {
    const op = await Operation.findByPk(req.params.id);
    if (!op) return res.status(404).json({ success: false, message: 'Not found' });
    await op.destroy();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
