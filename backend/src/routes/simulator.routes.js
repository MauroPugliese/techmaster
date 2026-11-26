// =============================================================================
// routes/simulator.routes.js — CAE Flight Simulators, Subsystems & QTG API
// =============================================================================
'use strict';

const router = require('express').Router();
const { Op } = require('sequelize');
const {
  Simulator,
  SimulatorSubsystem,
  SimulatorQtgRecord,
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  Operation,
  OperationType,
  MaintenanceRecord,
  InventoryItem,
  StockMovement,
  WikiArticle,
  User,
  sequelize
} = require('../models');
const { validateIdParam } = require('../middleware/validation.middleware');
const { authorize } = require('../middleware/auth.middleware');
const { broadcastOperationalAlert } = require('../services/proactive-alerts.service');
const {
  DEFAULT_SUBSYSTEM_TEMPLATES,
  VALID_SIM_STATUSES,
  VALID_STATION_KINDS,
  VALID_SHIFT_USAGE_STATUSES,
  VALID_QTG_STATUSES,
  sanitizeSimulatorPayload,
  sanitizeSubsystemPayload,
  sanitizeQtgPayload,
  computeSimulatorTelemetry,
  normalizeHhMm,
  computeTestingDurationMinutes,
  deriveEntryUsageStatus,
  buildTimelineShiftBlocks,
  buildTimelineMaintenanceBlocks
} = require('../services/simulator-helpers.service');
const { expandOccurrencesInRange } = require('../services/planned-recurrence.service');

