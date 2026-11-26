// =============================================================================
// maintenance.routes.ts — Feature routes for Unified Maintenance & Planned Views
// =============================================================================
import { Routes } from '@angular/router';
import { MaintenanceComponent } from './maintenance.component';
import { PlannedMaintenanceDashboardComponent } from './planned/planned-maintenance-dashboard.component';

export const MAINTENANCE_ROUTES: Routes = [
  { path: '', component: MaintenanceComponent, data: { defaultTab: 'work-orders' } },
  { path: 'planned', component: PlannedMaintenanceDashboardComponent }
];

export default MAINTENANCE_ROUTES;
