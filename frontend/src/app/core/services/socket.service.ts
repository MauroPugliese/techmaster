import { Injectable, Injector } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Notification } from '../models/interfaces';
import { AuthService } from './auth.service';

export interface DomainUpdateEvent {
  domain: string;
  action?: string;
  simulatorId?: number;
  entityId?: number;
  date?: string;
  stationKind?: string;
  actorId?: number | null;
  timestamp?: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private notificationsSubject = new Subject<Notification>();
  notifications$ = this.notificationsSubject.asObservable();

  private domainUpdatesSubject = new Subject<DomainUpdateEvent>();
  domainUpdates$ = this.domainUpdatesSubject.asObservable();

  private refreshingForSocket = false;
  private authRetryCount = 0;
  private readonly MAX_AUTH_RETRIES = 2;

  constructor(private injector: Injector) {}

  connect(token?: string | null): void {
    const resolveToken = () => localStorage.getItem('access_token') || token || '';
    const initialToken = resolveToken();
    if (!initialToken) return;

    if (this.socket?.connected) return;
    if (this.socket) {
      this.disconnect();
    }

    const apiUrl = environment.apiUrl || '';
    let socketBaseUrl = '';

    // Absolute API URL (e.g. http://localhost:3000/api)
    if (/^https?:\/\//i.test(apiUrl)) {
      socketBaseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;
    } else {
      // Relative API URL (/api) or unresolved placeholder: use same-origin host.
      socketBaseUrl = window.location.origin;
    }

    this.socket = io(socketBaseUrl || undefined, {
      auth: (cb) => cb({ token: resolveToken() }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000
    });

    this.socket.on('connect', () => {
      this.authRetryCount = 0;
    });

    this.socket.on('notification', (payload: Notification) => {
      this.notificationsSubject.next(payload);
    });

    this.socket.on('domain:updated', (payload: DomainUpdateEvent) => {
      this.domainUpdatesSubject.next(payload);
    });

    this.socket.on('connect_error', (err: Error) => {
      const msg = String(err?.message || '');
      const isAuthErr = /authentication error|expired|invalid.*token/i.test(msg);
      if (!isAuthErr || this.refreshingForSocket) return;

      const refreshTok = localStorage.getItem('refresh_token');
      if (!refreshTok || this.authRetryCount >= this.MAX_AUTH_RETRIES) {
        this.disconnect();
        return;
      }

      this.refreshingForSocket = true;
      this.authRetryCount += 1;
      const auth = this.injector.get(AuthService);
      auth.refreshToken().subscribe({
        next: () => {
          this.refreshingForSocket = false;
        },
        error: () => {
          this.refreshingForSocket = false;
          this.disconnect();
        }
      });
    });
  }

  reconnectWithFreshToken(): void {
    const freshToken = localStorage.getItem('access_token');
    if (!freshToken) return;
    this.authRetryCount = 0;
    this.disconnect();
    this.connect(freshToken);
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }
}
