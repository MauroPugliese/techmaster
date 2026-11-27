// =============================================================================
// routes/maintenance.routes.js — Work Orders, Assets & Stock Integration
// =============================================================================
const router = require('express').Router();
const { Op, col, where: sqlWhere } = require('sequelize');
const {
  MaintenanceRecord,
  Asset,
  AssetCategory,
  Simulator,
  SimulatorSubsystem,
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  InventoryItem,
  StockMovement,
  WikiArticle,
  User,
  sequelize
} = require('../models');
const { parseDateFilter } = require('../middleware/error.middleware');
const { authorize } = require('../middleware/auth.middleware');
const { validateIdParam } = require('../middleware/validation.middleware');
const {
  sanitizeMaintenancePayload,
  sanitizeAssetPayload,
  sanitizeBulkMaintenanceAction,
  buildMaintenanceSortOrder,
  summarizeMaintenanceRows,
  computePartsStockDelta,
  computeReliabilityMetrics
} = require('../services/maintenance-helpers.service');
const { broadcastOperationalAlert } = require('../services/proactive-alerts.service');
const { emitDomainUpdate } = require('../config/socket');

const RECORD_INCLUDES = [
  { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }], required: false },
  { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'name', 'bay_code', 'station_kind', 'aircraft_type', 'status'], required: false },
  { model: WikiArticle, as: 'wikiArticle', attributes: ['id', 'title', 'slug', 'status'], required: false },
  { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name', 'username'] }
];

const OPEN_MAINT_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'];

/**
 * Computes parts_cost from InventoryItem unit costs and applies net stock delta
 * (OUT for increases, RETURN for reductions/removals) safely inside a transaction.
 */
async function syncMaintenancePartsAndStock({
  rec,
  nextParts = [],
  shouldSyncStock = false,
  explicitCostProvided = false,
  userId,
  transaction
}) {
  const partsList = Array.isArray(nextParts) ? nextParts : [];
  const itemIds = [...new Set(partsList.map(p => Number(p.item_id)).filter(n => Number.isInteger(n) && n > 0))];

  let computedPartsCost = 0;
  if (itemIds.length > 0) {
    const items = await InventoryItem.findAll({
      where: { id: { [Op.in]: itemIds } },
      attributes: ['id', 'unit_cost'],
      transaction
    });
    const costMap = new Map(items.map(i => [Number(i.id), Number(i.unit_cost) || 0]));
    for (const part of partsList) {
      if (part.item_id) {
        computedPartsCost += (costMap.get(Number(part.item_id)) || 0) * (Number(part.quantity) || 0);
      }
    }
    computedPartsCost = Number(computedPartsCost.toFixed(2));
  }

  const prevSnapshot = Array.isArray(rec.stock_deducted_snapshot) ? rec.stock_deducted_snapshot : [];
  const mustRunStockDelta = shouldSyncStock || prevSnapshot.length > 0;
  const lowAogAlerts = [];
  let nextSnapshot = prevSnapshot;

  if (mustRunStockDelta) {
    const targetParts = shouldSyncStock || prevSnapshot.length > 0 ? partsList : [];
    const delta = computePartsStockDelta(prevSnapshot, targetParts);

    for (const d of delta.toDeduct) {
      const item = await InventoryItem.findByPk(d.item_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) {
        const err = new Error(`Warehouse item #${d.item_id} not found.`);
        err.statusCode = 404;
        throw err;
      }
      const qtyBefore = Number(item.quantity) || 0;
      const qtyAfter = qtyBefore - d.quantity;
      if (qtyAfter < 0) {
        const err = new Error(`Insufficient warehouse stock for "${item.name}" (${item.sku}): available ${qtyBefore}, requested ${d.quantity}.`);
        err.statusCode = 400;
        throw err;
      }
      await StockMovement.create({
        item_id: item.id,
        user_id: userId,
        simulator_id: rec.simulator_id || null,
        maintenance_record_id: rec.id,
        type: 'OUT',
        quantity: d.quantity,
        quantity_before: qtyBefore,
        quantity_after: qtyAfter,
        reference: `MAINT-#${rec.id}`,
        reason: `Used in maintenance: ${rec.title}`
      }, { transaction });
      await item.update({ quantity: qtyAfter }, { transaction });

      if (item.aog_critical && qtyAfter <= (Number(item.reorder_point) || 0)) {
        lowAogAlerts.push({
          id: item.id,
          sku: item.sku,
          name: item.name,
          quantity: qtyAfter,
          reorder_point: Number(item.reorder_point) || 0
        });
      }
    }

    for (const r of delta.toReturn) {
      const item = await InventoryItem.findByPk(r.item_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) continue;
      const qtyBefore = Number(item.quantity) || 0;
      const qtyAfter = qtyBefore + r.quantity;
      await StockMovement.create({
        item_id: item.id,
        user_id: userId,
        simulator_id: rec.simulator_id || null,
        maintenance_record_id: rec.id,
        type: 'RETURN',
        quantity: r.quantity,
        quantity_before: qtyBefore,
        quantity_after: qtyAfter,
        reference: `MAINT-#${rec.id}`,
        reason: `Returned from maintenance adjustment: ${rec.title}`
      }, { transaction });
      await item.update({ quantity: qtyAfter }, { transaction });
    }

    nextSnapshot = delta.nextSnapshot;
  }

  const updateCostFields = { stock_deducted_snapshot: nextSnapshot };
  const hadPartsCost = rec.parts_cost != null && Number(rec.parts_cost) > 0;
  if (partsList.length > 0 || rec.parts_cost != null) {
    updateCostFields.parts_cost = computedPartsCost;
  }
  const laborCost = Number(rec.labor_cost) || 0;
  if (!explicitCostProvided && (computedPartsCost > 0 || laborCost > 0 || hadPartsCost)) {
    updateCostFields.cost = Number((computedPartsCost + laborCost).toFixed(2));
  }
  await rec.update(updateCostFields, { transaction });

  return { lowAogAlerts, computedPartsCost };
}

