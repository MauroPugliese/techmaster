import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { sectionAccessGuard } from './core/guards/section-access.guard';
import { authInterceptor } from './core/interceptors/auth.interceptor';

const appRoutes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  {
    path: 'auth',
    children: [
      { path: 'login',    loadComponent: () => import('./features/auth/auth.component').then(m => m.LoginComponent) },
      { path: 'register', loadComponent: () => import('./features/auth/auth.component').then(m => m.RegisterComponent) },
      { path: '',         redirectTo: 'login', pathMatch: 'full' }
    ]
  },
  {
    path: '',
    loadComponent: () => import('./shared/components/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'admin',
        loadComponent: () => import('./features/admin/admin.component').then(m => m.AdminComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'admin' }
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'dashboard' }
      },
      {
        path: 'operations',
        loadComponent: () => import('./features/operations/operations.component').then(m => m.OperationsComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'operations' }
      },
      {
        path: 'maintenance',
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'maintenance' },
        children: [
          { path: '',        loadComponent: () => import('./features/maintenance/maintenance.component').then(m => m.MaintenanceComponent) },
          { path: 'planned', loadComponent: () => import('./features/maintenance/planned/planned-maintenance-dashboard.component').then(m => m.PlannedMaintenanceDashboardComponent) }
        ]
      },
      {
        path: 'warehouse',
        loadComponent: () => import('./features/warehouse/warehouse.component').then(m => m.WarehouseComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'warehouse' }
      },
      {
        path: 'shifts',
        loadComponent: () => import('./features/shifts/shifts.component').then(m => m.ShiftsComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'shifts' }
      },
      {
        path: 'analytics/operations',
        loadComponent: () => import('./features/operations-analytics/operations-analytics.component').then(m => m.OperationsAnalyticsComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'operations_analytics' }
      },
      {
        path: 'analytics',
        loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'analytics' }
      },
      {
        path: 'tasks',
        loadComponent: () => import('./features/tasks/tasks.component').then(m => m.TasksComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'tasks' }
      },
      {
        path: 'wiki',
        loadComponent: () => import('./features/wiki/wiki.component').then(m => m.WikiComponent),
        canActivate: [sectionAccessGuard],
        data: { sectionKey: 'wiki' }
      },
    ]
  },
  { path: '**', redirectTo: '/dashboard' }
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimations(),
  ]
};