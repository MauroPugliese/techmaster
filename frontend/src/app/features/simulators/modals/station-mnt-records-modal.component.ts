import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Output
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, AuthService, ToastService } from '../../../core/services/services';
import { SimulatorMntRecord, SimulatorMntRecordsResponse } from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';

@Component({
  selector: 'app-station-mnt-records-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, RouterLink, DropdownComponent, DropdownOptionComponent, DateTimePickerComponent, ExportMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-overlay" *ngIf="visible" (click)="onBackdropClick($event)">
      <div class="modal mnt-records-modal" role="dialog" aria-modal="true" aria-label="Station MNT Records" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h3>{{ stationTitle }} · MNT RECORDS</h3>
            <p class="mr-sub">Rapid Preventive (Gray) &amp; Corrective / Fault (Red) Maintenance History</p>
          </div>
          <div class="mr-head-right">
            <app-export-menu
              *ngIf="simulatorId"
              [endpoint]="'simulators/' + simulatorId"
              [filename]="exportFilename"
              [params]="exportParams"
              [includeDateRange]="false"
              label="Export">
            </app-export-menu>
            <a *ngIf="simulatorId"
               class="btn btn-secondary btn-sm"
               [routerLink]="['/maintenance']"
               [queryParams]="{ simulatorId: simulatorId }"
               (click)="close()">
              <span class="btn-icon">open_in_new</span> Full Maintenance
            </a>
            <button type="button" class="btn btn-ghost btn-icon-only" (click)="close()" title="Close">
              <span class="btn-icon">close</span>
            </button>
          </div>
        </div>

        <div class="modal-body">
          <!-- Controls & Year Filter + Summary Pills -->
          <div class="mr-toolbar">
            <div class="mr-year-chips">
              <button type="button"
                      class="mr-year-btn"
                      [class.active]="selectedYear === 'ALL'"
                      (click)="changeYear('ALL')">
                All Years
              </button>
              <button *ngFor="let yr of availableYears"
                      type="button"
                      class="mr-year-btn mr-num"
                      [class.active]="selectedYear === yr"
                      (click)="changeYear(yr)">
                {{ yr }}
              </button>
            </div>

            <div class="mr-actions">
              <div class="mr-summary-pills mr-num" *ngIf="data">
                <span class="mr-pill is-prev">Preventive: {{ data.counts.preventive }}</span>
                <span class="mr-pill is-corr">Corrective / Fault: {{ data.counts.corrective }}</span>
                <span class="mr-pill is-tot">Downtime: {{ data.counts.total_downtime_hours }}h</span>
              </div>
              <button *ngIf="auth.canWrite" type="button" class="btn btn-primary btn-sm" (click)="showQuickForm = !showQuickForm">
                <span class="btn-icon">{{ showQuickForm ? 'expand_less' : 'add' }}</span>
                {{ showQuickForm ? 'Hide Form' : 'Quick Log MNT' }}
              </button>
            </div>
          </div>

          <!-- Inline Quick MNT Form -->
          <div class="mr-quick-form" *ngIf="auth.canWrite && showQuickForm">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Record Classification</label>
                <app-dropdown class="form-control" [(ngModel)]="quickForm.type" ariaLabel="Record Classification">
                  <app-dropdown-option value="PREVENTIVE">Preventive (Routine / Lubrication / Check)</app-dropdown-option>
                  <app-dropdown-option value="CORRECTIVE">Corrective (Fault / Repair / Power Issue)</app-dropdown-option>
                </app-dropdown>
              </div>
              <div class="form-group">
                <label class="form-label">Summary Title *</label>
                <input class="form-control" [(ngModel)]="quickForm.title" placeholder="e.g. Lubrication of pedals or New PSU installed" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Scheduled / Event Date &amp; Time</label>
                <app-datetime-picker
                  class="form-control"
                  mode="datetime"
                  [clearable]="false"
                  ariaLabel="Event Date and Time"
                  [(ngModel)]="quickForm.scheduledDate">
                </app-datetime-picker>
              </div>
              <div class="form-group">
                <label class="form-label">Downtime Hours</label>
                <input type="number" step="0.25" min="0" class="form-control mr-num" [(ngModel)]="quickForm.downtime_hours" />
              </div>
            </div>
            <div class="form-group" style="margin-bottom:10px">
              <label class="form-label">Notes / Resolution</label>
              <textarea class="form-control" rows="2" [(ngModel)]="quickForm.description" placeholder="Action performed, replaced LRU, or corrective findings..."></textarea>
            </div>
            <div class="mr-quick-actions">
              <button type="button" class="btn btn-ghost btn-sm" (click)="showQuickForm = false">Cancel</button>
              <button type="button" class="btn btn-primary btn-sm" [disabled]="savingQuick || !quickForm.title.trim()" (click)="submitQuickMnt()">
                {{ savingQuick ? 'Saving…' : 'Save Maintenance Entry' }}
              </button>
            </div>
          </div>

          <!-- Loading / Empty -->
          <div *ngIf="loading" class="mr-state">Loading station maintenance records...</div>
          <div *ngIf="!loading && records.length === 0" class="mr-state">
            No maintenance records found for {{ stationTitle }} in {{ selectedYear === 'ALL' ? 'any year' : selectedYear }}.
          </div>

          <!-- Records Timeline List (Gray Preventive vs Red Corrective) -->
          <div class="mr-list" *ngIf="!loading && records.length > 0">
            <article
              *ngFor="let rec of records; trackBy: trackById"
              class="mr-row"
              [class.is-corrective]="rec.is_corrective"
              [class.is-preventive]="!rec.is_corrective">
              <div class="mr-row-head">
                <div class="mr-row-badges">
                  <span class="mr-kind-badge" [class.corr]="rec.is_corrective" [class.prev]="!rec.is_corrective">
                    {{ rec.is_corrective ? 'CORRECTIVE / FAULT' : 'PREVENTIVE' }}
                  </span>
                  <span class="mr-date-pill mr-num">
                    {{ rec.scheduled_date | date:'dd MMM yyyy' }}
                    <ng-container *ngIf="rec.time_window"> · {{ rec.time_window }}</ng-container>
                  </span>
                  <span class="mr-dt-pill mr-num" *ngIf="rec.downtime_hours && rec.downtime_hours > 0">
                    {{ rec.downtime_hours }}h down
                  </span>
                  <span class="mr-status-tag">{{ rec.status }}</span>
                </div>

                <a class="mr-full-link"
                   [routerLink]="['/maintenance']"
                   [queryParams]="{ simulatorId: simulatorId, search: rec.title }"
                   (click)="close()"
                   title="Open full Work Order in Maintenance module">
                  Full Report <span class="mat-i" style="font-size:14px">arrow_outward</span>
                </a>
              </div>

              <div class="mr-row-title">{{ rec.title }}</div>
              <div class="mr-row-findings mr-num" *ngIf="$any(rec).part_number || $any(rec).broken_serial_number || $any(rec).new_serial_number">
                <ng-container *ngIf="$any(rec).part_number"><strong>P/N:</strong> {{ $any(rec).part_number }}</ng-container>
                <ng-container *ngIf="$any(rec).part_number && ($any(rec).broken_serial_number || $any(rec).new_serial_number)"> · </ng-container>
                <ng-container *ngIf="$any(rec).broken_serial_number || $any(rec).new_serial_number">
                  <strong>S/N:</strong> {{ $any(rec).broken_serial_number || '—' }} &rarr; {{ $any(rec).new_serial_number || '—' }}
                </ng-container>
              </div>
              <div class="mr-row-desc" *ngIf="rec.description">{{ rec.description }}</div>
              <div class="mr-row-findings" *ngIf="rec.findings">
                <strong>Resolution:</strong> {{ rec.findings }}
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .mnt-records-modal {
      max-width: 860px;
      width: 95vw;
      font-family: var(--font-sans);
      overflow: visible;
    }
    .mnt-records-modal .modal-header {
      overflow: visible;
      position: relative;
      z-index: 4;
    }
    .mnt-records-modal .modal-body {
      max-height: calc(88vh - 88px);
      overflow-y: auto;
    }
    .mr-num { font-variant-numeric: tabular-nums; }
    .mr-sub { margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted); }
    .mr-head-right { display: flex; align-items: center; gap: 8px; }
    .mr-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      background: var(--surface-raised);
      border: 1px solid var(--border);
      margin-bottom: 14px;
    }
    .mr-year-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .mr-year-btn {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--blue-900);
      font-family: var(--font-sans);
      font-size: 0.76rem;
      font-weight: 700;
      cursor: pointer;
      &.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    }
    .mr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .mr-summary-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .mr-pill {
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      &.is-prev { background: #F1F5F9; color: #334155; border: 1px solid #CBD5E1; }
      &.is-corr { background: #FEE2E2; color: #B91C1C; border: 1px solid #FCA5A5; }
      &.is-tot  { background: var(--blue-50); color: var(--blue-900); border: 1px solid var(--blue-200); }
    }
    .mr-quick-form {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: var(--blue-50);
      border: 1px solid var(--blue-200);
      margin-bottom: 14px;
    }
    .mr-quick-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .mr-state { padding: 36px; text-align: center; color: var(--text-muted); font-size: 0.88rem; }
    .mr-list { display: flex; flex-direction: column; gap: 8px; max-height: 52vh; overflow-y: auto; }
    .mr-row {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      border-left-width: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;

      &.is-preventive {
        background: #F8FAFC;
        border-color: #E2E8F0;
        border-left-color: #64748B;
      }
      &.is-corrective {
        background: #FEF2F2;
        border-color: #FECACA;
        border-left-color: #DC2626;
      }
    }
    .mr-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .mr-row-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .mr-kind-badge {
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 0.67rem;
      font-weight: 800;
      &.prev { background: #E2E8F0; color: #334155; }
      &.corr { background: #DC2626; color: #FFFFFF; }
    }
    .mr-date-pill { font-size: 0.76rem; font-weight: 700; color: var(--blue-950); }
    .mr-dt-pill {
      padding: 1px 6px;
      border-radius: 5px;
      background: rgba(15, 23, 42, 0.08);
      font-size: 0.71rem;
      font-weight: 700;
      color: var(--blue-900);
    }
    .mr-status-tag { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
    .mr-full-link {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--primary);
      text-decoration: none;
      &:hover { text-decoration: underline; }
    }
    .mr-row-title { font-size: 0.92rem; font-weight: 700; color: var(--blue-950); }
    .mr-row-desc { font-size: 0.81rem; color: var(--blue-900); }
    .mr-row-findings { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
  `]
})
export class StationMntRecordsModalComponent {
  @Output() mutated = new EventEmitter<void>();

  visible = false;
  loading = false;
  simulatorId: number | null = null;
  stationTitle = '';
  selectedYear: number | 'ALL' = new Date().getFullYear();
  availableYears: number[] = [new Date().getFullYear()];
  data: SimulatorMntRecordsResponse | null = null;
  records: SimulatorMntRecord[] = [];

  showQuickForm = false;
  savingQuick = false;
  quickForm = this.emptyQuickForm();

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (typeof document !== 'undefined' && document.querySelector('.confirm-overlay, .cdk-overlay-pane')) {
      return;
    }
    if (this.visible) this.close();
  }

  private emptyQuickForm() {
    return {
      type: 'CORRECTIVE' as 'PREVENTIVE' | 'CORRECTIVE',
      title: '',
      scheduledDate: new Date() as Date | null,
      downtime_hours: 1,
      description: ''
    };
  }

  open(simulatorId: number, stationLabel?: string): void {
    this.simulatorId = simulatorId;
    this.stationTitle = stationLabel || `Station #${simulatorId}`;
    this.selectedYear = new Date().getFullYear();
    this.showQuickForm = false;
    this.quickForm = this.emptyQuickForm();
    this.visible = true;
    this.loadRecords();
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

  get exportFilename(): string {
    const slug = (this.stationTitle || 'station')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `mnt_records_${slug || 'station'}`;
  }

  get exportParams(): Record<string, string | number> {
    return { year: this.selectedYear };
  }

  changeYear(yr: number | 'ALL'): void {
    this.selectedYear = yr;
    this.loadRecords();
  }

  loadRecords(): void {
    if (!this.simulatorId) return;
    this.loading = true;
    this.cdr.markForCheck();

    const params: Record<string, any> = {};
    if (this.selectedYear !== 'ALL') {
      params['year'] = this.selectedYear;
    }

    this.api.get<any>(`/simulators/${this.simulatorId}/mnt-records`, params).subscribe({
      next: (res) => {
        const d: SimulatorMntRecordsResponse | null = res?.data || null;
        this.data = d;
        this.records = d?.records || [];
        if (d?.simulator?.name) {
          this.stationTitle = d.simulator.name;
        }
        const curYr = new Date().getFullYear();
        const yrs = new Set<number>([curYr, ...(d?.availableYears || [])]);
        this.availableYears = [...yrs].sort((a, b) => b - a);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load maintenance history.');
        this.cdr.markForCheck();
      }
    });
  }

  submitQuickMnt(): void {
    if (!this.simulatorId || this.savingQuick || !this.quickForm.title.trim()) return;
    this.savingQuick = true;
    this.cdr.markForCheck();

    const isCorr = this.quickForm.type === 'CORRECTIVE';
    const payload = {
      simulator_id: this.simulatorId,
      type: this.quickForm.type,
      title: this.quickForm.title.trim(),
      description: this.quickForm.description.trim() || this.quickForm.title.trim(),
      status: 'COMPLETED',
      priority: isCorr ? 'HIGH' : 'LOW',
      severity: isCorr ? 'DEGRADED' : 'MINOR',
      is_snag: isCorr,
      scheduled_date: (this.quickForm.scheduledDate || new Date()).toISOString(),
      downtime_hours: Number(this.quickForm.downtime_hours || 0)
    };

    this.api.post<any>('/maintenance', payload).subscribe({
      next: () => {
        this.savingQuick = false;
        this.showQuickForm = false;
        this.quickForm = this.emptyQuickForm();
        this.toast.success('Maintenance record saved.');
        this.loadRecords();
        this.mutated.emit();
      },
      error: (err: any) => {
        this.savingQuick = false;
        this.toast.error(err?.error?.message || 'Unable to save maintenance record.');
        this.cdr.markForCheck();
      }
    });
  }

  trackById(_: number, rec: SimulatorMntRecord): number {
    return rec.id;
  }
}