// ── Shared Daily-Sheet Orchestrator ──────────────────────────────────────────
function resolveSheetDate(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function resolveStationKind(raw, fallback = 'TEST_PLACE') {
  const up = String(raw || fallback).trim().toUpperCase();
  return VALID_STATION_KINDS.has(up) ? up : fallback;
}

function summarizeEffectiveStationStatuses(shifts, stationIds) {
  const ordered = [...(shifts || [])].sort(
    (a, b) => (Number(a.shift_number) || 0) - (Number(b.shift_number) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0)
  );
  const effectiveByStation = new Map();
  for (const sid of stationIds) {
    effectiveByStation.set(Number(sid), 'READY');
  }

  for (const sh of ordered) {
    for (const e of (sh.entries || [])) {
      const sid = Number(e.simulator_id);
      if (!effectiveByStation.has(sid)) continue;
      if (e.usage_status === 'NA' || e.usage_status === 'IN_USE') {
        effectiveByStation.set(sid, e.usage_status);
      } else if (e.usage_status === 'READY' && effectiveByStation.get(sid) === 'NA') {
        // Station recovered on a later shift
        effectiveByStation.set(sid, 'READY');
      }
    }
  }

  let inUseCount = 0;
  let readyCount = 0;
  let naCount = 0;
  for (const status of effectiveByStation.values()) {
    if (status === 'IN_USE') inUseCount += 1;
    else if (status === 'NA') naCount += 1;
    else readyCount += 1;
  }
  return { inUseCount, readyCount, naCount };
}

function groupBySimulatorId(rows) {
  const map = new Map();
  for (const r of rows) {
    const plain = typeof r.get === 'function' ? r.get({ plain: true }) : r;
    const simId = Number(plain.simulator_id);
    if (!map.has(simId)) map.set(simId, []);
    map.get(simId).push(plain);
  }
  return map;
}

async function ensureDailySheetData(dateStr, stationKind, userId = null) {
  const [stations, activeStaff] = await Promise.all([
    Simulator.findAll({
      where: { station_kind: stationKind },
      order: [['sort_order', 'ASC'], ['bay_code', 'ASC'], ['id', 'ASC']]
    }),
    User.findAll({
      where: { is_active: true },
      attributes: ['id', 'first_name', 'last_name', 'username', 'job_title'],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']]
    })
  ]);

  let dailyLog;
  try {
    [dailyLog] = await SimulatorDailyLog.findOrCreate({
      where: { log_date: dateStr, station_kind: stationKind },
      defaults: {
        log_date: dateStr,
        station_kind: stationKind,
        system_readiness_time: '06:30',
        post_testing_time: '17:00',
        logout_time: '18:00',
        updated_by: userId || null
      }
    });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    dailyLog = await SimulatorDailyLog.findOne({ where: { log_date: dateStr, station_kind: stationKind } });
  }

  const SHIFT_USER_INCLUDES = [
    { model: User, as: 'lead', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
    { model: User, as: 'signer', attributes: ['id', 'first_name', 'last_name', 'username'], required: false }
  ];

  let shifts = await SimulatorDailyShift.findAll({
    where: { daily_log_id: dailyLog.id },
    include: SHIFT_USER_INCLUDES,
    order: [['shift_number', 'ASC'], ['id', 'ASC']]
  });

  if (shifts.length === 0) {
    try {
      const [s1] = await SimulatorDailyShift.findOrCreate({
        where: { daily_log_id: dailyLog.id, shift_number: 1 },
        defaults: {
          daily_log_id: dailyLog.id,
          shift_number: 1,
          shift_name: 'SHIFT 1',
          pre_flight_test_time: '06:40',
          lead_user_id: userId || null
        }
      });
      const hydratedS1 = await SimulatorDailyShift.findByPk(s1.id, { include: SHIFT_USER_INCLUDES });
      shifts = [hydratedS1 || s1];
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;
      shifts = await SimulatorDailyShift.findAll({
        where: { daily_log_id: dailyLog.id },
        include: SHIFT_USER_INCLUDES,
        order: [['shift_number', 'ASC'], ['id', 'ASC']]
      });
    }
  }

  const stationIds = stations.map(s => Number(s.id));
  const stationMap = new Map(stations.map(s => [Number(s.id), s.get({ plain: true })]));

  const hydratedShifts = [];
  let totalSessionMinutes = 0;

  for (let idx = 0; idx < shifts.length; idx++) {
    const shiftPlain = shifts[idx].get({ plain: true });
    let entries = await SimulatorShiftEntry.findAll({
      where: { shift_id: shiftPlain.id }
    });

    const existingSimIds = new Set(entries.map(e => Number(e.simulator_id)));
    const missingStations = stations.filter(st => !existingSimIds.has(Number(st.id)));
    if (missingStations.length > 0) {
      await SimulatorShiftEntry.bulkCreate(
        missingStations.map(st => ({
          shift_id: shiftPlain.id,
          simulator_id: st.id,
          usage_status: st.status === 'AOG' ? 'NA' : 'READY',
          sim_testing_start: '00:00',
          sim_testing_end: '00:00',
          notes: null,
          updated_by: userId || null
        })),
        { ignoreDuplicates: true }
      );
      entries = await SimulatorShiftEntry.findAll({ where: { shift_id: shiftPlain.id } });
    }

    const enrichedEntries = entries
      .filter(e => stationIds.includes(Number(e.simulator_id)))
      .map(e => {
        const plain = e.get({ plain: true });
        const station = stationMap.get(Number(plain.simulator_id)) || null;
        const durMin = computeTestingDurationMinutes(plain.sim_testing_start, plain.sim_testing_end);
        totalSessionMinutes += durMin;
        return {
          ...plain,
          duration_minutes: durMin,
          station: station ? {
            id: station.id,
            code: station.code,
            name: station.name,
            bay_code: station.bay_code,
            status: station.status,
            aircraft_type: station.aircraft_type,
            limitations_mel: station.limitations_mel,
            sort_order: station.sort_order
          } : null
        };
      })
      .sort((a, b) => {
        const sa = a.station?.sort_order ?? 999;
        const sb = b.station?.sort_order ?? 999;
        if (sa !== sb) return sa - sb;
        return String(a.station?.bay_code || '').localeCompare(String(b.station?.bay_code || ''));
      });

    hydratedShifts.push({
      ...shiftPlain,
      entries: enrichedEntries
    });
  }

  const { inUseCount, readyCount, naCount } = summarizeEffectiveStationStatuses(hydratedShifts, stationIds);

  return {
    log: dailyLog.get({ plain: true }),
    shifts: hydratedShifts,
    stations: stations.map(s => s.get({ plain: true })),
    staff: activeStaff.map(u => u.get({ plain: true })),
    summary: {
      total_stations: stations.length,
      in_use_count: inUseCount,
      ready_count: readyCount,
      na_count: naCount,
      total_session_minutes: totalSessionMinutes
    }
  };
}

// ── Static routes MUST stay before /:id ──────────────────────────────────────

// GET /simulators/daily-sheet — unified Test Place / IOS Console daily shifts & usage sheet
router.get('/daily-sheet', async (req, res, next) => {
  try {
    const dateStr = resolveSheetDate(req.query.date);
    const stationKind = resolveStationKind(req.query.station_kind, 'TEST_PLACE');
    const data = await ensureDailySheetData(dateStr, stationKind, req.user?.id || null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /simulators/daily-sheet/timeline — aggregated 24h timeline blocks (shifts + maintenance) for Sorties & Dispatch
router.get('/daily-sheet/timeline', async (req, res, next) => {
  try {
    const dateStr = resolveSheetDate(req.query.date);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const [tpSheet, iosSheet, dayMaint, plannedOccs, allSims] = await Promise.all([
      ensureDailySheetData(dateStr, 'TEST_PLACE', req.user?.id || null),
      ensureDailySheetData(dateStr, 'IOS_CONSOLE', req.user?.id || null),
      MaintenanceRecord.findAll({
        where: {
          simulator_id: { [Op.ne]: null },
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] },
          scheduled_date: { [Op.between]: [dayStart, dayEnd] }
        },
        attributes: ['id', 'simulator_id', 'title', 'scheduled_date', 'downtime_hours', 'status', 'severity']
      }),
      expandOccurrencesInRange(dateStr, dateStr, 1).catch(() => []),
      Simulator.findAll({ attributes: ['id', 'bay_code', 'code', 'name'] })
    ]);

    const sheets = [tpSheet, iosSheet];
    const { blocks, statusBySimulator } = buildTimelineShiftBlocks(sheets);
    const maintenanceBlocks = buildTimelineMaintenanceBlocks(
      dateStr,
      dayMaint.map(m => m.get({ plain: true })),
      plannedOccs,
      allSims.map(s => s.get({ plain: true }))
    );

    res.json({
      success: true,
      data: {
        date: dateStr,
        blocks,
        maintenanceBlocks,
        statusBySimulator,
        operatingHours: {
          TEST_PLACE: tpSheet.log,
          IOS_CONSOLE: iosSheet.log
        }
      }
    });
  } catch (err) { next(err); }
});

// PUT /simulators/daily-sheet — update Operating Hours (System Readiness, Post-Testing, Logout)
router.put('/daily-sheet', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const dateStr = resolveSheetDate(req.body?.date || req.query?.date);
    const stationKind = resolveStationKind(req.body?.station_kind || req.query?.station_kind, 'TEST_PLACE');
    const [dailyLog] = await SimulatorDailyLog.findOrCreate({
      where: { log_date: dateStr, station_kind: stationKind },
      defaults: {
        log_date: dateStr,
        station_kind: stationKind,
        system_readiness_time: '06:30',
        post_testing_time: '17:00',
        logout_time: '18:00',
        updated_by: req.user?.id || null
      }
    });

    const updates = { updated_by: req.user?.id || null };
    if (req.body?.system_readiness_time !== undefined) {
      updates.system_readiness_time = normalizeHhMm(req.body.system_readiness_time, '06:30');
    }
    if (req.body?.post_testing_time !== undefined) {
      updates.post_testing_time = normalizeHhMm(req.body.post_testing_time, '17:00');
    }
    if (req.body?.logout_time !== undefined) {
      updates.logout_time = normalizeHhMm(req.body.logout_time, '18:00');
    }
    if (req.body?.general_notes !== undefined) {
      updates.general_notes = String(req.body.general_notes || '').trim() || null;
    }

    await dailyLog.update(updates);
    res.json({ success: true, data: dailyLog });
  } catch (err) { next(err); }
});

// POST /simulators/daily-sheet/shifts — add SHIFT 2 / SHIFT 3 for the selected day & station kind
router.post('/daily-sheet/shifts', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const dateStr = resolveSheetDate(req.body?.date);
    const stationKind = resolveStationKind(req.body?.station_kind, 'TEST_PLACE');
    const sheet = await ensureDailySheetData(dateStr, stationKind, req.user?.id || null);

    const existingNums = sheet.shifts.map(s => Number(s.shift_number) || 0);
    const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
    const defaultPreFlight = nextNum === 2 ? '13:00' : (nextNum === 3 ? '21:00' : '06:40');
    const preFlight = normalizeHhMm(req.body?.pre_flight_test_time, defaultPreFlight);
    const shiftName = String(req.body?.shift_name || `SHIFT ${nextNum}`).trim().toUpperCase().slice(0, 40);

    const createdShift = await SimulatorDailyShift.create({
      daily_log_id: sheet.log.id,
      shift_number: nextNum,
      shift_name: shiftName,
      pre_flight_test_time: preFlight,
      lead_user_id: req.user?.id || null
    });

    if (sheet.stations.length > 0) {
      await SimulatorShiftEntry.bulkCreate(
        sheet.stations.map(st => ({
          shift_id: createdShift.id,
          simulator_id: st.id,
          usage_status: st.status === 'AOG' ? 'NA' : 'READY',
          sim_testing_start: '00:00',
          sim_testing_end: '00:00',
          notes: null,
          updated_by: req.user?.id || null
        }))
      );
    }

    const updated = await ensureDailySheetData(dateStr, stationKind, req.user?.id || null);
    res.status(201).json({ success: true, data: updated, createdShiftId: createdShift.id });
  } catch (err) { next(err); }
});