/**
 * Synchronizes Simulator & Subsystem operational health (AOG / DEGRADED / RTS READY)
 * and today's Daily Shift Entry when maintenance work orders open, escalate, or complete.
 */
async function syncSimulatorAndSubsystemHealth({ rec, previousStatus = null, previousSeverity = null, userId, transaction }) {
  if (!rec?.simulator_id) return { triggeredAogAlert: false, simulator: null };

  const sim = await Simulator.findByPk(rec.simulator_id, { transaction });
  if (!sim) return { triggeredAogAlert: false, simulator: null };

  const openRecords = await MaintenanceRecord.findAll({
    where: {
      simulator_id: sim.id,
      status: { [Op.in]: OPEN_MAINT_STATUSES }
    },
    attributes: ['id', 'status', 'type', 'severity', 'is_snag', 'subsystem_code'],
    transaction
  });

  // 1. Subsystem health sync
  if (rec.subsystem_code) {
    const sub = await SimulatorSubsystem.findOne({
      where: { simulator_id: sim.id, subsystem_code: rec.subsystem_code },
      transaction
    });
    if (sub) {
      const subOpen = openRecords.filter(r => r.subsystem_code === rec.subsystem_code);
      const hasSubAog = subOpen.some(r => r.severity === 'AOG');
      const hasSubDegraded = subOpen.some(r => r.severity === 'DEGRADED' || r.is_snag || r.type === 'CORRECTIVE');
      if (hasSubAog) {
        await sub.update({ status: 'FAULT', last_checked_at: new Date(), updated_by: userId }, { transaction });
      } else if (hasSubDegraded) {
        await sub.update({ status: 'DEGRADED', last_checked_at: new Date(), updated_by: userId }, { transaction });
      } else if (rec.status === 'COMPLETED' && sub.status !== 'NOMINAL') {
        await sub.update({ status: 'NOMINAL', last_checked_at: new Date(), updated_by: userId }, { transaction });
      }
    }
  }

  // 2. Simulator bay status sync (AOG / DEGRADED / RTS READY)
  const relevantOpen = openRecords.filter(r => r.severity === 'AOG' || r.severity === 'DEGRADED' || r.is_snag || r.type === 'CORRECTIVE');
  const hasAog = relevantOpen.some(r => r.severity === 'AOG');
  const hasDegraded = relevantOpen.some(r => r.severity === 'DEGRADED');

  if (hasAog && sim.status !== 'AOG') {
    await sim.update({ status: 'AOG' }, { transaction });
  } else if (!hasAog && hasDegraded && !['IN_SORTIE', 'DEGRADED', 'MAINTENANCE'].includes(sim.status)) {
    await sim.update({ status: 'DEGRADED' }, { transaction });
  } else if (!hasAog && !hasDegraded && rec.status === 'COMPLETED' && ['AOG', 'DEGRADED', 'MAINTENANCE'].includes(sim.status)) {
    // Auto Return-To-Service (RTS)
    await sim.update({ status: 'READY' }, { transaction });
  }

  // 3. If newly opened or escalated to AOG, mark today's Daily Shift Entry as NA (if present)
  const isNowOpenAog = OPEN_MAINT_STATUSES.includes(rec.status) && rec.severity === 'AOG';
  const wasAlreadyOpenAog = previousStatus && OPEN_MAINT_STATUSES.includes(previousStatus) && previousSeverity === 'AOG';
  const triggeredAogAlert = isNowOpenAog && !wasAlreadyOpenAog;

  if (triggeredAogAlert) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const dailyLog = await SimulatorDailyLog.findOne({
      where: { log_date: todayStr, station_kind: sim.station_kind },
      transaction
    });
    if (dailyLog) {
      const shifts = await SimulatorDailyShift.findAll({
        where: { daily_log_id: dailyLog.id },
        attributes: ['id'],
        transaction
      });
      const shiftIds = shifts.map(s => s.id);
      if (shiftIds.length > 0) {
        const entries = await SimulatorShiftEntry.findAll({
          where: { shift_id: { [Op.in]: shiftIds }, simulator_id: sim.id },
          transaction
        });
        for (const entry of entries) {
          const notePrefix = `[WO #${rec.id} AOG] ${rec.title}`;
          const nextNotes = entry.notes
            ? (entry.notes.includes(`WO #${rec.id}`) ? entry.notes : `${entry.notes} | ${notePrefix}`)
            : notePrefix;
          await entry.update({
            usage_status: 'NA',
            sim_testing_start: '00:00',
            sim_testing_end: '00:00',
            notes: nextNotes,
            updated_by: userId
          }, { transaction });
        }
      }
    }
  }

  return { triggeredAogAlert, simulator: sim.get({ plain: true }) };
}

