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