// POST /simulators/daily-sheet/copy-previous — copy operating hours, shifts & carry over unresolved NA faults
router.post('/daily-sheet/copy-previous', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const dateStr = resolveSheetDate(req.body?.date || req.query?.date);
    const stationKind = resolveStationKind(req.body?.station_kind || req.query?.station_kind, 'TEST_PLACE');

    const prevLog = await SimulatorDailyLog.findOne({
      where: {
        station_kind: stationKind,
        log_date: { [Op.lt]: dateStr }
      },
      include: [{
        model: SimulatorDailyShift,
        as: 'shifts',
        include: [{ model: SimulatorShiftEntry, as: 'entries' }]
      }],
      order: [['log_date', 'DESC']],
      transaction
    });

    if (!prevLog) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'No previous operating sheet found to copy from.' });
    }

    const [targetLog] = await SimulatorDailyLog.findOrCreate({
      where: { log_date: dateStr, station_kind: stationKind },
      defaults: {
        log_date: dateStr,
        station_kind: stationKind,
        system_readiness_time: prevLog.system_readiness_time || '06:30',
        post_testing_time: prevLog.post_testing_time || '17:00',
        logout_time: prevLog.logout_time || '18:00',
        general_notes: prevLog.general_notes || null,
        updated_by: req.user?.id || null
      },
      transaction
    });

    await targetLog.update({
      system_readiness_time: prevLog.system_readiness_time || targetLog.system_readiness_time,
      post_testing_time: prevLog.post_testing_time || targetLog.post_testing_time,
      logout_time: prevLog.logout_time || targetLog.logout_time,
      updated_by: req.user?.id || null
    }, { transaction });

    const prevShifts = [...(prevLog.shifts || [])].sort(
      (a, b) => (a.shift_number || 0) - (b.shift_number || 0) || (a.id || 0) - (b.id || 0)
    );
    const latestPrevShift = prevShifts[prevShifts.length - 1];
    const carryNaMap = new Map();
    if (latestPrevShift) {
      for (const e of (latestPrevShift.entries || [])) {
        if (e.usage_status === 'NA') {
          const noteTxt = String(e.notes || '').trim();
          carryNaMap.set(
            Number(e.simulator_id),
            noteTxt
              ? (noteTxt.startsWith('[Carry-Over]') ? noteTxt : `[Carry-Over ${prevLog.log_date}] ${noteTxt}`)
              : `[Carry-Over ${prevLog.log_date}] Station remained NA from previous shift.`
          );
        }
      }
    }

    const stations = await Simulator.findAll({
      where: { station_kind: stationKind },
      order: [['sort_order', 'ASC'], ['bay_code', 'ASC'], ['id', 'ASC']],
      transaction
    });

    const existingTargetShifts = await SimulatorDailyShift.findAll({
      where: { daily_log_id: targetLog.id },
      order: [['shift_number', 'ASC']],
      transaction
    });

    const shiftsToMirror = prevShifts.length > 0 ? prevShifts : [{
      shift_number: 1,
      shift_name: 'SHIFT 1',
      pre_flight_test_time: '06:40',
      lead_user_id: req.user?.id || null
    }];

    for (const pShift of shiftsToMirror) {
      let targetShift = existingTargetShifts.find(s => Number(s.shift_number) === Number(pShift.shift_number));
      if (!targetShift) {
        targetShift = await SimulatorDailyShift.create({
          daily_log_id: targetLog.id,
          shift_number: pShift.shift_number,
          shift_name: pShift.shift_name || `SHIFT ${pShift.shift_number}`,
          pre_flight_test_time: pShift.pre_flight_test_time || '06:40',
          lead_user_id: pShift.lead_user_id || req.user?.id || null
        }, { transaction });
      } else {
        await targetShift.update({
          pre_flight_test_time: pShift.pre_flight_test_time || targetShift.pre_flight_test_time,
          lead_user_id: pShift.lead_user_id || targetShift.lead_user_id
        }, { transaction });
      }

      const existingEntries = await SimulatorShiftEntry.findAll({
        where: { shift_id: targetShift.id },
        transaction
      });
      const entryBySim = new Map(existingEntries.map(e => [Number(e.simulator_id), e]));

      for (const st of stations) {
        const simId = Number(st.id);
        const carryNote = carryNaMap.get(simId);
        const isNa = Boolean(carryNote) || st.status === 'AOG';
        const ex = entryBySim.get(simId);
        if (!ex) {
          await SimulatorShiftEntry.create({
            shift_id: targetShift.id,
            simulator_id: simId,
            usage_status: isNa ? 'NA' : 'READY',
            sim_testing_start: '00:00',
            sim_testing_end: '00:00',
            notes: carryNote || null,
            updated_by: req.user?.id || null
          }, { transaction });
        } else if (isNa && ex.usage_status !== 'IN_USE') {
          await ex.update({
            usage_status: 'NA',
            sim_testing_start: '00:00',
            sim_testing_end: '00:00',
            notes: ex.notes || carryNote || null,
            updated_by: req.user?.id || null
          }, { transaction });
        }
      }
    }

    await transaction.commit();
    const updatedSheet = await ensureDailySheetData(dateStr, stationKind, req.user?.id || null);
    res.json({
      success: true,
      data: updatedSheet,
      meta: {
        copiedFromDate: prevLog.log_date,
        carriedOverNaCount: carryNaMap.size
      }
    });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// PUT /simulators/daily-sheet/shifts/:shiftId — update pre-flight test time, label, or Test Leader
router.put('/daily-sheet/shifts/:shiftId', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const shiftId = parseInt(req.params.shiftId, 10);
    if (Number.isNaN(shiftId)) return res.status(400).json({ success: false, message: 'Invalid shiftId' });

    const shift = await SimulatorDailyShift.findByPk(shiftId);
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    const updates = {};
    if (req.body?.pre_flight_test_time !== undefined) {
      updates.pre_flight_test_time = normalizeHhMm(req.body.pre_flight_test_time, shift.pre_flight_test_time || '06:40');
    }
    if (req.body?.shift_name !== undefined && String(req.body.shift_name).trim()) {
      updates.shift_name = String(req.body.shift_name).trim().toUpperCase().slice(0, 40);
    }
    if (req.body?.lead_user_id !== undefined) {
      if (req.body.lead_user_id === null || req.body.lead_user_id === '') {
        updates.lead_user_id = null;
      } else {
        const uid = Number(req.body.lead_user_id);
        if (!Number.isInteger(uid) || uid < 1) {
          return res.status(400).json({ success: false, message: 'Invalid lead_user_id.' });
        }
        updates.lead_user_id = uid;
      }
    }

    await shift.update(updates);
    const full = await SimulatorDailyShift.findByPk(shift.id, {
      include: [
        { model: User, as: 'lead', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
        { model: User, as: 'signer', attributes: ['id', 'first_name', 'last_name', 'username'], required: false }
      ]
    });
    res.json({ success: true, data: full || shift });
  } catch (err) { next(err); }
});

// POST /simulators/daily-sheet/shifts/:shiftId/sign-off — official Test Leader shift handover sign-off
router.post('/daily-sheet/shifts/:shiftId/sign-off', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const shiftId = parseInt(req.params.shiftId, 10);
    if (Number.isNaN(shiftId)) return res.status(400).json({ success: false, message: 'Invalid shiftId' });

    const shift = await SimulatorDailyShift.findByPk(shiftId);
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    await shift.update({
      signed_off_at: new Date(),
      signed_off_by: req.user?.id || null
    });

    const full = await SimulatorDailyShift.findByPk(shift.id, {
      include: [
        { model: User, as: 'lead', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
        { model: User, as: 'signer', attributes: ['id', 'first_name', 'last_name', 'username'], required: false }
      ]
    });
    res.json({ success: true, data: full || shift });
  } catch (err) { next(err); }
});