const ASSET_INCLUDES = [
  { model: AssetCategory, as: 'category' },
  { model: User, as: 'assignedUser', attributes: ['id', 'first_name', 'last_name', 'username'] }
];

// ── Static routes MUST stay BEFORE /:id ──────────────────────────────────────

// GET /maintenance/asset-categories — hardware/software/network asset categories
router.get('/asset-categories', async (req, res, next) => {
  try {
    const categories = await AssetCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
});

// POST /maintenance/asset-categories — quick-create asset category from form dropdown
router.post('/asset-categories', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: 'Asset category name is required.' });
    const existing = await AssetCategory.findOne({ where: { name } });
    if (existing) return res.json({ success: true, data: existing });

    const rawType = String(req.body?.type || 'HARDWARE').trim().toUpperCase();
    const type = ['HARDWARE', 'SOFTWARE', 'NETWORK', 'OTHER'].includes(rawType) ? rawType : 'OTHER';
    const description = String(req.body?.description || '').trim().slice(0, 500) || null;
    const created = await AssetCategory.create({ name, type, description });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

// GET /maintenance/assets — list assets with optional search/status/category & open maintenance count
router.get('/assets', async (req, res, next) => {
  try {
    const { include_retired, search, status, category_id } = req.query;
    const where = {};

    if (status) {
      where.status = String(status).toUpperCase();
    } else if (include_retired !== 'true') {
      where.status = { [Op.ne]: 'RETIRED' };
    }

    if (category_id && Number.isInteger(Number(category_id)) && Number(category_id) > 0) {
      where.category_id = Number(category_id);
    }

    const q = String(search || '').trim();
    if (q) {
      const like = `%${q}%`;
      where[Op.or] = [
        { name: { [Op.like]: like } },
        { serial_number: { [Op.like]: like } },
        { manufacturer: { [Op.like]: like } },
        { model: { [Op.like]: like } },
        { location: { [Op.like]: like } }
      ];
    }

    const [assets, [openRows]] = await Promise.all([
      Asset.findAll({
        where,
        include: ASSET_INCLUDES,
        order: [['name', 'ASC']]
      }),
      sequelize.query(
        `SELECT asset_id, COUNT(*) AS cnt
         FROM maintenance_records
         WHERE deleted_at IS NULL AND status IN ('SCHEDULED', 'IN_PROGRESS', 'DEFERRED')
         GROUP BY asset_id`
      ).catch(() => [[]])
    ]);

    const openMap = new Map(openRows.map(r => [Number(r.asset_id), Number(r.cnt) || 0]));
    const data = assets.map(a => ({
      ...a.get({ plain: true }),
      open_maintenance_count: openMap.get(Number(a.id)) || 0
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /maintenance/assets — create asset
router.post('/assets', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const { data, error } = sanitizeAssetPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await Asset.create(data);
    const full = await Asset.findByPk(created.id, { include: ASSET_INCLUDES });
    res.status(201).json({ success: true, data: full || created });
  } catch (err) { next(err); }
});

// PUT /maintenance/assets/:id — update asset
router.put('/assets/:id', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const { data, error } = sanitizeAssetPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    await asset.update(data);
    const full = await Asset.findByPk(asset.id, { include: ASSET_INCLUDES });
    res.json({ success: true, data: full || asset });
  } catch (err) { next(err); }
});

// DELETE /maintenance/assets/:id — retire if referenced by records, otherwise delete
router.delete('/assets/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    const linkedCount = await MaintenanceRecord.count({
      where: { asset_id: asset.id },
      paranoid: false
    });

    if (linkedCount > 0) {
      await asset.update({ status: 'RETIRED' });
      return res.json({ success: true, data: { id: asset.id, retired: true } });
    }

    await asset.destroy();
    res.json({ success: true, data: { id: asset.id, retired: false } });
  } catch (err) { next(err); }
});

