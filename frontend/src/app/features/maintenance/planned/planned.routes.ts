// =============================================================================
// planned.routes.ts — Lazy-loaded routes for Planned Maintenance
// =============================================================================
import { Routes } from '@angular/router';
import { PlannedMaintenanceDashboardComponent } from './planned-maintenance-dashboard.component';

export const PLANNED_ROUTES: Routes = [
  { path: '', component: PlannedMaintenanceDashboardComponent }
];

export default PLANNED_ROUTES;