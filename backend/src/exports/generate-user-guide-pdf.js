// =============================================================================
// generate-user-guide-pdf.js
// Generates a branded, publication-quality PDF for docs/USER_GUIDE.pdf
// using PDFKit and CAE brand assets.
// =============================================================================

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.resolve(__dirname, 'templates/cae_logo_light.png');
const OUTPUT_PATH = path.resolve(__dirname, '../../../docs/USER_GUIDE.pdf');

const MARGIN = 40;
const FOOTER_H = 26;

const COLORS = {
  navy:       '#06103D',
  ink:        '#0F172A',
  body:       '#334155',
  band:       '#06103D',
  headerRow:  '#132252',
  accent:     '#2969F2',
  lime:       '#B4F62A',
  subtle:     '#64748B',
  zebra:      '#F8FAFC',
  border:     '#CBD5E1',
  white:      '#FFFFFF',
  cardBg:     '#F1F5F9',
  tagBg:      '#E0E7FF',
  tagFg:      '#3730A3'
};

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique'
};

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  bufferPages: true
});

const outStream = fs.createWriteStream(OUTPUT_PATH);
doc.pipe(outStream);

const contentW = () => doc.page.width - MARGIN * 2;
const bottomLimit = () => doc.page.height - MARGIN - FOOTER_H;

function ensureSpace(heightNeeded) {
  if (doc.y + heightNeeded > bottomLimit()) {
    doc.addPage();
    drawRunningHeader();
  }
}

function drawRunningHeader() {
  const w = contentW();
  const x = MARGIN;
  const y = MARGIN;

  doc.save();
  doc.rect(x, y, w, 22).fill(COLORS.navy);

  let textX = x + 10;
  let textW = w - 20;

  if (fs.existsSync(LOGO_PATH)) {
    const logoW = 38;
    const logoH = 14;
    doc.image(LOGO_PATH, x + 8, y + 4, { width: logoW, height: logoH });
    textX = x + 8 + logoW + 10;
    textW = w - (logoW + 26);
  }

  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(9)
    .text('CAE · SMaRT Platform  |  New User Guide', textX, y + 6, { width: textW });
  doc.restore();

  doc.save();
  doc.rect(x, y + 22, w, 2).fill(COLORS.accent);
  doc.restore();

  doc.y = y + 34;
}

function drawCoverBanner() {
  const w = contentW();
  const x = MARGIN;
  const y = MARGIN;
  const bandH = 72;

  doc.save();
  doc.rect(x, y, w, bandH).fill(COLORS.band);

  let textX = x + 16;
  let textW = w - 32;

  if (fs.existsSync(LOGO_PATH)) {
    const logoW = 80;
    const logoH = 30;
    const logoY = y + (bandH - logoH) / 2;
    doc.image(LOGO_PATH, x + 16, logoY, { width: logoW, height: logoH });
    textX = x + 16 + logoW + 18;
    textW = w - (logoW + 48);
  }

  doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(18)
    .text('SMaRT Platform — User Guide', textX, y + 16, { width: textW });

  doc.font(FONTS.regular).fontSize(9.5).fillColor('#94A3B8')
    .text('Operations, Maintenance, Warehouse & Resource Tracking System', textX, y + 40, { width: textW });

  doc.restore();

  // Accent Line
  doc.save();
  doc.rect(x, y + bandH, w, 3).fill(COLORS.accent);
  doc.restore();

  doc.y = y + bandH + 16;
}

function heading1(title) {
  ensureSpace(40);
  doc.y += 10;
  const y = doc.y;
  const w = contentW();
  
  doc.save();
  doc.rect(MARGIN, y, 4, 18).fill(COLORS.accent);
  doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(14)
    .text(title, MARGIN + 12, y + 1);
  doc.restore();

  doc.y = y + 24;
}

function heading2(title) {
  ensureSpace(28);
  doc.y += 6;
  doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(11)
    .text(title, MARGIN, doc.y);
  doc.y += 3;
}

function paragraph(text) {
  ensureSpace(20);
  doc.font(FONTS.regular).fontSize(9.5).fillColor(COLORS.body)
    .text(text, MARGIN, doc.y, { width: contentW(), lineGap: 2.5 });
  doc.y += 4;
}

