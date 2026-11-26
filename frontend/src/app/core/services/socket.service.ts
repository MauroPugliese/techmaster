import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Notification } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private notificationsSubject = new Subject<Notification>();
  notifications$ = this.notificationsSubject.asObservable();

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
      transports: ['websocket', 'polling']
    });

    this.socket.on('notification', (payload: Notification) => {
      this.notificationsSubject.next(payload);
    });
  }

  reconnectWithFreshToken(): void {
    const freshToken = localStorage.getItem('access_token');
    if (!freshToken) return;
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
