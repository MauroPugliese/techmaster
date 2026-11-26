'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../../services/simulator-helpers.service');

test('sanitizeSimulatorPayload validates required fields and normalizes codes without mutating input', () => {
  const input = {
    code: ' ffs-a320-09 ',
    name: 'A320neo Bay 09',
    bay_code: 'bay-09',
    aircraft_type: 'Airbus A320neo',
    platform_category: 'commercial_fixed_wing',
    daily_available_hours: 18.5
  };
  const snapshot = { ...input };
  const res = sanitizeSimulatorPayload(input, { isCreate: true });

  assert.deepEqual(input, snapshot);
  assert.equal(res.error, undefined);
  assert.equal(res.data.code, 'FFS-A320-09');
  assert.equal(res.data.bay_code, 'BAY-09');
  assert.equal(res.data.platform_category, 'COMMERCIAL_FIXED_WING');
  assert.equal(res.data.daily_available_hours, 18.5);
});

test('sanitizeSimulatorPayload rejects missing required fields and invalid enums', () => {
  assert.ok(sanitizeSimulatorPayload({}, { isCreate: true }).error);
  assert.ok(sanitizeSimulatorPayload({ code: 'SIM1', name: 'Sim', bay_code: 'B1', aircraft_type: 'A320', status: 'BAD' }, { isCreate: true }).error);
  assert.ok(sanitizeSimulatorPayload({ daily_available_hours: 30 }, { isCreate: false }).error);
});

test('sanitizeSubsystemPayload and sanitizeQtgPayload enforce domain enums cleanly', () => {
  const subOk = sanitizeSubsystemPayload({ subsystem_code: 'visual', name: 'Laser Dome', operating_hours: 120.4 }, { isCreate: true });
  assert.equal(subOk.error, undefined);
  assert.equal(subOk.data.subsystem_code, 'VISUAL');
  assert.ok(sanitizeSubsystemPayload({ subsystem_code: 'UNKNOWN', name: 'X' }, { isCreate: true }).error);

  const qtgOk = sanitizeQtgPayload({ test_code: 'qtg-1.a', title: 'Takeoff Trim', quarter: 'q2', year: 2026, status: 'passed' }, { isCreate: true });
  assert.equal(qtgOk.error, undefined);
  assert.equal(qtgOk.data.test_code, 'QTG-1.A');
  assert.equal(qtgOk.data.quarter, 'Q2');
  assert.equal(qtgOk.data.status, 'PASSED');
  assert.ok(qtgOk.data.executed_at instanceof Date);
});

test('computeCertificateStatus identifies VALID, EXPIRING_SOON, EXPIRED and UNSET', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  assert.equal(computeCertificateStatus(null, now).status, 'UNSET');
  assert.equal(computeCertificateStatus('2026-05-20', now).status, 'EXPIRED');
  assert.equal(computeCertificateStatus('2026-06-25', now).status, 'EXPIRING_SOON');
  assert.equal(computeCertificateStatus('2026-12-31', now).status, 'VALID');
});

test('computeSimulatorTelemetry computes dispatch reliability, utilization, QTG %, and active/next sortie', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const sim = { id: 1, code: 'FFS-A320-01', daily_available_hours: 20, certificate_expiry: '2026-12-10' };

  const telemetry = computeSimulatorTelemetry(sim, {
    sorties: [
      { id: 1, sortie_code: 'S1', title: 'Slot 1', status: 'COMPLETED', start_date: '2026-11-24T04:00:00Z', end_date: '2026-11-24T08:00:00Z', scheduled_hours: 4, lost_training_minutes: 0 },
      { id: 2, sortie_code: 'S2', title: 'Slot 2', status: 'IN_PROGRESS', start_date: '2026-11-24T09:00:00Z', end_date: '2026-11-24T13:00:00Z', scheduled_hours: 4, lost_training_minutes: 30 },
      { id: 3, sortie_code: 'S3', title: 'Slot 3', status: 'PLANNED', start_date: '2026-11-24T14:00:00Z', end_date: '2026-11-24T16:00:00Z', scheduled_hours: 2, lost_training_minutes: 0 }
    ],
    maintenance: [
      { id: 10, status: 'IN_PROGRESS', severity: 'AOG' },
      { id: 11, status: 'DEFERRED', severity: 'MINOR' },
      { id: 12, status: 'COMPLETED', severity: 'DEGRADED' }
    ],
    qtgRecords: [
      { status: 'PASSED' },
      { status: 'TOLERANCE_WARN' },
      { status: 'PENDING' },
      { status: 'FAILED' }
    ],
    subsystems: [
      { status: 'NOMINAL' },
      { status: 'DEGRADED' }
    ],
    now
  });

  // Total scheduled = 10h (600m), lost = 30m -> 570/600 = 95.0%
  assert.equal(telemetry.dispatchReliabilityPct, 95);
  assert.equal(telemetry.todayFlightHours, 10);
  assert.equal(telemetry.bayUtilizationPct, 50);
  assert.equal(telemetry.activeSortie.id, 2);
  assert.equal(telemetry.nextSortie.id, 3);
  assert.equal(telemetry.openSnagsCount, 2);
  assert.equal(telemetry.aogSnagsCount, 1);
  assert.equal(telemetry.degradedSubsystemsCount, 1);
  assert.equal(telemetry.qtgSummary.completionPct, 50);
  assert.equal(telemetry.certificate.status, 'EXPIRING_SOON');
});

