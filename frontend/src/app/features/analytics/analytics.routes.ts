import { Routes } from '@angular/router';

export const ANALYTICS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./analytics.component').then(m => m.AnalyticsComponent)
  },
  {
    path: 'operations',
    loadComponent: () => import('../operations-analytics/operations-analytics.component').then(m => m.OperationsAnalyticsComponent)
  }
];