// GET /maintenance/mel — active deferred defects (MEL / Deferred Snags) with expiry countdown
router.get('/mel', async (req, res, next) => {
  try {
    const where = {
      status: { [Op.in]: OPEN_MAINT_STATUSES },
      mel_category: { [Op.ne]: 'NONE' }
    };
    if (req.query.simulator_id && Number(req.query.simulator_id) > 0) {
      where.simulator_id = Number(req.query.simulator_id);
    }
    const rows = await MaintenanceRecord.findAll({
      where,
      include: RECORD_INCLUDES,
      order: [['mel_expiry_date', 'ASC'], ['scheduled_date', 'ASC']]
    });
    const nowMs = Date.now();
    const data = rows.map(r => {
      const plain = r.get({ plain: true });
      let daysRemaining = null;
      let isExpired = false;
      if (plain.mel_expiry_date) {
        const expMs = new Date(`${String(plain.mel_expiry_date).slice(0, 10)}T23:59:59Z`).getTime();
        if (!Number.isNaN(expMs)) {
          daysRemaining = Math.ceil((expMs - nowMs) / 86400000);
          isExpired = daysRemaining < 0;
        }
      }
      return { ...plain, days_remaining: daysRemaining, is_expired: isExpired };
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /maintenance/summary — global DB KPI counts, overdue, total cost, downtime & reliability
router.get('/summary', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const where = {};
    if (from || to) {
      where.scheduled_date = {};
      if (from) where.scheduled_date[Op.gte] = from;
      if (to) where.scheduled_date[Op.lte] = to;
    }

    const rows = await MaintenanceRecord.findAll({
      where,
      attributes: [
        'id', 'type', 'status', 'scheduled_date', 'cost', 'parts_cost', 'labor_cost',
        'downtime_hours', 'is_snag', 'severity', 'lost_training_hours',
        'subsystem_code', 'mel_category', 'mel_expiry_date'
      ]
    });

    const plain = rows.map(r => r.get({ plain: true }));
    const openSnags = plain.filter(r => r.is_snag && OPEN_MAINT_STATUSES.includes(r.status));
    const aogSnags = openSnags.filter(r => r.severity === 'AOG');
    const lostTrainingHours = plain.reduce((acc, r) => acc + (Number(r.lost_training_hours) || 0), 0);
    const partsCostTotal = plain.reduce((acc, r) => acc + (Number(r.parts_cost) || 0), 0);
    const reliability = computeReliabilityMetrics(plain, 0);

    res.json({
      success: true,
      data: {
        ...summarizeMaintenanceRows(plain),
        open_snags_count: openSnags.length,
        aog_snags_count: aogSnags.length,
        lost_training_hours: Number(lostTrainingHours.toFixed(2)),
        parts_cost_total: Number(partsCostTotal.toFixed(2)),
        active_mel_count: reliability.activeMelCount,
        mel_expiring_count: reliability.melExpiringSoonCount,
        mttr_hours: reliability.mttrHours,
        corrective_count: reliability.correctiveCount,
        preventive_count: reliability.preventiveCount
      }
    });
  } catch (err) { next(err); }
});

// PATCH /maintenance/bulk — bulk status, priority, or soft-delete (transactional with stock return & bay sync)
router.patch('/bulk', authorize('admin', 'manager'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { data, error } = sanitizeBulkMaintenanceAction(req.body);
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const { ids, action, value } = data;
    const records = await MaintenanceRecord.findAll({
      where: { id: { [Op.in]: ids } },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    let affected = 0;

    if (action === 'status') {
      const updateFields = { status: value };
      if (value === 'COMPLETED') {
        updateFields.completed_date = new Date();
      }
      const [count] = await MaintenanceRecord.update(updateFields, {
        where: { id: { [Op.in]: ids } },
        transaction
      });
      affected = count;

      for (const rec of records) {
        if (!rec.simulator_id) continue;
        const prevStatus = rec.status;
        rec.status = value;
        await syncSimulatorAndSubsystemHealth({
          rec,
          previousStatus: prevStatus,
          previousSeverity: rec.severity,
          userId: req.user.id,
          transaction
        });
      }
    } else if (action === 'priority') {
      const [count] = await MaintenanceRecord.update(
        { priority: value },
        { where: { id: { [Op.in]: ids } }, transaction }
      );
      affected = count;
    } else if (action === 'delete') {
      for (const rec of records) {
        const prevSnapshot = Array.isArray(rec.stock_deducted_snapshot) ? rec.stock_deducted_snapshot : [];
        if (prevSnapshot.length > 0) {
          for (const entry of prevSnapshot) {
            const item = await InventoryItem.findByPk(entry.item_id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!item || !(Number(entry.quantity) > 0)) continue;
            const qtyBefore = Number(item.quantity) || 0;
            const qtyAfter = qtyBefore + Number(entry.quantity);
            await StockMovement.create({
              item_id: item.id,
              user_id: req.user.id,
              simulator_id: rec.simulator_id || null,
              maintenance_record_id: rec.id,
              type: 'RETURN',
              quantity: Number(entry.quantity),
              quantity_before: qtyBefore,
              quantity_after: qtyAfter,
              reference: `MAINT-#${rec.id}`,
              reason: `Auto-returned upon bulk deletion of WO #${rec.id}: ${rec.title}`
            }, { transaction });
            await item.update({ quantity: qtyAfter }, { transaction });
          }
          await rec.update({ stock_deducted_snapshot: [] }, { transaction });
        }
      }
      affected = await MaintenanceRecord.destroy({ where: { id: { [Op.in]: ids } }, transaction });
      const touchedSims = new Set();
      for (const rec of records) {
        if (!rec.simulator_id || touchedSims.has(rec.simulator_id)) continue;
        touchedSims.add(rec.simulator_id);
        await syncSimulatorAndSubsystemHealth({
          rec: { id: rec.id, simulator_id: rec.simulator_id, subsystem_code: rec.subsystem_code, status: 'COMPLETED', severity: 'MINOR' },
          userId: req.user.id,
          transaction
        });
      }
    }

    await transaction.commit();
    res.json({ success: true, data: { affected, ids, action, value } });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    next(err);
  }
});

// ── Maintenance Work Orders CRUD ─────────────────────────────────────────────

router.get('/', parseDateFilter, async (req, res, next) => {
  try {
    const { from, to } = req.dateRange;
    const {
      status,
      priority,
      type,
      asset_id,
      simulator_id,
      subsystem_code,
      severity,
      is_snag,
      mel_category,
      search,
      sort_by,
      sort_dir,
      page = 1,
      limit = 20
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const where = {};
    const andConditions = [];

    if (from || to) {
      where.scheduled_date = {};
      if (from) where.scheduled_date[Op.gte] = from;
      if (to) where.scheduled_date[Op.lte] = to;
    }

    const normalizedStatus = String(status || '').trim().toUpperCase();
    if (normalizedStatus === 'OVERDUE') {
      andConditions.push({
        status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] },
        scheduled_date: { [Op.lt]: new Date() }
      });
    } else if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    if (priority) where.priority = String(priority).trim().toUpperCase();
    if (type) where.type = String(type).trim().toUpperCase();
    if (asset_id && Number.isInteger(Number(asset_id)) && Number(asset_id) > 0) {
      where.asset_id = Number(asset_id);
    }
    if (simulator_id && Number.isInteger(Number(simulator_id)) && Number(simulator_id) > 0) {
      where.simulator_id = Number(simulator_id);
    }
    if (subsystem_code && String(subsystem_code).trim()) {
      where.subsystem_code = String(subsystem_code).trim().toUpperCase();
    }
    if (severity && String(severity).trim()) {
      where.severity = String(severity).trim().toUpperCase();
    }
    if (is_snag === 'true') {
      where.is_snag = true;
    }
    if (mel_category && String(mel_category).trim()) {
      const melVal = String(mel_category).trim().toUpperCase();
      if (melVal === 'ACTIVE') {
        where.mel_category = { [Op.ne]: 'NONE' };
      } else {
        where.mel_category = melVal;
      }
    }

    if (search?.trim()) {
      const searchTerm = `%${search.trim()}%`;
      andConditions.push({
        [Op.or]: [
          { title: { [Op.like]: searchTerm } },
          { description: { [Op.like]: searchTerm } },
          { findings: { [Op.like]: searchTerm } },
          { part_number: { [Op.like]: searchTerm } },
          { broken_serial_number: { [Op.like]: searchTerm } },
          { new_serial_number: { [Op.like]: searchTerm } },
          sqlWhere(col('asset.name'), { [Op.like]: searchTerm }),
          sqlWhere(col('asset.serial_number'), { [Op.like]: searchTerm }),
          sqlWhere(col('simulator.name'), { [Op.like]: searchTerm }),
          sqlWhere(col('simulator.code'), { [Op.like]: searchTerm }),
          sqlWhere(col('simulator.bay_code'), { [Op.like]: searchTerm })
        ]
      });
    }

    if (andConditions.length) {
      where[Op.and] = andConditions;
    }

    const order = buildMaintenanceSortOrder(sort_by, sort_dir, { Asset, User });

    const { count, rows } = await MaintenanceRecord.findAndCountAll({
      where,
      distinct: true,
      subQuery: false,
      include: RECORD_INCLUDES,
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
      order
    });

    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) { next(err); }
});

router.post('/', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  const shouldDeduct = req.body?.deduct_stock === true;
  const transaction = await sequelize.transaction();

  try {
    const { data, error } = sanitizeMaintenancePayload(req.body, { isCreate: true });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const rec = await MaintenanceRecord.create(
      { ...data, performed_by: req.user.id, stock_deducted_snapshot: [] },
      { transaction }
    );

    const explicitCostProvided = req.body?.cost !== undefined && req.body?.cost !== '' && req.body?.cost !== null && Number(req.body.cost) > 0;
    const { lowAogAlerts } = await syncMaintenancePartsAndStock({
      rec,
      nextParts: data.parts_used || [],
      shouldSyncStock: shouldDeduct && Array.isArray(data.parts_used) && data.parts_used.length > 0,
      explicitCostProvided,
      userId: req.user.id,
      transaction
    });

    const healthSync = await syncSimulatorAndSubsystemHealth({
      rec,
      previousStatus: null,
      previousSeverity: null,
      userId: req.user.id,
      transaction
    });

    await transaction.commit();

    // Non-blocking proactive operational alerts
    if (healthSync.triggeredAogAlert && healthSync.simulator) {
      await broadcastOperationalAlert({
        req,
        type: 'SIMULATOR_AOG',
        title: `AOG Alert: ${healthSync.simulator.bay_code} (${healthSync.simulator.name})`,
        body: `Work Order #${rec.id} opened as AOG${rec.subsystem_code ? ` [${rec.subsystem_code}]` : ''}: ${rec.title}`,
        link: `/maintenance?simulatorId=${healthSync.simulator.id}`,
        excludeUserId: req.user.id
      });
    }
    for (const spare of lowAogAlerts) {
      await broadcastOperationalAlert({
        req,
        type: 'AOG_SPARE_LOW',
        title: `AOG Critical Spare Low: ${spare.sku}`,
        body: `${spare.name} dropped to ${spare.quantity} units (reorder point: ${spare.reorder_point}) after WO #${rec.id}.`,
        link: `/warehouse?tab=reorder&search=${encodeURIComponent(spare.sku || '')}`,
        excludeUserId: req.user.id
      });
    }

    const full = await MaintenanceRecord.findByPk(rec.id, { include: RECORD_INCLUDES });
    res.status(201).json({ success: true, data: full || rec });
  } catch (err) {
    await transaction.rollback();
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    next(err);
  }
});

router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id, { include: RECORD_INCLUDES });
    if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rec });
  } catch (err) { next(err); }
});

