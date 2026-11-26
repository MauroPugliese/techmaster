// =============================================================================
// exports/modules/simulators.js — Flight Simulator Fleet & Single-Station Dossier (CAE-SIM-13)
//   - build(req): Fleet Dossier separating FFS Bays, Test Places & IOS Consoles + 8-Subsystem Health
//   - buildSingleStation(req): Single Station Technical Dossier & Annual MNT Records (?year=YYYY)
// =============================================================================
'use strict';

const { Op } = require('sequelize');
const {
  Simulator,
  SimulatorSubsystem,
  SimulatorQtgRecord,
  SimulatorDailyLog,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  Operation,
  MaintenanceRecord,
  StockMovement,
  InventoryItem,
  WikiArticle,
  User
} = require('../../models');
const {
  VALID_STATION_KINDS,
  computeSimulatorTelemetry,
  computeTestingDurationMinutes
} = require('../../services/simulator-helpers.service');
const { computeReliabilityMetrics } = require('../../services/maintenance-helpers.service');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtMoney, fmtPercent, fmtHours, fullName, cleanText, toNumber, parseRange, rangeLabel
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  READY: 'success',
  IN_SORTIE: 'info',
  PRE_FLIGHT: 'info',
  DEGRADED: 'warning',
  MAINTENANCE: 'warning',
  AOG: 'danger'
};

const USAGE_TONE = {
  IN_USE: 'info',
  READY: 'success',
  NA: 'danger'
};

const MAINT_TYPE_TONE = {
  CORRECTIVE: 'danger',
  PREVENTIVE: 'neutral',
  INSPECTION: 'info',
  PREDICTIVE: 'teal',
  UPGRADE: 'purple'
};

const SUB_TONE = {
  NOMINAL: 'success',
  DEGRADED: 'warning',
  FAULT: 'danger',
  MAINTENANCE: 'info'
};