// DELETE /simulators/daily-sheet/shifts/:shiftId — remove extra shift (keeps at least 1)
router.delete('/daily-sheet/shifts/:shiftId', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const shiftId = parseInt(req.params.shiftId, 10);
    if (Number.isNaN(shiftId)) return res.status(400).json({ success: false, message: 'Invalid shiftId' });

    const shift = await SimulatorDailyShift.findByPk(shiftId);
    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    const count = await SimulatorDailyShift.count({ where: { daily_log_id: shift.daily_log_id } });
    if (count <= 1) {
      return res.status(400).json({ success: false, message: 'At least SHIFT 1 must remain on the daily sheet.' });
    }

    await shift.destroy();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /simulators/daily-sheet/shifts/:shiftId/bulk-time — One-Click Bulk Sim Testing Start/End
router.post('/daily-sheet/shifts/:shiftId/bulk-time', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const shiftId = parseInt(req.params.shiftId, 10);
    if (Number.isNaN(shiftId)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid shiftId' });
    }

    const shift = await SimulatorDailyShift.findByPk(shiftId, { transaction });
    if (!shift) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    const mode = String(req.body?.mode || 'start').toLowerCase();
    const simIds = Array.isArray(req.body?.simulator_ids)
      ? req.body.simulator_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];

    if (!simIds.length) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Select at least one Test Place / station.' });
    }

    const entries = await SimulatorShiftEntry.findAll({
      where: { shift_id: shift.id, simulator_id: { [Op.in]: simIds } },
      transaction
    });

    const newStart = (mode === 'start' || mode === 'both') ? normalizeHhMm(req.body?.start_time ?? req.body?.time, null) : null;
    const newEnd = (mode === 'end' || mode === 'both') ? normalizeHhMm(req.body?.end_time ?? req.body?.time, null) : null;

    if ((mode === 'start' || mode === 'both') && !newStart) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid HH:MM start time is required.' });
    }
    if ((mode === 'end' || mode === 'both') && !newEnd) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Valid HH:MM end time is required.' });
    }

    for (const entry of entries) {
      const targetStart = newStart !== null ? newStart : entry.sim_testing_start;
      const targetEnd = newEnd !== null ? newEnd : entry.sim_testing_end;
      const nextStatus = deriveEntryUsageStatus({
        currentStatus: entry.usage_status,
        requestedStatus: req.body?.override_status,
        startHhMm: targetStart,
        endHhMm: targetEnd
      });
      await entry.update({
        sim_testing_start: targetStart,
        sim_testing_end: targetEnd,
        usage_status: nextStatus,
        updated_by: req.user?.id || null
      }, { transaction });
    }

    await transaction.commit();
    res.json({ success: true, data: { updatedCount: entries.length } });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// PATCH /simulators/daily-sheet/entries/:entryId — quick inline status, time, or handover note update
router.patch('/daily-sheet/entries/:entryId', authorize('admin', 'manager', 'tech'), async (req, res, next) => {
  try {
    const entryId = parseInt(req.params.entryId, 10);
    if (Number.isNaN(entryId)) return res.status(400).json({ success: false, message: 'Invalid entryId' });

    const entry = await SimulatorShiftEntry.findByPk(entryId);
    if (!entry) return res.status(404).json({ success: false, message: 'Shift entry not found' });

    const targetStart = req.body?.sim_testing_start !== undefined
      ? normalizeHhMm(req.body.sim_testing_start, '00:00')
      : entry.sim_testing_start;
    const targetEnd = req.body?.sim_testing_end !== undefined
      ? normalizeHhMm(req.body.sim_testing_end, '00:00')
      : entry.sim_testing_end;

    const requestedStatus = req.body?.usage_status !== undefined
      ? String(req.body.usage_status).trim().toUpperCase()
      : undefined;

    if (requestedStatus !== undefined && !VALID_SHIFT_USAGE_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ success: false, message: 'usage_status must be READY, IN_USE, or NA.' });
    }

    const nextStatus = deriveEntryUsageStatus({
      currentStatus: entry.usage_status,
      requestedStatus,
      startHhMm: targetStart,
      endHhMm: targetEnd
    });

    const updates = {
      sim_testing_start: nextStatus === 'NA' ? '00:00' : targetStart,
      sim_testing_end: nextStatus === 'NA' ? '00:00' : targetEnd,
      usage_status: nextStatus,
      updated_by: req.user?.id || null
    };

    if (req.body?.notes !== undefined) {
      updates.notes = String(req.body.notes || '').trim() || null;
    }

    const prevStatus = entry.usage_status;
    await entry.update(updates);

    // Sync NA <-> Simulator status and trigger proactive alert on newly marked NA
    if (nextStatus !== prevStatus && entry.simulator_id) {
      const sim = await Simulator.findByPk(entry.simulator_id);
      if (sim) {
        if (nextStatus === 'NA') {
          if (sim.status !== 'AOG') {
            await sim.update({ status: 'AOG' });
          }
          await broadcastOperationalAlert({
            req,
            type: 'STATION_NA',
            title: `Station Marked NA: ${sim.bay_code} (${sim.name})`,
            body: updates.notes || entry.notes || `${sim.name} was marked Not Available (NA) on the daily shift sheet.`,
            link: `/simulators?simulatorId=${sim.id}`,
            excludeUserId: req.user?.id || null
          });
        } else if (prevStatus === 'NA' && sim.status === 'AOG') {
          const openAogCount = await MaintenanceRecord.count({
            where: {
              simulator_id: sim.id,
              severity: 'AOG',
              status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] }
            }
          });
          if (openAogCount === 0) {
            await sim.update({ status: 'READY' });
          }
        }
      }
    }

    const plain = entry.get({ plain: true });
    res.json({
      success: true,
      data: {
        ...plain,
        duration_minutes: computeTestingDurationMinutes(plain.sim_testing_start, plain.sim_testing_end)
      }
    });
  } catch (err) { next(err); }
});