function bullet(boldPrefix, text) {
  ensureSpace(18);
  const w = contentW() - 14;
  const bulletX = MARGIN + 4;
  const textX = MARGIN + 14;
  const y = doc.y;

  doc.fillColor(COLORS.accent).font(FONTS.bold).fontSize(9.5).text('•', bulletX, y);
  doc.font(FONTS.bold).fillColor(COLORS.ink).text(`${boldPrefix} `, textX, y, { continued: true });
  doc.font(FONTS.regular).fillColor(COLORS.body).text(text, { width: w, lineGap: 2 });
  doc.y += 3;
}

function callout(title, body) {
  ensureSpace(48);
  const w = contentW();
  const x = MARGIN;
  const y = doc.y + 4;

  doc.font(FONTS.regular).fontSize(9);
  const bodyH = doc.heightOfString(body, { width: w - 24 });
  const totalH = bodyH + 26;

  doc.save();
  doc.rect(x, y, w, totalH).fill(COLORS.cardBg);
  doc.rect(x, y, 3.5, totalH).fill(COLORS.accent);

  doc.font(FONTS.bold).fontSize(9.5).fillColor(COLORS.navy)
    .text(title, x + 14, y + 7);
  doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.body)
    .text(body, x + 14, y + 20, { width: w - 24, lineGap: 2 });
  doc.restore();

  doc.y = y + totalH + 8;
}

function drawTable(columns, rows) {
  const w = contentW();
  const x0 = MARGIN;
  const padding = 5;

  const totalWt = columns.reduce((acc, c) => acc + (c.weight || 1), 0);
  const colWidths = columns.map(c => ((c.weight || 1) / totalWt) * w);

  function renderHeader(curY) {
    let maxH = 18;
    doc.font(FONTS.bold).fontSize(8.5);
    columns.forEach((col, i) => {
      const h = doc.heightOfString(col.title, { width: colWidths[i] - padding * 2 }) + 8;
      if (h > maxH) maxH = h;
    });

    doc.save().rect(x0, curY, w, maxH).fill(COLORS.headerRow).restore();

    let curX = x0;
    columns.forEach((col, i) => {
      doc.fillColor(COLORS.white).font(FONTS.bold).fontSize(8.5)
        .text(col.title, curX + padding, curY + 5, { width: colWidths[i] - padding * 2, align: col.align || 'left' });
      curX += colWidths[i];
    });

    return curY + maxH;
  }

  let y = doc.y + 4;
  if (y + 40 > bottomLimit()) {
    doc.addPage();
    drawRunningHeader();
    y = doc.y + 4;
  }

  y = renderHeader(y);

  rows.forEach((row, rIdx) => {
    doc.font(FONTS.regular).fontSize(8.5);
    let rowH = 16;
    const cellTexts = columns.map(col => String(row[col.key] || ''));

    cellTexts.forEach((txt, i) => {
      const h = doc.heightOfString(txt, { width: colWidths[i] - padding * 2 }) + 8;
      if (h > rowH) rowH = h;
    });

    if (y + rowH > bottomLimit()) {
      doc.addPage();
      drawRunningHeader();
      y = renderHeader(doc.y + 4);
    }

    const zebra = rIdx % 2 === 1;
    if (zebra) {
      doc.save().rect(x0, y, w, rowH).fill(COLORS.zebra).restore();
    }

    let curX = x0;
    columns.forEach((col, i) => {
      doc.save().lineWidth(0.4).strokeColor(COLORS.border)
        .rect(curX, y, colWidths[i], rowH).stroke().restore();

      const isFirstCol = i === 0;
      doc.fillColor(isFirstCol ? COLORS.ink : COLORS.body)
        .font(isFirstCol ? FONTS.bold : FONTS.regular)
        .fontSize(8.5)
        .text(cellTexts[i], curX + padding, y + 4, {
          width: colWidths[i] - padding * 2,
          align: col.align || 'left',
          lineGap: 1.5
        });

      curX += colWidths[i];
    });

    y += rowH;
  });

  doc.y = y + 8;
}

