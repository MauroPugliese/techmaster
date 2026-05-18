// =============================================================================
// maintenance.routes.ts — Feature routes for Maintenance
// =============================================================================
import { Routes } from '@angular/router';
import { MaintenanceComponent } from './maintenance.component';

export const MAINTENANCE_ROUTES: Routes = [
  { path: '',        component: MaintenanceComponent },
  { path: 'planned', loadChildren: () => import('./planned/planned.routes') }
];

export default MAINTENANCE_ROUTES;