test('detectSortieBayConflict flags overlapping slots, AOG bays, MEL limits, and motion faults', () => {
  const simulator = { code: 'FFS-A350-03', bay_code: 'BAY-03', status: 'AOG', platform_category: 'COMMERCIAL_FIXED_WING' };
  const subsystems = [{ subsystem_code: 'MOTION', status: 'FAULT' }];
  const existing = [
    { id: 10, sortie_code: 'SRT-10', title: 'LOFT', status: 'PLANNED', start_date: '2026-11-24T08:00:00Z', end_date: '2026-11-24T12:00:00Z' },
    { id: 11, sortie_code: 'SRT-11', title: 'Cancelled', status: 'CANCELLED', start_date: '2026-11-24T10:00:00Z', end_date: '2026-11-24T14:00:00Z' }
  ];

  const res = detectSortieBayConflict(
    { start_date: '2026-11-24T11:00:00Z', end_date: '2026-11-24T15:00:00Z', motion_required: true },
    existing,
    simulator,
    subsystems
  );

  assert.equal(res.hasOverlap, true);
  assert.equal(res.overlappingSorties.length, 1);
  assert.equal(res.overlappingSorties[0].id, 10);
  assert.ok(res.warnings.some(w => w.includes('AOG')));
  assert.ok(res.warnings.some(w => w.includes('Motion 6-DOF')));

  // Excluding self (id 10) removes overlap
  const editRes = detectSortieBayConflict(
    { start_date: '2026-11-24T08:00:00Z', end_date: '2026-11-24T12:00:00Z', exclude_id: 10, motion_required: false },
    existing,
    simulator,
    subsystems
  );
  assert.equal(editRes.hasOverlap, false);
});

test('normalizeHhMm, computeTestingDurationMinutes & deriveEntryUsageStatus handle daily station sheet inputs', () => {
  assert.equal(normalizeHhMm('6:30'), '06:30');
  assert.equal(normalizeHhMm('0:00'), '00:00');
  assert.equal(normalizeHhMm('17:45'), '17:45');
  assert.equal(normalizeHhMm('25:99', '06:40'), '06:40');

  assert.equal(computeTestingDurationMinutes('00:00', '00:00'), 0);
  assert.equal(computeTestingDurationMinutes('07:00', '12:30'), 330);
  assert.equal(computeTestingDurationMinutes('22:00', '02:00'), 240);

  assert.equal(deriveEntryUsageStatus({ currentStatus: 'READY', startHhMm: '07:00', endHhMm: '12:30' }), 'IN_USE');
  assert.equal(deriveEntryUsageStatus({ currentStatus: 'IN_USE', startHhMm: '00:00', endHhMm: '00:00' }), 'READY');
  assert.equal(deriveEntryUsageStatus({ currentStatus: 'NA', startHhMm: '07:00', endHhMm: '12:30' }), 'NA');
  assert.equal(deriveEntryUsageStatus({ currentStatus: 'IN_USE', requestedStatus: 'NA', startHhMm: '00:00', endHhMm: '00:00' }), 'NA');

  const tp = sanitizeSimulatorPayload({
    code: 'tp-11',
    name: 'TEST PLACE 11',
    bay_code: 'tp-11',
    aircraft_type: 'Multi-Role Sim Test Place',
    station_kind: 'test_place',
    sort_order: 11
  }, { isCreate: true });
  assert.equal(tp.error, undefined);
  assert.equal(tp.data.station_kind, 'TEST_PLACE');
  assert.equal(tp.data.sort_order, 11);
});

