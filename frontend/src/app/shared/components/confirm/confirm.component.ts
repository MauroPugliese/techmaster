// =============================================================================
// shared/components/confirm/confirm.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, HostListener, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
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
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" style="max-width:400px" (click)="$event.stopPropagation()">

    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:22px"
              [style.color]="current.danger ? '#EF4444' : 'var(--primary)'">
          {{current.danger ? 'warning' : 'help_outline'}}
        </span>
        <h3 id="confirm-dialog-title" style="margin:0">{{current.title}}</h3>
      </div>
      <button type="button" class="btn btn-ghost btn-icon-only" aria-label="Close confirmation dialog" (click)="answer(false)">
        <span class="btn-icon">close</span>
      </button>
    </div>

    <div class="modal-body">
      <p style="margin:0;color:var(--blue-900);line-height:1.6">{{current.message}}</p>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" (click)="answer(false)">Cancel</button>
      <button type="button" class="btn btn-primary" (click)="answer(true)"
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
      if (this.current) {
        this.current.resolve(false);
      }
      this.current = req;
      this.cdr.markForCheck();
    });
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.current) {
      this.answer(false);
    }
  }

  ngOnDestroy(): void {
    if (this.current) {
      this.current.resolve(false);
      this.current = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  answer(value: boolean): void {
    const active = this.current;
    this.current = null;
    active?.resolve(value);
    this.cdr.markForCheck();
  }
}
