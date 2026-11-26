// =============================================================================
// exports/modules/daily-station-ops.js — Daily Station Operations & Handover Log (CAE-OPS-14)
// Blueprint:
//   P1 Cover -> P2 Daily Operating Hours, Shift KPIs & Faulted Station Alerts
//   -> P3+ Per-Shift Utilization & Handover Tables (SHIFT 1, SHIFT 2, ... with Full Notes)
// =============================================================================
'use strict';

const { Op } = require('sequelize');
const {
  Simulator,
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  User
} = require('../../models');
const {
  VALID_STATION_KINDS,
  computeTestingDurationMinutes
} = require('../../services/simulator-helpers.service');
const {
  fmtDateTime, fmtNumber, fmtPercent, fullName, cleanText, parseRange, rangeLabel
} = require('../core/helpers');

const USAGE_TONE = {
  IN_USE: 'info',
  READY: 'success',
  NA: 'danger'
};

const USAGE_LABEL = {
  IN_USE: 'IN USE',
  READY: 'READY',
  NA: 'NA'
};

function resolveDate(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function kindTitle(kind) {
  if (kind === 'IOS_CONSOLE') return 'IOS Consoles';
  if (kind === 'FFS_BAY') return 'Full Flight Simulators';
  return 'Test Places';
}

async function loadKindSnapshot(dateStr, stationKind) {
  const [stations, dailyLog] = await Promise.all([
    Simulator.findAll({
      where: { station_kind: stationKind },
      order: [['sort_order', 'ASC'], ['bay_code', 'ASC'], ['id', 'ASC']]
    }),
    SimulatorDailyLog.findOne({
      where: { log_date: dateStr, station_kind: stationKind },
      include: [
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name', 'username'] },
        {
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [
            { model: User, as: 'lead', attributes: ['id', 'first_name', 'last_name', 'username'] },
            { model: User, as: 'signer', attributes: ['id', 'first_name', 'last_name', 'username'] },
            { model: SimulatorShiftEntry, as: 'entries' }
          ]
        }
      ]
    })
  ]);

  const stationPlain = stations.map(s => s.get({ plain: true }));
  const stationMap = new Map(stationPlain.map(s => [Number(s.id), s]));

  const logPlain = dailyLog ? dailyLog.get({ plain: true }) : {
    log_date: dateStr,
    station_kind: stationKind,
    system_readiness_time: '06:30',
    post_testing_time: '17:00',
    logout_time: '18:00',
    general_notes: null,
    shifts: []
  };

  const sortedShifts = [...(logPlain.shifts || [])].sort(
    (a, b) => (a.shift_number || 0) - (b.shift_number || 0) || (a.id || 0) - (b.id || 0)
  );

  // If no shifts persisted yet for the date, synthesize a clean default read-only preview
  const effectiveShifts = sortedShifts.length > 0 ? sortedShifts : [{
    shift_number: 1,
    shift_name: 'SHIFT 1',
    pre_flight_test_time: '06:40',
    lead: null,
    signer: null,
    signed_off_at: null,
    entries: stationPlain.map(st => ({
      simulator_id: st.id,
      usage_status: st.status === 'AOG' ? 'NA' : 'READY',
      sim_testing_start: '00:00',
      sim_testing_end: '00:00',
      notes: st.limitations_mel || null
    }))
  }];

  let inUse = 0;
  let ready = 0;
  let na = 0;
  let totalMinutes = 0;
  const naAlerts = [];

  const hydratedShifts = effectiveShifts.map((sh, shiftIdx) => {
    const entryBySim = new Map((sh.entries || []).map(e => [Number(e.simulator_id), e]));
    let shiftMinutes = 0;
    let shiftInUse = 0;
    let shiftReady = 0;
    let shiftNa = 0;

    const rows = stationPlain.map(st => {
      const entry = entryBySim.get(Number(st.id)) || {
        usage_status: st.status === 'AOG' ? 'NA' : 'READY',
        sim_testing_start: '00:00',
        sim_testing_end: '00:00',
        notes: null
      };
      const statusKey = entry.usage_status || 'READY';
      const durMin = computeTestingDurationMinutes(entry.sim_testing_start, entry.sim_testing_end);
      shiftMinutes += durMin;
      totalMinutes += durMin;

      if (statusKey === 'IN_USE') shiftInUse += 1;
      else if (statusKey === 'NA') shiftNa += 1;
      else shiftReady += 1;

      if (shiftIdx === 0) {
        if (statusKey === 'IN_USE') inUse += 1;
        else if (statusKey === 'NA') na += 1;
        else ready += 1;
      }

      if (statusKey === 'NA') {
        naAlerts.push({
          severity: 'danger',
          title: `${st.bay_code} · ${st.name} (${sh.shift_name || `SHIFT ${sh.shift_number}`})`,
          detail: entry.notes ? cleanText(entry.notes, 200) : 'Marked NA (Not Available) — troubleshooting / maintenance required.'
        });
      }

      return {
        station: `${st.bay_code} · ${st.name}`,
        aircraft: st.aircraft_type || '—',
        status: USAGE_LABEL[statusKey] || statusKey,
        status_tone: USAGE_TONE[statusKey] || 'neutral',
        start: statusKey === 'NA' ? '—' : (entry.sim_testing_start || '00:00'),
        end: statusKey === 'NA' ? '—' : (entry.sim_testing_end || '00:00'),
        hours: Number((durMin / 60).toFixed(2)),
        notes: entry.notes ? cleanText(entry.notes, 240) : '—',
        _flag: statusKey === 'NA' ? 'danger' : (statusKey === 'IN_USE' ? 'info' : undefined)
      };
    });

    return {
      shift_number: sh.shift_number || shiftIdx + 1,
      shift_name: sh.shift_name || `SHIFT ${shiftIdx + 1}`,
      pre_flight_test_time: sh.pre_flight_test_time || '06:40',
      lead_name: sh.lead ? fullName(sh.lead) : 'Unassigned',
      signed_off_label: sh.signed_off_at
        ? `Signed by ${fullName(sh.signer, 'Supervisor')} (${fmtDateTime(sh.signed_off_at)})`
        : 'Pending Sign-Off',
      shiftMinutes,
      shiftInUse,
      shiftReady,
      shiftNa,
      rows
    };
  });

  return {
    stationKind,
    label: kindTitle(stationKind),
    log: logPlain,
    stationsCount: stationPlain.length,
    inUse,
    ready,
    na,
    totalMinutes,
    shifts: hydratedShifts,
    naAlerts
  };
}

async function loadRangeRollup(fromYmd, toYmd, kinds) {
  const [stations, logs] = await Promise.all([
    Simulator.findAll({
      where: { station_kind: { [Op.in]: kinds } },
      order: [['station_kind', 'ASC'], ['sort_order', 'ASC'], ['bay_code', 'ASC'], ['id', 'ASC']]
    }),
    SimulatorDailyLog.findAll({
      where: {
        station_kind: { [Op.in]: kinds },
        log_date: { [Op.between]: [fromYmd, toYmd] }
      },
      include: [
        { model: User, as: 'updater', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
        {
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [
            { model: User, as: 'lead', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
            { model: User, as: 'signer', attributes: ['id', 'first_name', 'last_name', 'username'], required: false },
            { model: SimulatorShiftEntry, as: 'entries' }
          ]
        }
      ],
      order: [['log_date', 'DESC'], ['station_kind', 'ASC']]
    })
  ]);

  const stationPlain = stations.map((s) => s.get({ plain: true }));
  const stationMap = new Map(stationPlain.map((s) => [Number(s.id), s]));
  const perStation = new Map();
  stationPlain.forEach((st) => {
    perStation.set(Number(st.id), {
      station: `${st.bay_code} · ${st.name}`,
      kind: st.station_kind === 'IOS_CONSOLE' ? 'IOS' : (st.station_kind === 'TEST_PLACE' ? 'TP' : 'FFS'),
      inUseShifts: 0,
      readyShifts: 0,
      naShifts: 0,
      totalMinutes: 0,
      latestNote: ''
    });
  });

  let totalShifts = 0;
  let signedShifts = 0;
  let totalMinutes = 0;
  let totalEntries = 0;
  let totalNaEntries = 0;
  let totalInUseEntries = 0;
  const naAlerts = [];
  const shiftSummaryRows = [];

  for (const log of logs) {
    const lp = log.get({ plain: true });
    const sortedShifts = [...(lp.shifts || [])].sort((a, b) => (a.shift_number || 0) - (b.shift_number || 0));
    for (const sh of sortedShifts) {
      totalShifts += 1;
      if (sh.signed_off_at) signedShifts += 1;
      let shMin = 0;
      let shInUse = 0;
      let shReady = 0;
      let shNa = 0;
      const naStationCodes = [];

      for (const e of (sh.entries || [])) {
        const simId = Number(e.simulator_id);
        const st = stationMap.get(simId);
        const durMin = computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end);
        const statusKey = e.usage_status || 'READY';
        shMin += durMin;
        totalMinutes += durMin;
        totalEntries += 1;

        if (statusKey === 'IN_USE') { shInUse += 1; totalInUseEntries += 1; }
        else if (statusKey === 'NA') {
          shNa += 1;
          totalNaEntries += 1;
          if (st) naStationCodes.push(st.bay_code);
          if (naAlerts.length < 10) {
            naAlerts.push({
              severity: 'danger',
              title: `${lp.log_date} · ${st ? `${st.bay_code} · ${st.name}` : `Station #${simId}`} (${sh.shift_name})`,
              detail: e.notes ? cleanText(e.notes, 160) : 'Marked NA (Not Available) during shift.'
            });
          }
        } else {
          shReady += 1;
        }

        const agg = perStation.get(simId);
        if (agg) {
          if (statusKey === 'IN_USE') agg.inUseShifts += 1;
          else if (statusKey === 'NA') agg.naShifts += 1;
          else agg.readyShifts += 1;
          agg.totalMinutes += durMin;
          if (!agg.latestNote && e.notes) agg.latestNote = cleanText(e.notes, 110);
        }
      }

      shiftSummaryRows.push({
        date: lp.log_date,
        scope: lp.station_kind === 'IOS_CONSOLE' ? 'IOS' : (lp.station_kind === 'TEST_PLACE' ? 'TP' : 'FFS'),
        shift: sh.shift_name || `SHIFT ${sh.shift_number || 1}`,
        lead: sh.lead ? fullName(sh.lead) : 'Unassigned',
        signoff: sh.signed_off_at ? 'SIGNED' : 'PENDING',
        signoff_tone: sh.signed_off_at ? 'success' : 'warning',
        split: `${shInUse} Use / ${shReady} Rdy / ${shNa} NA`,
        hours: Number((shMin / 60).toFixed(1)),
        na_notes: naStationCodes.length ? `NA: ${naStationCodes.join(', ')}` : (lp.general_notes ? cleanText(lp.general_notes, 90) : 'All Nominal'),
        _flag: shNa > 0 ? 'danger' : undefined
      });
    }
  }

  const stationRows = [...perStation.values()].map((r) => {
    const seen = r.inUseShifts + r.readyShifts + r.naShifts;
    const avail = seen > 0 ? Number((((seen - r.naShifts) / seen) * 100).toFixed(1)) : 100;
    return {
      station: r.station,
      kind: r.kind,
      in_use: r.inUseShifts,
      na_count: r.naShifts,
      hours: Number((r.totalMinutes / 60).toFixed(1)),
      avail_pct: avail,
      note: r.latestNote || '—',
      _flag: r.naShifts > 0 ? 'danger' : undefined
    };
  });

  const uniqueDays = new Set(logs.map((l) => l.log_date)).size;
  const availPct = totalEntries > 0 ? Math.round(((totalEntries - totalNaEntries) / totalEntries) * 1000) / 10 : 100;
  const signoffPct = totalShifts > 0 ? Math.round((signedShifts / totalShifts) * 1000) / 10 : 100;

  return {
    stationsCount: stationPlain.length,
    uniqueDays,
    totalShifts,
    signedShifts,
    signoffPct,
    totalHours: Number((totalMinutes / 60).toFixed(1)),
    totalInUseEntries,
    totalNaEntries,
    availPct,
    naAlerts,
    stationRows,
    shiftSummaryRows
  };
}

module.exports = {
  key: 'daily-station-ops',
  docCode: 'CAE-OPS-14',
  theme: 'daily-station-ops',
  title: 'Daily Station Operations & Shift Handover Log',
  subtitle: 'Operating hours, per-shift Pre-Flight checks, station utilization and Test Leader handover notes',
  category: 'DAILY STATION OPERATIONS',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const rawKind = String(req.query.station_kind || 'TEST_PLACE').trim().toUpperCase();
    const kinds = rawKind === 'ALL'
      ? ['TEST_PLACE', 'IOS_CONSOLE']
      : [VALID_STATION_KINDS.has(rawKind) ? rawKind : 'TEST_PLACE'];
    const scopeLabel = rawKind === 'ALL' ? 'Test Places & IOS Consoles' : kindTitle(kinds[0]);

    // Multi-day Weekly / Monthly / Custom Range rollup mode
    if (range.isMultiDay || (range.periodType && ['weekly', 'monthly', 'custom'].includes(range.periodType) && range.fromYmd && range.toYmd)) {
      const fromYmd = range.fromYmd;
      const toYmd = range.toYmd;
      const rollup = await loadRangeRollup(fromYmd, toYmd, kinds);
      const periodHeading = range.periodLabel || 'Period Report';

      return {
        moduleKey: 'daily-station-ops',
        docCode: 'CAE-OPS-14',
        theme: 'daily-station-ops',
        title: `Station Operations ${periodHeading} — ${scopeLabel}`,
        subtitle: `${rangeLabel(range)} · Multi-day station availability, testing hours & shift handover audit`,
        filename: `station_ops_${rawKind.toLowerCase()}`,
        orientation: 'portrait',
        coverHighlights: [
          { label: 'Availability', value: fmtPercent(rollup.availPct, 1) },
          { label: 'Logged Hours', value: `${rollup.totalHours.toFixed(1)} h` },
          { label: 'Days / Shifts', value: `${rollup.uniqueDays}d / ${rollup.totalShifts}` }
        ],
        filters: [
          { label: 'Period', value: rangeLabel(range) },
          { label: 'Station Scope', value: `${scopeLabel} (${rollup.stationsCount})` },
          { label: 'Operating Days', value: fmtNumber(rollup.uniqueDays) },
          { label: 'Shifts Logged', value: `${rollup.totalShifts} (${fmtPercent(rollup.signoffPct, 0)} signed)` }
        ],
        pages: [
          {
            eyebrow: 'SECTION 01 · PERIOD OPERATIONS SUMMARY',
            title: `${scopeLabel} — ${periodHeading}`,
            subtitle: `${rangeLabel(range)} · Aggregated station utilization, sign-off compliance & NA escalations`,
            blocks: [
              {
                type: 'kpis',
                variant: 'hero-split',
                items: [
                  { label: 'Period Availability', value: fmtPercent(rollup.availPct, 1), rawValue: rollup.availPct, numFmt: '0.0"%"', sublabel: `${rollup.totalNaEntries} NA shift occurrence(s)`, tone: rollup.totalNaEntries > 0 ? 'warning' : 'success' },
                  { label: 'Total Testing Hrs', value: `${rollup.totalHours.toFixed(1)} h`, rawValue: rollup.totalHours, numFmt: '#,##0.0" h"', sublabel: `${rollup.uniqueDays} operating day(s)`, tone: 'primary' },
                  { label: 'Shifts Logged', value: fmtNumber(rollup.totalShifts), rawValue: rollup.totalShifts, numFmt: '#,##0', sublabel: `${rollup.signedShifts} signed off (${fmtPercent(rollup.signoffPct, 0)})`, tone: 'info' },
                  { label: 'Active Sessions', value: fmtNumber(rollup.totalInUseEntries), rawValue: rollup.totalInUseEntries, numFmt: '#,##0', sublabel: 'Station-shifts IN USE', tone: 'success' },
                  { label: 'NA Incidents', value: fmtNumber(rollup.totalNaEntries), rawValue: rollup.totalNaEntries, numFmt: '#,##0', sublabel: 'Station-shifts unavailable', tone: rollup.totalNaEntries > 0 ? 'danger' : 'success' }
                ]
              },
              {
                type: 'statMatrix',
                title: 'Reporting Scope & Compliance Telemetry',
                pairs: [
                  ['Reporting Window', rangeLabel(range)],
                  ['Station Scope', `${scopeLabel} (${rollup.stationsCount} stations)`],
                  ['Operating Days Recorded', `${rollup.uniqueDays} day(s) · ${rollup.totalShifts} shifts`],
                  ['Supervisor Sign-Off Rate', `${rollup.signedShifts}/${rollup.totalShifts} shifts (${fmtPercent(rollup.signoffPct, 1)})`]
                ]
              },
              ...(rollup.naAlerts.length ? [{
                type: 'alerts',
                title: 'NA Station Escalations in Period',
                items: rollup.naAlerts.slice(0, 6)
              }] : [{
                type: 'alerts',
                title: 'Period Readiness Verification',
                items: [{
                  severity: 'success',
                  title: 'Zero NA Incidents in Period',
                  detail: `All ${rollup.stationsCount} stations maintained full availability across ${rollup.uniqueDays} logged operating day(s).`
                }]
              }])
            ]
          },
          {
            eyebrow: 'SECTION 02 · PER-STATION UTILIZATION ROLLUP',
            title: `${scopeLabel} — Station Utilization & Availability Matrix`,
            subtitle: `Aggregated testing hours, active shift count and NA frequency (${rangeLabel(range)})`,
            blocks: [
              {
                type: 'table',
                showHeading: false,
                table: {
                  name: `${scopeLabel} Period Utilization (${fromYmd} to ${toYmd})`,
                  columns: [
                    { header: 'Station', key: 'station', width: 24, type: 'mono' },
                    { header: 'Kind', key: 'kind', width: 8, type: 'mono', align: 'center', printHidden: true },
                    { header: 'In Use', key: 'in_use', width: 10, type: 'number', align: 'right', total: 'sum' },
                    { header: 'NA', key: 'na_count', width: 8, type: 'number', align: 'right', total: 'sum' },
                    { header: 'Hours', key: 'hours', width: 11, type: 'number', decimals: 1, align: 'right', total: 'sum', dataBar: true },
                    { header: 'Avail. %', key: 'avail_pct', width: 11, type: 'percent', decimals: 1, align: 'right', total: 'avg' },
                    { header: 'Latest Handover Note', key: 'note', width: 36 }
                  ],
                  rows: rollup.stationRows
                }
              }
            ]
          },
          {
            eyebrow: 'SECTION 03 · DAILY SHIFT HANDOVER LOG',
            title: 'Chronological Daily Shift Register',
            subtitle: `${rollup.shiftSummaryRows.length} shift sheet(s) recorded during ${rangeLabel(range)}`,
            blocks: [
              {
                type: 'table',
                showHeading: false,
                table: {
                  name: 'Daily Shift Handover Ledger',
                  columns: [
                    { header: 'Date', key: 'date', width: 13, type: 'mono' },
                    { header: 'Scope', key: 'scope', width: 8, type: 'mono', align: 'center' },
                    { header: 'Shift', key: 'shift', width: 11 },
                    { header: 'Test Leader', key: 'lead', width: 18 },
                    { header: 'Sign-Off', key: 'signoff', width: 12, type: 'badge', align: 'center' },
                    { header: 'Status Split', key: 'split', width: 20, printHidden: true },
                    { header: 'Hours', key: 'hours', width: 10, type: 'number', decimals: 1, align: 'right', total: 'sum' },
                    { header: 'NA / Brief Notes', key: 'na_notes', width: 28 }
                  ],
                  rows: rollup.shiftSummaryRows
                }
              }
            ]
          }
        ]
      };
    }

    const dateStr = resolveDate(req.query.date || range.fromYmd);
    const snapshots = await Promise.all(kinds.map(k => loadKindSnapshot(dateStr, k)));

    const totalStations = snapshots.reduce((s, x) => s + x.stationsCount, 0);
    const totalInUse = snapshots.reduce((s, x) => s + x.inUse, 0);
    const totalReady = snapshots.reduce((s, x) => s + x.ready, 0);
    const totalNa = snapshots.reduce((s, x) => s + x.na, 0);
    const totalHours = Number((snapshots.reduce((s, x) => s + x.totalMinutes, 0) / 60).toFixed(1));
    const totalShifts = snapshots.reduce((s, x) => s + x.shifts.length, 0);
    const availPct = totalStations > 0 ? Math.round(((totalStations - totalNa) / totalStations) * 1000) / 10 : 100;
    const allNaAlerts = snapshots.flatMap(s => s.naAlerts);
    const primary = snapshots[0];

    const opHoursPairs = [
      ['Operating Date', dateStr],
      ['Station Scope', `${scopeLabel} (${totalStations} stations)`],
      ['System Readiness', primary?.log?.system_readiness_time || '06:30'],
      ['Post-Testing Routine', primary?.log?.post_testing_time || '17:00'],
      ['Facility Logout', primary?.log?.logout_time || '18:00'],
      ['Active Shifts Logged', `${totalShifts} shift${totalShifts === 1 ? '' : 's'} · ${totalHours.toFixed(1)} h total`]
    ];

    const pages = [
      {
        eyebrow: 'SECTION 01 · OPERATING HOURS & READINESS',
        title: `Daily Operating Summary — ${dateStr}`,
        subtitle: `${scopeLabel} facility schedule, shift availability and NA escalations`,
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Station Availability', value: fmtPercent(availPct, 1), rawValue: availPct, numFmt: '0.0"%"', sublabel: `${totalStations - totalNa}/${totalStations} operational`, tone: totalNa > 0 ? 'warning' : 'success' },
              { label: 'In Use', value: fmtNumber(totalInUse), rawValue: totalInUse, numFmt: '#,##0', sublabel: 'Active in session', tone: 'info' },
              { label: 'Ready', value: fmtNumber(totalReady), rawValue: totalReady, numFmt: '#,##0', sublabel: 'Standby / available', tone: 'success' },
              { label: 'Not Available (NA)', value: fmtNumber(totalNa), rawValue: totalNa, numFmt: '#,##0', sublabel: 'Fault / troubleshooting', tone: totalNa > 0 ? 'danger' : 'success' },
              { label: 'Logged Testing Hrs', value: `${totalHours.toFixed(1)} h`, rawValue: totalHours, numFmt: '#,##0.0" h"', sublabel: `Across ${totalShifts} shift(s)`, tone: 'primary' }
            ]
          },
          { type: 'statMatrix', title: 'Facility Operating Hours & Control Parameters', pairs: opHoursPairs },
          ...(primary?.log?.general_notes ? [{
            type: 'brief',
            title: 'Daily Shift Brief & Supervisor Notes',
            text: cleanText(primary.log.general_notes, 600)
          }] : []),
          ...(allNaAlerts.length ? [{
            type: 'alerts',
            title: 'Unavailable Stations (NA) & Handover Escalations',
            items: allNaAlerts.slice(0, 8)
          }] : [{
            type: 'alerts',
            title: 'Station Readiness Verification',
            items: [{
              severity: 'success',
              title: 'Zero NA Stations Reported',
              detail: `All ${totalStations} stations in ${scopeLabel} are operational (IN USE or READY) for ${dateStr}.`
            }]
          }])
        ]
      }
    ];

    let sectionIdx = 2;
    for (const snap of snapshots) {
      for (const sh of snap.shifts) {
        const shiftHours = (sh.shiftMinutes / 60).toFixed(1);
        pages.push({
          eyebrow: `SECTION 0${sectionIdx} · ${snap.label.toUpperCase()} — ${sh.shift_name}`,
          title: `${snap.label} — ${sh.shift_name} Utilization & Handover`,
          subtitle: `Pre-Flight: ${sh.pre_flight_test_time} · Test Leader: ${sh.lead_name} · ${sh.signed_off_label}`,
          blocks: [
            {
              type: 'statMatrix',
              title: `${sh.shift_name} Control Summary`,
              pairs: [
                ['Pre-Flight Test', sh.pre_flight_test_time],
                ['Test Leader', sh.lead_name],
                ['Handover Sign-Off', sh.signed_off_label],
                ['Utilization Split', `${sh.shiftInUse} In Use · ${sh.shiftReady} Ready · ${sh.shiftNa} NA (${shiftHours} h)`]
              ]
            },
            {
              type: 'table',
              showHeading: false,
              table: {
                name: `${snap.label} ${sh.shift_name} (${dateStr})`,
                note: 'Station operational status, testing window and handover notes.',
                columns: [
                  { header: 'Station', key: 'station', width: 96, type: 'mono' },
                  { header: 'Platform', key: 'aircraft', width: 78, printHidden: true },
                  { header: 'Status', key: 'status', width: 62, type: 'badge', align: 'center' },
                  { header: 'Start', key: 'start', width: 46, type: 'mono', align: 'center' },
                  { header: 'End', key: 'end', width: 46, type: 'mono', align: 'center' },
                  { header: 'Hours', key: 'hours', width: 48, type: 'number', decimals: 1, align: 'right', total: 'sum', dataBar: true },
                  { header: 'Handover Notes', key: 'notes', width: 175 }
                ],
                rows: sh.rows
              }
            }
          ]
        });
        sectionIdx += 1;
      }
    }

    return {
      moduleKey: 'daily-station-ops',
      docCode: 'CAE-OPS-14',
      theme: 'daily-station-ops',
      title: `Daily Station Operations Log — ${scopeLabel}`,
      subtitle: `${dateStr} · Operating Hours, Shift Pre-Flight & Handover Record`,
      filename: `daily_station_ops_${rawKind.toLowerCase()}_${dateStr}`,
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Operating Date', value: dateStr },
        { label: 'Availability', value: fmtPercent(availPct, 1) },
        { label: 'Logged Hours', value: `${totalHours.toFixed(1)} h` }
      ],
      filters: [
        { label: 'Operating Date', value: dateStr },
        { label: 'Station Scope', value: scopeLabel },
        { label: 'Total Stations', value: fmtNumber(totalStations) },
        { label: 'Shifts Logged', value: fmtNumber(totalShifts) }
      ],
      pages
    };
  }
};
