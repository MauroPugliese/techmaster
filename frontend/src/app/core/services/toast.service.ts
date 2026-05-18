// =============================================================================
// core/services/toast.service.ts
// =============================================================================
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Toast {
  id:      number;
  type:    'success' | 'error' | 'info' | 'warning';
  title:   string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private counter = 0;
  private _toasts = new BehaviorSubject<Toast[]>([]);
  toasts$ = this._toasts.asObservable();

  success(message: string, title = 'Success')  { this._add('success', title, message); }
  error(message: string,   title = 'Error')    { this._add('error',   title, message); }
  info(message: string,    title = 'Info')     { this._add('info',    title, message); }
  warning(message: string, title = 'Warning')  { this._add('warning', title, message); }

  dismiss(id: number): void {
    this._toasts.next(this._toasts.value.filter(t => t.id !== id));
  }

  private _add(type: Toast['type'], title: string, message: string): void {
    const id = ++this.counter;
    this._toasts.next([...this._toasts.value, { id, type, title, message }]);
    setTimeout(() => this.dismiss(id), 4500);
  }
}