// GET /simulators/summary — fleet readiness & QTG summary cleanly separated by FFS_BAY, TEST_PLACE, IOS_CONSOLE
router.get('/summary', async (req, res, next) => {
  try {
    const requestedKind = req.query.station_kind && VALID_STATION_KINDS.has(String(req.query.station_kind).trim().toUpperCase())
      ? String(req.query.station_kind).trim().toUpperCase()
      : null;
    const simWhere = requestedKind ? { station_kind: requestedKind } : {};
    const todayStr = new Date().toISOString().slice(0, 10);

    const [sims, sorties, maint, qtg, subs, todayLogs] = await Promise.all([
      Simulator.findAll({ where: simWhere, order: [['sort_order', 'ASC'], ['bay_code', 'ASC']] }),
      Operation.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'] } },
        attributes: ['id', 'simulator_id', 'status', 'severity', 'mel_category', 'mel_expiry_date']
      }),
      SimulatorQtgRecord.findAll({
        attributes: ['id', 'simulator_id', 'status', 'quarter', 'year']
      }),
      SimulatorSubsystem.findAll({
        attributes: ['id', 'simulator_id', 'status']
      }),
      SimulatorDailyLog.findAll({
        where: { log_date: todayStr },
        include: [{
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [{ model: SimulatorShiftEntry, as: 'entries' }]
        }]
      })
    ]);

    const now = new Date();
    const soonMs = now.getTime() + 7 * 86400000;
    const ffsList = requestedKind ? sims : sims.filter(s => (s.station_kind || 'FFS_BAY') === 'FFS_BAY');
    const metricBase = ffsList.length > 0 ? ffsList : sims;
    const metricBaseIds = new Set(metricBase.map(s => Number(s.id)));

    let readyCount = 0;
    let inSortieCount = 0;
    let degradedCount = 0;
    let aogOrMaintCount = 0;
    let totalFlightHoursToday = 0;
    let reliabilitySum = 0;
    let qtgTotal = 0;
    let qtgPassed = 0;
    let certExpiringSoon = 0;

    const sortiesBySim = groupBySimulatorId(sorties);
    const maintBySim = groupBySimulatorId(maint);
    const qtgBySim = groupBySimulatorId(qtg);
    const subsBySim = groupBySimulatorId(subs);

    for (const s of sims) {
      const plain = s.get({ plain: true });
      const simId = Number(plain.id);
      const isMetricBase = metricBaseIds.has(simId);
      if (isMetricBase) {
        if (plain.status === 'READY' || plain.status === 'PRE_FLIGHT') readyCount += 1;
        else if (plain.status === 'IN_SORTIE') inSortieCount += 1;
        else if (plain.status === 'DEGRADED') degradedCount += 1;
        else if (plain.status === 'AOG' || plain.status === 'MAINTENANCE') aogOrMaintCount += 1;
      }

      const t = computeSimulatorTelemetry(plain, {
        sorties: sortiesBySim.get(simId) || [],
        maintenance: maintBySim.get(simId) || [],
        qtgRecords: qtgBySim.get(simId) || [],
        subsystems: subsBySim.get(simId) || [],
        now
      });

      totalFlightHoursToday += t.todayFlightHours;
      if (isMetricBase) {
        reliabilitySum += t.dispatchReliabilityPct;
        qtgTotal += t.qtgSummary.total;
        qtgPassed += t.qtgSummary.passed + t.qtgSummary.warn;
        if (t.certificate.status === 'EXPIRING_SOON' || t.certificate.status === 'EXPIRED') {
          certExpiringSoon += 1;
        }
      }
    }

    const summarizeKindLive = (kind) => {
      const kindSims = sims.filter(s => s.station_kind === kind);
      const kindSimIds = kindSims.map(s => Number(s.id));
      const log = todayLogs.find(l => l.station_kind === kind);
      let inUse = 0;
      let ready = 0;
      let na = 0;
      let totalMin = 0;

      if (log && Array.isArray(log.shifts) && log.shifts.length > 0) {
        const sortedShifts = [...log.shifts].sort((a, b) => (a.shift_number || 0) - (b.shift_number || 0));
        sortedShifts.forEach((sh) => {
          for (const e of (sh.entries || [])) {
            totalMin += computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end);
          }
        });
        const eff = summarizeEffectiveStationStatuses(sortedShifts, kindSimIds);
        inUse = eff.inUseCount;
        ready = eff.readyCount;
        na = eff.naCount;
      } else {
        for (const st of kindSims) {
          if (st.status === 'AOG') na += 1;
          else if (st.status === 'IN_SORTIE') inUse += 1;
          else ready += 1;
        }
      }

      return {
        total: kindSims.length,
        in_use: inUse,
        ready,
        na,
        today_shift_hours: Number((totalMin / 60).toFixed(1))
      };
    };

    const testPlacesLive = summarizeKindLive('TEST_PLACE');
    const iosConsolesLive = summarizeKindLive('IOS_CONSOLE');

    let melActiveCount = 0;
    let melExpiringCount = 0;
    for (const m of maint) {
      if (m.mel_category && m.mel_category !== 'NONE') {
        melActiveCount += 1;
        if (m.mel_expiry_date) {
          const expMs = new Date(`${String(m.mel_expiry_date).slice(0, 10)}T23:59:59Z`).getTime();
          if (!Number.isNaN(expMs) && expMs <= soonMs) melExpiringCount += 1;
        }
      }
    }

    const baseCount = metricBase.length;
    const avgDispatchRel = baseCount > 0 ? Math.round((reliabilitySum / baseCount) * 10) / 10 : 100;
    const qtgPct = qtgTotal > 0 ? Math.round((qtgPassed / qtgTotal) * 100) : 100;
    const todayStationHours = Number((testPlacesLive.today_shift_hours + iosConsolesLive.today_shift_hours).toFixed(1));

    res.json({
      success: true,
      data: {
        total_simulators: sims.length,
        ready_count: readyCount,
        in_sortie_count: inSortieCount,
        degraded_count: degradedCount,
        aog_or_maint_count: aogOrMaintCount,
        today_flight_hours: Math.round(totalFlightHoursToday * 10) / 10,
        today_station_hours: todayStationHours,
        avg_dispatch_reliability_pct: avgDispatchRel,
        qtg_compliance_pct: qtgPct,
        cert_expiring_count: certExpiringSoon,
        open_snags_count: maint.length,
        mel_active_count: melActiveCount,
        mel_expiring_count: melExpiringCount,
        ffs_fleet: {
          total: baseCount,
          ready: readyCount,
          in_sortie: inSortieCount,
          degraded: degradedCount,
          aog_or_maint: aogOrMaintCount,
          today_flight_hours: Math.round(totalFlightHoursToday * 10) / 10,
          avg_dispatch_reliability_pct: avgDispatchRel,
          qtg_compliance_pct: qtgPct,
          cert_expiring_count: certExpiringSoon
        },
        test_places_live: testPlacesLive,
        ios_consoles_live: iosConsolesLive
      }
    });
  } catch (err) { next(err); }
});