router.put('/:id', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  const shouldDeduct = req.body?.deduct_stock === true;
  const transaction = await sequelize.transaction();

  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!rec) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const { data, error } = sanitizeMaintenancePayload(req.body, { isCreate: false });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const previousStatus = rec.status;
    const previousSeverity = rec.severity;
    await rec.update(data, { transaction });

    const nextParts = data.parts_used !== undefined ? data.parts_used : (rec.parts_used || []);
    const explicitCostProvided = req.body?.cost !== undefined && req.body?.cost !== '' && req.body?.cost !== null && Number(req.body.cost) > 0;
    const shouldRunDelta = shouldDeduct || (data.parts_used !== undefined && Array.isArray(rec.stock_deducted_snapshot) && rec.stock_deducted_snapshot.length > 0);
    const { lowAogAlerts } = await syncMaintenancePartsAndStock({
      rec,
      nextParts,
      shouldSyncStock: shouldRunDelta,
      explicitCostProvided,
      userId: req.user.id,
      transaction
    });

    const healthSync = await syncSimulatorAndSubsystemHealth({
      rec,
      previousStatus,
      previousSeverity,
      userId: req.user.id,
      transaction
    });

    // Cyclic maintenance: auto-generate next scheduled record upon completion
    if (rec.status === 'COMPLETED' && previousStatus !== 'COMPLETED' && rec.next_scheduled) {
      const cycleWhere = {
        scheduled_date: rec.next_scheduled,
        status: 'SCHEDULED',
        title: rec.title
      };
      if (rec.simulator_id) cycleWhere.simulator_id = rec.simulator_id;
      else cycleWhere.asset_id = rec.asset_id;

      const alreadyScheduled = await MaintenanceRecord.findOne({
        where: cycleWhere,
        transaction
      });

      if (!alreadyScheduled) {
        await MaintenanceRecord.create({
          asset_id: rec.asset_id,
          simulator_id: rec.simulator_id,
          subsystem_code: rec.subsystem_code,
          severity: rec.severity || 'MINOR',
          performed_by: rec.performed_by || req.user.id,
          type: rec.type,
          title: rec.title,
          description: `Automatically generated recurring maintenance record following the completion of task #${rec.id}.\n\nOriginal description: ${rec.description}`,
          status: 'SCHEDULED',
          priority: rec.priority,
          scheduled_date: rec.next_scheduled,
          cost: 0.00,
          parts_used: [],
          stock_deducted_snapshot: []
        }, { transaction });
      }
    }

    await transaction.commit();

    if (healthSync.triggeredAogAlert && healthSync.simulator) {
      await broadcastOperationalAlert({
        req,
        type: 'SIMULATOR_AOG',
        title: `AOG Escalation: ${healthSync.simulator.bay_code} (${healthSync.simulator.name})`,
        body: `Work Order #${rec.id} escalated to AOG${rec.subsystem_code ? ` [${rec.subsystem_code}]` : ''}: ${rec.title}`,
        link: `/maintenance?simulatorId=${healthSync.simulator.id}`,
        excludeUserId: req.user.id
      });
    }
    for (const spare of lowAogAlerts) {
      await broadcastOperationalAlert({
        req,
        type: 'AOG_SPARE_LOW',
        title: `AOG Critical Spare Low: ${spare.sku}`,
        body: `${spare.name} dropped to ${spare.quantity} units (reorder point: ${spare.reorder_point}) after WO #${rec.id}.`,
        link: `/warehouse?tab=reorder&search=${encodeURIComponent(spare.sku || '')}`,
        excludeUserId: req.user.id
      });
    }

    const full = await MaintenanceRecord.findByPk(rec.id, { include: RECORD_INCLUDES });
    res.json({ success: true, data: full || rec });
  } catch (err) {
    await transaction.rollback();
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    next(err);
  }
});

