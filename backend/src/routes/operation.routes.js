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
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  MaintenanceRecord,
  User,
  sequelize
} = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { authorize } = require('../middleware/auth.middleware');
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
const { broadcastOperationalAlert } = require('../services/proactive-alerts.service');
const { emitDomainUpdate } = require('../config/socket');

/**
 * Auto-syncs Simulator live status (READY <-> IN_SORTIE) and accumulates hub
 * power_on_hours / motion_hours when a sortie starts, completes, or exits IN_PROGRESS.
 */
async function syncSimulatorOnSortieTransition({ op, previousStatus = null, alreadyAccrued = false, transaction }) {
  if (!op?.simulator_id) return;
  const sim = await Simulator.findByPk(op.simulator_id, { transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!sim) return;

  if (op.status === 'IN_PROGRESS' && previousStatus !== 'IN_PROGRESS') {
    if (sim.status === 'READY' || sim.status === 'PRE_FLIGHT') {
      await sim.update({ status: 'IN_SORTIE' }, { transaction });
    }
    return;
  }

  const updates = {};
  const transitionedToCompleted = op.status === 'COMPLETED' && previousStatus !== 'COMPLETED';
  const exitedInProgress = previousStatus === 'IN_PROGRESS' && op.status !== 'IN_PROGRESS';

  if (transitionedToCompleted && !alreadyAccrued) {
    let flownHours = Number(op.actual_flight_hours);
    if (!Number.isFinite(flownHours) || flownHours <= 0) {
      flownHours = Number(op.scheduled_hours);
    }
    if ((!Number.isFinite(flownHours) || flownHours <= 0) && op.start_date && (op.actual_end_date || op.end_date)) {
      const diffMs = new Date(op.actual_end_date || op.end_date).getTime() - new Date(op.start_date).getTime();
      if (Number.isFinite(diffMs) && diffMs > 0) {
        flownHours = Math.min(24, Math.round((diffMs / 3600000) * 100) / 100);
      }
    }
    flownHours = Number.isFinite(flownHours) && flownHours > 0 ? flownHours : 0;

    if (flownHours > 0) {
      updates.power_on_hours = Number(((Number(sim.power_on_hours) || 0) + flownHours).toFixed(1));
      if (op.motion_required !== false) {
        updates.motion_hours = Number(((Number(sim.motion_hours) || 0) + flownHours).toFixed(1));
      }
    }
  }

  if ((transitionedToCompleted || exitedInProgress) && sim.status === 'IN_SORTIE') {
    const otherLive = await Operation.count({
      where: { simulator_id: sim.id, status: 'IN_PROGRESS', id: { [Op.ne]: op.id } },
      transaction
    });
    const openAog = await MaintenanceRecord.count({
      where: { simulator_id: sim.id, severity: 'AOG', status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] } },
      transaction
    });
    if (otherLive === 0 && openAog === 0) {
      updates.status = 'READY';
    }
  }

  if (Object.keys(updates).length > 0) {
    await sim.update(updates, { transaction });
  }
}

const LIST_INCLUDES = [
  { model: OperationType, as: 'type' },
  { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'name', 'bay_code', 'station_kind', 'scheduling_mode', 'schedule_config', 'aircraft_type', 'qualification_level', 'status', 'limitations_mel'] },
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

// POST /operations/types — quick-create training profile / operation type
router.post('/types', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: 'Operation type name is required.' });
    const existing = await OperationType.findOne({ where: { name } });
    if (existing) return res.json({ success: true, data: existing });

    const colorRaw = String(req.body?.color || '#1565C0').trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '#1565C0';
    const icon = String(req.body?.icon || 'flight_takeoff').trim().slice(0, 50) || 'flight_takeoff';
    const description = String(req.body?.description || '').trim().slice(0, 500) || null;
    const created = await OperationType.create({ name, color, icon, description });
    res.status(201).json({ success: true, data: created });
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

