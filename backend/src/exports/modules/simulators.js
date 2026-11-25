// =============================================================================
// exports/modules/simulators.js — Flight Simulator Fleet & QTG Compliance Report (CAE-SIM-13)
// =============================================================================
'use strict';

const { Op } = require('sequelize');
const {
  Simulator,
  SimulatorSubsystem,
  SimulatorQtgRecord,
  Operation,
  MaintenanceRecord
} = require('../../models');
const { computeSimulatorTelemetry } = require('../../services/simulator-helpers.service');
const { fmtNumber, fmtPercent } = require('../core/helpers');
const { COLORS } = require('../core/branding');

const STATUS_TONE = {
  READY: 'success',
  IN_SORTIE: 'info',
  PRE_FLIGHT: 'info',
  DEGRADED: 'warning',
  MAINTENANCE: 'warning',
  AOG: 'danger'
};

module.exports = {
  key: 'simulators',
  docCode: 'CAE-SIM-13',
  theme: 'simulators',
  title: 'Flight Simulator Fleet & Qualification Dossier',
  subtitle: 'Bay availability, dispatch reliability, FSTD qualification, QTG status & subsystem health',
  category: 'SIMULATOR FLEET',
  orientation: 'portrait',

  async build() {
    const [sims, sorties, maint, qtg, subs] = await Promise.all([
      Simulator.findAll({ order: [['bay_code', 'ASC'], ['code', 'ASC']] }),
      Operation.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: { [Op.ne]: null } },
        attributes: ['id', 'simulator_id', 'status', 'severity']
      }),
      SimulatorQtgRecord.findAll({ attributes: ['id', 'simulator_id', 'status'] }),
      SimulatorSubsystem.findAll({ attributes: ['id', 'simulator_id', 'status'] })
    ]);

    const now = new Date();
    const enriched = sims.map(s => {
      const plain = s.get({ plain: true });
      const simId = Number(plain.id);
      return {
        ...plain,
        telemetry: computeSimulatorTelemetry(plain, {
          sorties: sorties.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          maintenance: maint.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          qtgRecords: qtg.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          subsystems: subs.filter(x => Number(x.simulator_id) === simId).map(x => x.get({ plain: true })),
          now
        })
      };
    });

    const totalBays = enriched.length;
    const readyBays = enriched.filter(s => ['READY', 'IN_SORTIE', 'PRE_FLIGHT'].includes(s.status)).length;
    const aogBays = enriched.filter(s => s.status === 'AOG').length;
    const avgReliability = totalBays > 0
      ? Math.round((enriched.reduce((acc, s) => acc + s.telemetry.dispatchReliabilityPct, 0) / totalBays) * 10) / 10
      : 100;
    const avgQtg = totalBays > 0
      ? Math.round(enriched.reduce((acc, s) => acc + s.telemetry.qtgSummary.completionPct, 0) / totalBays)
      : 100;
    const totalPowerHours = enriched.reduce((acc, s) => acc + (Number(s.power_on_hours) || 0), 0);

    const statusCounts = {};
    for (const s of enriched) {
      statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    }

    const alertItems = enriched
      .filter(s => s.status === 'AOG' || s.status === 'DEGRADED' || ['EXPIRED', 'EXPIRING_SOON'].includes(s.telemetry.certificate.status))
      .map(s => ({
        severity: s.status === 'AOG' || s.telemetry.certificate.status === 'EXPIRED' ? 'danger' : 'warning',
        title: `${s.bay_code} · ${s.code} (${s.aircraft_type})`,
        detail: s.limitations_mel || `Certificate ${s.telemetry.certificate.status} (${s.telemetry.certificate.daysRemaining ?? 'N/A'} days) · Open DRs: ${s.telemetry.openSnagsCount}`
      }));

    return {
      title: 'Flight Simulator Fleet & Qualification Dossier',
      subtitle: 'Multi-bay operational status, FSTD compliance, QTG progress & subsystem telemetry',
      generatedAt: now,
      coverHighlights: [
        { label: 'Total Bays', value: fmtNumber(totalBays) },
        { label: 'Dispatch Reliability', value: fmtPercent(avgReliability) },
        { label: 'QTG Compliance', value: fmtPercent(avgQtg) }
      ],
      pages: [
        {
          title: 'Fleet Readiness & Qualification Posture',
          blocks: [
            {
              type: 'kpis',
              variant: 'hero-split',
              items: [
                { label: 'Active Bays', value: `${readyBays}/${totalBays}`, rawValue: readyBays, sublabel: `${aogBays} grounded AOG`, tone: aogBays > 0 ? 'danger' : 'success' },
                { label: 'Dispatch Reliability', value: fmtPercent(avgReliability), rawValue: avgReliability, sublabel: 'Training SLA adherence', tone: 'primary' },
                { label: 'QTG Compliance', value: fmtPercent(avgQtg), rawValue: avgQtg, sublabel: 'Quarterly EASA/FAA tests', tone: 'info' },
                { label: 'Power-On Fleet Hrs', value: `${fmtNumber(Math.round(totalPowerHours))} h`, rawValue: Math.round(totalPowerHours), sublabel: 'Cumulative hub meters', tone: 'neutral' }
              ]
            },
            ...(alertItems.length ? [{ type: 'alerts', title: 'Bay Limitations & Qualification Warnings', items: alertItems.slice(0, 6) }] : []),
            {
              type: 'chart',
              height: 205,
              chart: {
                type: 'horizontalBar',
                title: 'Dispatch Reliability (%) by Simulator Bay',
                labels: enriched.map(s => `${s.bay_code} (${s.code})`),
                series: [{ name: 'Reliability %', data: enriched.map(s => s.telemetry.dispatchReliabilityPct), color: COLORS.accent }]
              }
            }
          ]
        },
        {
          title: 'Simulator Fleet & Qualification Register',
          blocks: [
            {
              type: 'table',
              showHeading: false,
              table: {
                name: 'Simulator Fleet Register',
                columns: [
                  { key: 'bay', header: 'Bay / Code', type: 'mono', width: 88 },
                  { key: 'aircraft', header: 'Aircraft & Model', type: 'text', width: 138 },
                  { key: 'qual', header: 'Authority / Level', type: 'text', width: 92 },
                  { key: 'status', header: 'Status', type: 'badge', width: 68, align: 'center' },
                  { key: 'reliability', header: 'Reliability', type: 'percent', width: 60, align: 'right' },
                  { key: 'qtg', header: 'QTG %', type: 'percent', width: 48, align: 'right' }
                ],
                rows: enriched.map(s => ({
                  bay: `${s.bay_code} · ${s.code}`,
                  aircraft: `${s.aircraft_type} (${s.manufacturer || 'CAE'})`,
                  qual: `${s.authority || 'EASA'} · ${s.qualification_level || 'Level D'}`,
                  status: s.status,
                  status_tone: STATUS_TONE[s.status] || 'neutral',
                  reliability: s.telemetry.dispatchReliabilityPct,
                  qtg: s.telemetry.qtgSummary.completionPct
                }))
              }
            }
          ]
        }
      ]
    };
  }
};