// ── DOCUMENT CONTENT GENERATION ──────────────────────────────────────────────

drawCoverBanner();

// 1. Overview & Concepts
heading1('1. Overview & Core Concepts');
paragraph('SMaRT (System for Operations, Maintenance, and Resource Tracking) is a unified enterprise management application built for high-tempo operations, equipment maintenance, warehouse logistics, and workforce scheduling. Built on an event-driven architecture, every change in one module instantly updates related indicators across the platform.');

bullet('Reactive Synchronization:', 'Updating a work order, sortie, or inventory quantity updates dashboard KPI cards and graphs immediately.');
bullet('Audited Workflows:', 'Every maintenance record, stock transaction, and shift adjustment is logged with actor and timestamp audit trails.');
bullet('Role-Based Visibility:', 'Administrators can fine-tune section and action visibility per user role.');

callout('Core Operational Synergy',
  'Operations schedule sorties ➔ Maintenance prepares hardware and logs downtime ➔ Warehouse reserves parts and logs audited stock movements ➔ Shifts ensure qualified technicians are on duty ➔ Analytics synthesizes cross-domain metrics into actionable intelligence.');

// 2. Global Controls
heading1('2. Global Controls & Platform Features');
paragraph('The following core tools are always accessible in the application shell header:');

bullet('Global Date Range Filter:', 'Controls the active time window across Dashboard, Operations, Maintenance, Warehouse, Shifts, and Analytics simultaneously. Offers 1-click presets (Today, 7D, 30D, 90D) and a custom calendar date picker.');
bullet('Multi-Format Export Engine:', 'Download reports on demand with branded headers in Excel (.xlsx), Word (.docx), PDF (.pdf), and PowerPoint (.pptx).');
bullet('Real-Time Notification Center:', 'Live WebSocket alert feed for critical equipment breakdowns, low stock warnings, and overdue task deadlines.');
bullet('User Profile & Session Controls:', 'Manage personal details, avatar, and password via the user menu in the sidebar footer.');

// 3. Section-by-Section Guide
heading1('3. Section-by-Section Functional Guide');

heading2('3.1 Dashboard (/dashboard)');
paragraph('The command center displaying live operational health metrics and immediate action items.');
drawTable(
  [
    { key: 'area', title: 'Feature Area', weight: 2 },
    { key: 'desc', title: 'Capabilities & User Actions', weight: 5 }
  ],
  [
    { area: 'KPI Metric Cards', desc: 'Live counters: Active Operations, Pending Maintenance, Low Stock Items, Open Tasks, and Registered Users.' },
    { area: 'Urgent Action Center', desc: 'Direct links to Overdue Tasks, Critical Maintenance work orders, and Out-of-Stock inventory items.' },
    { area: 'Telemetry Charts', desc: 'Visual trend charts for daily operations volume, maintenance workload distribution, and resource allocations.' },
    { area: 'Executive Export', desc: 'Download comprehensive multi-format dashboard summary reports.' }
  ]
);

heading2('3.2 Operations & Sorties (/operations)');
paragraph('Plan, dispatch, and track tactical missions, sorties, and technical deployments.');
drawTable(
  [
    { key: 'area', title: 'Feature Area', weight: 2 },
    { key: 'desc', title: 'Capabilities & User Actions', weight: 5 }
  ],
  [
    { area: 'Sortie Lifecycle', desc: 'Track states: PLANNED ➔ IN_PROGRESS ➔ COMPLETED (or ON_HOLD / CANCELLED).' },
    { area: 'Priority Matrix', desc: 'Classify urgency with LOW, MEDIUM, HIGH, or CRITICAL badges.' },
    { area: 'Sortie Details', desc: 'Specify operation type, team lead, operational location, scheduled dates, and mission debrief notes.' },
    { area: 'Filters & Export', desc: 'Filter by date range, priority, and status; export mission logs to Excel, Word, or PDF.' }
  ]
);