// GET /simulators/qtg/all — cross-fleet QTG compliance view
router.get('/qtg/all', async (req, res, next) => {
  try {
    const { simulator_id, quarter, year, status } = req.query;
    const where = {};
    if (simulator_id && Number(simulator_id) > 0) where.simulator_id = Number(simulator_id);
    if (quarter && String(quarter).trim()) where.quarter = String(quarter).trim().toUpperCase();
    if (year && Number(year) > 0) where.year = Number(year);
    if (status && String(status).trim()) where.status = String(status).trim().toUpperCase();

    const rows = await SimulatorQtgRecord.findAll({
      where,
      include: [
        { model: Simulator, as: 'simulator', attributes: ['id', 'code', 'name', 'bay_code', 'aircraft_type', 'qualification_level'] },
        { model: User, as: 'executor', attributes: ['id', 'first_name', 'last_name', 'username'] }
      ],
      order: [['year', 'DESC'], ['quarter', 'ASC'], ['test_code', 'ASC']]
    });

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /simulators — full fleet list enriched with live bay telemetry
router.get('/', async (req, res, next) => {
  try {
    const { search, platform_category, status, station_kind } = req.query;
    const where = {};

    if (station_kind && VALID_STATION_KINDS.has(String(station_kind).trim().toUpperCase())) {
      where.station_kind = String(station_kind).trim().toUpperCase();
    }
    if (platform_category && String(platform_category).trim()) {
      where.platform_category = String(platform_category).trim().toUpperCase();
    }
    if (status && String(status).trim()) {
      where.status = String(status).trim().toUpperCase();
    }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where[Op.or] = [
        { code: { [Op.like]: like } },
        { name: { [Op.like]: like } },
        { bay_code: { [Op.like]: like } },
        { aircraft_type: { [Op.like]: like } },
        { certificate_code: { [Op.like]: like } }
      ];
    }

    const [sims, sorties, maint, qtg, subs] = await Promise.all([
      Simulator.findAll({ where, order: [['sort_order', 'ASC'], ['bay_code', 'ASC'], ['code', 'ASC']] }),
      Operation.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: { [Op.ne]: null } },
        attributes: ['id', 'simulator_id', 'status', 'severity', 'is_snag']
      }),
      SimulatorQtgRecord.findAll({
        attributes: ['id', 'simulator_id', 'status', 'quarter', 'year']
      }),
      SimulatorSubsystem.findAll({
        attributes: ['id', 'simulator_id', 'subsystem_code', 'status']
      })
    ]);

    const now = new Date();
    const sortiesBySim = groupBySimulatorId(sorties);
    const maintBySim = groupBySimulatorId(maint);
    const qtgBySim = groupBySimulatorId(qtg);
    const subsBySim = groupBySimulatorId(subs);

    const enriched = sims.map(s => {
      const plain = s.get({ plain: true });
      const simId = Number(plain.id);
      return {
        ...plain,
        telemetry: computeSimulatorTelemetry(plain, {
          sorties: sortiesBySim.get(simId) || [],
          maintenance: maintBySim.get(simId) || [],
          qtgRecords: qtgBySim.get(simId) || [],
          subsystems: subsBySim.get(simId) || [],
          now
        })
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) { next(err); }
});

// GET /simulators/:id/mnt-records — rapid MNT Records modal view (Preventive vs Corrective, filterable by year)
router.get('/:id/mnt-records', validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id, {
      attributes: ['id', 'code', 'name', 'bay_code', 'station_kind', 'aircraft_type', 'status']
    });
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator / Station not found' });

    const yearFilter = req.query.year && /^\d{4}$/.test(String(req.query.year)) ? Number(req.query.year) : null;
    const allRows = await MaintenanceRecord.findAll({
      where: { simulator_id: sim.id },
      include: [{ model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name', 'username'] }],
      order: [['scheduled_date', 'DESC'], ['id', 'DESC']]
    });

    const yearsSet = new Set();
    const mapped = allRows.map(r => {
      const p = r.get({ plain: true });
      const sched = p.scheduled_date ? new Date(p.scheduled_date) : null;
      const comp = p.completed_date ? new Date(p.completed_date) : null;
      const yr = sched && !Number.isNaN(sched.getTime()) ? sched.getUTCFullYear() : new Date().getUTCFullYear();
      yearsSet.add(yr);

      const isCorrective = p.type === 'CORRECTIVE' || Boolean(p.is_snag) || p.severity === 'AOG';
      const fmtTime = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      let timeWindow = '';
      if (sched && !Number.isNaN(sched.getTime())) {
        if (comp && !Number.isNaN(comp.getTime())) {
          timeWindow = `${fmtTime(sched)}–${fmtTime(comp)}`;
        } else if (p.downtime_hours && Number(p.downtime_hours) > 0) {
          const endEst = new Date(sched.getTime() + Number(p.downtime_hours) * 3600000);
          timeWindow = `${fmtTime(sched)}–${fmtTime(endEst)}`;
        } else {
          timeWindow = fmtTime(sched);
        }
      }

      return {
        ...p,
        record_year: yr,
        is_corrective: isCorrective,
        time_window: timeWindow
      };
    });

    const availableYears = [...yearsSet].sort((a, b) => b - a);
    const filtered = yearFilter ? mapped.filter(m => m.record_year === yearFilter) : mapped;
    const preventiveCount = filtered.filter(m => !m.is_corrective).length;
    const correctiveCount = filtered.filter(m => m.is_corrective).length;
    const totalDowntime = Math.round(
      filtered.reduce((acc, m) => acc + (Number(m.downtime_hours) || 0), 0) * 10
    ) / 10;

    res.json({
      success: true,
      data: {
        simulator: sim.get({ plain: true }),
        selectedYear: yearFilter || 'ALL',
        availableYears,
        counts: {
          total: filtered.length,
          preventive: preventiveCount,
          corrective: correctiveCount,
          total_downtime_hours: totalDowntime
        },
        records: filtered
      }
    });
  } catch (err) { next(err); }
});

// GET /simulators/:id — complete simulator dossier + all sub-sections
router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id);
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const [subsystems, qtgRecords, sorties, maintenanceRecords, allItems, recentStockMovements] = await Promise.all([
      SimulatorSubsystem.findAll({
        where: { simulator_id: sim.id },
        order: [['subsystem_code', 'ASC'], ['name', 'ASC']]
      }),
      SimulatorQtgRecord.findAll({
        where: { simulator_id: sim.id },
        include: [{ model: User, as: 'executor', attributes: ['id', 'first_name', 'last_name', 'username'] }],
        order: [['year', 'DESC'], ['quarter', 'ASC'], ['test_code', 'ASC']]
      }),
      Operation.findAll({
        where: { simulator_id: sim.id },
        include: [
          { model: OperationType, as: 'type' },
          { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'username'] }
        ],
        order: [['start_date', 'DESC']],
        limit: 40
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: sim.id },
        include: [
          { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name', 'username'] },
          { model: WikiArticle, as: 'wikiArticle', attributes: ['id', 'title', 'slug'], required: false }
        ],
        order: [['scheduled_date', 'DESC']],
        limit: 40
      }),
      InventoryItem.findAll({
        where: { is_active: true },
        attributes: ['id', 'sku', 'part_number', 'name', 'unit', 'quantity', 'reorder_point', 'part_classification', 'aog_critical', 'compatible_models', 'lru_status', 'on_order_qty', 'expected_delivery_date']
      }),
      StockMovement.findAll({
        where: { simulator_id: sim.id },
        include: [
          { model: InventoryItem, as: 'item', attributes: ['id', 'sku', 'name', 'unit'] },
          { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }
        ],
        order: [['movement_date', 'DESC']],
        limit: 15
      })
    ]);

    const plainSim = sim.get({ plain: true });
    const simCodeUpper = String(plainSim.code || '').toUpperCase();
    const acTokens = String(plainSim.aircraft_type || '').toUpperCase().split(/[\s\/,]+/).filter(t => t.length >= 3);
    const compatibleSpares = allItems
      .map(i => i.get({ plain: true }))
      .filter(item => {
        const models = Array.isArray(item.compatible_models) ? item.compatible_models : [];
        return models.some(m => {
          const mu = String(m || '').toUpperCase();
          return mu === simCodeUpper || mu === 'ALL' || acTokens.some(tok => mu.includes(tok));
        });
      });

    const plainMaint = maintenanceRecords.map(x => x.get({ plain: true }));
    const nowMs = Date.now();
    const melRecords = plainMaint
      .filter(m => ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'].includes(m.status) && m.mel_category && m.mel_category !== 'NONE')
      .map(m => {
        let daysRemaining = null;
        if (m.mel_expiry_date) {
          const expMs = new Date(`${String(m.mel_expiry_date).slice(0, 10)}T23:59:59Z`).getTime();
          if (!Number.isNaN(expMs)) daysRemaining = Math.ceil((expMs - nowMs) / 86400000);
        }
        return { ...m, days_remaining: daysRemaining };
      });

    const telemetry = computeSimulatorTelemetry(plainSim, {
      sorties: sorties.map(x => x.get({ plain: true })),
      maintenance: plainMaint,
      qtgRecords: qtgRecords.map(x => x.get({ plain: true })),
      subsystems: subsystems.map(x => x.get({ plain: true }))
    });

    res.json({
      success: true,
      data: {
        ...plainSim,
        telemetry,
        subsystems,
        qtgRecords,
        sorties,
        maintenanceRecords,
        melRecords,
        recentStockMovements,
        compatibleSpares
      }
    });
  } catch (err) { next(err); }
});