router.delete('/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const rec = await MaintenanceRecord.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!rec) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    // Automatically return any previously deducted warehouse stock before deleting
    const prevSnapshot = Array.isArray(rec.stock_deducted_snapshot) ? rec.stock_deducted_snapshot : [];
    if (prevSnapshot.length > 0) {
      for (const entry of prevSnapshot) {
        const item = await InventoryItem.findByPk(entry.item_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!item || !(Number(entry.quantity) > 0)) continue;
        const qtyBefore = Number(item.quantity) || 0;
        const qtyAfter = qtyBefore + Number(entry.quantity);
        await StockMovement.create({
          item_id: item.id,
          user_id: req.user.id,
          simulator_id: rec.simulator_id || null,
          maintenance_record_id: rec.id,
          type: 'RETURN',
          quantity: Number(entry.quantity),
          quantity_before: qtyBefore,
          quantity_after: qtyAfter,
          reference: `MAINT-#${rec.id}`,
          reason: `Auto-returned upon deletion of WO #${rec.id}: ${rec.title}`
        }, { transaction });
        await item.update({ quantity: qtyAfter }, { transaction });
      }
      await rec.update({ stock_deducted_snapshot: [] }, { transaction });
    }

    const simId = rec.simulator_id;
    const subCode = rec.subsystem_code;
    await rec.destroy({ transaction });

    if (simId) {
      await syncSimulatorAndSubsystemHealth({
        rec: { id: rec.id, simulator_id: simId, subsystem_code: subCode, status: 'COMPLETED', severity: 'MINOR' },
        userId: req.user.id,
        transaction
      });
    }

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

module.exports = router;
