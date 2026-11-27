// =============================================================================
// shift-detail-modal.component.ts — Entity Detail Info Modal for Shifts & Leave
// =============================================================================
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { Shift, ShiftType } from '../../../core/models/interfaces';
import {
  formatHours,
  getLeaveMeta,
  getShiftEffectiveInfo,
  getStatusMeta,
  LeaveTypeMeta,
  ShiftEffectiveInfo,
  ShiftStatusMeta,
} from '../shift-helpers';

@Component({
  selector: 'app-shift-detail-modal',
  standalone: true,
  imports: [CommonModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .detail-id-pill,
    .detail-value,
    .detail-sub,
    .sh-badge-time,
    .sh-badge-ot {
      font-family: var(--font-sans);
      font-variant-numeric: tabular-nums;
    }
    .sh-badge-custom {
      background: #EDE9FE;
      color: #5B21B6;
    }
    .sh-badge-leave {
      background: #CCFBF1;
      color: #0F766E;
    }
    .sh-badge-time {
      background: var(--blue-50);
      color: var(--blue-900);
    }
    .sh-badge-ot {
      background: #EDE9FE;
      color: #6D28D9;
    }
    .sh-icon-in { color: #0284C7; }
    .sh-icon-out { color: #15803D; }
  `],
  template: `
    <div class="modal-overlay" *ngIf="shift" (click)="onBackdrop($event)">
      <div class="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="shift-detail-title" (click)="$event.stopPropagation()">
        <ng-container *ngIf="getInfo(shift) as info">
          <div class="modal-header">
            <div class="detail-header-title">
              <div class="detail-head-meta">
                <span class="detail-id-pill">#{{shift.id}}</span>
                <span class="detail-type-chip">
                  <span class="detail-type-dot" [style.background]="info.color"></span>
                  {{info.name}} ({{info.code}})
                </span>
                <span class="badge sh-badge-custom" *ngIf="info.isCustom">Custom Hours</span>
                <span class="badge sh-badge-leave" *ngIf="info.isLeave">{{getLeave(shift).label}}</span>
              </div>
              <h2 id="shift-detail-title">
                {{getPersonName(shift.employee)}} · {{shift.date | date:'EEEE, MMM d, y'}}
              </h2>
            </div>
            <button type="button" class="btn btn-ghost btn-icon-only" (click)="close.emit()" title="Close">
              <span class="btn-icon">close</span>
            </button>
          </div>

          <div class="modal-body">
            <div class="detail-badges">
              <span class="badge" [ngClass]="getStatus(shift).badgeClass">
                {{getStatus(shift).label}}
              </span>
              <span class="badge sh-badge-time" *ngIf="!info.isLeave">
                Effective: {{info.start}}–{{info.end}} ({{formatHrs(info.effectiveHours)}})
              </span>
              <span class="badge sh-badge-ot" *ngIf="shift.overtime_hours > 0">
                {{formatSignedHrs(shift.overtime_hours)}} Overtime
              </span>
            </div>

            <div class="detail-grid">
              <div class="detail-field">
                <span class="detail-label">Employee</span>
                <span class="detail-value">{{getPersonName(shift.employee)}}</span>
                <span class="detail-sub" *ngIf="shift.employee?.department || shift.employee?.job_title">
                  {{shift.employee?.department}}<span *ngIf="shift.employee?.department && shift.employee?.job_title"> · </span>{{shift.employee?.job_title}}
                </span>
              </div>
              <div class="detail-field">
                <span class="detail-label">Supervisor</span>
                <span class="detail-value">{{getPersonName(shift.supervisor)}}</span>
              </div>

              <ng-container *ngIf="!info.isLeave; else leaveFields">
                <div class="detail-field">
                  <span class="detail-label">Effective Working Hours</span>
                  <span class="detail-value">{{info.start}} – {{info.end}} ({{formatHrs(info.effectiveHours)}})</span>
                  <span class="detail-sub" *ngIf="info.isCustom">
                    Standard: {{info.standardStart}} – {{info.standardEnd}} ({{formatHrs(info.standardHours)}})
                    <ng-container *ngIf="info.deltaHours !== 0"> · {{formatSignedHrs(info.deltaHours)}}</ng-container>
                  </span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Overtime &amp; Reason</span>
                  <span class="detail-value">
                    {{shift.overtime_hours > 0 ? formatSignedHrs(shift.overtime_hours) : 'None'}}
                  </span>
                  <span class="detail-sub" *ngIf="shift.adjustment_reason">{{shift.adjustment_reason}}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Check-In</span>
                  <span class="detail-value">{{shift.check_in ? (shift.check_in | date:'dd MMM yyyy, HH:mm') : '—'}}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Check-Out</span>
                  <span class="detail-value">{{shift.check_out ? (shift.check_out | date:'dd MMM yyyy, HH:mm') : '—'}}</span>
                </div>
              </ng-container>

              <ng-template #leaveFields>
                <div class="detail-field">
                  <span class="detail-label">Leave Category</span>
                  <span class="detail-value">{{getLeave(shift).label}}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Reason</span>
                  <span class="detail-value">{{shift.adjustment_reason || '—'}}</span>
                </div>
              </ng-template>
            </div>

            <div class="detail-section">
              <span class="detail-section-title">Notes</span>
              <div class="detail-text-box" [style.color]="shift.notes ? 'var(--blue-900)' : 'var(--text-muted)'">
                {{shift.notes || 'No notes recorded for this entry.'}}
              </div>
            </div>
          </div>

          <div class="modal-footer detail-footer">
            <button *ngIf="auth.canManage" type="button" class="btn btn-ghost detail-delete-btn" (click)="remove.emit(shift)">
              <span class="btn-icon">delete</span>
              Delete
            </button>
            <div class="detail-footer-actions">
              <button type="button" class="btn btn-secondary" (click)="close.emit()">Close</button>
              <button *ngIf="canCheckIn(shift)"
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="checkingId === shift.id"
                      (click)="checkIn.emit(shift)">
                <span class="btn-icon sh-icon-in">login</span>
                Check In
              </button>
              <button *ngIf="canCheckOut(shift)"
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="checkingId === shift.id"
                      (click)="checkOut.emit(shift)">
                <span class="btn-icon sh-icon-out">logout</span>
                Check Out
              </button>
              <button *ngIf="auth.canManage" type="button" class="btn btn-primary" (click)="edit.emit(shift)">
                <span class="btn-icon">edit</span>
                Edit
              </button>
            </div>
          </div>
        </ng-container>
      </div>
    </div>
  `,
})
export class ShiftDetailModalComponent {
  @Input() shift: Shift | null = null;
  @Input() shiftTypes: ShiftType[] = [];
  @Input() checkingId: number | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() checkIn = new EventEmitter<Shift>();
  @Output() checkOut = new EventEmitter<Shift>();
  @Output() edit = new EventEmitter<Shift>();
  @Output() remove = new EventEmitter<Shift>();

  constructor(public auth: AuthService) {}

  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  getInfo(shift: Shift): ShiftEffectiveInfo {
    return getShiftEffectiveInfo(shift, this.shiftTypes);
  }

  getStatus(shift: Shift): ShiftStatusMeta {
    return getStatusMeta(shift.status);
  }

  getLeave(shift: Shift): LeaveTypeMeta {
    const matched = shift.shiftType || this.shiftTypes.find(st => st.id === shift.shift_type_id);
    return getLeaveMeta(shift.leave_type, matched);
  }

  formatHrs(hours: number): string {
    return formatHours(hours, { zeroLabel: '0h' });
  }

  formatSignedHrs(hours: number): string {
    return formatHours(hours, { signed: true });
  }

  getPersonName(person?: { first_name?: string; last_name?: string } | null): string {
    if (!person) return '—';
    return `${person.first_name || ''} ${person.last_name || ''}`.trim() || '—';
  }

  private canClockShift(shift: Shift): boolean {
    if (this.auth.canManage) return true;
    return this.auth.canWrite && Number(shift.user_id) === Number(this.auth.currentUser?.id);
  }

  canCheckIn(shift: Shift): boolean {
    if (!this.canClockShift(shift)) return false;
    const info = this.getInfo(shift);
    return !info.isLeave && (shift.status === 'SCHEDULED' || shift.status === 'CONFIRMED');
  }

  canCheckOut(shift: Shift): boolean {
    if (!this.canClockShift(shift)) return false;
    const info = this.getInfo(shift);
    return !info.isLeave && shift.status === 'IN_PROGRESS';
  }
}