// POST /simulators — register new simulator (+ optional scaffold of 8 FSTD subsystems & annual QTG)
router.post('/', authorize('admin', 'manager'), async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { data, error } = sanitizeSimulatorPayload(req.body, { isCreate: true });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: error });
    }

    const dup = await Simulator.findOne({ where: { code: data.code }, transaction });
    if (dup) {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: `Simulator code "${data.code}" already exists.` });
    }

    const created = await Simulator.create(data, { transaction });

    if (req.body?.scaffold_subsystems !== false) {
      const isFixedBase = data.platform_category === 'FTD_FNPT' || /fixed-base/i.test(data.motion_system || '');
      await SimulatorSubsystem.bulkCreate(
        DEFAULT_SUBSYSTEM_TEMPLATES.map(tpl => ({
          simulator_id: created.id,
          subsystem_code: tpl.subsystem_code,
          name: tpl.subsystem_code === 'MOTION' && isFixedBase ? 'Fixed-Base / G-Seat Interface' : tpl.name,
          status: 'NOMINAL',
          operating_hours: 0
        })),
        { transaction }
      );
    }

    if (req.body?.scaffold_qtg !== false) {
      const yr = new Date().getUTCFullYear();
      await SimulatorQtgRecord.bulkCreate([
        { simulator_id: created.id, test_code: 'QTG-1.B.1', title: 'Performance & Acceleration Validation', category: 'PERFORMANCE', quarter: 'Q1', year: yr, mode: 'AUTO', status: 'PENDING', due_date: `${yr}-03-31` },
        { simulator_id: created.id, test_code: 'QTG-2.C.1', title: 'Handling Qualities & Primary Control Feel', category: 'HANDLING', quarter: 'Q2', year: yr, mode: 'AUTO', status: 'PENDING', due_date: `${yr}-06-30` },
        { simulator_id: created.id, test_code: 'QTG-3.A.1', title: 'Motion Cueing & Latency Compliance', category: 'MOTION_CUEING', quarter: 'Q3', year: yr, mode: 'AUTO', status: 'PENDING', due_date: `${yr}-09-30` },
        { simulator_id: created.id, test_code: 'QTG-4.D.1', title: 'Visual Collimation, Alignment & Luminance', category: 'VISUAL_SYSTEM', quarter: 'Q4', year: yr, mode: 'MANUAL', status: 'PENDING', due_date: `${yr}-12-15` }
      ], { transaction });
    }

    await transaction.commit();
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

// PUT /simulators/:id — update simulator configuration & qualification
router.put('/:id', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id);
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const { data, error } = sanitizeSimulatorPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    if (data.code && data.code !== sim.code) {
      const dup = await Simulator.findOne({ where: { code: data.code, id: { [Op.ne]: sim.id } } });
      if (dup) return res.status(409).json({ success: false, message: `Simulator code "${data.code}" already exists.` });
    }

    await sim.update(data);
    res.json({ success: true, data: sim });
  } catch (err) { next(err); }
});

// PATCH /simulators/:id/status — quick bay status + MEL limitation switch
router.patch('/:id/status', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id);
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!VALID_SIM_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: 'Invalid simulator status.' });
    }

    const prevStatus = sim.status;
    const updates = { status };
    if (req.body?.limitations_mel !== undefined) {
      updates.limitations_mel = String(req.body.limitations_mel || '').trim() || null;
    }

    await sim.update(updates);

    if (status !== prevStatus && (status === 'AOG' || status === 'DEGRADED')) {
      await broadcastOperationalAlert({
        req,
        type: status === 'AOG' ? 'SIMULATOR_AOG' : 'SIMULATOR_DEGRADED',
        title: `Simulator ${status}: ${sim.bay_code || sim.code} (${sim.name})`,
        body: updates.limitations_mel || sim.limitations_mel || `Status changed from ${prevStatus} to ${status}.`,
        link: `/simulators?simulatorId=${sim.id}`,
        excludeUserId: req.user?.id || null
      });
    }

    res.json({ success: true, data: sim });
  } catch (err) { next(err); }
});

// DELETE /simulators/:id
router.delete('/:id', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id);
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });
    await sim.destroy();
    res.json({ success: true, message: 'Simulator deleted' });
  } catch (err) { next(err); }
});

// ── Simulator Subsystems Sub-section CRUD ────────────────────────────────────

router.get('/:id/subsystems', validateIdParam, async (req, res, next) => {
  try {
    const subs = await SimulatorSubsystem.findAll({
      where: { simulator_id: req.params.id },
      order: [['subsystem_code', 'ASC'], ['name', 'ASC']]
    });
    res.json({ success: true, data: subs });
  } catch (err) { next(err); }
});

