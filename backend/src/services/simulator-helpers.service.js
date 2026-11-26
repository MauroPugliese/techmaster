// =============================================================================
// services/simulator-helpers.service.js — Pure Flight Simulator Fleet Helpers
// =============================================================================
'use strict';

const VALID_SIM_CATEGORIES = new Set(['COMMERCIAL_FIXED_WING', 'ROTORCRAFT', 'DEFENSE_FMS', 'FTD_FNPT']);
const VALID_SIM_STATUSES = new Set(['READY', 'IN_SORTIE', 'PRE_FLIGHT', 'MAINTENANCE', 'DEGRADED', 'AOG']);
const VALID_STATION_KINDS = new Set(['FFS_BAY', 'TEST_PLACE', 'IOS_CONSOLE']);
const VALID_SHIFT_USAGE_STATUSES = new Set(['READY', 'IN_USE', 'NA']);
const VALID_SUBSYSTEM_CODES = new Set([
  'VISUAL', 'MOTION', 'CONTROL_LOADING', 'AVIONICS_COCKPIT', 'IOS', 'HOST_COMPUTE', 'SOUND', 'HVAC_POWER'
]);
const VALID_SUBSYSTEM_STATUSES = new Set(['NOMINAL', 'DEGRADED', 'FAULT', 'MAINTENANCE']);
const VALID_QTG_CATEGORIES = new Set(['PERFORMANCE', 'HANDLING', 'MOTION_CUEING', 'VISUAL_SYSTEM', 'SOUND', 'IOS_NAV']);
const VALID_QTG_QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'Q4']);
const VALID_QTG_MODES = new Set(['AUTO', 'MANUAL']);
const VALID_QTG_STATUSES = new Set(['PENDING', 'PASSED', 'TOLERANCE_WARN', 'FAILED']);

const DEFAULT_SUBSYSTEM_TEMPLATES = [
  { subsystem_code: 'VISUAL', name: 'Visual Display & Projectors' },
  { subsystem_code: 'MOTION', name: '6-DOF Motion Platform' },
  { subsystem_code: 'CONTROL_LOADING', name: 'Control Loading System (CLS)' },
  { subsystem_code: 'AVIONICS_COCKPIT', name: 'Cockpit Avionics & Panels' },
  { subsystem_code: 'IOS', name: 'Instructor Operating Station (IOS)' },
  { subsystem_code: 'HOST_COMPUTE', name: 'Real-Time Host Simulation Compute' },
  { subsystem_code: 'SOUND', name: '3D Acoustic & Comms System' },
  { subsystem_code: 'HVAC_POWER', name: 'Bay PDU, UPS & Precision HVAC' }
];

function cleanOptionalText(val, maxLen) {
  if (val === undefined) return { provided: false, value: undefined };
  if (val === null) return { provided: true, value: null };
  const s = String(val).trim();
  if (!s) return { provided: true, value: null };
  if (s.length > maxLen) return { error: `Field exceeds max length of ${maxLen} characters.` };
  return { provided: true, value: s };
}

function cleanOptionalDateOnly(val) {
  if (val === undefined) return { provided: false, value: undefined };
  if (val === null || val === '') return { provided: true, value: null };
  const s = String(val).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'Date must use YYYY-MM-DD format.' };
  return { provided: true, value: s };
}

function cleanOptionalNumber(val, { min = 0, max = 999999, decimals = 1 } = {}) {
  if (val === undefined) return { provided: false, value: undefined };
  if (val === null || val === '') return { provided: true, value: null };
  const n = Number(val);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { error: `Numeric value must be between ${min} and ${max}.` };
  }
  const factor = Math.pow(10, decimals);
  return { provided: true, value: Math.round(n * factor) / factor };
}

function sanitizeSimulatorPayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.code !== undefined || isCreate) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code || code.length > 40) return { error: 'Simulator code is required (max 40 characters).' };
    payload.code = code;
  }

  if (body.name !== undefined || isCreate) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 200) return { error: 'Simulator name is required (max 200 characters).' };
    payload.name = name;
  }

  if (body.bay_code !== undefined || isCreate) {
    const bay = String(body.bay_code ?? '').trim().toUpperCase();
    if (!bay || bay.length > 40) return { error: 'Bay code is required (max 40 characters).' };
    payload.bay_code = bay;
  }

  if (body.aircraft_type !== undefined || isCreate) {
    const ac = String(body.aircraft_type ?? '').trim();
    if (!ac || ac.length > 120) return { error: 'Aircraft type is required (max 120 characters).' };
    payload.aircraft_type = ac;
  }

  if (body.platform_category !== undefined || isCreate) {
    const cat = String(body.platform_category ?? 'COMMERCIAL_FIXED_WING').trim().toUpperCase();
    if (!VALID_SIM_CATEGORIES.has(cat)) return { error: 'Invalid platform category.' };
    payload.platform_category = cat;
  }

  if (body.status !== undefined || isCreate) {
    const status = String(body.status ?? 'READY').trim().toUpperCase();
    if (!VALID_SIM_STATUSES.has(status)) return { error: 'Invalid simulator status.' };
    payload.status = status;
  }

  if (body.station_kind !== undefined || isCreate) {
    const kind = String(body.station_kind ?? 'FFS_BAY').trim().toUpperCase();
    if (!VALID_STATION_KINDS.has(kind)) return { error: 'Invalid station_kind.' };
    payload.station_kind = kind;
  }

  if (body.sort_order !== undefined) {
    const so = Number(body.sort_order);
    if (!Number.isInteger(so) || so < 0 || so > 9999) {
      return { error: 'sort_order must be an integer between 0 and 9999.' };
    }
    payload.sort_order = so;
  }

  const textFields = [
    ['manufacturer', 120],
    ['serial_number', 100],
    ['authority', 60],
    ['qualification_level', 60],
    ['certificate_code', 100],
    ['engine_avionics', 200],
    ['software_load', 120],
    ['airac_cycle', 60],
    ['visual_system', 160],
    ['motion_system', 120],
    ['control_loading', 120],
    ['ios_config', 120],
    ['limitations_mel', 3000],
    ['notes', 4000]
  ];

  for (const [key, maxLen] of textFields) {
    const res = cleanOptionalText(body[key], maxLen);
    if (res.error) return { error: `${key}: ${res.error}` };
    if (res.provided) payload[key] = res.value;
  }

  for (const dKey of ['certificate_expiry', 'last_eval_date']) {
    const res = cleanOptionalDateOnly(body[dKey]);
    if (res.error) return { error: `${dKey}: ${res.error}` };
    if (res.provided) payload[dKey] = res.value;
  }

  const dailyHrs = cleanOptionalNumber(body.daily_available_hours, { min: 1, max: 24, decimals: 1 });
  if (dailyHrs.error) return { error: `daily_available_hours: ${dailyHrs.error}` };
  if (dailyHrs.provided) payload.daily_available_hours = dailyHrs.value ?? 20;

  for (const hKey of ['power_on_hours', 'motion_hours', 'visual_lamp_hours']) {
    const res = cleanOptionalNumber(body[hKey], { min: 0, max: 999999, decimals: 1 });
    if (res.error) return { error: `${hKey}: ${res.error}` };
    if (res.provided) payload[hKey] = res.value ?? 0;
  }

  if (body.asset_id !== undefined) {
    if (body.asset_id === null || body.asset_id === '') {
      payload.asset_id = null;
    } else {
      const aid = Number(body.asset_id);
      if (!Number.isInteger(aid) || aid < 1) return { error: 'Invalid asset_id.' };
      payload.asset_id = aid;
    }
  }

  return { data: payload };
}

function sanitizeSubsystemPayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.subsystem_code !== undefined || isCreate) {
    const sc = String(body.subsystem_code ?? '').trim().toUpperCase();
    if (!VALID_SUBSYSTEM_CODES.has(sc)) return { error: 'Invalid subsystem_code.' };
    payload.subsystem_code = sc;
  }

  if (body.name !== undefined || isCreate) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 150) return { error: 'Subsystem name is required (max 150 characters).' };
    payload.name = name;
  }

  if (body.status !== undefined || isCreate) {
    const status = String(body.status ?? 'NOMINAL').trim().toUpperCase();
    if (!VALID_SUBSYSTEM_STATUSES.has(status)) return { error: 'Invalid subsystem status.' };
    payload.status = status;
  }

  for (const [k, len] of [['part_number', 100], ['serial_number', 100], ['firmware_version', 80], ['notes', 2000]]) {
    const r = cleanOptionalText(body[k], len);
    if (r.error) return { error: r.error };
    if (r.provided) payload[k] = r.value;
  }

  const hrs = cleanOptionalNumber(body.operating_hours, { min: 0, max: 999999, decimals: 1 });
  if (hrs.error) return { error: hrs.error };
  if (hrs.provided) payload.operating_hours = hrs.value ?? 0;

  for (const dKey of ['last_calibrated_at', 'next_calibration_due']) {
    const r = cleanOptionalDateOnly(body[dKey]);
    if (r.error) return { error: r.error };
    if (r.provided) payload[dKey] = r.value;
  }

  return { data: payload };
}