function formatPartsBrief(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return '—';
  return parts.map(p => `${p.name || p.sku || `#${p.item_id}`} ×${p.quantity}`).join(', ');
}

module.exports = {
  key: 'simulators',
  docCode: 'CAE-SIM-13',
  theme: 'simulators',
  title: 'Flight Simulator Fleet & Qualification Dossier',
  subtitle: 'Bay availability, dispatch reliability, FSTD qualification, QTG status & subsystem health',
  category: 'SIMULATOR FLEET',
  orientation: 'portrait',

  async build(req = { query: {} }) {
    const range = parseRange(req?.query || {});
    const rawKind = String(req?.query?.station_kind || '').trim().toUpperCase();
    const filterKind = VALID_STATION_KINDS.has(rawKind) ? rawKind : null;
    const statusParam = String(req?.query?.status || '').trim().toUpperCase();
    const categoryParam = String(req?.query?.platform_category || '').trim().toUpperCase();
    const searchParam = String(req?.query?.search || '').trim();

    const simWhere = {};
    if (filterKind) simWhere.station_kind = filterKind;
    if (categoryParam && categoryParam !== 'ALL') simWhere.platform_category = categoryParam;
    if (statusParam === 'READY_GROUP') {
      simWhere.status = { [Op.in]: ['READY', 'IN_SORTIE', 'PRE_FLIGHT'] };
    } else if (statusParam === 'ATTENTION_GROUP') {
      simWhere.status = { [Op.in]: ['DEGRADED', 'MAINTENANCE', 'AOG'] };
    } else if (statusParam && statusParam !== 'ALL') {
      simWhere.status = statusParam;
    }
    if (searchParam) {
      const q = `%${searchParam}%`;
      simWhere[Op.or] = [
        { code: { [Op.like]: q } },
        { name: { [Op.like]: q } },
        { bay_code: { [Op.like]: q } },
        { aircraft_type: { [Op.like]: q } }
      ];
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const sortieWhere = { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } };
    const maintWhere = { simulator_id: { [Op.ne]: null } };
    const logWhere = {};
    if (range.from || range.to) {
      sortieWhere.start_date = {};
      maintWhere.scheduled_date = {};
      logWhere.log_date = {};
      if (range.from) {
        sortieWhere.start_date[Op.gte] = range.from;
        maintWhere.scheduled_date[Op.gte] = range.from;
        logWhere.log_date[Op.gte] = range.fromYmd;
      }
      if (range.to) {
        sortieWhere.start_date[Op.lte] = range.to;
        maintWhere.scheduled_date[Op.lte] = range.to;
        logWhere.log_date[Op.lte] = range.toYmd;
      }
    } else {
      logWhere.log_date = todayStr;
    }

    const [sims, sorties, maint, qtg, subs, todayLogs] = await Promise.all([
      Simulator.findAll({ where: simWhere, order: [['sort_order', 'ASC'], ['bay_code', 'ASC'], ['code', 'ASC']] }),
      Operation.findAll({
        where: sortieWhere,
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: maintWhere,
        attributes: ['id', 'simulator_id', 'status', 'severity', 'is_snag', 'type', 'mel_category', 'mel_expiry_date', 'downtime_hours']
      }),
      SimulatorQtgRecord.findAll({ attributes: ['id', 'simulator_id', 'status', 'quarter', 'year'] }),
      SimulatorSubsystem.findAll({ attributes: ['id', 'simulator_id', 'subsystem_code', 'name', 'status'] }),
      SimulatorDailyLog.findAll({
        where: logWhere,
        include: [{
          model: SimulatorDailyShift,
          as: 'shifts',
          include: [{ model: SimulatorShiftEntry, as: 'entries' }]
        }]
      })
    ]);

    const now = new Date();
    const enriched = sims.map(s => {
      const plain = s.get({ plain: true });
      const simId = Number(plain.id);
      const simSubs = subs.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true }));
      const simMaint = maint.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true }));
      const activeMel = simMaint.filter(m => ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'].includes(m.status) && m.mel_category && m.mel_category !== 'NONE');
      return {
        ...plain,
        subsystems: simSubs,
        activeMelCount: activeMel.length,
        telemetry: computeSimulatorTelemetry(plain, {
          sorties: sorties.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          maintenance: simMaint,
          qtgRecords: qtg.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          subsystems: simSubs,
          now
        })
      };
    });

    const ffsBays = enriched.filter(s => (s.station_kind || 'FFS_BAY') === 'FFS_BAY');
    const testPlaces = enriched.filter(s => s.station_kind === 'TEST_PLACE');
    const iosConsoles = enriched.filter(s => s.station_kind === 'IOS_CONSOLE');
    const primaryFleet = filterKind ? enriched : (ffsBays.length > 0 ? ffsBays : enriched);

    const primaryCount = primaryFleet.length;
    const readyPrimary = primaryFleet.filter(s => ['READY', 'IN_SORTIE', 'PRE_FLIGHT'].includes(s.status)).length;
    const aogPrimary = primaryFleet.filter(s => s.status === 'AOG').length;
    const avgReliability = primaryCount > 0
      ? Math.round((primaryFleet.reduce((acc, s) => acc + s.telemetry.dispatchReliabilityPct, 0) / primaryCount) * 10) / 10
      : 100;
    const avgQtg = primaryCount > 0
      ? Math.round(primaryFleet.reduce((acc, s) => acc + s.telemetry.qtgSummary.completionPct, 0) / primaryCount)
      : 100;
    const totalPowerHours = primaryFleet.reduce((acc, s) => acc + (Number(s.power_on_hours) || 0), 0);
    const totalMel = enriched.reduce((acc, s) => acc + s.activeMelCount, 0);

    // Map today's live shift usage for Test Places and IOS Consoles
    const liveEntryMap = new Map();
    for (const log of todayLogs) {
      const sortedShifts = [...(log.shifts || [])].sort((a, b) => (a.shift_number || 0) - (b.shift_number || 0));
      sortedShifts.forEach((sh, idx) => {
        for (const e of (sh.entries || [])) {
          const simId = Number(e.simulator_id);
          const durMin = computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end);
          const cur = liveEntryMap.get(simId) || { status: e.usage_status, minutes: 0, notes: e.notes || '' };
          if (idx === 0) {
            cur.status = e.usage_status;
            if (e.notes) cur.notes = e.notes;
          } else if (!cur.notes && e.notes) {
            cur.notes = e.notes;
          }
          cur.minutes += durMin;
          liveEntryMap.set(simId, cur);
        }
      });
    }

    const alertItems = enriched
      .filter(s => s.status === 'AOG' || s.status === 'DEGRADED' || s.activeMelCount > 0 || ['EXPIRED', 'EXPIRING_SOON'].includes(s.telemetry.certificate.status))
      .map(s => ({
        severity: s.status === 'AOG' || s.telemetry.certificate.status === 'EXPIRED' ? 'danger' : 'warning',
        title: `${s.bay_code} · ${s.name} (${s.aircraft_type})`,
        detail: [
          s.limitations_mel ? `MEL: ${cleanText(s.limitations_mel, 110)}` : null,
          s.activeMelCount > 0 ? `${s.activeMelCount} Active Deferred Defect(s)` : null,
          ['EXPIRED', 'EXPIRING_SOON'].includes(s.telemetry.certificate.status)
            ? `FSTD Cert ${s.telemetry.certificate.status} (${s.telemetry.certificate.daysRemaining ?? 'N/A'}d)` : null,
          `Open DRs: ${s.telemetry.openSnagsCount}`
        ].filter(Boolean).join(' · ')
      }));

    const pages = [
      {
        eyebrow: 'SECTION 01 · FLEET READINESS & QUALIFICATION',
        title: 'Simulator Fleet Readiness & Qualification Posture',
        subtitle: `FFS bays (${ffsBays.length}), Test Places (${testPlaces.length}) & IOS Consoles (${iosConsoles.length})`,
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'FFS Active Bays', value: `${readyPrimary}/${primaryCount}`, rawValue: readyPrimary, sublabel: `${aogPrimary} grounded AOG`, tone: aogPrimary > 0 ? 'danger' : 'success' },
              { label: 'Dispatch Reliability', value: fmtPercent(avgReliability, 1), rawValue: avgReliability, numFmt: '0.0"%"', sublabel: 'FFS training SLA adherence', tone: 'primary' },
              { label: 'QTG Compliance', value: fmtPercent(avgQtg), rawValue: avgQtg, numFmt: '0"%"', sublabel: 'Quarterly EASA/FAA tests', tone: 'info' },
              { label: 'Active MEL / Snags', value: fmtNumber(totalMel), rawValue: totalMel, numFmt: '#,##0', sublabel: `${enriched.reduce((a, s) => a + s.telemetry.openSnagsCount, 0)} open DRs total`, tone: totalMel > 0 ? 'warning' : 'success' },
              { label: 'Power-On Fleet Hrs', value: `${fmtNumber(Math.round(totalPowerHours))} h`, rawValue: Math.round(totalPowerHours), sublabel: 'Cumulative hub meters', tone: 'neutral' }
            ]
          },
          ...(alertItems.length ? [{ type: 'alerts', title: 'Bay Limitations, MEL & Qualification Warnings', items: alertItems.slice(0, 7) }] : []),
          {
            type: 'chart',
            height: 205,
            chart: {
              type: 'hbar',
              title: 'Dispatch Reliability (%) by Simulator Bay',
              labels: primaryFleet.slice(0, 12).map(s => `${s.bay_code} (${s.code})`),
              series: [{ name: 'Reliability %', data: primaryFleet.slice(0, 12).map(s => s.telemetry.dispatchReliabilityPct), color: COLORS.accent }]
            }
          }
        ]
      },
      {
        eyebrow: 'SECTION 02 · QUALIFICATION & SUBSYSTEM HEALTH',
        title: 'FFS Bay Qualification & 8-Subsystem Health Matrix',
        subtitle: 'FSTD authority certification, QTG progress, hub hours and subsystem nominality',
        blocks: [
          {
            type: 'table',
            showHeading: true,
            table: {
              name: 'FFS Simulator Fleet Register',
              columns: [
                { key: 'bay', header: 'Bay / Code', type: 'mono', width: 78 },
                { key: 'aircraft', header: 'Aircraft & Model', type: 'text', width: 122 },
                { key: 'qual', header: 'Authority / Level', type: 'text', width: 84 },
                { key: 'status', header: 'Status', type: 'badge', width: 64, align: 'center' },
                { key: 'sub_health', header: 'Subsystems', type: 'text', width: 66, align: 'center' },
                { key: 'reliability', header: 'Rel. %', type: 'percent', width: 48, align: 'right' },
                { key: 'qtg', header: 'QTG %', type: 'percent', width: 44, align: 'right' },
                { key: 'power_hrs', header: 'Power Hrs', type: 'number', width: 64, align: 'right', printHidden: true },
                { key: 'cert_expiry', header: 'Cert Expiry', type: 'text', width: 72, printHidden: true }
              ],
              rows: primaryFleet.map(s => {
                const subNominal = s.subsystems.filter(x => x.status === 'NOMINAL').length;
                const subTotal = s.subsystems.length;
                return {
                  bay: `${s.bay_code} · ${s.code}`,
                  aircraft: `${s.aircraft_type} (${s.manufacturer || 'CAE'})`,
                  qual: `${s.authority || 'EASA'} · ${s.qualification_level || 'Level D'}`,
                  status: s.status,
                  status_tone: STATUS_TONE[s.status] || 'neutral',
                  sub_health: subTotal > 0 ? `${subNominal}/${subTotal} OK` : '—',
                  reliability: s.telemetry.dispatchReliabilityPct,
                  qtg: s.telemetry.qtgSummary.completionPct,
                  power_hrs: Math.round(Number(s.power_on_hours) || 0),
                  cert_expiry: s.certificate_expiry ? fmtDate(s.certificate_expiry) : '—',
                  _flag: s.status === 'AOG' ? 'danger' : (s.status === 'DEGRADED' ? 'warning' : undefined)
                };
              })
            }
          }
        ]
      }
    ];

    if (!filterKind && (testPlaces.length > 0 || iosConsoles.length > 0)) {
      const buildStationRows = (list) => list.map(st => {
        const live = liveEntryMap.get(Number(st.id));
        const liveStatus = live?.status || (st.status === 'AOG' ? 'NA' : 'READY');
        return {
          bay: `${st.bay_code} · ${st.name}`,
          aircraft: st.aircraft_type || '—',
          today_status: liveStatus === 'IN_USE' ? 'IN USE' : liveStatus,
          today_status_tone: USAGE_TONE[liveStatus] || 'neutral',
          shift_hours: Number(((live?.minutes || 0) / 60).toFixed(1)),
          open_snags: st.telemetry.openSnagsCount,
          notes: live?.notes ? cleanText(live.notes, 110) : (st.limitations_mel ? cleanText(st.limitations_mel, 110) : '—'),
          _flag: liveStatus === 'NA' ? 'danger' : undefined
        };
      });

      const stationBlocks = [];
      if (testPlaces.length > 0) {
        stationBlocks.push({
          type: 'table',
          showHeading: true,
          table: {
            name: `Test Places Live Readiness (${testPlaces.length} Stations · ${todayStr})`,
            columns: [
              { key: 'bay', header: 'Station', type: 'mono', width: 96 },
              { key: 'aircraft', header: 'Platform', type: 'text', width: 84, printHidden: true },
              { key: 'today_status', header: 'Today Status', type: 'badge', width: 68, align: 'center' },
              { key: 'shift_hours', header: 'Today Hrs', type: 'number', decimals: 1, width: 56, align: 'right', total: 'sum' },
              { key: 'open_snags', header: 'Open DRs', type: 'number', width: 52, align: 'right', total: 'sum' },
              { key: 'notes', header: 'Latest Handover / MEL Note', type: 'text', width: 175 }
            ],
            rows: buildStationRows(testPlaces)
          }
        });
      }
      if (iosConsoles.length > 0) {
        stationBlocks.push({
          type: 'table',
          showHeading: true,
          table: {
            name: `IOS Consoles Live Readiness (${iosConsoles.length} Consoles · ${todayStr})`,
            columns: [
              { key: 'bay', header: 'Console', type: 'mono', width: 96 },
              { key: 'aircraft', header: 'Platform', type: 'text', width: 84, printHidden: true },
              { key: 'today_status', header: 'Today Status', type: 'badge', width: 68, align: 'center' },
              { key: 'shift_hours', header: 'Today Hrs', type: 'number', decimals: 1, width: 56, align: 'right', total: 'sum' },
              { key: 'open_snags', header: 'Open DRs', type: 'number', width: 52, align: 'right', total: 'sum' },
              { key: 'notes', header: 'Latest Handover / MEL Note', type: 'text', width: 175 }
            ],
            rows: buildStationRows(iosConsoles)
          }
        });
      }

      pages.push({
        eyebrow: 'SECTION 03 · TEST PLACES & IOS CONSOLES',
        title: 'Test Places & IOS Consoles Operational Status',
        subtitle: `Live daily readiness snapshot (${todayStr}) across ${testPlaces.length} Test Places and ${iosConsoles.length} IOS Consoles`,
        blocks: stationBlocks
      });
    }

    return {
      moduleKey: 'simulators',
      docCode: 'CAE-SIM-13',
      theme: 'simulators',
      title: 'Flight Simulator Fleet & Qualification Dossier',
      subtitle: 'Multi-bay operational status, FSTD compliance, subsystem matrix & station readiness',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'FFS / TP / IOS', value: `${ffsBays.length} / ${testPlaces.length} / ${iosConsoles.length}` },
        { label: 'Dispatch Reliability', value: fmtPercent(avgReliability, 1) },
        { label: 'QTG Compliance', value: fmtPercent(avgQtg) }
      ],
      filters: [
        { label: 'Period', value: range.from || range.to ? rangeLabel(range) : `Snapshot (${todayStr})` },
        { label: 'Station Scope', value: filterKind || 'All (FFS + TP + IOS)' },
        ...(statusParam && statusParam !== 'ALL' ? [{ label: 'Status', value: statusParam }] : []),
        ...(searchParam ? [{ label: 'Search', value: searchParam }] : []),
        { label: 'Total Stations', value: fmtNumber(enriched.length) }
      ],
      pages
    };
  },

  /**
   * Single Station Technical Dossier & Annual / Period MNT Records Report
   * Endpoint: GET /api/export/simulators/:id?year=YYYY|ALL&report_period=weekly|monthly|custom&from=...&to=...&format=pdf|xlsx|docx|pptx
   */
  async buildSingleStation(req) {
    const simId = Number(req.params.id);
    if (!Number.isInteger(simId) || simId < 1) return null;

    const sim = await Simulator.findByPk(simId);
    if (!sim) return null;

    const range = parseRange(req.query || {});
    const rawYear = String(req.query.year || '').trim().toUpperCase();
    const isAllYears = rawYear === 'ALL';
    const hasExplicitRange = Boolean(range.from || range.to);
    const targetYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : new Date().getFullYear();

    let scopeStart = null;
    let scopeEnd = null;
    let scopeStartYmd = null;
    let scopeEndYmd = null;
    let scopeTag = String(targetYear);

    if (hasExplicitRange) {
      scopeStart = range.from;
      scopeEnd = range.to;
      scopeStartYmd = range.fromYmd;
      scopeEndYmd = range.toYmd;
      scopeTag = rangeLabel(range);
    } else if (isAllYears) {
      scopeTag = 'All Years';
    } else {
      scopeStart = new Date(`${targetYear}-01-01T00:00:00.000Z`);
      scopeEnd = new Date(`${targetYear}-12-31T23:59:59.999Z`);
      scopeStartYmd = `${targetYear}-01-01`;
      scopeEndYmd = `${targetYear}-12-31`;
      scopeTag = String(targetYear);
    }

    const buildDateBetween = (s, e) => {
      if (s && e) return { [Op.between]: [s, e] };
      if (s) return { [Op.gte]: s };
      if (e) return { [Op.lte]: e };
      return null;
    };

    const maintDateCond = buildDateBetween(scopeStart, scopeEnd);
    const logDateCond = buildDateBetween(scopeStartYmd, scopeEndYmd);
    const qtgWhere = { simulator_id: simId };
    if (!isAllYears && !hasExplicitRange) qtgWhere.year = targetYear;
    const maintWhere = { simulator_id: simId, ...(maintDateCond ? { scheduled_date: maintDateCond } : {}) };
    const sortieWhere = { simulator_id: simId, status: { [Op.ne]: 'CANCELLED' }, ...(maintDateCond ? { start_date: maintDateCond } : {}) };
    const stockWhere = { simulator_id: simId, ...(maintDateCond ? { movement_date: maintDateCond } : {}) };

    const [subsystems, qtgRecords, yearMaint, allSorties, yearShiftEntries, stockConsumed] = await Promise.all([
      SimulatorSubsystem.findAll({ where: { simulator_id: simId }, order: [['subsystem_code', 'ASC']] }),
      SimulatorQtgRecord.findAll({
        where: qtgWhere,
        include: [{ model: User, as: 'executor', attributes: ['first_name', 'last_name'] }],
        order: [['year', 'DESC'], ['quarter', 'ASC'], ['test_code', 'ASC']]
      }),
      MaintenanceRecord.findAll({
        where: maintWhere,
        include: [
          { model: User, as: 'technician', attributes: ['first_name', 'last_name'] },
          { model: WikiArticle, as: 'wikiArticle', attributes: ['id', 'title'] }
        ],
        order: [['scheduled_date', 'DESC']]
      }),
      Operation.findAll({
        where: sortieWhere,
        order: [['start_date', 'DESC']]
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
            ...(logDateCond ? { where: { log_date: logDateCond } } : {})
          }]
        }]
      }),
      StockMovement.findAll({
        where: stockWhere,
        include: [
          { model: InventoryItem, as: 'item', attributes: ['sku', 'name', 'unit_cost'] },
          { model: User, as: 'user', attributes: ['first_name', 'last_name'] }
        ],
        order: [['movement_date', 'DESC']],
        limit: 100
      })
    ]);

    const plainSim = sim.get({ plain: true });
    const plainMaint = yearMaint.map(m => m.get({ plain: true }));
    const plainSorties = allSorties.map(o => o.get({ plain: true }));
    const plainSubs = subsystems.map(s => s.get({ plain: true }));
    const plainQtg = qtgRecords.map(q => q.get({ plain: true }));

    const shiftHoursYear = Number((yearShiftEntries.reduce(
      (acc, e) => acc + computeTestingDurationMinutes(e.sim_testing_start, e.sim_testing_end),
      0
    ) / 60).toFixed(1));
    const sortieHoursYear = Number(plainSorties.reduce(
      (acc, o) => acc + (Number(o.actual_flight_hours) || Number(o.scheduled_hours) || 0),
      0
    ).toFixed(1));
    const totalOpHoursYear = Number((shiftHoursYear + sortieHoursYear).toFixed(1));

    const reliability = computeReliabilityMetrics(plainMaint, totalOpHoursYear || Number(plainSim.power_on_hours) || 0);
    const telemetry = computeSimulatorTelemetry(plainSim, {
      sorties: plainSorties,
      maintenance: plainMaint,
      qtgRecords: plainQtg,
      subsystems: plainSubs
    });

    const totalCostYear = plainMaint.reduce((acc, m) => acc + toNumber(m.cost, 0), 0);
    const totalDowntimeYear = plainMaint.reduce((acc, m) => acc + toNumber(m.downtime_hours, 0), 0);
    const openSnags = plainMaint.filter(m => ['SCHEDULED', 'IN_PROGRESS', 'DEFERRED'].includes(m.status));

    const specPairs = [
      ['Station / Bay Code', `${plainSim.bay_code} · ${plainSim.code}`],
      ['Station Class', `${plainSim.station_kind || 'FFS_BAY'} · ${plainSim.platform_category || 'CIVIL_FFS'}`],
      ['Aircraft & Model', `${plainSim.aircraft_type} (${plainSim.manufacturer || 'CAE'})`],
      ['Qualification', `${plainSim.authority || 'EASA'} · ${plainSim.qualification_level || 'Level D'}`],
      ['Certificate', `${plainSim.certificate_code || '—'} (Exp: ${plainSim.certificate_expiry ? fmtDate(plainSim.certificate_expiry) : '—'})`],
      ['Power / Motion Hrs', `${fmtNumber(Math.round(Number(plainSim.power_on_hours) || 0))} h / ${fmtNumber(Math.round(Number(plainSim.motion_hours) || 0))} h`],
      ['Visual / SW Load', `${plainSim.visual_system || '—'} · ${plainSim.software_load || '—'}`],
      ['Current Status & MEL', `${plainSim.status}${plainSim.limitations_mel ? ` · ${cleanText(plainSim.limitations_mel, 80)}` : ''}`]
    ];

    const stationAlerts = [];
    if (plainSim.status === 'AOG' || plainSim.status === 'DEGRADED') {
      stationAlerts.push({
        severity: plainSim.status === 'AOG' ? 'danger' : 'warning',
        title: `Station Status: ${plainSim.status}`,
        detail: plainSim.limitations_mel || `${openSnags.length} open work order(s) active on ${plainSim.bay_code}.`
      });
    }
    if (reliability.activeMelCount > 0) {
      stationAlerts.push({
        severity: reliability.melExpiringSoonCount > 0 ? 'danger' : 'warning',
        title: `${reliability.activeMelCount} Active MEL / Deferred Defect(s)`,
        detail: `${reliability.melExpiringSoonCount} expiring within 7 days. Review corrective closure schedule.`
      });
    }

    const mntLedgerRows = plainMaint.map(m => {
      const isCorrective = m.type === 'CORRECTIVE' || m.is_snag;
      return {
        date: fmtDate(m.scheduled_date),
        type: m.is_snag ? 'SNAG / CORR' : m.type,
        type_tone: isCorrective ? 'danger' : (MAINT_TYPE_TONE[m.type] || 'neutral'),
        severity: m.severity || 'MINOR',
        subsystem: m.subsystem_code || 'GENERAL',
        title: cleanText(m.title, 70),
        findings: m.findings ? cleanText(m.findings, 110) : cleanText(m.description, 110),
        downtime: Number(toNumber(m.downtime_hours, 0).toFixed(2)),
        parts: formatPartsBrief(m.parts_used),
        cost: Number(toNumber(m.cost, 0).toFixed(2)),
        status: m.status,
        status_tone: m.status === 'COMPLETED' ? 'success' : (m.status === 'FAILED' ? 'danger' : 'warning'),
        technician: fullName(m.technician),
        _flag: isCorrective ? 'danger' : undefined
      };
    });

    const pages = [
      {
        eyebrow: `SECTION 01 · TECHNICAL DOSSIER (${scopeTag})`,
        title: `${plainSim.bay_code} — ${plainSim.name} Technical Profile`,
        subtitle: `Reliability, operating hours (${scopeTag}), preventive vs corrective split and active escalations`,
        blocks: [
          {
            type: 'kpis',
            variant: 'hero-split',
            items: [
              { label: 'Preventive / Corrective', value: `${reliability.preventiveCount} / ${reliability.correctiveCount}`, rawValue: plainMaint.length, sublabel: `${plainMaint.length} MNT records (${scopeTag})`, tone: reliability.correctiveCount > reliability.preventiveCount ? 'warning' : 'success' },
              { label: 'Period Downtime', value: fmtHours(totalDowntimeYear), rawValue: Number(totalDowntimeYear.toFixed(1)), numFmt: '#,##0.0" h"', sublabel: `MTTR: ${reliability.mttrHours} h`, tone: totalDowntimeYear > 20 ? 'danger' : 'info' },
              { label: 'MTBF', value: reliability.mtbfHours != null ? `${reliability.mtbfHours} h` : 'N/A', rawValue: reliability.mtbfHours || 0, sublabel: `${totalOpHoursYear} h logged`, tone: 'primary' },
              { label: 'MNT Spend', value: fmtMoney(totalCostYear), rawValue: Number(totalCostYear.toFixed(2)), numFmt: '$#,##0.00', sublabel: `${stockConsumed.length} spare movements`, tone: 'info' },
              { label: 'Dispatch Reliability', value: fmtPercent(telemetry.dispatchReliabilityPct, 1), rawValue: telemetry.dispatchReliabilityPct, sublabel: `${openSnags.length} open work orders`, tone: telemetry.dispatchReliabilityPct >= 95 ? 'success' : 'warning' }
            ]
          },
          ...(stationAlerts.length ? [{ type: 'alerts', title: 'Active Operational & MEL Alerts', items: stationAlerts }] : []),
          { type: 'statMatrix', title: 'Station Hardware & Qualification Specification', pairs: specPairs }
        ]
      }
    ];

    if (plainSubs.length > 0 || plainQtg.length > 0) {
      const subBlocks = [];
      if (plainSubs.length > 0) {
        subBlocks.push({
          type: 'table',
          showHeading: true,
          table: {
            name: 'Subsystem Health Matrix',
            columns: [
              { key: 'code', header: 'Code', type: 'mono', width: 72 },
              { key: 'name', header: 'Subsystem', type: 'text', width: 150 },
              { key: 'status', header: 'Status', type: 'badge', width: 74, align: 'center' },
              { key: 'notes', header: 'Latest Inspection / Health Notes', type: 'text', width: 195 }
            ],
            rows: plainSubs.map(s => ({
              code: s.subsystem_code,
              name: s.name,
              status: s.status,
              status_tone: SUB_TONE[s.status] || 'neutral',
              notes: s.notes ? cleanText(s.notes, 140) : 'Nominal operation',
              _flag: s.status === 'FAULT' ? 'danger' : (s.status === 'DEGRADED' ? 'warning' : undefined)
            }))
          }
        });
      }
      if (plainQtg.length > 0) {
        subBlocks.push({
          type: 'table',
          showHeading: true,
          table: {
            name: `QTG Qualification Tests (${scopeTag})`,
            columns: [
              { key: 'quarter', header: 'Qtr', type: 'mono', width: 44, align: 'center' },
              { key: 'code', header: 'Test Code', type: 'mono', width: 78 },
              { key: 'title', header: 'Test Procedure', type: 'text', width: 165 },
              { key: 'status', header: 'Result', type: 'badge', width: 68, align: 'center' },
              { key: 'run_date', header: 'Run Date', type: 'text', width: 68 },
              { key: 'executor', header: 'Engineer', type: 'text', width: 85, printHidden: true }
            ],
            rows: plainQtg.map(q => ({
              quarter: q.quarter,
              code: q.test_code,
              title: cleanText(q.title, 75),
              status: q.status,
              status_tone: q.status === 'PASSED' ? 'success' : (q.status === 'FAILED' ? 'danger' : (q.status === 'TOLERANCE_WARN' ? 'warning' : 'neutral')),
              run_date: q.executed_at ? fmtDate(q.executed_at) : '—',
              executor: fullName(q.executor),
              _flag: q.status === 'FAILED' ? 'danger' : undefined
            }))
          }
        });
      }
      pages.push({
        eyebrow: 'SECTION 02 · SUBSYSTEMS & QTG',
        title: 'Subsystems Health & Quarterly QTG Qualification',
        subtitle: `Engineering subsystems status and QTG execution record (${scopeTag})`,
        blocks: subBlocks
      });
    }

    pages.push({
      eyebrow: `SECTION ${plainSubs.length > 0 || plainQtg.length > 0 ? '03' : '02'} · MNT RECORDS (${scopeTag})`,
      title: `${plainSim.name} — Maintenance & Fault History (${scopeTag})`,
      subtitle: `${reliability.preventiveCount} Preventive · ${reliability.correctiveCount} Corrective / Faults · Total Downtime: ${fmtHours(totalDowntimeYear)}`,
      blocks: [
        {
          type: 'table',
          showHeading: false,
          table: {
            name: `${plainSim.bay_code} MNT Records (${scopeTag})`,
            note: 'Corrective faults highlighted; preventive maintenance, parts replaced, downtime & cost archived.',
            columns: [
              { key: 'date', header: 'Date', type: 'text', width: 64 },
              { key: 'type', header: 'Type', type: 'badge', width: 68, align: 'center' },
              { key: 'subsystem', header: 'Subsys.', type: 'mono', width: 58, printHidden: true },
              { key: 'title', header: 'Intervention / Fault Summary', type: 'text', width: 150 },
              { key: 'findings', header: 'Findings / Notes', type: 'text', width: 130, printHidden: true },
              { key: 'parts', header: 'Parts Used', type: 'text', width: 95 },
              { key: 'downtime', header: 'Down (h)', type: 'number', decimals: 1, width: 48, align: 'right', total: 'sum' },
              { key: 'cost', header: 'Cost ($)', type: 'currency', width: 62, align: 'right', total: 'sum' },
              { key: 'status', header: 'Status', type: 'badge', width: 64, align: 'center' },
              { key: 'technician', header: 'Engineer', type: 'text', width: 85, printHidden: true }
            ],
            rows: mntLedgerRows
          }
        }
      ]
    });

    const filenameScope = hasExplicitRange ? 'period' : (isAllYears ? 'all_years' : String(targetYear));
    return {
      moduleKey: 'simulators',
      docCode: `CAE-SIM-${plainSim.bay_code}`,
      theme: 'simulators',
      title: `${plainSim.bay_code} · ${plainSim.name} — Station Dossier (${scopeTag})`,
      subtitle: `${plainSim.aircraft_type} · Technical Specification, Subsystems Health & Maintenance Audit`,
      filename: `station_dossier_${String(plainSim.bay_code || simId).toLowerCase()}_${filenameScope}`,
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Station / Status', value: `${plainSim.bay_code} · ${plainSim.status}` },
        { label: 'MNT Records', value: `${reliability.preventiveCount} Prev / ${reliability.correctiveCount} Corr` },
        { label: 'Period Downtime', value: fmtHours(totalDowntimeYear) }
      ],
      filters: [
        { label: 'Station', value: `${plainSim.bay_code} — ${plainSim.name}` },
        { label: 'Audit Scope', value: scopeTag },
        { label: 'MNT Records', value: fmtNumber(plainMaint.length) }
      ],
      pages
    };
  }
};