router.post('/:id/subsystems', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id, { attributes: ['id'] });
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const { data, error } = sanitizeSubsystemPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await SimulatorSubsystem.create({
      ...data,
      simulator_id: sim.id,
      last_checked_at: new Date(),
      updated_by: req.user?.id || null
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

router.put('/:id/subsystems/:subId', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const subId = parseInt(req.params.subId, 10);
    if (Number.isNaN(subId)) return res.status(400).json({ success: false, message: 'Invalid subsystem ID' });

    const sub = await SimulatorSubsystem.findOne({ where: { id: subId, simulator_id: req.params.id } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subsystem not found' });

    const { data, error } = sanitizeSubsystemPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    const prevStatus = sub.status;
    await sub.update({
      ...data,
      last_checked_at: new Date(),
      updated_by: req.user?.id || null
    });

    if (data.status && data.status !== prevStatus && data.status === 'FAULT') {
      const sim = await Simulator.findByPk(sub.simulator_id, { attributes: ['id', 'code', 'bay_code', 'name'] });
      await broadcastOperationalAlert({
        req,
        type: 'SUBSYSTEM_FAULT',
        title: `Subsystem Fault: ${sim?.bay_code || sim?.code || `Bay #${sub.simulator_id}`} — ${sub.name}`,
        body: data.notes || sub.notes || `${sub.subsystem_code} reported FAULT.`,
        link: `/simulators?simulatorId=${sub.simulator_id}`,
        excludeUserId: req.user?.id || null
      });
    }

    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
});

router.delete('/:id/subsystems/:subId', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const subId = parseInt(req.params.subId, 10);
    if (Number.isNaN(subId)) return res.status(400).json({ success: false, message: 'Invalid subsystem ID' });

    const deleted = await SimulatorSubsystem.destroy({ where: { id: subId, simulator_id: req.params.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Subsystem not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Simulator QTG Records Sub-section CRUD ───────────────────────────────────

router.get('/:id/qtg', validateIdParam, async (req, res, next) => {
  try {
    const qtg = await SimulatorQtgRecord.findAll({
      where: { simulator_id: req.params.id },
      include: [{ model: User, as: 'executor', attributes: ['id', 'first_name', 'last_name', 'username'] }],
      order: [['year', 'DESC'], ['quarter', 'ASC'], ['test_code', 'ASC']]
    });
    res.json({ success: true, data: qtg });
  } catch (err) { next(err); }
});

router.post('/:id/qtg', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id, { attributes: ['id'] });
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const { data, error } = sanitizeQtgPayload(req.body, { isCreate: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const created = await SimulatorQtgRecord.create({
      ...data,
      simulator_id: sim.id,
      executed_by: data.executed_at ? req.user.id : null
    });
    const full = await SimulatorQtgRecord.findByPk(created.id, {
      include: [{ model: User, as: 'executor', attributes: ['id', 'first_name', 'last_name', 'username'] }]
    });
    res.status(201).json({ success: true, data: full || created });
  } catch (err) { next(err); }
});

router.put('/:id/qtg/:qtgId', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const qtgId = parseInt(req.params.qtgId, 10);
    if (Number.isNaN(qtgId)) return res.status(400).json({ success: false, message: 'Invalid QTG ID' });

    const record = await SimulatorQtgRecord.findOne({ where: { id: qtgId, simulator_id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'QTG record not found' });

    const { data, error } = sanitizeQtgPayload(req.body, { isCreate: false });
    if (error) return res.status(400).json({ success: false, message: error });

    const prevStatus = record.status;
    if (data.status && VALID_QTG_STATUSES.has(data.status) && data.status !== 'PENDING') {
      data.executed_by = req.user.id;
    }

    await record.update(data);

    if (data.status && data.status !== prevStatus && data.status === 'FAILED') {
      const sim = await Simulator.findByPk(record.simulator_id, { attributes: ['id', 'code', 'bay_code', 'name'] });
      await broadcastOperationalAlert({
        req,
        type: 'QTG_FAILED',
        title: `QTG Failed: ${sim?.bay_code || sim?.code || `Bay #${record.simulator_id}`} — ${record.test_code}`,
        body: data.notes || record.notes || `${record.title} (${record.quarter} ${record.year}) marked FAILED.`,
        link: `/simulators?simulatorId=${record.simulator_id}`,
        excludeUserId: req.user?.id || null
      });
    }

    const full = await SimulatorQtgRecord.findByPk(record.id, {
      include: [{ model: User, as: 'executor', attributes: ['id', 'first_name', 'last_name', 'username'] }]
    });
    res.json({ success: true, data: full || record });
  } catch (err) { next(err); }
});

// POST /simulators/:id/qtg/clone-year — clone previous/source year's QTG schedule into target year as PENDING
router.post('/:id/qtg/clone-year', authorize('admin', 'manager', 'tech'), validateIdParam, async (req, res, next) => {
  try {
    const sim = await Simulator.findByPk(req.params.id, { attributes: ['id'] });
    if (!sim) return res.status(404).json({ success: false, message: 'Simulator not found' });

    const targetYear = Number(req.body?.target_year) || (new Date().getUTCFullYear() + 1);
    if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2050) {
      return res.status(400).json({ success: false, message: 'Valid target_year (2020–2050) is required.' });
    }

    let sourceYear = Number(req.body?.source_year) || (targetYear - 1);
    let sourceRows = await SimulatorQtgRecord.findAll({
      where: { simulator_id: sim.id, year: sourceYear },
      order: [['quarter', 'ASC'], ['test_code', 'ASC']]
    });

    if (!sourceRows.length) {
      const latest = await SimulatorQtgRecord.findOne({
        where: { simulator_id: sim.id, year: { [Op.ne]: targetYear } },
        order: [['year', 'DESC']]
      });
      if (latest) {
        sourceYear = latest.year;
        sourceRows = await SimulatorQtgRecord.findAll({
          where: { simulator_id: sim.id, year: sourceYear },
          order: [['quarter', 'ASC'], ['test_code', 'ASC']]
        });
      }
    }

    if (!sourceRows.length) {
      return res.status(400).json({ success: false, message: 'No existing QTG records found to clone.' });
    }

    const existingTarget = await SimulatorQtgRecord.findAll({
      where: { simulator_id: sim.id, year: targetYear },
      attributes: ['quarter', 'test_code']
    });
    const existingKeys = new Set(existingTarget.map(r => `${r.quarter}::${r.test_code}`));

    const quarterDueDefault = { Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-15' };
    const isTargetLeapYear = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
    const toInsert = [];
    for (const row of sourceRows) {
      const key = `${row.quarter}::${row.test_code}`;
      if (existingKeys.has(key)) continue;
      let dueSuffix = row.due_date ? String(row.due_date).slice(5, 10) : (quarterDueDefault[row.quarter] || '12-15');
      if (dueSuffix === '02-29' && !isTargetLeapYear) {
        dueSuffix = '02-28';
      }
      toInsert.push({
        simulator_id: sim.id,
        test_code: row.test_code,
        title: row.title,
        category: row.category,
        quarter: row.quarter,
        year: targetYear,
        mode: row.mode || 'AUTO',
        status: 'PENDING',
        due_date: `${targetYear}-${dueSuffix}`,
        notes: null
      });
    }

    if (toInsert.length > 0) {
      await SimulatorQtgRecord.bulkCreate(toInsert);
    }

    res.status(201).json({
      success: true,
      data: {
        source_year: sourceYear,
        target_year: targetYear,
        created_count: toInsert.length,
        skipped_count: sourceRows.length - toInsert.length
      }
    });
  } catch (err) { next(err); }
});

router.delete('/:id/qtg/:qtgId', authorize('admin', 'manager'), validateIdParam, async (req, res, next) => {
  try {
    const qtgId = parseInt(req.params.qtgId, 10);
    if (Number.isNaN(qtgId)) return res.status(400).json({ success: false, message: 'Invalid QTG ID' });

    const deleted = await SimulatorQtgRecord.destroy({ where: { id: qtgId, simulator_id: req.params.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'QTG record not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