function sanitizeQtgPayload(body = {}, { isCreate = false } = {}) {
  const payload = {};

  if (body.test_code !== undefined || isCreate) {
    const tc = String(body.test_code ?? '').trim().toUpperCase();
    if (!tc || tc.length > 60) return { error: 'QTG test_code is required (max 60 characters).' };
    payload.test_code = tc;
  }

  if (body.title !== undefined || isCreate) {
    const title = String(body.title ?? '').trim();
    if (!title || title.length > 220) return { error: 'QTG title is required (max 220 characters).' };
    payload.title = title;
  }

  if (body.category !== undefined || isCreate) {
    const cat = String(body.category ?? 'PERFORMANCE').trim().toUpperCase();
    if (!VALID_QTG_CATEGORIES.has(cat)) return { error: 'Invalid QTG category.' };
    payload.category = cat;
  }

  if (body.quarter !== undefined || isCreate) {
    const q = String(body.quarter ?? 'Q1').trim().toUpperCase();
    if (!VALID_QTG_QUARTERS.has(q)) return { error: 'Invalid QTG quarter (Q1-Q4).' };
    payload.quarter = q;
  }

  if (body.year !== undefined || isCreate) {
    const yr = Number(body.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(yr) || yr < 2000 || yr > 2100) return { error: 'Invalid QTG year.' };
    payload.year = yr;
  }

  if (body.mode !== undefined || isCreate) {
    const mode = String(body.mode ?? 'AUTO').trim().toUpperCase();
    if (!VALID_QTG_MODES.has(mode)) return { error: 'Invalid QTG execution mode.' };
    payload.mode = mode;
  }

  if (body.status !== undefined || isCreate) {
    const st = String(body.status ?? 'PENDING').trim().toUpperCase();
    if (!VALID_QTG_STATUSES.has(st)) return { error: 'Invalid QTG status.' };
    payload.status = st;
    if (st === 'PASSED' || st === 'TOLERANCE_WARN' || st === 'FAILED') {
      payload.executed_at = body.executed_at ? new Date(body.executed_at) : new Date();
    }
  }

  const due = cleanOptionalDateOnly(body.due_date);
  if (due.error) return { error: due.error };
  if (due.provided) payload.due_date = due.value;

  for (const [k, len] of [['measured_delta', 120], ['notes', 2000]]) {
    const r = cleanOptionalText(body[k], len);
    if (r.error) return { error: r.error };
    if (r.provided) payload[k] = r.value;
  }

  return { data: payload };
}

function computeCertificateStatus(expiryDate, now = new Date()) {
  if (!expiryDate) return { status: 'UNSET', daysRemaining: null };
  const expMs = Date.parse(`${String(expiryDate).slice(0, 10)}T23:59:59Z`);
  if (!Number.isFinite(expMs)) return { status: 'UNSET', daysRemaining: null };

  const todayUtcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysRemaining = Math.floor((expMs - todayUtcStart) / 86400000);

  if (daysRemaining < 0) return { status: 'EXPIRED', daysRemaining };
  if (daysRemaining <= 45) return { status: 'EXPIRING_SOON', daysRemaining };
  return { status: 'VALID', daysRemaining };
}

