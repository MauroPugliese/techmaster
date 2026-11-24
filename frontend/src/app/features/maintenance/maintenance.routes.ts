// =============================================================================
// maintenance.routes.ts — Feature routes for Unified Maintenance & Planned Views
// =============================================================================
import { Routes } from '@angular/router';
import { MaintenanceComponent } from './maintenance.component';

export const MAINTENANCE_ROUTES: Routes = [
  { path: '', component: MaintenanceComponent, data: { defaultTab: 'work-orders' } },
  { path: 'planned', component: MaintenanceComponent, data: { defaultTab: 'planned' } }
];

export default MAINTENANCE_ROUTES;
