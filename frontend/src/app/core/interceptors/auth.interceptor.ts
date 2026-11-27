import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, finalize, switchMap, take, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

interface RefreshState {
  status: 'idle' | 'pending' | 'success' | 'failed';
  token: string | null;
}

let isRefreshing = false;
const refreshState$ = new BehaviorSubject<RefreshState>({ status: 'idle', token: null });

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getAccessToken();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthCredentialEndpoint = /\/auth\/(login|register|refresh|logout)\b/.test(req.url);
      if (err.status !== 401 || isAuthCredentialEndpoint) {
        return throwError(() => err);
      }

      if (isRefreshing) {
        return refreshState$.pipe(
          filter((state) => state.status !== 'pending'),
          take(1),
          switchMap((state) => {
            if (state.status === 'success' && state.token) {
              return next(req.clone({ setHeaders: { Authorization: `Bearer ${state.token}` } }));
            }
            return throwError(() => err);
          })
        );
      }

      if (!localStorage.getItem('refresh_token')) {
        auth.logout();
        return throwError(() => err);
      }

      isRefreshing = true;
      let settled = false;
      refreshState$.next({ status: 'pending', token: null });

      return auth.refreshToken().pipe(
        switchMap((res: any) => {
          const newToken = res?.data?.access_token || auth.getAccessToken();
          if (!newToken) {
            settled = true;
            refreshState$.next({ status: 'failed', token: null });
            auth.logout();
            return throwError(() => err);
          }
          settled = true;
          refreshState$.next({ status: 'success', token: newToken });
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }));
        }),
        catchError((refreshErr) => {
          settled = true;
          refreshState$.next({ status: 'failed', token: null });
          auth.logout();
          return throwError(() => refreshErr);
        }),
        finalize(() => {
          isRefreshing = false;
          if (!settled) {
            refreshState$.next({ status: 'failed', token: null });
          }
        })
      );
    })
  );
};