heading2('3.3 Maintenance (/maintenance)');
paragraph('Maintains hardware readiness through dual capabilities: active corrective logs and recurring preventive maintenance.');
bullet('Maintenance Records:', 'Log work under PREVENTIVE, CORRECTIVE, PREDICTIVE, UPGRADE, or INSPECTION. Track hardware asset ID, technician, downtime hours, financial costs, parts used, and technical findings.');
bullet('Planned Maintenance Calendar:', 'Create recurring routines repeating by DAY, WEEK, or MONTH. Interactive monthly calendar features color-coded indicator dots. Supports master tasks vs. occurrence overrides and checklist generation.');

heading2('3.4 Warehouse & Inventory (/warehouse)');
paragraph('Asset inventory tracking, catalog management, and audited component movements.');
drawTable(
  [
    { key: 'area', title: 'Feature Area', weight: 2 },
    { key: 'desc', title: 'Capabilities & User Actions', weight: 5 }
  ],
  [
    { area: 'Item Catalog', desc: 'SKU, part number, category, description, unit of measure, unit cost, and supplier information.' },
    { area: 'Stock Health', desc: 'Automated warnings when quantities reach Reorder Point or fall below Min Stock thresholds.' },
    { area: '5-Type Movements', desc: 'Log audited physical stock movements: IN (Receipt), OUT (Issue), TRANSFER (Relocate), ADJUSTMENT (Audit count), and RETURN (Unused item).' },
    { area: 'Audit Ledger', desc: 'Full transaction history recording quantity delta, remaining stock, user ID, and timestamp.' }
  ]
);

heading2('3.5 Shift Management (/shifts)');
paragraph('Manage workforce rosters, duty rotations, and attendance tracking.');
drawTable(
  [
    { key: 'area', title: 'Feature Area', weight: 2 },
    { key: 'desc', title: 'Capabilities & User Actions', weight: 5 }
  ],
  [
    { area: 'Weekly Calendar Grid', desc: 'Interactive weekly grid displaying scheduled duty assignments across all personnel.' },
    { area: 'Shift Archetypes', desc: 'Configurable shift types (Morning, Evening, Night, On-Call) with standard hours and colors.' },
    { area: 'Time & Attendance', desc: 'Record clock-in and clock-out timestamps; compute accrued overtime automatically.' },
    { area: 'Status Tracking', desc: 'Manage states: SCHEDULED, CONFIRMED, IN_PROGRESS, COMPLETED, ABSENT, or SWAPPED.' }
  ]
);

heading2('3.6 Analytics & Intelligence (/analytics & /analytics/operations)');
paragraph('Business intelligence, operational velocity, and equipment reliability analytics.');
bullet('System Analytics:', 'Interactive Chart.js visualizations for mission success rates, equipment downtime breakdown, inventory consumption velocity, and shift coverage.');
bullet('Operations Analytics:', 'Dedicated drill-down dashboard (/analytics/operations) for sortie duration distributions, priority weightings, and location heatmaps.');

heading2('3.7 Task Manager (/tasks)');
paragraph('Task orchestration supporting both Kanban workflows and deep checklist hierarchies.');
bullet('Dual Views:', 'Toggle freely between an interactive Kanban board (TODO, IN_PROGRESS, REVIEW, DONE) and a hierarchical List View.');
bullet('Recursive Subtasks:', 'Nest unlimited subtasks beneath parent deliverables with real-time aggregate completion percentages.');
bullet('Interval Recurrence:', 'Automate recurring work with intervals: ONCE, DAILY, WEEKLY, MONTHLY, or YEARLY.');

heading2('3.8 Wiki & Documentation (/wiki)');
paragraph('Centralized engineering knowledge base, standard operating procedures (SOPs), and manuals.');
bullet('Category Tree:', 'Multi-level hierarchical category tree with dedicated icons for fast document browsing.');
bullet('Markdown Authoring:', 'Full rich text and markdown editor with code highlighting, checklists, tags, and pinned articles.');
bullet('Article Governance:', 'Manage document lifecycles (DRAFT ➔ REVIEW ➔ PUBLISHED ➔ ARCHIVED) with version counters.');

