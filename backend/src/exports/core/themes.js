// =============================================================================
// exports/core/themes.js — Official CAE A4 Corporate Design System (v4)
// -----------------------------------------------------------------------------
// Enforces one cohesive visual identity derived strictly from the official CAE
// templates in /docs (diagonal-hero cover, Deep Navy #06103D, Electric Blue
// #2969F2, Cobalt #0C47C7, Cyan #31C6DE, Red Hat fonts & Arial), while giving
// each module its own document code, report type label, and tailored tagline.
// =============================================================================

const { COLORS } = require('./branding');

const CAE_A4_THEME = {
  id: 'diagonal-hero',
  coverStyle: 'diagonal-hero',
  headerMode: 'dark',
  tableStyle: 'navy-classic',
  primary: COLORS.navy,          // #06103D Deep Navy
  accent: COLORS.accent,         // #2969F2 Electric Blue
  secondary: COLORS.cyan,        // #31C6DE Cyan highlight
  cobalt: COLORS.cobalt,         // #0C47C7 Headings
  royal: COLORS.royal,           // #082F84 Subheadings
  tint: COLORS.navyTint,         // #EEF2FF Soft tint
  tableHeaderBg: COLORS.navy,
  chartPalette: [
    COLORS.accent,   // #2969F2
    COLORS.navy,     // #06103D
    COLORS.teal,     // #1ED4B2
    COLORS.cyan,     // #31C6DE
    COLORS.amber,    // #F59B40
    COLORS.coral,    // #F55C38
    COLORS.royal,    // #082F84
    COLORS.magenta   // #E23E90
  ]
};

const MODULE_THEMES = {
  dashboard: {
    docCode: 'CAE-EXEC-01',
    reportType: 'Executive Command Briefing',
    coverTagline: 'Cross-Domain Fleet Readiness & Escalation Radar'
  },
  analytics: {
    docCode: 'CAE-BI-02',
    reportType: 'Financial & BI Intelligence Review',
    coverTagline: 'Maintenance Spend Drivers, Velocity & Performance Benchmarks'
  },
  operations: {
    docCode: 'CAE-OPS-03',
    reportType: 'Mission & Sortie Operations Dossier',
    coverTagline: 'Operational Lifecycle, Site Concentration & Sortie Spotlights'
  },
  'operations-analytics': {
    docCode: 'CAE-TEL-04',
    reportType: 'Throughput & Time Telemetry Study',
    coverTagline: 'Operational Volume Curves, Peak Demand Windows & Effort Split'
  },
  maintenance: {
    docCode: 'CAE-MNT-05',
    reportType: 'Reliability & Asset Cost Audit',
    coverTagline: 'Corrective Interventions, Downtime Impact & Costly Equipment'
  },
  'planned-maintenance': {
    docCode: 'CAE-PM-06',
    reportType: 'Preventive Compliance & Schedule Booklet',
    coverTagline: 'System Preventive Adherence, Cadence Mix & Exceptions'
  },
  warehouse: {
    docCode: 'CAE-INV-07',
    reportType: 'Supply Chain & Procurement Pack',
    coverTagline: 'Immediate Restock Action, Capital Allocation & Stock Velocity'
  },
  shifts: {
    docCode: 'CAE-HR-08',
    reportType: 'Workforce Attendance & Roster Schedule',
    coverTagline: 'Department Presence Health, Shift Patterns & Overtime Hours'
  },
  tasks: {
    docCode: 'CAE-TSK-09',
    reportType: 'Team Workload & SLA Delivery Dossier',
    coverTagline: 'Assignee Capacity Balance, Overdue Risks & Deliverable Pipeline'
  },
  wiki: {
    docCode: 'CAE-DOC-10',
    reportType: 'Engineering Knowledge Catalogue',
    coverTagline: 'Controlled Documentation Governance & SOP Readership Audit'
  },
  'wiki-article': {
    docCode: 'CAE-SOP',
    reportType: 'Standard Operating Procedure',
    coverTagline: 'Controlled Engineering SOP & Technical Reference Manual'
  },
  users: {
    docCode: 'CAE-IAM-11',
    reportType: 'Identity & RBAC Governance Review',
    coverTagline: 'Privilege Posture, Role Distribution & Account Activity Audit'
  },
  audit: {
    docCode: 'CAE-SEC-12',
    reportType: 'Security & Forensic Audit Trail',
    coverTagline: 'HTTP Integrity, Access Rejections & Operator Anomaly Hotspots'
  },
  simulators: {
    docCode: 'CAE-SIM-13',
    reportType: 'Flight Simulator Fleet & QTG Dossier',
    coverTagline: 'Multi-Bay Availability, Qualification Compliance & Subsystem Health'
  }
};

/**
 * Resolve an immutable theme grounded strictly in CAE_A4_THEME with
 * module-specific document control metadata.
 */
function resolveTheme(spec = {}) {
  const modKey = spec.moduleKey || (typeof spec.theme === 'string' ? spec.theme : null);
  const modPreset = modKey && MODULE_THEMES[modKey] ? MODULE_THEMES[modKey] : null;
  const customObj = spec.theme && typeof spec.theme === 'object' ? spec.theme : {};

  return {
    ...CAE_A4_THEME,
    ...(modPreset || {}),
    ...customObj,
    coverStyle: 'diagonal-hero',
    docCode: spec.docCode || customObj.docCode || modPreset?.docCode || 'CAE-RPT',
    chartPalette: customObj.chartPalette || CAE_A4_THEME.chartPalette
  };
}

module.exports = { THEMES: { 'diagonal-hero': CAE_A4_THEME }, CAE_A4_THEME, MODULE_THEMES, resolveTheme };
