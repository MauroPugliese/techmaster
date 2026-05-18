// =============================================================================
// shared/components/toast/toast.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ToastService, Toast } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div style="position:fixed;bottom:24px;right:24px;z-index:9999;
            display:flex;flex-direction:column;gap:10px;pointer-events:none">

  <div *ngFor="let t of toasts; trackBy: trackById"
       style="pointer-events:all;min-width:300px;max-width:380px;
              border-radius:12px;padding:14px 16px;
              display:flex;align-items:flex-start;gap:12px;
              box-shadow:0 8px 32px rgba(0,0,0,0.18);
              animation:slideInRight 0.3s cubic-bezier(0.34,1.56,0.64,1)"
       [style.background]="bgColor(t.type)"
       [style.border-left]="'4px solid ' + accentColor(t.type)">

    <!-- Icon -->
    <span style="font-family:'Material Icons Round';font-style:normal;font-size:22px;flex-shrink:0;margin-top:1px"
          [style.color]="accentColor(t.type)">
      {{icon(t.type)}}
    </span>

    <!-- Text -->
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:0.875rem;color:#1F2937;margin-bottom:2px">{{t.title}}</div>
      <div style="font-size:0.8rem;color:#4B5563;line-height:1.4">{{t.message}}</div>
    </div>

    <!-- Dismiss -->
    <button (click)="toast.dismiss(t.id)"
            style="background:none;border:none;cursor:pointer;padding:2px;
                   color:#9CA3AF;font-family:'Material Icons Round';
                   font-style:normal;font-size:18px;flex-shrink:0;line-height:1">
      close
    </button>
  </div>

</div>

<style>
@keyframes slideInRight {
  from { transform: translateX(110%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
</style>
  `
})
export class ToastComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  toasts: Toast[] = [];

  constructor(public toast: ToastService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.toast.toasts$.pipe(takeUntil(this.destroy$)).subscribe(ts => {
      this.toasts = ts;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  trackById(_: number, t: Toast): number { return t.id; }

  bgColor(type: Toast['type']): string {
    return { success: '#F0FDF4', error: '#FEF2F2', info: '#EFF6FF', warning: '#FFFBEB' }[type];
  }

  accentColor(type: Toast['type']): string {
    return { success: '#16A34A', error: '#DC2626', info: '#2563EB', warning: '#D97706' }[type];
  }

  icon(type: Toast['type']): string {
    return { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' }[type];
  }
}
