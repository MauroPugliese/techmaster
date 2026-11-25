import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ToastService } from '../../../core/services/services';
import { SimulatorDailyShift, SimulatorShiftEntry } from '../../../core/models/interfaces';
import { SHIFT_USAGE_STATUS_META } from '../simulator-helpers';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';

export type BulkTimeMode = 'start' | 'end' | 'both';

@Component({
  selector: 'app-bulk-sim-time-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TimePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-overlay" *ngIf="visible && shift" (click)="onBackdropClick($event)">
      <div class="modal bulk-time-modal" role="dialog" aria-modal="true" aria-label="One-Click Bulk Entry" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h3>Bulk Entry · {{ modeLabel }}</h3>
            <p class="bt-sub">{{ shift.shift_name }} · Apply identical session times across selected Test Places / Stations</p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon-only" (click)="close()" title="Close">
            <span class="btn-icon">close</span>
          </button>
        </div>

        <div class="modal-body">
          <!-- Mode Selector -->
          <div class="bt-mode-bar" role="group" aria-label="Bulk entry mode">
            <button type="button" class="bt-mode-btn" [class.active]="mode === 'start'" (click)="mode = 'start'">
              Sim Testing Start
            </button>
            <button type="button" class="bt-mode-btn" [class.active]="mode === 'end'" (click)="mode = 'end'">
              Sim Testing End
            </button>
            <button type="button" class="bt-mode-btn" [class.active]="mode === 'both'" (click)="mode = 'both'">
              Start &amp; End Together
            </button>
          </div>

          <!-- Time Inputs + Presets -->
          <div class="bt-time-card">
            <div class="bt-time-grid" [class.single]="mode !== 'both'">
              <div class="form-group" *ngIf="mode === 'start' || mode === 'both'">
                <label class="form-label">Sim Testing Start (HH:MM)</label>
                <div class="bt-input-row">
                  <app-time-picker
                    class="form-control"
                    ariaLabel="Sim Testing Start"
                    [(ngModel)]="startTime">
                  </app-time-picker>
                  <button type="button" class="btn btn-secondary btn-sm" (click)="setNow('start')">Now</button>
                </div>
              </div>

              <div class="form-group" *ngIf="mode === 'end' || mode === 'both'">
                <label class="form-label">Sim Testing End (HH:MM)</label>
                <div class="bt-input-row">
                  <app-time-picker
                    class="form-control"
                    ariaLabel="Sim Testing End"
                    [(ngModel)]="endTime">
                  </app-time-picker>
                  <button type="button" class="btn btn-secondary btn-sm" (click)="setNow('end')">Now</button>
                </div>
              </div>
            </div>

            <div class="bt-presets">
              <span class="bt-preset-lbl">Quick times:</span>
              <button *ngFor="let t of timePresets"
                      type="button"
                      class="bt-preset-chip bt-num"
                      (click)="applyPreset(t)">
                {{ t === '00:00' ? '00:00 (Reset)' : t }}
              </button>
            </div>
          </div>

          <!-- Station Checkbox Grid -->
          <div class="bt-station-sec">
            <div class="bt-sec-head">
              <strong>Select Target Stations ({{ selectedIds.size }} / {{ shift.entries.length }})</strong>
              <div class="bt-sel-btns">
                <button type="button" class="btn btn-ghost btn-sm" (click)="selectAvailable()">Ready / In Use Only</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="selectAll()">All</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="clearAll()">Clear</button>
              </div>
            </div>

            <div class="bt-check-grid">
              <label
                *ngFor="let entry of shift.entries; trackBy: trackByEntryId"
                class="bt-check-tile"
                [class.checked]="isChecked(entry.simulator_id)"
                [class.is-na]="entry.usage_status === 'NA'">
                <input
                  type="checkbox"
                  [checked]="isChecked(entry.simulator_id)"
                  (change)="toggleStation(entry.simulator_id)" />
                <div class="bt-tile-body">
                  <div class="bt-tile-top">
                    <span class="bt-tile-code bt-num">{{ entry.station?.name || entry.station?.code || ('TP-' + entry.simulator_id) }}</span>
                    <span
                      class="bt-st-dot-pill"
                      [style.background]="statusMeta(entry.usage_status).bg"
                      [style.color]="statusMeta(entry.usage_status).color">
                      {{ statusMeta(entry.usage_status).label }}
                    </span>
                  </div>
                  <div class="bt-tile-time bt-num">
                    Current: {{ entry.sim_testing_start || '00:00' }} – {{ entry.sim_testing_end || '00:00' }}
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="saving || selectedIds.size === 0"
            (click)="applyBulk()">
            <span class="btn-icon">done_all</span>
            {{ saving ? 'Applying…' : ('OK · Apply to ' + selectedIds.size + ' Stations') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .bulk-time-modal { max-width: 720px; width: 95vw; font-family: var(--font-sans); }
    .bt-num { font-variant-numeric: tabular-nums; }
    .bt-sub { margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted); }
    .bt-mode-bar {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      border-radius: var(--radius-md);
      background: var(--blue-50);
      border: 1px solid var(--blue-200);
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .bt-mode-btn {
      border: none;
      background: transparent;
      color: var(--blue-900);
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      &.active { background: var(--primary); color: #fff; box-shadow: var(--shadow-sm); }
    }
    .bt-time-card {
      padding: 14px;
      border-radius: var(--radius-md);
      background: var(--surface-raised);
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .bt-time-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      &.single { grid-template-columns: minmax(0, 320px); }
      .form-group { margin-bottom: 10px; }
    }
    .bt-input-row { display: flex; align-items: center; gap: 8px; }
    .bt-presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .bt-preset-lbl { font-size: 0.74rem; font-weight: 700; color: var(--text-muted); }
    .bt-preset-chip {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--blue-900);
      border-radius: 999px;
      padding: 3px 9px;
      font-family: var(--font-sans);
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      &:hover { border-color: var(--primary); color: var(--primary); background: var(--blue-50); }
    }
    .bt-sec-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
      font-size: 0.85rem;
      color: var(--blue-950);
    }
    .bt-sel-btns { display: flex; align-items: center; gap: 4px; }
    .bt-check-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
      gap: 8px;
      max-height: 36vh;
      overflow-y: auto;
      padding: 2px;
    }
    .bt-check-tile {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 9px 10px;
      border-radius: var(--radius-md);
      border: 1.5px solid var(--border);
      background: var(--surface);
      cursor: pointer;
      transition: var(--transition);

      input[type="checkbox"] {
        margin-top: 3px;
        width: 16px;
        height: 16px;
        accent-color: var(--primary);
        flex-shrink: 0;
      }
      &.checked {
        border-color: var(--primary);
        background: var(--blue-50);
      }
      &.is-na {
        border-color: #FECACA;
        background: #FEF2F2;
      }
    }
    .bt-tile-body { min-width: 0; flex: 1; }
    .bt-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .bt-tile-code { font-size: 0.8rem; font-weight: 700; color: var(--blue-950); }
    .bt-st-dot-pill {
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 0.66rem;
      font-weight: 700;
    }
    .bt-tile-time { font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }
    @media (max-width: 600px) {
      .bt-time-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class BulkSimTimeModalComponent {
  @Output() applied = new EventEmitter<void>();

  visible = false;
  saving = false;
  shift: SimulatorDailyShift | null = null;
  mode: BulkTimeMode = 'start';
  startTime = '07:00';
  endTime = '16:30';
  selectedIds = new Set<number>();

  readonly timePresets = ['06:45', '07:00', '08:00', '12:30', '13:15', '16:30', '17:00', '00:00'];

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.visible) this.close();
  }

  get modeLabel(): string {
    if (this.mode === 'start') return 'SIM TESTING START';
    if (this.mode === 'end') return 'SIM TESTING END';
    return 'START & END TIME';
  }

  open(opts: { shift: SimulatorDailyShift; mode: BulkTimeMode }): void {
    this.shift = opts.shift;
    this.mode = opts.mode;
    const now = new Date();
    const nowHhMm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (opts.mode === 'start') {
      this.startTime = nowHhMm;
    } else if (opts.mode === 'end') {
      this.endTime = nowHhMm;
    }
    this.selectAvailable();
    this.visible = true;
    this.cdr.markForCheck();
  }

  close(): void {
    this.visible = false;
    this.cdr.markForCheck();
  }

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close();
    }
  }

  setNow(target: 'start' | 'end'): void {
    const now = new Date();
    const val = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (target === 'start') this.startTime = val;
    else this.endTime = val;
    this.cdr.markForCheck();
  }

  applyPreset(val: string): void {
    if (this.mode === 'start') {
      this.startTime = val;
    } else if (this.mode === 'end') {
      this.endTime = val;
    } else {
      if (val === '00:00') {
        this.startTime = '00:00';
        this.endTime = '00:00';
      } else {
        this.startTime = val;
      }
    }
    this.cdr.markForCheck();
  }

  selectAvailable(): void {
    this.selectedIds.clear();
    for (const e of this.shift?.entries || []) {
      if (e.usage_status !== 'NA') {
        this.selectedIds.add(Number(e.simulator_id));
      }
    }
    this.cdr.markForCheck();
  }

  selectAll(): void {
    this.selectedIds.clear();
    for (const e of this.shift?.entries || []) {
      this.selectedIds.add(Number(e.simulator_id));
    }
    this.cdr.markForCheck();
  }

  clearAll(): void {
    this.selectedIds.clear();
    this.cdr.markForCheck();
  }

  isChecked(simId: number): boolean {
    return this.selectedIds.has(Number(simId));
  }

  toggleStation(simId: number): void {
    const id = Number(simId);
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.cdr.markForCheck();
  }

  applyBulk(): void {
    if (!this.shift || this.saving || this.selectedIds.size === 0) return;
    this.saving = true;
    this.cdr.markForCheck();

    const payload = {
      mode: this.mode,
      start_time: this.startTime,
      end_time: this.endTime,
      simulator_ids: [...this.selectedIds]
    };

    this.api.post<any>(`/simulators/daily-sheet/shifts/${this.shift.id}/bulk-time`, payload).subscribe({
      next: () => {
        this.saving = false;
        this.visible = false;
        this.toast.success(`Updated ${this.selectedIds.size} station(s) in ${this.shift?.shift_name}.`);
        this.applied.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to apply bulk session time.');
        this.cdr.markForCheck();
      }
    });
  }

  statusMeta(st: any) {
    return (SHIFT_USAGE_STATUS_META as any)[st || 'READY'] || SHIFT_USAGE_STATUS_META.READY;
  }

  trackByEntryId(_: number, e: SimulatorShiftEntry): number {
    return e.id;
  }
}
