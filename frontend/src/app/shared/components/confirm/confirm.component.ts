// =============================================================================
// shared/components/confirm/confirm.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ConfirmService, ConfirmRequest } from '../../../core/services/confirm.service';

@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="modal-overlay" *ngIf="current" (click)="answer(false)">
  <div class="modal" style="max-width:400px" (click)="$event.stopPropagation()">

    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:22px"
              [style.color]="current.danger ? '#EF4444' : '#1565C0'">
          {{current.danger ? 'warning' : 'help_outline'}}
        </span>
        <h3 style="margin:0">{{current.title}}</h3>
      </div>
      <button class="btn btn-ghost btn-icon-only" (click)="answer(false)">
        <span class="btn-icon">close</span>
      </button>
    </div>

    <div class="modal-body">
      <p style="margin:0;color:#374151;line-height:1.6">{{current.message}}</p>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" (click)="answer(false)">Cancel</button>
      <button class="btn btn-primary" (click)="answer(true)"
              [style.background]="current.danger ? '#EF4444' : ''"
              [style.border-color]="current.danger ? '#EF4444' : ''">
        <span style="font-family:'Material Icons Round';font-style:normal;
                     font-size:17px;margin-right:6px">
          {{current.danger ? 'delete' : 'check'}}
        </span>
        {{current.danger ? 'Yes, delete' : 'Confirm'}}
      </button>
    </div>

  </div>
</div>
  `
})
export class ConfirmComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  current: ConfirmRequest | null = null;

  constructor(private confirmSvc: ConfirmService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.confirmSvc.request$.pipe(takeUntil(this.destroy$)).subscribe(req => {
      this.current = req;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  answer(value: boolean): void {
    this.current?.resolve(value);
    this.current = null;
    this.cdr.markForCheck();
  }
}
