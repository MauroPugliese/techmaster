import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ShiftHandover } from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { formatLocalYmd } from '../../../shared/components/datetime-picker/datetime-picker.utils';

@Component({
  selector: 'app-shift-handover-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent, DropdownComponent, DropdownOptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-overlay" *ngIf="visible" (click)="onBackdropClick($event)">
      <div class="modal handover-modal" role="dialog" aria-modal="true" aria-label="Shift Handover Log" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h3>Engineering Shift Handover Log</h3>
            <p class="ho-sub">FSTD bay continuity, active DRs, LOTO safety status &amp; incoming engineer sign-off</p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon-only" (click)="closed.emit()" title="Close">
            <span class="btn-icon">close</span>
          </button>
        </div>

        <div class="modal-body">
          <div class="ho-form-card">
            <div class="ho-form-head">
              <strong>Log Outgoing Shift Handover</strong>
              <button type="button" class="btn btn-ghost btn-sm" (click)="showForm = !showForm">
                {{ showForm ? 'Hide Form' : 'New Entry' }}
              </button>
            </div>

            <div class="ho-form-grid" *ngIf="showForm">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Shift Date</label>
                  <app-datetime-picker
                    class="form-control ho-num"
                    mode="date"
                    [clearable]="false"
                    ariaLabel="Shift Date"
                    [(ngModel)]="shiftDateObj">
                  </app-datetime-picker>
                </div>
                <div class="form-group">
                  <label class="form-label">From Shift</label>
                  <app-dropdown class="form-control" [(ngModel)]="form.from_shift_code" ariaLabel="From Shift">
                    <app-dropdown-option value="MORNING">MORNING (06:00–14:00)</app-dropdown-option>
                    <app-dropdown-option value="AFTERNOON">AFTERNOON (14:00–22:00)</app-dropdown-option>
                    <app-dropdown-option value="NIGHT">NIGHT (22:00–06:00)</app-dropdown-option>
                    <app-dropdown-option value="DAY">DAY</app-dropdown-option>
                  </app-dropdown>
                </div>
                <div class="form-group">
                  <label class="form-label">To Incoming Shift</label>
                  <app-dropdown class="form-control" [(ngModel)]="form.to_shift_code" ariaLabel="To Incoming Shift">
                    <app-dropdown-option value="AFTERNOON">AFTERNOON (14:00–22:00)</app-dropdown-option>
                    <app-dropdown-option value="NIGHT">NIGHT (22:00–06:00)</app-dropdown-option>
                    <app-dropdown-option value="MORNING">MORNING (06:00–14:00)</app-dropdown-option>
                    <app-dropdown-option value="DAY">DAY</app-dropdown-option>
                  </app-dropdown>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Simulators Readiness Summary</label>
                  <textarea class="form-control" rows="2" [(ngModel)]="form.simulators_status_summary" placeholder="e.g. Bays 1-3 green; Bay 4 on MEL (motion yaw limiter)"></textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">Open Snags / DRs Summary</label>
                  <textarea class="form-control" rows="2" [(ngModel)]="form.open_drs_summary" placeholder="e.g. DR-204 projector fan replaced, awaiting QC signoff"></textarea>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Pending Actions for Incoming Crew</label>
                  <textarea class="form-control" rows="2" [(ngModel)]="form.pending_actions" placeholder="e.g. Complete QTG 2.c.1 on FFS-A320-01 after 22:00 sortie"></textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">Safety / LOTO Lockouts</label>
                  <textarea class="form-control" rows="2" [(ngModel)]="form.safety_loto_notes" placeholder="e.g. Hydraulic HPU Bay 5 under LOTO tag #412"></textarea>
                </div>
              </div>

              <div class="ho-form-actions">
                <button type="button" class="btn btn-primary btn-sm" [disabled]="saving" (click)="submitHandover()">
                  {{ saving ? 'Recording...' : 'Submit Shift Handover' }}
                </button>
              </div>
            </div>
          </div>

          <div *ngIf="loading" class="ho-empty">Loading shift handover log...</div>
          <div *ngIf="!loading && handovers.length === 0" class="ho-empty">
            No engineering handovers recorded yet. Submit the first shift continuity entry above.
          </div>

          <div class="ho-list" *ngIf="!loading && handovers.length > 0">
            <article class="ho-entry" *ngFor="let h of handovers; trackBy: trackById">
              <div class="ho-entry-top">
                <div class="ho-entry-meta">
                  <span class="ho-date-pill ho-num">{{ h.shift_date }}</span>
                  <strong class="ho-flow">{{ h.from_shift_code }} &rarr; {{ h.to_shift_code }}</strong>
                  <span class="ho-author">by {{ userLabel(h.author) }}</span>
                </div>

                <ng-container *ngIf="h.acknowledged_at; else ackBtnTpl">
                  <span class="ho-ack-pill ho-num">
                    Acknowledged by {{ userLabel(h.acknowledger) }} · {{ h.acknowledged_at | date:'shortTime' }}
                  </span>
                </ng-container>
                <ng-template #ackBtnTpl>
                  <button type="button"
                          class="btn btn-secondary btn-sm"
                          [disabled]="ackingId === h.id"
                          (click)="acknowledge(h)">
                    {{ ackingId === h.id ? 'Signing...' : 'Acknowledge Handover' }}
                  </button>
                </ng-template>
              </div>

              <div class="ho-notes-grid">
                <div class="ho-note" *ngIf="h.simulators_status_summary">
                  <span class="note-lbl">Simulators</span>
                  <div>{{ h.simulators_status_summary }}</div>
                </div>
                <div class="ho-note" *ngIf="h.open_drs_summary">
                  <span class="note-lbl">Open DRs</span>
                  <div>{{ h.open_drs_summary }}</div>
                </div>
                <div class="ho-note" *ngIf="h.pending_actions">
                  <span class="note-lbl">Pending Actions</span>
                  <div>{{ h.pending_actions }}</div>
                </div>
                <div class="ho-note is-loto" *ngIf="h.safety_loto_notes">
                  <span class="note-lbl">Safety / LOTO</span>
                  <div>{{ h.safety_loto_notes }}</div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .handover-modal { max-width: 820px; width: 95vw; font-family: var(--font-sans); }
    .ho-num { font-variant-numeric: tabular-nums; }
    .ho-sub { margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted); }
    .ho-form-card { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-raised); margin-bottom: 14px; }
    .ho-form-head { display: flex; align-items: center; justify-content: space-between; font-size: 0.88rem; color: var(--blue-950); }
    .ho-form-grid { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .ho-form-actions { display: flex; justify-content: flex-end; }
    .ho-empty { padding: 28px; text-align: center; color: var(--text-muted); font-size: 0.86rem; }
    .ho-list { display: flex; flex-direction: column; gap: 10px; max-height: 48vh; overflow-y: auto; }
    .ho-entry { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 8px; }
    .ho-entry-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .ho-entry-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.82rem; }
    .ho-date-pill { padding: 2px 8px; border-radius: 6px; background: #0f172a; color: #f8fafc; font-size: 0.72rem; font-weight: 700; }
    .ho-flow { color: var(--blue-950); }
    .ho-author { color: var(--text-muted); font-size: 0.78rem; }
    .ho-ack-pill { padding: 3px 9px; border-radius: 999px; background: #dcfce7; color: #15803d; font-size: 0.73rem; font-weight: 700; }
    .ho-notes-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
    .ho-note { padding: 8px 10px; border-radius: 8px; background: var(--surface-raised); border: 1px solid var(--border); font-size: 0.79rem; }
    .ho-note.is-loto { background: #fffbeb; border-color: #fde68a; color: #92400e; }
    .note-lbl { display: block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 3px; }
  `]
})
export class ShiftHandoverModalComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  loading = false;
  saving = false;
  ackingId: number | null = null;
  showForm = true;
  handovers: ShiftHandover[] = [];

  shiftDateObj: Date | null = new Date();
  form = this.emptyForm();

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.loadHandovers();
    }
  }

  private emptyForm() {
    return {
      shift_date: formatLocalYmd(new Date()),
      from_shift_code: 'MORNING',
      to_shift_code: 'AFTERNOON',
      simulators_status_summary: '',
      open_drs_summary: '',
      pending_actions: '',
      safety_loto_notes: ''
    };
  }

  loadHandovers(): void {
    this.loading = true;
    this.cdr.markForCheck();
    this.api.get<any>('/shifts/handovers').subscribe({
      next: (res) => {
        this.handovers = res?.data || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  submitHandover(): void {
    if (this.saving) return;
    this.saving = true;
    this.cdr.markForCheck();

    const payload = {
      ...this.form,
      shift_date: formatLocalYmd(this.shiftDateObj || new Date())
    };

    this.api.post<any>('/shifts/handovers', payload).subscribe({
      next: (res) => {
        const created = res?.data;
        if (created) {
          this.handovers = [created, ...this.handovers];
        } else {
          this.loadHandovers();
        }
        this.saving = false;
        this.shiftDateObj = new Date();
        this.form = this.emptyForm();
        this.toast.success('Shift handover recorded.');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to submit handover.');
        this.cdr.markForCheck();
      }
    });
  }

  acknowledge(h: ShiftHandover): void {
    if (this.ackingId) return;
    this.ackingId = h.id;
    this.cdr.markForCheck();

    this.api.patch<any>(`/shifts/handovers/${h.id}/acknowledge`, {}).subscribe({
      next: (res) => {
        const updated = res?.data;
        if (updated) {
          this.handovers = this.handovers.map(row => (row.id === h.id ? updated : row));
        }
        this.ackingId = null;
        this.toast.success('Handover acknowledged.');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.ackingId = null;
        this.toast.error(err?.error?.message || 'Unable to acknowledge handover.');
        this.cdr.markForCheck();
      }
    });
  }

  userLabel(u: any): string {
    if (!u) return 'Engineer';
    const full = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    return full || u.username || 'Engineer';
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closed.emit();
    }
  }

  trackById(_: number, h: ShiftHandover): number {
    return h.id;
  }
}
