// =============================================================================
// shift-types-modal.component.ts — Manage Work & Leave Shift Types
// =============================================================================
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ShiftType, ShiftTypeCategory } from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { calculateShiftHours, formatHours, formatTimeShort } from '../shift-helpers';

const PRESET_COLORS = [
  '#1565C0',
  '#0288D1',
  '#01579B',
  '#7C3AED',
  '#0D9488',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#37474F',
];

@Component({
  selector: 'app-shift-types-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .st-modal {
      max-width: 720px;
      width: min(720px, calc(100vw - 24px));
    }
    .st-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .st-form-card {
      background: var(--surface-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
    }
    .st-form-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 14px;
    }
    .st-form-title {
      font-family: var(--font-sans);
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--blue-950);
    }
    .st-time-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;

      input[type="time"] {
        font-family: var(--font-sans);
        font-variant-numeric: tabular-nums;
      }
    }
    .st-leave-note {
      display: flex;
      align-items: center;
      color: var(--text-muted);
      background: var(--surface);
      font-size: 0.84rem;
    }
    .st-swatches {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .st-swatch {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid rgba(10, 22, 40, 0.15);
      cursor: pointer;
      padding: 0;
    }
    .st-swatch.active {
      outline: 2px solid var(--blue-950);
      outline-offset: 2px;
    }
    .st-color-native {
      width: 28px;
      height: 24px;
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
    }
    .st-section-title {
      font-family: var(--font-sans);
      font-variant-numeric: tabular-nums;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .st-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .st-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }
    .st-item-main {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .st-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .st-item-name {
      font-family: var(--font-sans);
      font-weight: 600;
      font-size: 0.88rem;
      color: var(--blue-950);
    }
    .st-item-sub {
      font-family: var(--font-sans);
      font-variant-numeric: tabular-nums;
      font-size: 0.76rem;
      color: var(--text-muted);
    }
  `],
  template: `
    <div class="modal-overlay" *ngIf="open" (click)="onBackdropClick($event)">
      <div class="modal st-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="shift-types-modal-title">
        <div class="modal-header">
          <div>
            <h3 id="shift-types-modal-title">Manage Shift &amp; Leave Types</h3>
            <p class="text-sm text-muted" style="margin:2px 0 0">
              Configure working shift patterns and leave / time off categories
            </p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon-only" (click)="close.emit()" title="Close">
            <span class="btn-icon">close</span>
          </button>
        </div>

        <div class="modal-body st-body">
          <div class="st-form-card">
            <div class="st-form-head">
              <span class="st-form-title">
                {{ editingType ? ('Edit Type: ' + editingType.name) : 'New Shift / Leave Type' }}
              </span>
              <button *ngIf="editingType" type="button" class="btn btn-ghost btn-sm" (click)="resetForm()">
                Cancel Edit
              </button>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Name *</label>
                <input type="text" class="form-control" [(ngModel)]="form.name" placeholder="e.g. Late Evening, Compensatory Leave" maxlength="80">
              </div>
              <div class="form-group">
                <label class="form-label">Code (max 10) *</label>
                <input type="text" class="form-control" [(ngModel)]="form.code" (ngModelChange)="form.code = ($event || '').toUpperCase()" placeholder="e.g. EVE" maxlength="10">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Category *</label>
                <app-dropdown class="form-control" [(ngModel)]="form.category" (ngModelChange)="onCategoryChange($event)" ariaLabel="Shift type category">
                  <app-dropdown-option value="WORK">Work Shift</app-dropdown-option>
                  <app-dropdown-option value="LEAVE">Leave / Time Off</app-dropdown-option>
                </app-dropdown>
              </div>
              <div class="form-group" *ngIf="form.category === 'WORK'">
                <label class="form-label">Standard Hours</label>
                <div class="st-time-row">
                  <input type="time" class="form-control" [(ngModel)]="form.start_time" aria-label="Start time">
                  <span class="text-muted text-sm">→</span>
                  <input type="time" class="form-control" [(ngModel)]="form.end_time" aria-label="End time">
                </div>
              </div>
              <div class="form-group" *ngIf="form.category === 'LEAVE'">
                <label class="form-label">Behavior</label>
                <div class="form-control st-leave-note">
                  Full-day leave entry (exempt from 11h rest checks)
                </div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Badge Color</label>
                <div class="st-swatches">
                  <button *ngFor="let swatch of presetColors"
                          type="button"
                          class="st-swatch"
                          [class.active]="form.color === swatch"
                          (click)="form.color = swatch"
                          [title]="swatch"
                          [style.background]="swatch">
                  </button>
                  <input type="color" class="st-color-native" [(ngModel)]="form.color" title="Custom color">
                </div>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Description</label>
                <input type="text" class="form-control" [(ngModel)]="form.description" placeholder="Optional description">
              </div>
            </div>

            <div class="flex justify-end gap-2 mt-4">
              <button type="button" class="btn btn-primary btn-sm" (click)="saveType()" [disabled]="saving">
                <span class="btn-icon">{{ editingType ? 'save' : 'add' }}</span>
                {{ saving ? 'Saving…' : (editingType ? 'Save Changes' : 'Add Shift Type') }}
              </button>
            </div>
          </div>

          <div>
            <div class="st-section-title">Work Shift Types ({{ workTypes.length }})</div>
            <div class="st-list">
              <div *ngFor="let st of workTypes" class="st-item">
                <div class="st-item-main">
                  <span class="st-dot" [style.background]="st.color"></span>
                  <span class="badge" [style.background]="st.color + '20'" [style.color]="st.color">{{ st.code }}</span>
                  <div style="min-width:0">
                    <div class="st-item-name">{{ st.name }}</div>
                    <div class="st-item-sub">
                      {{ formatTime(st.start_time) }} – {{ formatTime(st.end_time) }} · {{ formatTypeDuration(st) }}
                      <span *ngIf="st.description"> · {{ st.description }}</span>
                    </div>
                  </div>
                </div>
                <div class="flex gap-1" style="flex-shrink:0">
                  <button type="button" class="btn btn-ghost btn-icon-only btn-sm" (click)="startEdit(st)" title="Edit">
                    <span class="btn-icon" style="font-size:17px">edit</span>
                  </button>
                  <button type="button" class="btn btn-ghost btn-icon-only btn-sm" (click)="removeType(st)" title="Delete">
                    <span class="btn-icon" style="font-size:17px;color:#EF4444">delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="st-section-title">Leave &amp; Time Off Types ({{ leaveTypes.length }})</div>
            <div class="st-list">
              <div *ngFor="let st of leaveTypes" class="st-item">
                <div class="st-item-main">
                  <span class="st-dot" [style.background]="st.color"></span>
                  <span class="badge" [style.background]="st.color + '20'" [style.color]="st.color">{{ st.code }}</span>
                  <div style="min-width:0">
                    <div class="st-item-name">{{ st.name }}</div>
                    <div class="st-item-sub" *ngIf="st.description">{{ st.description }}</div>
                  </div>
                </div>
                <div class="flex gap-1" style="flex-shrink:0">
                  <button type="button" class="btn btn-ghost btn-icon-only btn-sm" (click)="startEdit(st)" title="Edit">
                    <span class="btn-icon" style="font-size:17px">edit</span>
                  </button>
                  <button type="button" class="btn btn-ghost btn-icon-only btn-sm" (click)="removeType(st)" title="Delete">
                    <span class="btn-icon" style="font-size:17px;color:#EF4444">delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" (click)="close.emit()">Done</button>
        </div>
      </div>
    </div>
  `,
})
export class ShiftTypesModalComponent implements OnChanges {
  @Input() open = false;
  @Input() shiftTypes: ShiftType[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() changed = new EventEmitter<void>();

  readonly presetColors = PRESET_COLORS;
  editingType: ShiftType | null = null;
  saving = false;

  form: {
    name: string;
    code: string;
    category: ShiftTypeCategory;
    start_time: string;
    end_time: string;
    color: string;
    description: string;
  } = this.emptyForm();

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    private readonly confirm: ConfirmService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.resetForm();
    }
  }

  get workTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category !== 'LEAVE');
  }

  get leaveTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category === 'LEAVE');
  }

  formatTime(value?: string): string {
    return formatTimeShort(value) || '00:00';
  }

  formatTypeDuration(st: ShiftType): string {
    return formatHours(calculateShiftHours(st.start_time, st.end_time), { zeroLabel: '0h' });
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  onCategoryChange(category: ShiftTypeCategory): void {
    if (category === 'LEAVE') {
      this.form.start_time = '00:00';
      this.form.end_time = '00:00';
    } else if (this.form.start_time === '00:00' && this.form.end_time === '00:00') {
      this.form.start_time = '08:00';
      this.form.end_time = '16:00';
    }
  }

  startEdit(st: ShiftType): void {
    this.editingType = st;
    this.form = {
      name: st.name,
      code: st.code,
      category: st.category || 'WORK',
      start_time: formatTimeShort(st.start_time) || '08:00',
      end_time: formatTimeShort(st.end_time) || '16:00',
      color: st.color || '#1565C0',
      description: st.description || '',
    };
    this.cdr.markForCheck();
  }

  resetForm(): void {
    this.editingType = null;
    this.form = this.emptyForm();
    this.cdr.markForCheck();
  }

  saveType(): void {
    const name = this.form.name.trim();
    const code = this.form.code.trim().toUpperCase();
    if (!name || !code) {
      this.toast.warning('Name and Code are required.');
      return;
    }

    this.saving = true;
    const payload = {
      name,
      code,
      category: this.form.category,
      start_time: this.form.category === 'LEAVE' ? '00:00:00' : this.form.start_time,
      end_time: this.form.category === 'LEAVE' ? '00:00:00' : this.form.end_time,
      color: this.form.color,
      description: this.form.description.trim() || null,
    };

    const req$ = this.editingType
      ? this.api.put<any>(`/shifts/types/${this.editingType.id}`, payload)
      : this.api.post<any>('/shifts/types', payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(this.editingType ? 'Shift type updated.' : 'Shift type created.');
        this.resetForm();
        this.changed.emit();
      },
      error: (err: any) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save shift type.');
        this.cdr.markForCheck();
      },
    });
  }

  async removeType(st: ShiftType): Promise<void> {
    const confirmed = await this.confirm.confirm(
      `Delete "${st.name}" (${st.code})? Types already assigned to shifts cannot be removed.`,
      'Delete Shift Type'
    );
    if (!confirmed) return;

    this.api.delete<any>(`/shifts/types/${st.id}`).subscribe({
      next: () => {
        this.toast.success('Shift type deleted.');
        if (this.editingType?.id === st.id) this.resetForm();
        this.changed.emit();
      },
      error: (err: any) => {
        this.toast.error(err?.error?.message || 'Cannot delete shift type.');
      },
    });
  }

  private emptyForm() {
    return {
      name: '',
      code: '',
      category: 'WORK' as ShiftTypeCategory,
      start_time: '08:00',
      end_time: '16:00',
      color: '#1565C0',
      description: '',
    };
  }
}
