// =============================================================================
// core/services/confirm.service.ts
// =============================================================================
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface ConfirmRequest {
  message:  string;
  title?:   string;
  danger?:  boolean;
  resolve:  (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request$ = new Subject<ConfirmRequest>();

  confirm(message: string, title = 'Are you sure?', danger = true): Promise<boolean> {
    return new Promise(resolve => {
      this.request$.next({ message, title, danger, resolve });
    });
  }
}