test('buildTimelineShiftBlocks projects IN_USE, READY and NA shift entries onto 24h timeline blocks', () => {
  const { blocks, statusBySimulator } = buildTimelineShiftBlocks([
    {
      log: {
        log_date: '2026-11-25',
        station_kind: 'TEST_PLACE',
        system_readiness_time: '06:30',
        post_testing_time: '17:00',
        logout_time: '18:00'
      },
      shifts: [
        {
          id: 1,
          shift_name: 'SHIFT 1',
          pre_flight_test_time: '06:40',
          entries: [
            { id: 101, simulator_id: 10, usage_status: 'IN_USE', sim_testing_start: '07:00', sim_testing_end: '12:30', notes: 'SMT run' },
            { id: 102, simulator_id: 11, usage_status: 'READY', sim_testing_start: '00:00', sim_testing_end: '00:00', notes: null },
            { id: 103, simulator_id: 12, usage_status: 'NA', sim_testing_start: '00:00', sim_testing_end: '00:00', notes: 'PSU fault' }
          ]
        }
      ]
    }
  ]);

  assert.equal(blocks.length, 3);
  assert.equal(statusBySimulator[10], 'IN_USE');
  assert.equal(statusBySimulator[11], 'READY');
  assert.equal(statusBySimulator[12], 'NA');

  const inUse = blocks.find(b => b.simulator_id === 10);
  assert.equal(inUse.block_kind, 'SHIFT_IN_USE');
  assert.equal(inUse.start_time, '07:00');
  assert.equal(inUse.end_time, '12:30');
  assert.equal(inUse.duration_minutes, 330);

  const ready = blocks.find(b => b.simulator_id === 11);
  assert.equal(ready.block_kind, 'SHIFT_READY');
  assert.equal(ready.start_time, '06:30');
  assert.equal(ready.end_time, '17:00');

  const na = blocks.find(b => b.simulator_id === 12);
  assert.equal(na.block_kind, 'SHIFT_NA');
  assert.equal(na.notes, 'PSU fault');
});


test('detectSortieBayConflict flags overlapping maintenance windows and daily NA status', () => {
  const res = detectSortieBayConflict(
    { start_date: '2026-11-25T10:00:00Z', end_date: '2026-11-25T14:00:00Z', motion_required: false },
    [],
    { id: 1, bay_code: 'BAY-01', code: 'FFS-A320', status: 'READY' },
    [],
    [{ id: 77, title: 'Hydraulic Actuator PM', source: 'MAINTENANCE_WO', start_date: '2026-11-25T11:00:00Z', end_date: '2026-11-25T13:00:00Z' }],
    'NA'
  );
  assert.equal(res.hasOverlap, true);
  assert.equal(res.overlappingMaintenance.length, 1);
  assert.ok(res.warnings.some(w => /Maintenance window conflict/i.test(w)));
  assert.ok(res.warnings.some(w => /marked NA/i.test(w)));
});

test('buildTimelineMaintenanceBlocks projects scheduled WOs and matched Planned Maintenance onto 24h timeline', () => {
  const blocks = buildTimelineMaintenanceBlocks(
    '2026-11-25',
    [{ id: 15, simulator_id: 2, title: 'Visual Alignment', scheduled_date: '2026-11-25T09:00:00', downtime_hours: 2.5, status: 'SCHEDULED', severity: 'DEGRADED' }],
    [{ masterId: 9, system: 'BAY-02 A320', subsystem: 'MOTION', task: 'Monthly Lube', status: 'TODO', operationDateStart: '2026-11-25T14:00:00', operationDateEnd: '2026-11-25T15:30:00' }],
    [{ id: 2, bay_code: 'BAY-02', code: 'FFS-A320', name: 'A320 Bay 2' }]
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source, 'MAINTENANCE_WO');
  assert.equal(blocks[0].simulator_id, 2);
  assert.equal(blocks[1].source, 'PLANNED_MAINT');
  assert.equal(blocks[1].simulator_id, 2);
});
