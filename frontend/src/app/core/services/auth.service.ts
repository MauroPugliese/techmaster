import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, AuthTokens, LoginPayload, RegisterPayload, ApiResponse } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(this.loadUser());
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {}

  get currentUser(): User | null { return this.currentUserSubject.value; }
  get isAuthenticated(): boolean  { return !!this.getAccessToken(); }

  login(payload: LoginPayload): Observable<ApiResponse<{ user: User } & AuthTokens>> {
    return this.http.post<any>(`${this.API}/login`, payload).pipe(
      tap(res => { this.storeSession(res.data.user, res.data.access_token, res.data.refresh_token); })
    );
  }

  register(payload: RegisterPayload): Observable<any> {
    return this.http.post<any>(`${this.API}/register`, payload).pipe(
      tap(res => { this.storeSession(res.data.user, res.data.access_token, res.data.refresh_token); })
    );
  }

  refreshToken(): Observable<any> {
    const refresh = localStorage.getItem('refresh_token');
    return this.http.post<any>(`${this.API}/refresh`, { refresh_token: refresh }).pipe(
      tap(res => {
        localStorage.setItem('access_token', res.data.access_token);
        localStorage.setItem('refresh_token', res.data.refresh_token);
      })
    );
  }

  logout(): void {
    this.http.post(`${this.API}/logout`, {}).subscribe();
    localStorage.clear();
    this.currentUserSubject.next(null);
    this.router.navigate(['/auth/login']);
  }

  updateProfile(data: Partial<User>): Observable<any> {
    return this.http.put<any>(`${this.API}/profile`, data).pipe(
      tap(res => {
        const updated = { ...this.currentUser, ...res.data };
        this.currentUserSubject.next(updated as User);
        localStorage.setItem('user', JSON.stringify(updated));
      })
    );
  }

  getAccessToken(): string | null { return localStorage.getItem('access_token'); }

  hasRole(...roles: string[]): boolean {
    return roles.includes(this.currentUser?.role?.name || '');
  }

  private storeSession(user: User, access: string, refresh: string): void {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    localStorage.setItem('user', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  private loadUser(): User | null {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  }
}