// GET /operations/check-conflict — preflight slot overlap + maintenance windows + daily NA check
router.get('/check-conflict', async (req, res, next) => {
  try {
    const simId = Number(req.query.simulator_id);
    if (!Number.isInteger(simId) || simId < 1) {
      return res.json({ success: true, data: { hasOverlap: false, overlappingSorties: [], overlappingMaintenance: [], warnings: [] } });
    }

    const startDateObj = req.query.start_date ? new Date(req.query.start_date) : new Date();
    const dateStr = !Number.isNaN(startDateObj.getTime()) ? startDateObj.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const [simulator, subsystems, existingSorties, dayMaint, dailyShiftEntries] = await Promise.all([
      Simulator.findByPk(simId),
      SimulatorSubsystem.findAll({ where: { simulator_id: simId }, attributes: ['subsystem_code', 'status'] }),
      Operation.findAll({
        where: { simulator_id: simId, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'sortie_code', 'title', 'status', 'start_date', 'end_date']
      }),
      MaintenanceRecord.findAll({
        where: {
          simulator_id: simId,
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] },
          scheduled_date: { [Op.between]: [dayStart, dayEnd] }
        },
        attributes: ['id', 'title', 'scheduled_date', 'downtime_hours', 'status']
      }),
      SimulatorShiftEntry.findAll({
        where: { simulator_id: simId },
        include: [{
          model: SimulatorDailyShift,
          as: 'shift',
          required: true,
          include: [{
            model: SimulatorDailyLog,
            as: 'dailyLog',
            required: true,
            where: { log_date: dateStr }
          }]
        }]
      }).catch(() => [])
    ]);

    const maintWindows = dayMaint.map(m => {
      const s = new Date(m.scheduled_date);
      const hrs = Number(m.downtime_hours) > 0 ? Number(m.downtime_hours) : 2;
      return {
        id: m.id,
        title: m.title,
        source: 'MAINTENANCE_WO',
        start_date: s.toISOString(),
        end_date: new Date(s.getTime() + hrs * 3600000).toISOString()
      };
    });

    const dailyShiftStatus = dailyShiftEntries.some(e => e.usage_status === 'NA') ? 'NA' : null;

    const result = detectSortieBayConflict(
      {
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        exclude_id: req.query.exclude_id,
        motion_required: req.query.motion_required !== 'false'
      },
      existingSorties.map(s => s.get({ plain: true })),
      simulator ? simulator.get({ plain: true }) : null,
      subsystems.map(s => s.get({ plain: true })),
      maintWindows,
      dailyShiftStatus
    );

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// PATCH /operations/bulk — batch status, priority, or delete
router.patch('/bulk', authorize('admin', 'manager'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { data, error } = sanitizeBulkOperationAction(req.body);
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const { ids, action, value } = data;
    const targetOps = await Operation.findAll({
      where: { id: { [Op.in]: ids } },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    let affected = 0;

    if (action === 'status') {
      const updateFields = { status: value };
      if (value === 'COMPLETED') {
        updateFields.actual_end_date = new Date();
      }
      const [count] = await Operation.update(updateFields, {
        where: { id: { [Op.in]: ids } },
        transaction
      });
      affected = count;

      await OperationLog.bulkCreate(
        targetOps.map(op => ({
          operation_id: op.id,
          user_id: req.user.id,
          action: `Bulk status update: ${value}`
        })),
        { transaction }
      );

      for (const op of targetOps) {
        const prev = op.status;
        op.status = value;
        await syncSimulatorOnSortieTransition({ op, previousStatus: prev, transaction });
      }
    } else if (action === 'priority') {
      const [count] = await Operation.update(
        { priority: value },
        { where: { id: { [Op.in]: ids } }, transaction }
      );
      affected = count;
    } else if (action === 'delete') {
      const affectedSimIds = [...new Set(targetOps.map(o => o.simulator_id).filter(Boolean))];
      affected = await Operation.destroy({ where: { id: { [Op.in]: ids } }, transaction });
      for (const simId of affectedSimIds) {
        const sim = await Simulator.findByPk(simId, { transaction, lock: transaction.LOCK.UPDATE });
        if (sim && sim.status === 'IN_SORTIE') {
          const otherLive = await Operation.count({ where: { simulator_id: simId, status: 'IN_PROGRESS' }, transaction });
          if (otherLive === 0) await sim.update({ status: 'READY' }, { transaction });
        }
      }
    }

    await transaction.commit();
    res.json({ success: true, data: { affected, ids, action, value } });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    next(err);
  }
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
      // Buffer ±14h around UTC date boundaries so any client local timezone (UTC-12..UTC+14)
      // receives every sortie touching that local calendar day without dropping near-midnight slots
      const baseStart = new Date(`${String(date).trim()}T00:00:00.000Z`).getTime();
      const baseEnd = new Date(`${String(date).trim()}T23:59:59.999Z`).getTime();
      const dayStart = new Date(baseStart - 14 * 3600000);
      const dayEnd = new Date(baseEnd + 14 * 3600000);
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
          { mission_name: { [Op.like]: searchTerm } },
          { instructor_name: { [Op.like]: searchTerm } },
          { pilot_name: { [Op.like]: searchTerm } },
          { copilot_name: { [Op.like]: searchTerm } },
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

router.post('/', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const incoming = { ...(req.body || {}) };
    if (!incoming.type_id) {
      const defaultType = await OperationType.findOne({ order: [['id', 'ASC']], transaction });
      if (defaultType) incoming.type_id = defaultType.id;
    }
    if (!String(incoming.title || '').trim()) {
      const fallbackMission = String(incoming.mission_name || '').trim();
      incoming.title = fallbackMission || 'Simulator Sortie';
    }

    const { data, error } = sanitizeOperationPayload(incoming, { isCreate: true });
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

    const repeatDays = Math.min(7, Math.max(1, parseInt(req.body?.repeat_days, 10) || 1));
    const baseStartMs = data.start_date ? new Date(data.start_date).getTime() : Date.now();
    const baseEndMs = data.end_date ? new Date(data.end_date).getTime() : null;
    const baseCode = data.sortie_code;
    const createdOps = [];

    for (let dayIdx = 0; dayIdx < repeatDays; dayIdx++) {
      const shiftMs = dayIdx * 86400000;
      const itemStart = new Date(baseStartMs + shiftMs);
      const itemEnd = baseEndMs !== null ? new Date(baseEndMs + shiftMs) : null;
      const itemCode = repeatDays > 1 ? `${baseCode}-D${dayIdx + 1}` : baseCode;
      const itemTitle = repeatDays > 1 ? `${data.title} (Day ${dayIdx + 1}/${repeatDays})`.slice(0, 200) : data.title;

      const op = await Operation.create(
        {
          ...data,
          title: itemTitle,
          sortie_code: itemCode,
          start_date: itemStart,
          end_date: itemEnd,
          created_by: req.user.id
        },
        { transaction }
      );

      if (membersRes.provided && membersRes.data.length > 0) {
        await syncOperationMembers(op.id, membersRes.data, transaction);
      }

      await OperationLog.create({
        operation_id: op.id,
        user_id: req.user.id,
        action: repeatDays > 1 ? `Series sortie created (Day ${dayIdx + 1}/${repeatDays})` : 'Operation created',
        details: `Initial status: ${op.status}`
      }, { transaction });

      if (dayIdx === 0) {
        await syncSimulatorOnSortieTransition({ op, previousStatus: null, transaction });
      }
      createdOps.push(op);
    }

    await transaction.commit();

    const primaryOp = createdOps[0];
    const full = await Operation.findByPk(primaryOp.id, { include: LIST_INCLUDES });
    res.status(201).json({
      success: true,
      data: full || primaryOp,
      meta: { createdCount: createdOps.length }
    });
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

router.put('/:id', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const op = await Operation.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
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
    const previousOutcome = op.outcome;
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

    await syncSimulatorOnSortieTransition({ op, previousStatus, transaction });

    await transaction.commit();

    if (op.outcome === 'INTERRUPTED_TECH' && previousOutcome !== 'INTERRUPTED_TECH') {
      await broadcastOperationalAlert({
        req,
        type: 'SORTIE_INTERRUPTED',
        title: `Sortie Tech Interruption: ${op.sortie_code || `#${op.id}`}`,
        body: `${op.title} interrupted due to technical snag${op.lost_training_minutes ? ` (${op.lost_training_minutes} min lost)` : ''}.`,
        link: op.simulator_id ? `/operations?simulatorId=${op.simulator_id}` : '/operations',
        excludeUserId: req.user.id
      });
    }

    const full = await Operation.findByPk(op.id, { include: LIST_INCLUDES });
    res.json({ success: true, data: full || op });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// POST /operations/:id/duplicate — clone operation + crew roster into PLANNED draft
router.post('/:id/duplicate', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
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
      mission_name: source.mission_name,
      instructor_name: source.instructor_name,
      pilot_name: source.pilot_name,
      copilot_name: source.copilot_name,
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

router.post('/:id/members', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
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

router.delete('/:id/members/:userId', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
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

router.post('/:id/logs', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
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

// POST /operations/:id/debrief — 1-click post-sortie close, hub meter accrual & optional Corrective DR WO
router.post('/:id/debrief', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const op = await Operation.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!op) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Sortie not found' });
    }

    const validOutcomes = new Set(['CLEAN', 'COMPLETED_WITH_SNAGS', 'INTERRUPTED_TECH', 'NO_SHOW', 'CANCELLED']);
    const outcome = validOutcomes.has(String(req.body?.outcome || '').toUpperCase())
      ? String(req.body.outcome).toUpperCase()
      : 'CLEAN';

    const actualHoursRaw = req.body?.actual_flight_hours;
    const actualHours = actualHoursRaw !== undefined && actualHoursRaw !== null && actualHoursRaw !== ''
      ? Math.max(0, Math.min(24, Number(Number(actualHoursRaw).toFixed(2))))
      : (Number(op.scheduled_hours) || 0);
    const lostMinutes = Math.max(0, Math.min(1440, Math.round(Number(req.body?.lost_training_minutes) || 0)));
    const snagSummary = req.body?.snag_summary ? String(req.body.snag_summary).trim().slice(0, 2000) : (op.snag_summary || null);
    const previousStatus = op.status;

    await op.update({
      status: outcome === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED',
      actual_end_date: op.actual_end_date || new Date(),
      outcome,
      actual_flight_hours: actualHours,
      lost_training_minutes: lostMinutes,
      snag_summary: snagSummary
    }, { transaction });

    await syncSimulatorOnSortieTransition({ op, previousStatus, transaction });

    let createdWo = null;
    if (req.body?.open_snag_wo === true && op.simulator_id && (snagSummary || req.body?.snag_title)) {
      const severity = ['MINOR', 'DEGRADED', 'AOG'].includes(String(req.body?.severity || '').toUpperCase())
        ? String(req.body.severity).toUpperCase()
        : (outcome === 'INTERRUPTED_TECH' ? 'AOG' : 'DEGRADED');
      const subsystemCode = req.body?.subsystem_code ? String(req.body.subsystem_code).trim().toUpperCase().slice(0, 60) : 'HOST_COMPUTE';
      const woTitle = String(req.body?.snag_title || snagSummary || `Post-Sortie Snag (${op.sortie_code || `#${op.id}`})`).trim().slice(0, 200);

      createdWo = await MaintenanceRecord.create({
        simulator_id: op.simulator_id,
        sortie_id: op.id,
        subsystem_code: subsystemCode,
        severity,
        lost_training_hours: Number((lostMinutes / 60).toFixed(2)),
        is_snag: true,
        performed_by: req.user.id,
        type: 'CORRECTIVE',
        title: woTitle,
        description: snagSummary || woTitle,
        status: 'SCHEDULED',
        priority: severity === 'AOG' ? 'CRITICAL' : (severity === 'DEGRADED' ? 'HIGH' : 'MEDIUM'),
        scheduled_date: new Date()
      }, { transaction });

      if (severity === 'AOG' || severity === 'DEGRADED') {
        const sim = await Simulator.findByPk(op.simulator_id, { transaction });
        if (sim) {
          await sim.update({ status: severity === 'AOG' ? 'AOG' : 'DEGRADED' }, { transaction });
        }
        const sub = await SimulatorSubsystem.findOne({ where: { simulator_id: op.simulator_id, subsystem_code: subsystemCode }, transaction });
        if (sub) {
          await sub.update({ status: severity === 'AOG' ? 'FAULT' : 'DEGRADED', last_checked_at: new Date(), updated_by: req.user.id }, { transaction });
        }
      }
    }

    await OperationLog.create({
      operation_id: op.id,
      user_id: req.user.id,
      action: `Post-Sortie Debrief [${outcome}]`,
      details: `Flown: ${actualHours}h · Lost: ${lostMinutes}m${createdWo ? ` · Opened WO #${createdWo.id}` : ''}`
    }, { transaction });

    await transaction.commit();

    if (outcome === 'INTERRUPTED_TECH' || createdWo?.severity === 'AOG') {
      const simQs = op.simulator_id ? `?simulatorId=${op.simulator_id}` : '';
      await broadcastOperationalAlert({
        req,
        type: 'SORTIE_INTERRUPTED',
        title: `Sortie Debrief Alert: ${op.sortie_code || `#${op.id}`}`,
        body: `${op.title} closed as ${outcome} (${lostMinutes}m lost)${createdWo ? ` — WO #${createdWo.id} opened.` : '.'}`,
        link: createdWo ? `/maintenance${simQs}` : `/operations${simQs}`,
        excludeUserId: req.user.id
      });
    }

    const full = await Operation.findByPk(op.id, { include: LIST_INCLUDES });
    res.json({ success: true, data: { operation: full || op, maintenanceRecord: createdWo } });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// POST /operations/:id/snag — 1-click Post-Sortie Discrepancy Report (DR) linked to Simulator
router.post('/:id/snag', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
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

router.delete('/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const op = await Operation.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!op) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    const simId = op.simulator_id;
    await op.destroy({ transaction });
    if (simId) {
      const sim = await Simulator.findByPk(simId, { transaction, lock: transaction.LOCK.UPDATE });
      if (sim && sim.status === 'IN_SORTIE') {
        const otherLive = await Operation.count({ where: { simulator_id: simId, status: 'IN_PROGRESS' }, transaction });
        if (otherLive === 0) await sim.update({ status: 'READY' }, { transaction });
      }
    }
    await transaction.commit();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    next(err);
  }
});

module.exports = router;