function computeSimulatorTelemetry(sim, { sorties = [], maintenance = [], qtgRecords = [], subsystems = [], now = new Date() } = {}) {
  const nowMs = now.getTime();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const todayEnd = todayStart + 86400000;

  let scheduledMinutes = 0;
  let lostMinutes = 0;
  let todayMinutes = 0;
  let totalSorties = 0;
  let activeSortie = null;
  let nextSortie = null;

  for (const s of sorties) {
    if (!s || s.status === 'CANCELLED') continue;
    totalSorties += 1;

    const startMs = Date.parse(s.start_date);
    const endMs = s.end_date ? Date.parse(s.end_date) : (Number.isFinite(startMs) ? startMs + (Number(s.scheduled_hours || 2) * 3600000) : NaN);
    const schedMin = Number(s.scheduled_hours) > 0
      ? Math.round(Number(s.scheduled_hours) * 60)
      : (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60000) : 0);

    scheduledMinutes += schedMin;
    lostMinutes += Math.max(0, Number(s.lost_training_minutes) || 0);

    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const overlapStart = Math.max(startMs, todayStart);
      const overlapEnd = Math.min(endMs, todayEnd);
      if (overlapEnd > overlapStart) {
        todayMinutes += Math.round((overlapEnd - overlapStart) / 60000);
      }
    }

    if (s.status === 'IN_PROGRESS') {
      if (!activeSortie || startMs > Date.parse(activeSortie.start_date)) {
        activeSortie = s;
      }
    } else if (s.status === 'PLANNED' && Number.isFinite(startMs) && startMs >= nowMs) {
      if (!nextSortie || startMs < Date.parse(nextSortie.start_date)) {
        nextSortie = s;
      }
    }
  }

  const dispatchReliabilityPct = scheduledMinutes > 0
    ? Math.max(0, Math.min(100, Math.round(((scheduledMinutes - lostMinutes) / scheduledMinutes) * 1000) / 10))
    : 100;

  const todayFlightHours = Math.round((todayMinutes / 60) * 10) / 10;
  const dailyAvailableHours = Math.max(1, Number(sim?.daily_available_hours) || 20);
  const bayUtilizationPct = Math.min(100, Math.round((todayFlightHours / dailyAvailableHours) * 100));

  const openMaintenance = maintenance.filter(m => ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'].includes(m.status));
  const openSnagsCount = openMaintenance.length;
  const aogSnagsCount = openMaintenance.filter(m => m.severity === 'AOG').length;

  const degradedSubsystemsCount = subsystems.filter(sub => sub.status && sub.status !== 'NOMINAL').length;

  const qtgTotal = qtgRecords.length;
  const qtgPassed = qtgRecords.filter(q => q.status === 'PASSED').length;
  const qtgWarn = qtgRecords.filter(q => q.status === 'TOLERANCE_WARN').length;
  const qtgFailed = qtgRecords.filter(q => q.status === 'FAILED').length;
  const qtgPending = qtgRecords.filter(q => q.status === 'PENDING').length;

  return {
    totalSorties,
    todayFlightHours,
    dailyAvailableHours,
    bayUtilizationPct,
    scheduledHoursTotal: Math.round((scheduledMinutes / 60) * 10) / 10,
    lostTrainingMinutes: lostMinutes,
    dispatchReliabilityPct,
    activeSortie: activeSortie ? {
      id: activeSortie.id,
      sortie_code: activeSortie.sortie_code,
      title: activeSortie.title,
      customer_operator: activeSortie.customer_operator,
      start_date: activeSortie.start_date,
      end_date: activeSortie.end_date
    } : null,
    nextSortie: nextSortie ? {
      id: nextSortie.id,
      sortie_code: nextSortie.sortie_code,
      title: nextSortie.title,
      customer_operator: nextSortie.customer_operator,
      start_date: nextSortie.start_date,
      end_date: nextSortie.end_date
    } : null,
    openSnagsCount,
    aogSnagsCount,
    subsystemCount: subsystems.length,
    degradedSubsystemsCount,
    qtgSummary: {
      total: qtgTotal,
      passed: qtgPassed,
      warn: qtgWarn,
      failed: qtgFailed,
      pending: qtgPending,
      completionPct: qtgTotal > 0 ? Math.round(((qtgPassed + qtgWarn) / qtgTotal) * 100) : 100
    },
    certificate: computeCertificateStatus(sim?.certificate_expiry, now)
  };
}

