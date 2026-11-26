// =============================================================================
// exports/renderers/docx-section-profiles.js
// -----------------------------------------------------------------------------
// Tailored, concise, data-first Word (.docx) blueprints for EVERY SMaRT module.
// Guarantees that each platform section produces a distinct report with its own
// headings, short 1-sentence descriptions, column labels, and logical flow —
// zero generic audit essays and zero duplicated wording across sections.
// =============================================================================
'use strict';

const { fmtNumber } = require('../core/helpers');

const periodSuffix = (ctx) => (ctx.periodLabel ? ` (${ctx.periodLabel})` : '');

/**
 * Per-module Word report blueprints.
 * Section slot keys:
 *   'summary'    -> KPI summary table (+ optional compact metadata strip)
 *   'specs'      -> Control / configuration stat matrices
 *   'scorecards' -> Domain / department / system health scorecard tables
 *   'alerts'     -> Compact 3-column exceptions / advisories table
 *   'highlights' -> Featured items / spotlights compact table
 *   'charts'     -> Live native OOXML bar chart + secondary chart breakdowns
 *   'document'   -> Structured Markdown SOP / procedure body
 *   'tables'     -> Primary operational data tables (printHidden excluded)
 */
const DOCX_SECTION_PROFILES = Object.freeze({
  dashboard: {
    coverTeam: 'Operations Control Room',
    showChart: true,
    order: ['summary', 'scorecards', 'alerts', 'charts', 'tables'],
    kpiColumns: ['Control Room KPI', 'Current Value', 'Operational Context'],
    alertColumns: ['Urgent Escalation', 'Severity', 'Operational Detail'],
    sections: {
      summary: {
        title: 'Control Room Snapshot',
        desc: (c) => `Live cross-domain snapshot of fleet availability, active sorties, maintenance workload, and stock posture${periodSuffix(c)}.`
      },
      scorecards: {
        title: 'Domain Readiness Scorecard',
        desc: () => 'Normalized completion and availability scores across each operational pillar.'
      },
      alerts: {
        title: 'Priority Escalations',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} urgent condition(s) requiring immediate control-room attention.`
      },
      charts: {
        title: 'Activity & Workload Mix',
        desc: () => 'Distribution of completed versus active operational workload across the center.'
      },
      tables: {
        title: 'Urgent Action & Activity Ledger',
        desc: (c) => `Consolidated priority action items and platform counters (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  simulators: {
    coverTeam: 'Simulation Engineering & FSTD Qualification',
    showChart: true,
    order: ['summary', 'specs', 'charts', 'alerts', 'tables'],
    kpiColumns: ['Fleet Metric', 'Measured Value', 'Qualification / Readiness Note'],
    alertColumns: ['Bay / MEL Advisory', 'Priority', 'Impact & Limitation'],
    sections: {
      summary: {
        title: 'Simulator Fleet Readiness',
        desc: (c) => `Key availability, dispatch reliability, QTG qualification, and open snag figures across registered FSTD bays${periodSuffix(c)}.`
      },
      specs: {
        title: 'Hardware & Qualification Profile',
        desc: () => 'Authority certification, qualification level, bay metadata, and technical configuration.'
      },
      charts: {
        title: 'Bay Dispatch Reliability',
        desc: () => 'Dispatch reliability comparison across active simulator bays.'
      },
      alerts: {
        title: 'MEL Limitations & Qualification Warnings',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} active MEL restriction(s), AOG status, or certificate expiry notice(s).`
      },
      tables: {
        title: 'Fleet & Subsystem Health Register',
        desc: (c) => `Detailed bay status, QTG progress, and 8-subsystem health records (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  'daily-station-ops': {
    coverTeam: 'Station Operations & Shift Handover',
    showChart: true,
    order: ['specs', 'summary', 'alerts', 'charts', 'tables'],
    kpiColumns: ['Daily Ops Indicator', 'Recorded Value', 'Shift Context'],
    alertColumns: ['NA Station Notice', 'Status', 'Handover Escalation'],
    sections: {
      specs: {
        title: 'Facility Operating Hours & Controls',
        desc: (c) => `Plant readiness, post-testing routine, logout timestamps, and shift control parameters${periodSuffix(c)}.`
      },
      summary: {
        title: 'Station Utilization Totals',
        desc: () => 'Total active sessions, station readiness counts, and logged testing duration across shifts.'
      },
      alerts: {
        title: 'Unavailable Stations (NA) & Escalations',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} unavailable station notice(s) flagged during shift operations.`
      },
      charts: {
        title: 'Session Hours by Station',
        desc: () => 'Testing hours logged per station during the selected operating window.'
      },
      tables: {
        title: 'Shift Handover & Station Register',
        desc: (c) => `Per-station shift status, start/end testing times, and Test Leader handover notes (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  operations: {
    coverTeam: 'Sortie Dispatch & Crew Scheduling',
    showChart: true,
    order: ['summary', 'charts', 'highlights', 'alerts', 'tables'],
    kpiColumns: ['Dispatch Metric', 'Recorded Value', 'Sortie Context'],
    alertColumns: ['Dispatch Exception', 'Severity', 'Snag / Delay Detail'],
    highlightColumns: ['Sortie Highlight', 'Metric', 'Session Detail'],
    sections: {
      summary: {
        title: 'Sortie Volume & Dispatch Metrics',
        desc: (c) => `Scheduled, flown, and reliable simulator sorties plus lost training time${periodSuffix(c)}.`
      },
      charts: {
        title: 'Sortie Mix & Bay Allocation',
        desc: () => 'Breakdown of sortie volume by outcome, profile, and simulator bay.'
      },
      highlights: {
        title: 'Featured Sorties & Milestones',
        desc: () => 'Notable training blocks and high-priority mission sessions recorded in period.'
      },
      alerts: {
        title: 'Technical Snags & Dispatch Delays',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} interrupted, snag-affected, or overdue sortie alert(s).`
      },
      tables: {
        title: 'Bay Dispatch Scorecard & Sortie Ledger',
        desc: (c) => `Complete bay allocation scorecard and chronological sortie schedule (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  'operations-analytics': {
    coverTeam: 'Operations Telemetry & Performance',
    showChart: true,
    order: ['specs', 'summary', 'charts', 'tables'],
    kpiColumns: ['Telemetry Metric', 'Measured Value', 'Window Context'],
    sections: {
      specs: {
        title: 'Peak Demand & Runtime Telemetry',
        desc: (c) => `Peak booking window, average session duration, and combined bay/station runtime figures${periodSuffix(c)}.`
      },
      summary: {
        title: 'Throughput & Utilization KPIs',
        desc: () => 'Aggregated flight hours, operator load, and station shift totals.'
      },
      charts: {
        title: 'Throughput Curve & Effort Split',
        desc: () => 'Sortie throughput trend and training hours distributed by operation type.'
      },
      tables: {
        title: 'Bay Utilization & Velocity Tables',
        desc: (c) => `Combined FFS sortie hours, TP/IOS shift hours, and period velocity breakdown (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  maintenance: {
    coverTeam: 'Maintenance & Reliability Engineering',
    showChart: true,
    order: ['summary', 'charts', 'alerts', 'tables'],
    kpiColumns: ['Reliability Metric', 'Recorded Value', 'Engineering Note'],
    alertColumns: ['Critical Fault / MEL Alert', 'Severity', 'Technical Detail'],
    sections: {
      summary: {
        title: 'Work Orders, MTTR & Spend Summary',
        desc: (c) => `Corrective vs preventive workload, downtime impact, MTTR, and spare parts spend${periodSuffix(c)}.`
      },
      charts: {
        title: 'Faulty Subsystems & Spend Mix',
        desc: () => 'Subsystems generating the highest incident counts alongside expenditure by intervention type.'
      },
      alerts: {
        title: 'Critical Failures & MEL Exposure',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} high-severity snag(s), overdue work order(s), or active MEL exposure(s).`
      },
      tables: {
        title: 'Asset Reliability & Work Orders Ledger',
        desc: (c) => `Per-bay reliability metrics and complete work order register (${fmtNumber(c.totalRows, 0)} records).`
      }
    }
  },

  'planned-maintenance': {
    coverTeam: 'Preventive Maintenance Planning',
    showChart: true,
    order: ['summary', 'scorecards', 'charts', 'alerts', 'tables'],
    kpiColumns: ['Preventive KPI', 'Value', 'Schedule Context'],
    alertColumns: ['Schedule Exception', 'Severity', 'Occurrence Note'],
    sections: {
      summary: {
        title: 'Preventive Adherence Summary',
        desc: (c) => `Recurring preventive tasks scheduled, completed, and pending across systems${periodSuffix(c)}.`
      },
      scorecards: {
        title: 'System Compliance Scorecard',
        desc: () => 'Preventive completion rate broken down by technical system.'
      },
      charts: {
        title: 'Recurrence Cadence & System Load',
        desc: () => 'Distribution of recurring tasks by interval (daily, weekly, monthly) and system.'
      },
      alerts: {
        title: 'Schedule Exceptions & Overdue Items',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} preventive schedule exception(s) or pending compliance notice(s).`
      },
      tables: {
        title: 'Master Preventive Schedule & Overrides',
        desc: (c) => `Active recurring tasks and calendar occurrence overrides (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  warehouse: {
    coverTeam: 'Supply Chain & Spares Logistics',
    showChart: true,
    order: ['summary', 'alerts', 'charts', 'highlights', 'tables'],
    kpiColumns: ['Inventory Metric', 'Value', 'Buffer / Cost Context'],
    alertColumns: ['Stockout / AOG Alert', 'Urgency', 'Replenishment Action'],
    highlightColumns: ['Supply Chain Spotlight', 'Metric', 'Stock Detail'],
    sections: {
      summary: {
        title: 'Inventory Valuation & Buffer Health',
        desc: (c) => `Total spare parts valuation, AOG critical stock buffers, reorder deficit, and LRU/RMA count${periodSuffix(c)}.`
      },
      alerts: {
        title: 'AOG Critical & Reorder Alerts',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} depleted, low-buffer, or AOG-critical spare part alert(s).`
      },
      charts: {
        title: 'Stock Health & Category Valuation',
        desc: () => 'SKU buffer distribution versus reorder threshold and capital allocation by category.'
      },
      highlights: {
        title: 'Key Spares & Movement Spotlights',
        desc: () => 'Highest-value stock items and active rotable LRU turnaround notes.'
      },
      tables: {
        title: 'Restock, LRU/RMA & Stock Ledgers',
        desc: (c) => `Immediate procurement list, rotable LRU/RMA tracker, catalogue, and movement history (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  shifts: {
    coverTeam: 'Workforce Planning & Roster Control',
    showChart: true,
    order: ['summary', 'scorecards', 'charts', 'alerts', 'tables'],
    kpiColumns: ['Roster Metric', 'Value', 'Attendance Context'],
    alertColumns: ['Attendance / Overtime Notice', 'Severity', 'Workforce Detail'],
    sections: {
      summary: {
        title: 'Attendance & Overtime Summary',
        desc: (c) => `Scheduled shifts, attendance compliance rate, absences, and logged overtime hours${periodSuffix(c)}.`
      },
      scorecards: {
        title: 'Department Attendance Health',
        desc: () => 'Presence compliance and overtime ratio per organizational unit.'
      },
      charts: {
        title: 'Shift Patterns & Lifecycle Split',
        desc: () => 'Volume across shift archetypes (Morning, Afternoon, Night, On-Call) and shift statuses.'
      },
      alerts: {
        title: 'Attendance & Overtime Advisories',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} labor-law, absence, or overtime threshold advisory(ies).`
      },
      tables: {
        title: 'Employee Attendance & Daily Roster',
        desc: (c) => `Per-employee hours/overtime matrix and detailed shift schedule (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  tasks: {
    coverTeam: 'Team Delivery & Task Management',
    showChart: true,
    order: ['summary', 'charts', 'alerts', 'tables'],
    kpiColumns: ['Delivery KPI', 'Value', 'SLA Context'],
    alertColumns: ['SLA / Backlog Risk', 'Severity', 'Action Detail'],
    sections: {
      summary: {
        title: 'Task Pipeline & SLA Summary',
        desc: (c) => `Open deliverables, completion rate, overdue backlog, and recurring checklist progress${periodSuffix(c)}.`
      },
      charts: {
        title: 'Assignee Load & Priority Mix',
        desc: () => 'Task volume per assignee, priority distribution, and recurrence cadence.'
      },
      alerts: {
        title: 'Overdue & SLA Breach Advisories',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} SLA breach or overdue backlog warning(s).`
      },
      tables: {
        title: 'Assignee Workload & Task Register',
        desc: (c) => `Contributor workload summary and full deliverable register (${fmtNumber(c.totalRows, 0)} records).`
      }
    }
  },

  analytics: {
    coverTeam: 'Business Intelligence & Finance',
    showChart: true,
    order: ['summary', 'charts', 'highlights', 'alerts', 'tables'],
    kpiColumns: ['BI Performance Metric', 'Value', 'Benchmark Note'],
    alertColumns: ['Performance Variance', 'Severity', 'Analytical Detail'],
    highlightColumns: ['BI Highlight', 'Metric', 'Key Driver'],
    sections: {
      summary: {
        title: 'Financial & Cross-Module KPIs',
        desc: (c) => `Maintenance expenditure, operational throughput, stock velocity, and completion efficiency${periodSuffix(c)}.`
      },
      charts: {
        title: 'Cost Drivers & Flow Trends',
        desc: () => 'Maintenance cost ranking, warehouse IN/OUT velocity, and delivery split.'
      },
      highlights: {
        title: 'Key Spend & Velocity Drivers',
        desc: () => 'Primary operational drivers shaping period performance.'
      },
      alerts: {
        title: 'Variance & Spend Advisories',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} cost or throughput variance notice(s) detected.`
      },
      tables: {
        title: 'Cross-Module Benchmark Tables',
        desc: (c) => `Aggregated maintenance cost reliability and operational benchmarks (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  users: {
    coverTeam: 'Identity & Access Governance',
    showChart: true,
    order: ['summary', 'charts', 'highlights', 'alerts', 'tables'],
    kpiColumns: ['IAM Metric', 'Count / Value', 'Access Context'],
    alertColumns: ['Account Hygiene Notice', 'Severity', 'Governance Detail'],
    highlightColumns: ['Governance Note', 'Metric', 'Scope Detail'],
    sections: {
      summary: {
        title: 'Account & RBAC Posture',
        desc: (c) => `Registered user accounts, active ratio, role tiers, and login activity${periodSuffix(c)}.`
      },
      charts: {
        title: 'Role & Department Footprint',
        desc: () => 'Account distribution by RBAC role and organizational department.'
      },
      highlights: {
        title: 'Access Governance Highlights',
        desc: () => 'Key entitlement observations across platform accounts.'
      },
      alerts: {
        title: 'Entitlement & Hygiene Advisories',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} inactive account, admin concentration, or access review notice(s).`
      },
      tables: {
        title: 'RBAC Role Matrix & User Directory',
        desc: (c) => `Role governance summary and authorized user directory (${fmtNumber(c.totalRows, 0)} rows).`
      }
    }
  },

  audit: {
    coverTeam: 'Security & Forensic Telemetry',
    showChart: true,
    order: ['summary', 'alerts', 'charts', 'tables'],
    kpiColumns: ['Security Telemetry KPI', 'Measured Value', 'Integrity Status'],
    alertColumns: ['Security / HTTP Alert', 'Severity', 'Telemetry Detail'],
    sections: {
      summary: {
        title: 'HTTP Integrity & Audit Volume',
        desc: (c) => `Audited API requests, 2xx/3xx success ratio, client rejections (4xx), and server faults (5xx)${periodSuffix(c)}.`
      },
      alerts: {
        title: 'Security & Rejection Alerts',
        desc: (c) => `${fmtNumber(c.alertCount, 0)} rejected request burst(s) or server error anomaly(ies).`
      },
      charts: {
        title: 'Response Integrity & Top Actions',
        desc: () => 'HTTP status code distribution and most frequently logged platform events.'
      },
      tables: {
        title: 'Operator Hotspots & Forensic Log',
        desc: (c) => `Actor-level activity concentration and chronological audit trail (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  wiki: {
    coverTeam: 'Technical Documentation Control',
    showChart: true,
    order: ['summary', 'charts', 'highlights', 'tables'],
    kpiColumns: ['Documentation Metric', 'Value', 'Lifecycle Context'],
    highlightColumns: ['Featured Guide / SOP', 'Views / Tag', 'Reference Note'],
    sections: {
      summary: {
        title: 'Knowledge Base Coverage',
        desc: (c) => `Published technical procedures, draft/review backlog, and readership activity${periodSuffix(c)}.`
      },
      charts: {
        title: 'Coverage by Knowledge Domain',
        desc: () => 'Document distribution across engineering taxonomy categories and editorial statuses.'
      },
      highlights: {
        title: 'Most-Consulted Procedures',
        desc: () => 'Highest-readership SOPs and reference guides across the platform.'
      },
      tables: {
        title: 'Controlled Document Catalogue',
        desc: (c) => `Complete controlled index of platform articles and SOPs (${fmtNumber(c.totalRows, 0)} entries).`
      }
    }
  },

  'wiki-article': {
    coverTeam: 'Controlled Technical Procedure',
    showChart: false,
    order: ['specs', 'document', 'tables'],
    sections: {
      specs: {
        title: 'Document Control Metadata',
        desc: () => 'Controlled procedure identifier, category, owner, publication status, and revision info.'
      },
      document: {
        title: 'Standard Operating Procedure',
        desc: () => 'Controlled step-by-step instructions, technical notes, and reference tables.'
      },
      tables: {
        title: 'Document Control Record',
        desc: () => 'Supporting metadata and reference tables linked to this procedure.'
      }
    }
  }
});

/** Fallback profile for custom or unmapped specs. */
const DEFAULT_PROFILE = Object.freeze({
  coverTeam: 'SMaRT Operations Platform',
  showChart: true,
  order: ['summary', 'specs', 'scorecards', 'alerts', 'highlights', 'charts', 'document', 'tables'],
  kpiColumns: ['Indicator', 'Value', 'Context'],
  alertColumns: ['Notice', 'Severity', 'Details'],
  highlightColumns: ['Highlight', 'Metric', 'Details'],
  sections: {
    summary: {
      title: 'Key Metrics Summary',
      desc: (c) => `Core quantitative indicators captured for ${c.specTitle}${periodSuffix(c)}.`
    },
    specs: {
      title: 'Report Scope & Parameters',
      desc: () => 'Configuration parameters and scope metadata for this export.'
    },
    scorecards: {
      title: 'Performance Scorecard',
      desc: () => 'Normalized compliance and readiness scores.'
    },
    alerts: {
      title: 'Active Notices & Exceptions',
      desc: (c) => `${fmtNumber(c.alertCount, 0)} active operational notice(s) flagged in this window.`
    },
    highlights: {
      title: 'Operational Highlights',
      desc: () => 'Key items highlighted from the selected dataset.'
    },
    charts: {
      title: 'Visual Breakdown',
      desc: () => 'Quantitative breakdown of primary metrics.'
    },
    document: {
      title: 'Document Content',
      desc: () => 'Structured procedure and reference content.'
    },
    tables: {
      title: 'Detailed Data Register',
      desc: (c) => `Structured records matching the selected filters (${fmtNumber(c.totalRows, 0)} rows).`
    }
  }
});

function getDocxSectionProfile(moduleKey, spec = {}) {
  const key = String(moduleKey || spec.moduleKey || '').trim().toLowerCase();
  return DOCX_SECTION_PROFILES[key] || DEFAULT_PROFILE;
}

module.exports = {
  DOCX_SECTION_PROFILES,
  DEFAULT_PROFILE,
  getDocxSectionProfile
};
