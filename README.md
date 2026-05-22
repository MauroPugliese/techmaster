# SMaRT Platform — Full Technical Documentation

## Architecture Overview

```
smart/
├── database/
│   └── schema.sql              ← Complete MySQL schema + seed data
├── backend/                    ← Node.js + Express REST API
│   ├── src/
│   │   ├── server.js           ← Entry point, DB bootstrap
│   │   ├── app.js              ← Express config, CORS, rate limiting
│   │   ├── config/
│   │   │   ├── database.js     ← Sequelize + MySQL connection
│   │   │   └── logger.js       ← Winston logger
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js    ← JWT verify + role guard
│   │   │   └── error.middleware.js  ← Global error handler + parseDateFilter
│   │   ├── models/
│   │   │   └── index.js        ← All Sequelize models + associations
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   └── dashboard.controller.js
│   │   └── routes/
│   │       ├── auth.routes.js
│   │       ├── dashboard.routes.js
│   │       ├── operation.routes.js
│   │       ├── maintenance.routes.js
│   │       ├── warehouse.routes.js
│   │       ├── shift.routes.js
│   │       ├── task.routes.js
│   │       ├── wiki.routes.js
│   │       ├── analytics.routes.js
│   │       └── user.routes.js
└── frontend/                   ← Angular 17+ standalone components
    └── src/app/
        ├── core/
        │   ├── models/interfaces.ts    ← All TypeScript interfaces
        │   ├── services/services.ts    ← AuthService, ApiService, DateFilterService
        │   ├── interceptors/           ← JWT auth interceptor
        │   └── guards/                 ← authGuard
        ├── shared/components/
        │   └── shell/                  ← App shell (sidebar + header)
        └── features/
            ├── auth/                   ← Login + Register
            ├── dashboard/              ← KPIs + Charts (Chart.js)
            ├── operations/             ← CRUD + filters
            ├── maintenance/            ← Maintenance logs
            ├── warehouse/              ← Inventory + stock movements
            ├── shifts/                 ← Weekly calendar view
            ├── analytics/              ← 6 Chart.js visualizations
            ├── wiki/                   ← Article CRUD + category tree
            └── tasks/                  ← Kanban board + recursive subtasks
```

---

## ⚙️ Quick Setup

> Sensitive configuration values are stored in `.env` and should never be committed. A sample file is provided in `.env.example`.

### 1 — Database
```bash
mysql -u root -p < database/schema.sql
```

### 2 — Backend
```bash
cd backend
npm install
cp .env.example .env       # Edit DB credentials & JWT secrets
npm run dev                 # Starts on http://localhost:3000
```

### 3 — Frontend
```bash
# Requires Node.js 18+ and Angular CLI 17+
npm install -g @angular/cli
cd frontend
ng new smart-frontend --routing --style=scss --standalone
# Copy src files into the new project
npm install chart.js
ng serve                    # Starts on http://localhost:4200
```

---

## 🔑 API Authentication

All protected routes require a JWT Bearer token:

```http
Authorization: Bearer <access_token>
```

### Auth Endpoints
```
POST /api/auth/register   → { username, email, password, first_name, last_name }
POST /api/auth/login      → { email, password }  → { access_token, refresh_token, user }
POST /api/auth/refresh    → { refresh_token }     → { access_token, refresh_token }
GET  /api/auth/me         → Current user profile
PUT  /api/auth/profile    → Update profile / change password
```

---

## 📅 DATE FILTERING ARCHITECTURE — Detailed Explanation

This is one of the most important cross-cutting features of the platform.

### The Pattern: Global Date State → HTTP Params → SQL WHERE

```
User selects date range in Header
        ↓
DateFilterService.setRange({ from: Date, to: Date })
        ↓
Components subscribe to range$ Observable
        ↓
ApiService.buildParams() appends ?from=ISO&to=ISO to every request
        ↓
parseDateFilter middleware parses query params → req.dateRange
        ↓
Route handlers apply date conditions to Sequelize WHERE clauses
```

---

### Step 1: Global Angular State — DateFilterService

```typescript
// core/services/date-filter.service.ts
@Injectable({ providedIn: 'root' })
export class DateFilterService {
  private rangeSubject = new BehaviorSubject<DateRange>({ from: null, to: null });
  range$ = this.rangeSubject.asObservable();

  setRange(range: DateRange): void {
    this.rangeSubject.next(range);
  }
}
```

This is a **singleton** — one date range controls ALL modules simultaneously.

---

### Step 2: Shell Component triggers global updates

```typescript
// In shell.component.ts (the layout wrapper)
setPreset(preset: 'today' | 'week' | 'month' | 'quarter'): void {
  this.dateFilter.setPreset(preset);  // Updates BehaviorSubject
}

applyDatePicker(): void {
  this.dateFilter.setRange({
    from: new Date(this.pickerFrom),
    to:   new Date(this.pickerTo)
  });
}
```

---

### Step 3: Every component reacts reactively

```typescript
// In any feature component (e.g., OperationsComponent)
ngOnInit(): void {
  this.dateFilter.range$.pipe(
    takeUntil(this.destroy$),
    switchMap(range => {                    // cancel previous, load new
      this.loading = true;
      return this.api.get('/operations', {}, range);  // range passed to API
    })
  ).subscribe(res => { this.operations = res.data.items; });
}
```

**Key RxJS pattern**: `switchMap` cancels any in-flight HTTP request and fires a new one every time the date range changes — zero stale data.

---

### Step 4: ApiService appends date params to every HTTP request

