// =============================================================================
// wiki-templates.ts — Curated Documentation Templates & Pure Wiki Helpers
// =============================================================================
import { ArticleStatus, WikiCategory } from '../../core/models/interfaces';

export interface WikiTemplateOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  badge: string;
  tags: string[];
  content: string;
}

export interface FlatCategoryOption {
  id: number;
  label: string;
  icon: string;
  isChild: boolean;
}

export const WIKI_ICON_CHOICES: string[] = [
  'folder', 'menu_book', 'engineering', 'bolt', 'ac_unit', 'lan',
  'security', 'dns', 'build', 'precision_manufacturing', 'task_alt', 'description'
];

export const WIKI_TEMPLATES: WikiTemplateOption[] = [
  {
    id: 'fstd-morning-readiness-sop',
    name: 'Morning FSTD Bay Readiness & Pre-Flight SOP',
    description: 'Daily pre-sortie engineering verification checklist for Level D Flight Simulators.',
    icon: 'flight_takeoff',
    badge: 'FSTD SOP',
    tags: ['FSTD', 'Pre-Flight', 'Readiness', 'SOP'],
    content: `# Morning FSTD Bay Readiness & Pre-Flight SOP

**Document ID:** SOP-FSTD-01 · **Applies to:** All Full Flight Simulators (Level D) & FTDs

## 1. Bay Safety & Power-Up Sequence
- [ ] Verify bay doors clear, visual dome emergency stops reset, and no active **LOTO** tags present.
- [ ] Inspect HPU fluid level and chilled water supply temperature (18°C – 22°C).
- [ ] Power ON Host Computing Cluster (SimCore / avionics racks) and confirm green health status on IOS.

## 2. 6-DOF Motion & Control Loading Checks
- [ ] Engage Hydraulic Power Unit and run automated **Motion System Warm-up & Settling Check**.
- [ ] Verify Control Loading System (CLS) feel forces on captain/FO columns, rudder pedals, and tiller.

## 3. Visual, Sound & Navigation Database
- [ ] Power ON Medallion / Barco projectors; confirm cross-channel luminance, warp, and edge-blend alignment.
- [ ] Confirm current **AIRAC cycle** loaded and IOS weather/runway presets responsive.
- [ ] Record any anomaly as a Discrepancy Report (DR) in **SMaRT Maintenance** and update Bay MEL status before 06:00 UTC Dispatch.
`
  },
  {
    id: 'fstd-quarterly-qtg-runbook',
    name: 'EASA CS-FSTD(A) Quarterly QTG Runbook',
    description: 'Standard procedure for executing automated & manual QTG tests across Q1–Q4 regulatory blocks.',
    icon: 'fact_check',
    badge: 'QTG',
    tags: ['QTG', 'EASA', 'FAA', 'Compliance'],
    content: `# EASA CS-FSTD(A) / FAA Part 60 Quarterly QTG Execution Runbook

## 1. Preparation & Trim Conditions
- Reserve a minimum **3-hour engineering slot** on the Bay Gantt Timeline.
- Ensure simulator configuration matches the **Master QTG Baseline** (Software Load, Aerodynamic Model, Motion Filter set).

## 2. Test Execution Matrix
1. Navigate to **Flight Simulators → Workspace → QTG & Qualification** or **Maintenance → QTG Compliance**.
2. Execute the quarterly **25% automatic QTG batch** (Performance, Handling Qualities, Motion Cueing, Visual & Sound).
3. Complete functional & subjective evaluation checks in cockpit with TRI/Engineer sign-off.

## 3. Tolerance Analysis & Disposition
- **PASSED:** All traces fall strictly within CS-FSTD(A) tolerances; record executed date & delta in SMaRT.
- **TOLERANCE_WARN:** Approaching limit or minor transducer drift — log corrective tuning work order within 7 days.
- **FAILED:** Open an immediate Discrepancy Report (DR), assess MEL dispatch impact, and notify Authority Liaison if recurring.
`
  },
  {
    id: 'fstd-motion-visual-loto',
    name: '6-DOF Motion & Visual LOTO Safety Procedure',
    description: 'Lockout/Tagout (LOTO) safety isolation protocol before entering motion envelope or projector gantry.',
    icon: 'security',
    badge: 'LOTO',
    tags: ['LOTO', 'Safety', 'Motion', 'HPU'],
    content: `# 6-DOF Motion & Collimated Visual LOTO Safety Procedure

> **CRITICAL SAFETY NOTICE:** Never enter the motion platform underside envelope or drawbridge perimeter while HPU accumulators remain pressurized.

## 1. Motion Envelope Isolation (Lockout/Tagout)
1. Park simulator cockpit cleanly at **Ref / Parked attitude** and disengage motion on IOS.
2. Trip main **HPU Isolation Breaker** on Bay Power Panel and bleed accumulator pressure gauge to **0 bar**.
3. Apply personal **LOTO padlock + tag** and log the active Lockout in the **Shifts Handover Log**.
4. Engage physical access gate interlock switch before crossing yellow hazard line.

## 2. Visual Projector & Laser Optics Safety
- Allow projector lamp/laser assemblies 15 minutes cool-down before opening optical housing.
- Wear ESD wrist strap when handling image generator (IG) cards or collimator mirror mounts.

## 3. Return to Service
- Account for all tools & calibrated equipment, remove personal LOTO locks, run dry-cycle motion check from IOS before releasing bay to **READY**.
`
  },
  {
    id: 'sop',
    name: 'Standard Operating Procedure (SOP + LOTO)',
    description: 'Safety prerequisites, LOTO callout, step checklist, and approval diagram.',
    icon: 'security',
    badge: 'SOP',
    tags: ['sop', 'safety', 'loto'],
    content: [
      '# Purpose & Scope',
      '',
      'Describe the target subsystem, equipment boundaries, and operational conditions covered by this procedure.',
      '',
      '> [!CAUTION]',
      '> Verify zero-energy state and apply personal Lockout-Tagout (LOTO) devices before opening energized panels.',
      '',
      '## Safety Prerequisites Checklist',
      '',
      '- [ ] Confirm Change Request / maintenance window authorization',
      '- [ ] Inspect insulated PPE & calibrated multimeter',
      '- [ ] Notify Control Room operator prior to isolation',
      '',
      '## Execution Sequence',
      '',
      '```mermaid',
      'flowchart LR',
      '  A["Notify Control Room"] --> B["Isolate Breaker"]',
      '  B --> C["Apply LOTO Lock"]',
      '  C --> D["Zero-Energy Verification"]',
      '  D --> E["Execute Intervention"]',
      '```',
      '',
      '| Step | Action | Expected Limit | Owner |',
      '| --- | --- | --- | --- |',
      '| 1 | Main feeder isolation | 0 V AC phase-to-ground | Electrical Lead |',
      '| 2 | Thermal scan baseline | < 45 °C delta | Field Tech |',
      '',
      '## Restoration & Sign-Off',
      '',
      '1. Clear tools and remove lockout tags only by the issuing technician.',
      '2. Restore power in reverse order and log telemetry readings.'
    ].join('\n')
  },
  {
    id: 'runbook',
    name: 'Troubleshooting Runbook',
    description: 'Symptom triage, diagnostic commands, decision tree, and escalation matrix.',
    icon: 'build',
    badge: 'RUNBOOK',
    tags: ['runbook', 'diagnostics', 'ops'],
    content: [
      '# Incident Overview',
      '',
      'Summarize the service symptoms, alert thresholds, and blast radius.',
      '',
      '> [!TIP]',
      '> Capture system logs and container metrics before restarting services so root-cause evidence is preserved.',
      '',
      '## Triage Flow',
      '',
      '```mermaid',
      'flowchart TD',
      '  S["Alert Triggered"] --> H{"Health Check OK?"}',
      '  H -- "No" --> L["Inspect Container Logs"]',
      '  H -- "Yes" --> M["Check Latency & DB Pool"]',
      '  L --> R["Restart / Failover"]',
      '```',
      '',
      '## Diagnostic Commands',
      '',
      '```bash',
      'curl -fsS http://localhost:3000/api/health',
      'docker compose ps',
      '```',
      '',
      '## Escalation Matrix',
      '',
      '| Severity | Condition | Escalate To | SLA Target |',
      '| --- | --- | --- | --- |',
      '| Critical | Service unreachable | On-Call Lead | 15 min |',
      '| High | Degraded throughput | Platform Team | 1 hour |'
    ].join('\n')
  },
  {
    id: 'architecture',
    name: 'Architecture & Network Spec',
    description: 'Topology diagram, component inventory, ports, and operational notes.',
    icon: 'lan',
    badge: 'ARCH',
    tags: ['architecture', 'network', 'spec'],
    content: [
      '# Architecture Overview',
      '',
      'Document high-level data flows, security boundaries, and redundancy assumptions.',
      '',
      '```mermaid',
      'flowchart LR',
      '  Client["Operators Browser"] -->|HTTPS| Proxy["Reverse Proxy"]',
      '  Proxy -->|/api| API["SMaRT Node API"]',
      '  API -->|SQL| DB[("MySQL Database")]',
      '```',
      '',
      '> [!NOTE]',
      '> All internal service-to-service endpoints enforce JWT authentication and RBAC role checks.',
      '',
      '## Component Inventory',
      '',
      '| Component | Host / Container | Port | Notes |',
      '| --- | --- | --- | --- |',
      '| Web UI | nginx-frontend | 80 | Angular SPA static bundle |',
      '| API Server | smart-backend | 3000 | REST + Socket.IO + Export Engine |'
    ].join('\n')
  },
  {
    id: 'blank',
    name: 'Blank Technical Note',
    description: 'Clean starting document with a brief overview heading.',
    icon: 'article',
    badge: 'BLANK',
    tags: [],
    content: '# Overview\n\nStart writing your technical documentation here.\n'
  }
];

export function estimateReadingMinutes(md: string): number {
  const words = String(md || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function getArticleStatusBadge(status: ArticleStatus | string): string {
  const map: Record<string, string> = {
    PUBLISHED: 'badge-completed',
    DRAFT:     'badge-planned',
    REVIEW:    'badge-in-progress',
    ARCHIVED:  'badge-cancelled'
  };
  return map[status] || 'badge-planned';
}

export function getArticleStatusLabel(status: ArticleStatus | string): string {
  const map: Record<string, string> = {
    PUBLISHED: 'Published',
    DRAFT:     'Draft',
    REVIEW:    'In Review',
    ARCHIVED:  'Archived'
  };
  return map[status] || status;
}

export function flattenCategories(categories: WikiCategory[]): FlatCategoryOption[] {
  const out: FlatCategoryOption[] = [];
  for (const cat of categories || []) {
    out.push({ id: cat.id, label: cat.name, icon: cat.icon || 'folder', isChild: false });
    for (const child of cat.children || []) {
      out.push({
        id: child.id,
        label: `${cat.name} / ${child.name}`,
        icon: child.icon || 'subdirectory_arrow_right',
        isChild: true
      });
    }
  }
  return out;
}