function detectSortieBayConflict(
  proposed = {},
  existingSorties = [],
  simulator = null,
  subsystems = [],
  maintenanceWindows = [],
  dailyShiftStatus = null
) {
  const startMs = Date.parse(proposed.start_date);
  const endMs = proposed.end_date ? Date.parse(proposed.end_date) : (Number.isFinite(startMs) ? startMs + 7200000 : NaN);
  const excludeId = proposed.exclude_id ? Number(proposed.exclude_id) : null;
  const warnings = [];
  const overlappingSorties = [];
  const overlappingMaintenance = [];

  if (simulator) {
    if (simulator.status === 'AOG') {
      warnings.push(`${simulator.bay_code} (${simulator.code}) is currently AOG / Grounded.`);
    } else if (simulator.status === 'MAINTENANCE') {
      warnings.push(`${simulator.bay_code} (${simulator.code}) is scheduled under Maintenance.`);
    } else if (simulator.status === 'DEGRADED' && simulator.limitations_mel) {
      warnings.push(`MEL Limitation active: ${simulator.limitations_mel}`);
    }

    if (String(dailyShiftStatus || '').toUpperCase() === 'NA') {
      warnings.push(`${simulator.bay_code} is marked NA (Not Available) on the Daily Station Operations sheet for this date.`);
    }

    if (proposed.motion_required !== false) {
      if (simulator.platform_category === 'FTD_FNPT') {
        warnings.push(`${simulator.code} is Fixed-Base (${simulator.qualification_level}); motion cueing is unavailable.`);
      } else {
        const motionSub = (subsystems || []).find(s => s.subsystem_code === 'MOTION');
        if (motionSub && (motionSub.status === 'FAULT' || motionSub.status === 'MAINTENANCE')) {
          warnings.push(`Motion 6-DOF subsystem on ${simulator.bay_code} is currently ${motionSub.status}.`);
        }
      }
    }
  }

  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    for (const s of existingSorties || []) {
      if (!s || s.status === 'CANCELLED') continue;
      if (excludeId && Number(s.id) === excludeId) continue;

      const sStart = Date.parse(s.start_date);
      const sEnd = s.end_date ? Date.parse(s.end_date) : (Number.isFinite(sStart) ? sStart + 7200000 : NaN);
      if (!Number.isFinite(sStart) || !Number.isFinite(sEnd)) continue;

      if (startMs < sEnd && endMs > sStart) {
        overlappingSorties.push({
          id: s.id,
          sortie_code: s.sortie_code || `SRT-${s.id}`,
          title: s.title,
          status: s.status,
          start_date: s.start_date,
          end_date: s.end_date
        });
      }
    }

    for (const mw of maintenanceWindows || []) {
      const mStart = Date.parse(mw.start_date);
      const mEnd = mw.end_date ? Date.parse(mw.end_date) : (Number.isFinite(mStart) ? mStart + 7200000 : NaN);
      if (!Number.isFinite(mStart) || !Number.isFinite(mEnd)) continue;
      if (startMs < mEnd && endMs > mStart) {
        overlappingMaintenance.push({
          id: mw.id,
          title: mw.title,
          source: mw.source || 'MAINTENANCE_WO',
          start_date: mw.start_date,
          end_date: mw.end_date
        });
      }
    }
  }

  if (overlappingMaintenance.length > 0) {
    warnings.unshift(`Maintenance window conflict (${overlappingMaintenance.length}): ${overlappingMaintenance[0].title}`);
  }
  if (overlappingSorties.length > 0) {
    warnings.unshift(`Time-slot conflict with ${overlappingSorties.length} existing sortie(s) in this bay.`);
  }

  return {
    hasOverlap: overlappingSorties.length > 0 || overlappingMaintenance.length > 0,
    overlappingSorties,
    overlappingMaintenance,
    warnings
  };
}

/**
 * Normalizes flexible time input ("6:30", "06:40", "17:00", "0:00") into "HH:MM".
 */
function normalizeHhMm(value, fallback = '00:00') {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) return fallback;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return fallback;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Computes active testing session duration in minutes between start and end HH:MM.
 * Returns 0 when idle ("00:00" on either boundary or equal start/end).
 */
function computeTestingDurationMinutes(startHhMm, endHhMm) {
  const start = normalizeHhMm(startHhMm, '00:00');
  const end = normalizeHhMm(endHhMm, '00:00');
  if (start === '00:00' && end === '00:00') return 0;

  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (end === '00:00' || start === '00:00') return 0;
  if (endMin >= startMin) return endMin - startMin;
  return (24 * 60 - startMin) + endMin;
}

/**
 * Resolves usage_status ('READY' | 'IN_USE' | 'NA') when time fields or status change.
 */