```typescript
// core/services/api.service.ts
buildParams(extra: Record<string, any> = {}, dateRange?: DateRange): HttpParams {
  let params = new HttpParams();
  const range = dateRange ?? this.dateFilter.currentRange;  // fallback to global

  // Dates serialized as ISO 8601 strings
  if (range.from) params = params.set('from', range.from.toISOString());
  if (range.to)   params = params.set('to',   range.to.toISOString());

  // Merge any extra query params (status, page, etc.)
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
  });
  return params;
}
```

The resulting request looks like:
```
GET /api/operations?from=2024-01-01T00:00:00.000Z&to=2024-03-31T23:59:59.999Z&status=COMPLETED&page=1
```

Alternatively, the frontend can also send headers for date range:
```
X-Date-From: 2024-01-01T00:00:00.000Z
X-Date-To:   2024-03-31T23:59:59.999Z
```

---

### Step 5: Backend middleware parses the dates

```javascript
// middleware/error.middleware.js → parseDateFilter
const parseDateFilter = (req, res, next) => {
  // Accept BOTH headers and query params (headers take priority)
  const from = req.headers['x-date-from'] || req.query.from;
  const to   = req.headers['x-date-to']   || req.query.to;

  req.dateRange = {
    from: from ? new Date(from) : null,
    to:   to   ? new Date(to)   : null
  };

  // Validate: reject malformed dates immediately
  if (req.dateRange.from && isNaN(req.dateRange.from)) {
    return res.status(400).json({ success: false, message: 'Invalid date_from format' });
  }
  next();
};
```

---

### Step 6: Route handlers apply the date conditions

```javascript
// routes/operation.routes.js
router.get('/', parseDateFilter, async (req, res) => {
  const { from, to } = req.dateRange;
  const where = {};

  // Only add date condition if dates were provided
  if (from || to) {
    where.start_date = {};
    if (from) where.start_date[Op.gte] = from;  // >= from
    if (to)   where.start_date[Op.lte] = to;    // <= to
  }

  // Merge with other filters
  if (req.query.status)   where.status   = req.query.status;
  if (req.query.priority) where.priority = req.query.priority;

  const { count, rows } = await Operation.findAndCountAll({
    where,
    limit: +req.query.limit || 20,
    offset: ((+req.query.page || 1) - 1) * (+req.query.limit || 20),
    order: [['start_date', 'DESC']]
  });

  res.json({ success: true, data: { items: rows, total: count } });
});
```

---

### Date Filter Columns Per Module

| Module       | Filtered Column      | SQL Condition |
|--------------|----------------------|---------------|
| Operations   | `start_date`         | `BETWEEN from AND to` |
| Maintenance  | `scheduled_date`     | `>= from AND <= to` |
| Warehouse    | `movement_date`      | (stock movements) |
| Shifts       | `date` (DATE type)   | `>= from AND <= to` |
| Tasks        | `due_date`           | `>= from AND <= to` |
| Wiki         | `published_at`       | `>= from AND <= to` |
| Analytics    | Various (per query)  | Injected in raw SQL |
| Dashboard    | `created_at`         | All KPI queries |

---

## 📊 Chart.js Integration

Each chart is initialized in `ngAfterViewInit()` and updated in a subscription to `dateFilter.range$`:

```typescript
// Pattern used in analytics.component.ts and dashboard.component.ts
ngAfterViewInit(): void {
  this.initCharts();  // Create Chart instances with empty data
}

ngOnInit(): void {
  this.dateFilter.range$.pipe(
    takeUntil(this.destroy$),
    switchMap(range => this.fetchAnalyticsData(range))
  ).subscribe(data => {
    this.updateCharts(data);  // Pump new data into existing Chart instances
    this.cdr.markForCheck();
  });
}

private updateCharts(data: any): void {
  if (!this.myChart) return;
  this.myChart.data.labels   = data.labels;
  this.myChart.data.datasets = data.datasets;
  this.myChart.update('active');  // Animate the transition
}

ngOnDestroy(): void {
  this.myChart?.destroy();  // CRITICAL: prevent memory leaks
}
```

---

## 🎨 Design System

### Color Tokens
```scss
--primary:      #1565C0  /* Main blue */
--accent:       #00B0FF  /* Highlight blue */
--background:   #F0F4F8  /* Page background */
--surface:      #FFFFFF  /* Cards */
--border:       #E1EAF5  /* Subtle borders */
```

### Status Badge Classes
```html
<span class="badge badge-planned">Planned</span>
<span class="badge badge-in-progress">In Progress</span>
<span class="badge badge-completed">Completed</span>
<span class="badge badge-cancelled">Cancelled</span>
<span class="badge badge-low">Low Priority</span>
<span class="badge badge-critical">Critical</span>
```

### Typography
- **Display/Headings**: Plus Jakarta Sans (800, 700, 600)
- **Body**: Plus Jakarta Sans (400, 500)
- **Code/Mono**: JetBrains Mono (400, 500)

---

## 🔒 Security Features

1. **JWT Access Tokens** (15 min expiry) + **Refresh Tokens** (7 days)
2. **bcrypt password hashing** (12 salt rounds)
3. **Rate limiting** — global (500 req/15min) + auth endpoints (20 req/15min)
4. **Helmet.js** — security headers (CSP, HSTS, XSS protection)
5. **CORS whitelist** — only accepts requests from the Angular frontend URL
6. **Role-based access control** — `authorize('admin', 'manager')` middleware
7. **Input validation** — express-validator on auth routes
8. **SQL injection prevention** — Sequelize parameterized queries

---

## 📦 Production Deployment Checklist

```bash
# Backend
NODE_ENV=production
JWT_SECRET=<256-bit-random-string>
JWT_REFRESH_SECRET=<different-256-bit-string>
DB_PASSWORD=<strong-password>

# Frontend
ng build --configuration production
# Deploy dist/ to CDN or static host
# Set FRONTEND_URL in backend .env to production domain
```

