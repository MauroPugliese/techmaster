// =============================================================================
// ANGULAR PROJECT STRUCTURE
// ng new smart-frontend --routing --style=scss
// ng add @angular/material
// npm install chart.js ng2-charts date-fns
//
// src/
// ├── app/
// │   ├── core/
// │   │   ├── guards/         auth.guard.ts, role.guard.ts
// │   │   ├── interceptors/   auth.interceptor.ts, date-filter.interceptor.ts
// │   │   ├── services/       auth.service.ts, api.service.ts, date-filter.service.ts
// │   │   └── models/         interfaces.ts
// │   ├── shared/
// │   │   ├── components/     header, sidebar, kpi-card, date-range-picker, data-table
// │   │   └── pipes/          status-color.pipe.ts, priority.pipe.ts
// │   └── features/
// │       ├── auth/           login, register
// │       ├── dashboard/
// │       ├── operations/
// │       ├── maintenance/
// │       ├── warehouse/
// │       ├── shifts/
// │       ├── analytics/
// │       ├── wiki/
// │       └── tasks/
// └── environments/
// =============================================================================

// app/app.routes.ts
export const routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'auth', loadChildren: () => import('./features/auth/auth.routes') },
  {
    path: '',
    component: 'ShellComponent',  // layout with sidebar
    canActivate: ['AuthGuard'],
    children: [
      { path: 'dashboard',    loadChildren: () => import('./features/dashboard/dashboard.routes') },
      { path: 'operations',   loadChildren: () => import('./features/operations/operations.routes') },
      { path: 'maintenance',  loadChildren: () => import('./features/maintenance/maintenance.routes') },
      { path: 'warehouse',    loadChildren: () => import('./features/warehouse/warehouse.routes') },
      { path: 'shifts',       loadChildren: () => import('./features/shifts/shifts.routes') },
      { path: 'analytics',    loadChildren: () => import('./features/analytics/analytics.routes').then(m => m.ANALYTICS_ROUTES) },
      { path: 'wiki',         loadChildren: () => import('./features/wiki/wiki.routes') },
      { path: 'tasks',        loadChildren: () => import('./features/tasks/tasks.routes') }
    ]
  },
  { path: '**', redirectTo: '/dashboard' }
];