function deriveEntryUsageStatus({ currentStatus = 'READY', requestedStatus, startHhMm, endHhMm }) {
  if (requestedStatus !== undefined && requestedStatus !== null && requestedStatus !== '') {
    const reqUp = String(requestedStatus).trim().toUpperCase();
    if (VALID_SHIFT_USAGE_STATUSES.has(reqUp)) {
      return reqUp;
    }
  }
  if (String(currentStatus).toUpperCase() === 'NA') {
    return 'NA';
  }
  const s = normalizeHhMm(startHhMm, '00:00');
  const e = normalizeHhMm(endHhMm, '00:00');
  return (s !== '00:00' || e !== '00:00') ? 'IN_USE' : 'READY';
}

/**
 * Projects daily operating sheets (Test Places, IOS Consoles, etc.) into
 * 24-hour timeline bars for Sorties & Dispatch.
 */
function buildTimelineShiftBlocks(sheets = []) {
  const blocks = [];
  const statusBySimulator = {};

  for (const sheet of sheets || []) {
    if (!sheet || !sheet.log) continue;
    const log = sheet.log;
    const stationKind = log.station_kind || 'TEST_PLACE';
    const readiness = normalizeHhMm(log.system_readiness_time, '06:30');
    const postTesting = normalizeHhMm(log.post_testing_time, '17:00');
    const logout = normalizeHhMm(log.logout_time, '18:00');
    const fallbackEnd = postTesting !== '00:00' ? postTesting : (logout !== '00:00' ? logout : '17:00');

    const bySim = new Map();
    for (const shift of sheet.shifts || []) {
      const shiftName = shift.shift_name || `SHIFT ${shift.shift_number || 1}`;
      const preFlight = normalizeHhMm(shift.pre_flight_test_time, readiness);

      for (const entry of shift.entries || []) {
        const simId = Number(entry.simulator_id);
        if (!simId) continue;
        const list = bySim.get(simId) || [];
        list.push({
          id: entry.id,
          shift_id: shift.id,
          shift_name: shiftName,
          pre_flight_test_time: preFlight,
          usage_status: String(entry.usage_status || 'READY').toUpperCase(),
          sim_testing_start: normalizeHhMm(entry.sim_testing_start, '00:00'),
          sim_testing_end: normalizeHhMm(entry.sim_testing_end, '00:00'),
          notes: entry.notes || null
        });
        bySim.set(simId, list);
      }
    }

    for (const [simId, entries] of bySim.entries()) {
      const inUseEntries = entries.filter(e => e.usage_status === 'IN_USE');
      const naEntries = entries.filter(e => e.usage_status === 'NA');
      const readyEntries = entries.filter(e => e.usage_status === 'READY');

      if (inUseEntries.length > 0) {
        statusBySimulator[simId] = 'IN_USE';
        for (const e of inUseEntries) {
          const startTime = e.sim_testing_start !== '00:00'
            ? e.sim_testing_start
            : (e.pre_flight_test_time !== '00:00' ? e.pre_flight_test_time : readiness);
          const endTime = e.sim_testing_end !== '00:00' ? e.sim_testing_end : fallbackEnd;
          blocks.push({
            id: `shift-in-use-${e.id || `${simId}-${e.shift_id}`}`,
            simulator_id: simId,
            station_kind: stationKind,
            block_kind: 'SHIFT_IN_USE',
            usage_status: 'IN_USE',
            shift_name: e.shift_name,
            start_time: startTime,
            end_time: endTime,
            duration_minutes: computeTestingDurationMinutes(startTime, endTime),
            notes: e.notes
          });
        }
      } else if (naEntries.length > 0) {
        statusBySimulator[simId] = 'NA';
        const firstNa = naEntries[0];
        blocks.push({
          id: `shift-na-${simId}-${log.log_date}`,
          simulator_id: simId,
          station_kind: stationKind,
          block_kind: 'SHIFT_NA',
          usage_status: 'NA',
          shift_name: naEntries.map(e => e.shift_name).join(' / '),
          start_time: readiness,
          end_time: fallbackEnd,
          duration_minutes: computeTestingDurationMinutes(readiness, fallbackEnd),
          notes: naEntries.map(e => e.notes).filter(Boolean).join(' · ') || firstNa.notes || null
        });
      } else if (readyEntries.length > 0) {
        statusBySimulator[simId] = 'READY';
        const noteText = readyEntries.map(e => e.notes).filter(Boolean).join(' · ') || null;
        blocks.push({
          id: `shift-ready-${simId}-${log.log_date}`,
          simulator_id: simId,
          station_kind: stationKind,
          block_kind: 'SHIFT_READY',
          usage_status: 'READY',
          shift_name: readyEntries[0].shift_name,
          start_time: readiness,
          end_time: fallbackEnd,
          duration_minutes: computeTestingDurationMinutes(readiness, fallbackEnd),
          notes: noteText
        });
      }
    }
  }

  return { blocks, statusBySimulator };
}

