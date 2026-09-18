# SMaRT Platform — User Guide

> **SMaRT (System for Operations, Maintenance, and Resource Tracking)** is a unified enterprise platform designed to coordinate mission operations, equipment maintenance, warehouse logistics, and workforce scheduling from a single pane of glass.

---

## 📑 Table of Contents

1. [Overview & Core Concepts](#1-overview--core-concepts)
2. [Global Controls & Platform Features](#2-global-controls--platform-features)
   - [Global Date Filtering](#global-date-filtering)
   - [Multi-Format Document Export](#multi-format-document-export)
   - [Real-Time Notification Center](#real-time-notification-center)
   - [User Profile & Session Controls](#user-profile--session-controls)
3. [Section-by-Section Guide](#3-section-by-section-guide)
   - [1. Dashboard](#1-dashboard)
   - [2. Operations & Sorties](#2-operations--sorties)
   - [3. Maintenance](#3-maintenance)
   - [4. Warehouse & Inventory](#4-warehouse--inventory)
   - [5. Shift Management](#5-shift-management)
   - [6. Analytics & Intelligence](#6-analytics--intelligence)
   - [7. Task Manager](#7-task-manager)
   - [8. Wiki & Documentation](#8-wiki--documentation)
   - [9. Admin Settings](#9-admin-settings)
4. [Roles & Permissions Matrix](#4-roles--permissions-matrix)
5. [Quick Tips for New Users](#5-quick-tips-for-new-users)

---

## 1. Overview & Core Concepts

SMaRT brings all operational domains into real-time synchronization. Changes in one module instantly inform the rest:

```
┌────────────────────────────────────────────────────────┐
│                      SMaRT Core                        │
└─────┬──────────────┬──────────────┬──────────────┬─────┘
      │              │              │              │
┌─────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Operations │ │Maintenance │ │ Warehouse  │ │   Shifts   │
│ & Sorties  │ │& Equipment │ │& Inventory │ │ & Roster   │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      └──────────────┼──────────────┼──────────────┘
                     ▼              ▼
             ┌──────────────┐ ┌──────────────┐
             │  Analytics   │ │     Tasks    │
             │ & Reporting  │ │  & Workflows │
             └──────────────┘ └──────────────┘
```

- **Reactive Updates**: Changing a date filter or updating a record updates all related cards, tables, and charts instantly without page reloads.
- **Auditable History**: Critical movements, status changes, and maintenance records retain strict timestamps and user stamps.
- **Granular Access**: Administrators configure which sections each role can view and modify.

---

## 2. Global Controls & Platform Features

SMaRT includes powerful cross-cutting controls available across the entire application shell.

### Global Date Filtering
Located at the top-right of the header bar, the date filter controls the time window for **all** modules simultaneously.
- **Preset Chips**: One-click toggles for `Today`, `7D` (last 7 days), `30D` (last 30 days), and `90D` (last quarter).
- **Custom Range**: Click the date bar to open the calendar dialog and pick exact `From` and `To` boundaries.
- **Clear Filter**: Click the `✕` button to reset to the default view ("All time").

### Multi-Format Document Export
Every primary data view features an **Export** dropdown button offering instant client-side downloads branded with platform styling:
- 📊 **Excel (`.xlsx`)**: Full raw tabular datasets with formula-ready numbers and dates.
- 📄 **Word (`.docx`)**: Formal reports ready for distribution and archiving.
- 📑 **PDF (`.pdf`)**: Formatted executive summaries and printable logs.
- 📽️ **PowerPoint (`.pptx`)**: Presentation-ready summary decks for briefings.

### Real-Time Notification Center
- The bell icon in the top header indicates pending updates. A red dot appears when there are unread items.
- Receives live WebSocket alerts for critical events: overdue tasks, emergency maintenance logs, stock alerts below minimum thresholds, and new assignments.
- Click any notification to open its detail view or mark items as read.

### User Profile & Session Controls
- **Sidebar Footer**: Displays your active name, avatar, and assigned role (`Admin`, `Manager`, `Tech`, or `Viewer`). Click to view or update your profile and password.
- **Sign Out**: The logout icon in the header cleanly terminates your session and invalidates access tokens.

---

## 3. Section-by-Section Guide

### 1. Dashboard
**Route:** `/dashboard`  
**Purpose:** Real-time operational overview and high-level health metrics.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **KPI Metrics Cards** | View live counts for Active Operations, Pending Maintenance, Low Stock Items, Open Tasks, and Registered Users. |
| **Urgent Action Center** | Instant alerts on three critical categories: **Overdue Tasks**, **Critical Maintenance**, and **Out-of-Stock Inventory**. Click any alert to jump directly to the item. |
| **Telemetry Charts** | Interactive Chart.js graphs displaying daily sortie volumes, maintenance breakdown by status, and resource distribution over your chosen date range. |
| **Executive Export** | Click **Export** to generate a complete multi-format executive summary report. |

---

### 2. Operations & Sorties
**Route:** `/operations`  
**Purpose:** Plan, coordinate, and track field missions, deployments, and technical sorties.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **Sortie Lifecycle** | Track operations across 5 standard states: `PLANNED` ➔ `IN_PROGRESS` ➔ `COMPLETED` (or `ON_HOLD` / `CANCELLED`). |
| **Priority Matrix** | Assign urgency: `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` with visual status badges. |
| **Operation Details** | Record sortie title, description, category/type, assigned leader, deployment location, scheduled start date, and completion date. |
| **Search & Filtering** | Search by keyword; filter by status, priority, or custom date window. |
| **Data Export** | Export the current filtered list of sorties to Excel, Word, or PDF for mission briefings. |

---

### 3. Maintenance
**Route:** `/maintenance`  
**Purpose:** Ensure equipment readiness, log repairs, and manage preventive recurring schedules.

#### A. Maintenance Records (Work Orders & Logs)
- **Maintenance Classifications**: Log work under `PREVENTIVE`, `CORRECTIVE`, `PREDICTIVE`, `UPGRADE`, or `INSPECTION`.
- **Status Lifecycle**: Manage orders through `SCHEDULED` ➔ `IN_PROGRESS` ➔ `COMPLETED` (or `DEFERRED` / `FAILED`).
- **Audit Detail**: Track hardware asset ID, assigned technician, downtime duration (in hours), financial costs, spare parts consumed, and technical findings.
- **Asset Health**: View warranty expiration dates, serial numbers, and physical location for every piece of gear.

#### B. Planned Maintenance (Recurring Tasks & Calendar)
- **Recurrence Engine**: Create routines repeating by `DAY`, `WEEK`, or `MONTH` with customizable intervals.
- **Calendar Visualization**: Monthly interactive calendar featuring color-coded indicator dots showing scheduled task density.
- **Master vs. Instance Overrides**: Complete single occurrences without breaking the recurring master schedule.
- **Checklist Generation**: Link tasks to standard operating templates and download compliance reports.

---

### 4. Warehouse & Inventory
**Route:** `/warehouse`  
**Purpose:** Manage asset catalogs, monitor stock levels, and audit item movements.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **Item Master Catalog** | Track items by SKU, internal part number, category, description, unit of measure, unit cost, and preferred supplier. |
| **Stock Health & Reordering** | Automatic flags highlight items falling below their `Min Stock` or reaching their `Reorder Point`. |
| **Audited Movements** | Log physical movements across 5 audited types:<br>• `IN`: Supplier receipts and restocks<br>• `OUT`: Issuing parts to operations or maintenance<br>• `TRANSFER`: Moving stock between storage locations<br>• `ADJUSTMENT`: Reconciliations from physical cycle counts<br>• `RETURN`: Returned unused components |
| **Movement History** | Full chronological ledger showing quantity delta, remaining balance after transaction, timestamp, and responsible user. |

---

### 5. Shift Management
**Route:** `/shifts`  
**Purpose:** Organize workforce rotations, schedule team duty rosters, and track attendance.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **Weekly Grid View** | Interactive calendar grid displaying scheduled shifts across all days of the week for all personnel. |
| **Shift Types & Badges** | Configurable shift archetypes (e.g., Morning, Evening, Night, Standby) with standard start and end hours and color codes. |
| **Time Tracking & Overtime** | Record employee clock-in and clock-out timestamps; track accrued overtime hours automatically. |
| **Shift Statuses** | Update status from `SCHEDULED` to `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `ABSENT`, or `SWAPPED`. |

---

### 6. Analytics & Intelligence
**Route:** `/analytics` & `/analytics/operations`  
**Purpose:** High-level operational intelligence, trend discovery, and performance metrics.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **System-Wide Analytics** | Dedicated visualizations covering:<br>• Operational tempo and mission success rates<br>• Equipment reliability and downtime breakdown by asset<br>• Inventory turnover rates and consumption velocity<br>• Shift coverage and overtime distributions |
| **Operations Analytics** | Dedicated sub-dashboard (`/analytics/operations`) drilling into sortie completion duration, priority distribution, and location trends. |
| **Dynamic Date Slicing** | All charts react directly to the global date picker for historical comparison. |

---

### 7. Task Manager
**Route:** `/tasks`  
**Purpose:** Actionable task tracking with Kanban workflows and nested subtask structures.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **Dual View Modes** | Switch seamlessly between an interactive **Kanban Board** (`TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`) and a structured **List View**. |
| **Recursive Subtasks** | Break down complex parent tasks into nested checklist items with independent progress tracking. |
| **Interval Recurrence** | Set task recurrence: `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY`. |
| **Work Tracking** | Assign owners, due dates, estimated vs. actual logged hours, tags, and priority ratings. |

---

### 8. Wiki & Documentation
**Route:** `/wiki`  
**Purpose:** Centralized knowledge base, technical SOPs (Standard Operating Procedures), and manuals.

| Feature Area | Capabilities & User Actions |
| :--- | :--- |
| **Category Hierarchy** | Organize articles in a parent-child category tree with custom icons for fast navigation. |
| **Rich Markdown Editor** | Write and format technical guides with markdown, code snippets, checklists, and embedded media. |
| **Article Governance** | Manage article lifecycles (`DRAFT` ➔ `REVIEW` ➔ `PUBLISHED` ➔ `ARCHIVED`). |
| **Discovery** | Search articles by keyword or tag, view total read counts, and pin essential SOPs to the top. |
| **Article Export** | Export any individual SOP or document to clean Word (`.docx`) or PDF formats. |

---

### 9. Admin Settings
**Route:** `/admin` *(Accessible to `admin` and authorized roles)*  
**Purpose:** System administration, security governance, and reference data configuration.

| Tab | Capabilities & Actions |
| :--- | :--- |
| **System Overview** | Inspect server environment status, database health, uptime, and active connection metrics. |
| **User Directory** | View and manage all platform user accounts, create new credentials, modify email/department/title, assign roles, toggle active status, and perform secure password resets. |
| **Section Access** | Customize sidebar navigation visibility and role-based permissions per module for each role. |
| **Operation Types** | Add, edit, and color-code mission types and their associated icons. |
| **Shift Types** | Configure work shift blocks, default timings, and visual badge colors. |
| **Categories & Locations** | Manage lookup tables for Asset Categories, Inventory Item Categories, Wiki Categories, and Warehouse Storage Locations. |

---

## 4. Roles & Permissions Matrix

SMaRT enforces role-based access control (RBAC). Default permissions by role:

| Module / Feature | Admin | Manager | Tech | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| **Dashboard** | Full Access | Full Access | Full Access | View Only |
| **Operations & Sorties** | Full (CRUD) | Full (CRUD) | View & Update Status | View Only |
| **Maintenance Records** | Full (CRUD) | Full (CRUD) | Log & Update Work | View Only |
| **Planned Maintenance** | Full (CRUD) | Full (CRUD) | Mark Tasks Done | View Only |
| **Warehouse Inventory** | Full (CRUD) | Full (CRUD) | Log Stock Movements | View Only |
| **Shift Scheduling** | Full (CRUD) | Full (CRUD) | View & Clock In/Out | View Only |
| **Analytics & Reports** | Full Access | Full Access | View Only | View Only |
| **Task Manager** | Full (CRUD) | Full (CRUD) | Full (CRUD) | View Only |
| **Wiki & Docs** | Full (CRUD) | Full (CRUD) | Create & Edit | Read Only |
| **Admin Settings** | Full Access | Restricted | No Access | No Access |
| **Multi-Format Export** | Enabled | Enabled | Enabled | Enabled |

> *Note: Module visibility can be customized on a per-role basis in **Admin Settings ➔ Section Access**.*

---

## 5. Quick Tips for New Users

1. **Start with the Date Filter**: If a table appears empty, check the date range in the top-right header. Setting it to `All time` or `30D` ensures recent records are displayed.
2. **Use Keyboard & Fast Clicks**:
   - In **Tasks**, drag and drop Kanban cards between columns to update status instantly.
   - In **Wiki**, use tag chips to filter related documentation across categories.
3. **Keep Spare Parts Logged**: When completing a maintenance task, always log consumed items from the inventory dropdown to ensure warehouse stock levels stay accurate automatically.
4. **Export for Meetings**: Don't waste time formatting spreadsheets. Use the **Export ➔ PowerPoint** or **PDF** options in Operations or Analytics before briefings.
5. **Need Help?**: Visit the **Wiki & Docs** section (`/wiki`) for official Standard Operating Procedures and operational checklists.