heading2('3.9 Admin Settings (/admin)');
paragraph('Restricted administrative portal for system oversight, security, and master data management.');
drawTable(
  [
    { key: 'tab', title: 'Admin Tab', weight: 2 },
    { key: 'desc', title: 'Administrative Capabilities', weight: 5 }
  ],
  [
    { tab: 'System Overview', desc: 'Server health, MySQL database connection status, memory consumption, and uptime.' },
    { tab: 'User Directory', desc: 'Create and modify user profiles, assign roles, toggle active status, and perform secure password resets.' },
    { tab: 'Section Access', desc: 'Configure sidebar visibility and operational permissions per module for each user role.' },
    { tab: 'Reference Data', desc: 'Manage Operation Types, Shift Types, Asset Categories, Item Categories, and Warehouse Storage Locations.' }
  ]
);

// 4. Roles & Permissions Matrix
heading1('4. Roles & Permissions Matrix');
paragraph('SMaRT implements fine-grained Role-Based Access Control (RBAC):');

drawTable(
  [
    { key: 'module', title: 'Module / Feature', weight: 3 },
    { key: 'admin', title: 'Admin', weight: 2, align: 'center' },
    { key: 'mgr', title: 'Manager', weight: 2, align: 'center' },
    { key: 'tech', title: 'Tech', weight: 2, align: 'center' },
    { key: 'viewer', title: 'Viewer', weight: 2, align: 'center' }
  ],
  [
    { module: 'Dashboard', admin: 'Full Access', mgr: 'Full Access', tech: 'Full Access', viewer: 'View Only' },
    { module: 'Operations & Sorties', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Update Status', viewer: 'View Only' },
    { module: 'Maintenance Records', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Log & Update', viewer: 'View Only' },
    { module: 'Planned Maintenance', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Mark Done', viewer: 'View Only' },
    { module: 'Warehouse Inventory', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Movements', viewer: 'View Only' },
    { module: 'Shift Scheduling', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Clock In/Out', viewer: 'View Only' },
    { module: 'Analytics & Reports', admin: 'Full Access', mgr: 'Full Access', tech: 'View Only', viewer: 'View Only' },
    { module: 'Task Manager', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Full (CRUD)', viewer: 'View Only' },
    { module: 'Wiki & Docs', admin: 'Full (CRUD)', mgr: 'Full (CRUD)', tech: 'Edit & Create', viewer: 'Read Only' },
    { module: 'Admin Settings', admin: 'Full Access', mgr: 'Restricted', tech: 'No Access', viewer: 'No Access' },
    { module: 'Multi-Format Export', admin: 'Enabled', mgr: 'Enabled', tech: 'Enabled', viewer: 'Enabled' }
  ]
);

// 5. Quick Tips
heading1('5. Quick Tips for New Users');
bullet('Check Date Filters First:', 'If a table appears empty, check the date filter in the top header. Click 30D or Clear to reveal all historical records.');
bullet('Log Consumed Spare Parts:', 'Always attach consumed inventory items when closing maintenance logs to ensure automatic stock decrement.');
bullet('Export Ahead of Briefings:', 'Use Export ➔ PowerPoint or PDF from Operations or Analytics to instantly create slides and executive summaries.');
bullet('Need Standard Procedures?:', 'Visit /wiki for official checklists, operating manuals, and technical SOPs.');

// ── RENDER FOOTERS ACROSS ALL BUFFERED PAGES ─────────────────────────────────
const range = doc.bufferedPageRange();
const generatedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

for (let i = range.start; i < range.start + range.count; i += 1) {
  doc.switchToPage(i);
  const w = contentW();
  const yy = doc.page.height - MARGIN - 8;

  doc.save();
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .moveTo(MARGIN, yy - 6).lineTo(MARGIN + w, yy - 6).stroke();

  doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.subtle);
  doc.text('CAE · SMaRT Platform', MARGIN, yy, { width: w / 3, align: 'left' });
  doc.text(`Generated: ${generatedDate}`, MARGIN + w / 3, yy, { width: w / 3, align: 'center' });
  doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + (2 * w) / 3, yy, { width: w / 3, align: 'right' });
  doc.restore();
}

doc.end();

outStream.on('finish', () => {
  console.log(`PDF successfully generated: ${OUTPUT_PATH}`);
});