/**
 * Projects scheduled Maintenance Work Orders and Planned Maintenance occurrences
 * onto 24-hour simulator timeline bars for Sorties & Dispatch.
 */
function buildTimelineMaintenanceBlocks(dateStr, maintRecords = [], plannedOccurrences = [], simulators = []) {
  const blocks = [];
  const toHhMm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

  for (const m of maintRecords || []) {
    if (!m || !m.simulator_id || !m.scheduled_date) continue;
    const start = new Date(m.scheduled_date);
    if (Number.isNaN(start.getTime())) continue;
    const hours = Number(m.downtime_hours) > 0 ? Math.min(12, Number(m.downtime_hours)) : 2;
    const end = new Date(start.getTime() + hours * 3600000);
    blocks.push({
      id: `maint-wo-${m.id}`,
      simulator_id: Number(m.simulator_id),
      source: 'MAINTENANCE_WO',
      title: m.title || 'Maintenance Work Order',
      start_time: toHhMm(start),
      end_time: toHhMm(end),
      status: m.status || 'SCHEDULED',
      severity: m.severity || 'MINOR',
      record_id: Number(m.id)
    });
  }

  const simMatchList = (simulators || []).map(s => ({
    id: Number(s.id),
    tokens: [s.bay_code, s.code, s.name]
      .filter(Boolean)
      .map(t => String(t).toUpperCase().trim())
      .filter(t => t.length >= 3)
  }));

  for (const occ of plannedOccurrences || []) {
    if (!occ || occ.status === 'DONE') continue;
    const haystack = `${occ.system || ''} ${occ.subsystem || ''} ${occ.task || ''}`.toUpperCase();
    const matched = simMatchList.find(s => s.tokens.some(tok => haystack.includes(tok)));
    if (!matched) continue;
    const start = occ.operationDateStart ? new Date(occ.operationDateStart) : null;
    const end = occ.operationDateEnd ? new Date(occ.operationDateEnd) : null;
    const startHhMm = start && !Number.isNaN(start.getTime()) ? toHhMm(start) : '08:00';
    const endHhMm = end && !Number.isNaN(end.getTime()) ? toHhMm(end) : '10:00';
    blocks.push({
      id: `planned-pm-${occ.masterId || occ.id}-${dateStr}`,
      simulator_id: matched.id,
      source: 'PLANNED_MAINT',
      title: occ.task || occ.subsystem || 'Planned Maintenance',
      start_time: startHhMm,
      end_time: endHhMm,
      status: occ.status || 'TODO',
      severity: 'MINOR',
      record_id: Number(occ.masterId || occ.id) || null
    });
  }

  return blocks;
}

module.exports = {
  VALID_SIM_CATEGORIES,
  VALID_SIM_STATUSES,
  VALID_STATION_KINDS,
  VALID_SHIFT_USAGE_STATUSES,
  VALID_SUBSYSTEM_CODES,
  VALID_SUBSYSTEM_STATUSES,
  VALID_QTG_CATEGORIES,
  VALID_QTG_QUARTERS,
  VALID_QTG_MODES,
  VALID_QTG_STATUSES,
  DEFAULT_SUBSYSTEM_TEMPLATES,
  sanitizeSimulatorPayload,
  sanitizeSubsystemPayload,
  sanitizeQtgPayload,
  computeCertificateStatus,
  computeSimulatorTelemetry,
  detectSortieBayConflict,
  normalizeHhMm,
  computeTestingDurationMinutes,
  deriveEntryUsageStatus,
  buildTimelineShiftBlocks,
  buildTimelineMaintenanceBlocks
};
