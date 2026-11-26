import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated) return true;
  const returnUrl = state.url && state.url !== '/auth/login' ? state.url : undefined;
  return router.createUrlTree(['/auth/login'], returnUrl ? { queryParams: { returnUrl } } : undefined);
};
