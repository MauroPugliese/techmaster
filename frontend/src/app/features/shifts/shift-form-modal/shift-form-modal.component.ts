// =============================================================================
// shift-form-modal.component.ts — Schedule & Edit Work, Custom OT, Leave Modal
// =============================================================================
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiCustomizationService, UiSectionPreferences } from '../../../core/services/ui-customization.service';
import {
  Shift,
  ShiftEmployee,
  ShiftEntryKind,
  ShiftLeaveType,
  ShiftStatus,
  ShiftType,
} from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd } from '../../../shared/components/datetime-picker/datetime-picker.utils';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import {
  buildDateRangeYmd,
  calculateShiftHours,
  checkClientLaborLawAdvisory,
  combineHmToHours,
  formatHours,
  formatTimeShort,
  getLeaveMeta,
  getShiftEffectiveInfo,
  inferLeaveType,
  shiftTimeByMinutes,
  splitHoursToHm,
  toHms,
} from '../shift-helpers';

export type ShiftFormMode = 'WORK' | 'CUSTOM' | 'LEAVE';
export type DateSelectionMode = 'single' | 'weekdays' | 'range';

@Component({
  selector: 'app-shift-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    DateTimePickerComponent,
    DropdownComponent,
    DropdownOptionComponent,
  ],
  templateUrl: './shift-form-modal.component.html',
  styleUrl: './shift-form-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShiftFormModalComponent implements OnChanges, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  @Input() open = false;
  @Input() editingShift: Shift | null = null;
  @Input() defaultUserId: number | undefined;
  @Input() defaultDate: Date | undefined;
  @Input() defaultMode: ShiftFormMode = 'WORK';
  @Input() weekStart!: Date;
  @Input() weekEnd!: Date;
  @Input() weekDays: Date[] = [];
  @Input() allEmployees: ShiftEmployee[] = [];
  @Input() shiftTypes: ShiftType[] = [];
  @Input() loadedShifts: Shift[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<Shift>();

  saving = false;
  formMode: ShiftFormMode = 'WORK';
  dateSelectionMode: DateSelectionMode = 'single';
  selectedWeekdays: string[] = [];
  rangeStartDate: Date | null = null;
  rangeEndDate: Date | null = null;
  skipWeekends = true;
  overwriteOnConflict = false;
  autoSyncOvertime = true;
  laborLawAdvisory: string | null = null;

  readonly reasonPresets = ['Overtime', 'Early Leave', 'Extended Coverage', 'Custom Hours'];

  form: {
    user_id: number | null;
    shift_type_id: number | null;
    supervisor_id: number | null;
    date: Date | null;
    status: ShiftStatus;
    custom_start_time: string;
    custom_end_time: string;
    overtime_hours: number;
    ot_hours_part: number;
    ot_minutes_part: number;
    adjustment_reason: string;
    leave_type: ShiftLeaveType | null;
    notes: string;
  } = this.emptyForm();

  constructor(
    private readonly api: ApiService,
    private readonly toast: ToastService,
    private readonly uiCustomization: UiCustomizationService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.initializeFormState();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get workShiftTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category !== 'LEAVE');
  }

  get standardWorkShiftTypes(): ShiftType[] {
    const nonCst = this.workShiftTypes.filter(st => st.code.toUpperCase() !== 'CST');
    return nonCst.length ? nonCst : this.workShiftTypes;
  }

  get leaveShiftTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category === 'LEAVE');
  }

  get previewEffectiveTiming(): {
    standardStart: string;
    standardEnd: string;
    standardHours: number;
    effectiveHours: number;
    deltaHours: number;
  } {
    const selected = this.shiftTypes.find(st => st.id === this.form.shift_type_id);
    const stdStart = formatTimeShort(selected?.start_time) || '08:00';
    const stdEnd = formatTimeShort(selected?.end_time) || '16:00';
    const effStart = this.form.custom_start_time || stdStart;
    const effEnd = this.form.custom_end_time || stdEnd;
    const standardHours = calculateShiftHours(stdStart, stdEnd);
    const effectiveHours = calculateShiftHours(effStart, effEnd);
    return {
      standardStart: stdStart,
      standardEnd: stdEnd,
      standardHours,
      effectiveHours,
      deltaHours: Math.round((effectiveHours - standardHours) * 100) / 100,
    };
  }

  get resolvedTargetDatesPreview(): string[] {
    if (this.editingShift) {
      return this.form.date ? [formatLocalYmd(this.form.date)] : [];
    }
    if (this.dateSelectionMode === 'weekdays') {
      return [...this.selectedWeekdays].sort();
    }
    if (this.dateSelectionMode === 'range') {
      return buildDateRangeYmd(this.rangeStartDate, this.rangeEndDate, this.skipWeekends);
    }
    return this.form.date ? [formatLocalYmd(this.form.date)] : [];
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, 'form', fieldKey, fallback);
  }

  formatTime(value?: string | null): string {
    return formatTimeShort(value) || '—';
  }

  formatHrs(hours: number): string {
    return formatHours(hours, { zeroLabel: '0h' });
  }

  formatSignedHrs(hours: number): string {
    return formatHours(hours, { signed: true });
  }

  getLeaveIcon(st: ShiftType): string {
    return getLeaveMeta(null, st).icon;
  }

  isWeekdaySelected(day: Date): boolean {
    return this.selectedWeekdays.includes(formatLocalYmd(day));
  }

  setFormMode(mode: ShiftFormMode): void {
    if (this.formMode === mode) return;
    this.formMode = mode;

    if (mode === 'LEAVE') {
      const currentIsLeave = this.leaveShiftTypes.some(t => t.id === this.form.shift_type_id);
      const leaveType = currentIsLeave
        ? this.shiftTypes.find(t => t.id === this.form.shift_type_id)
        : this.pickDefaultType('LEAVE');

      this.form.shift_type_id = leaveType?.id ?? null;
      this.form.leave_type = inferLeaveType(leaveType);
      this.form.status = 'ON_LEAVE';
      this.setOvertimeDecimal(0);
      if (this.dateSelectionMode === 'weekdays') {
        this.dateSelectionMode = 'single';
      }
    } else {
      const currentType = this.shiftTypes.find(t => t.id === this.form.shift_type_id);
      const needsWorkType = !currentType || currentType.category === 'LEAVE';
      const targetType = needsWorkType ? this.pickDefaultType(mode) : currentType;

      this.form.shift_type_id = targetType?.id ?? null;
      this.form.leave_type = null;
      if (this.form.status === 'ON_LEAVE') {
        this.form.status = 'SCHEDULED';
      }

      const stdStart = formatTimeShort(targetType?.start_time) || '08:00';
      const stdEnd = formatTimeShort(targetType?.end_time) || '16:00';
      this.form.custom_start_time = stdStart;
      this.form.custom_end_time = stdEnd;

      if (mode === 'CUSTOM') {
        this.syncOvertimeFromCustomHours();
      } else if (!this.editingShift) {
        this.setOvertimeDecimal(0);
        this.form.adjustment_reason = '';
      }
    }

    this.refreshLaborLawAdvisory();
    this.cdr.markForCheck();
  }

  selectShiftType(typeId: number): void {
    this.form.shift_type_id = typeId;
    const selected = this.shiftTypes.find(t => t.id === typeId);
    if (!selected) return;

    if (this.formMode === 'LEAVE') {
      this.form.leave_type = inferLeaveType(selected);
    } else {
      this.form.custom_start_time = formatTimeShort(selected.start_time) || '08:00';
      this.form.custom_end_time = formatTimeShort(selected.end_time) || '16:00';
      if (this.formMode === 'CUSTOM') {
        this.autoSyncOvertime = true;
        this.syncOvertimeFromCustomHours();
      }
    }

    this.refreshLaborLawAdvisory();
    this.cdr.markForCheck();
  }

  onCustomTimeChanged(): void {
    this.autoSyncOvertime = true;
    this.syncOvertimeFromCustomHours();
    this.refreshLaborLawAdvisory();
  }

  onOvertimePartsChange(): void {
    this.autoSyncOvertime = false;
    let h = Math.max(0, Math.floor(Number(this.form.ot_hours_part) || 0));
    let m = Math.max(0, Math.floor(Number(this.form.ot_minutes_part) || 0));
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
    if (h >= 24) {
      h = 24;
      m = 0;
    }
    this.form.ot_hours_part = h;
    this.form.ot_minutes_part = m;
    this.form.overtime_hours = combineHmToHours(h, m);
  }

  applyQuickAdjustment(deltaMinutes: number): void {
    const selectedType = this.shiftTypes.find(st => st.id === this.form.shift_type_id);
    const stdStart = formatTimeShort(selectedType?.start_time) || '08:00';
    const stdEnd = formatTimeShort(selectedType?.end_time) || '16:00';

    if (deltaMinutes === 0) {
      this.form.custom_start_time = stdStart;
      this.form.custom_end_time = stdEnd;
      this.setOvertimeDecimal(0);
      this.form.adjustment_reason = '';
    } else {
      this.form.custom_start_time = this.form.custom_start_time || stdStart;
      this.form.custom_end_time = shiftTimeByMinutes(stdEnd, deltaMinutes);
      this.autoSyncOvertime = true;
      this.syncOvertimeFromCustomHours();
      const delta = this.previewEffectiveTiming.deltaHours;
      this.form.adjustment_reason = delta > 0 ? 'Overtime' : delta < 0 ? 'Early Leave' : 'Custom Hours';
    }

    this.refreshLaborLawAdvisory();
    this.cdr.markForCheck();
  }

  toggleWeekdayChip(day: Date): void {
    const ymd = formatLocalYmd(day);
    if (this.selectedWeekdays.includes(ymd)) {
      if (this.selectedWeekdays.length > 1) {
        this.selectedWeekdays = this.selectedWeekdays.filter(d => d !== ymd);
      }
    } else {
      this.selectedWeekdays = [...this.selectedWeekdays, ymd].sort();
    }
    this.refreshLaborLawAdvisory();
  }

  selectWeekdaysPreset(kind: 'mon-fri' | 'all'): void {
    this.selectedWeekdays = this.weekDays
      .filter(d => kind === 'all' || (d.getDay() !== 0 && d.getDay() !== 6))
      .map(d => formatLocalYmd(d));
    this.refreshLaborLawAdvisory();
  }

  refreshLaborLawAdvisory(): void {
    if (!this.form.user_id || !this.form.shift_type_id) {
      this.laborLawAdvisory = null;
      return;
    }

    const preview = this.previewEffectiveTiming;
    const dates = this.resolvedTargetDatesPreview;
    const startTime =
      this.formMode === 'LEAVE'
        ? null
        : this.formMode === 'CUSTOM'
          ? this.form.custom_start_time
          : preview.standardStart;
    const endTime =
      this.formMode === 'LEAVE'
        ? null
        : this.formMode === 'CUSTOM'
          ? this.form.custom_end_time
          : preview.standardEnd;

    this.laborLawAdvisory = checkClientLaborLawAdvisory(
      {
        userId: this.form.user_id,
        dates,
        startTime,
        endTime,
        isLeave: this.formMode === 'LEAVE',
        excludeShiftId: this.editingShift?.id ?? null,
      },
      this.loadedShifts,
      this.shiftTypes
    );
  }

  saveShift(): void {
    if (!this.form.user_id) {
      this.toast.warning('Please select an employee.');
      return;
    }
    if (!this.form.shift_type_id) {
      this.toast.warning(this.formMode === 'LEAVE' ? 'Please select a leave type.' : 'Please select a shift type.');
      return;
    }

    const dates = this.resolvedTargetDatesPreview;
    if (!dates.length) {
      this.toast.warning('Please select at least one valid date.');
      return;
    }

    if (this.formMode === 'CUSTOM' && (!this.form.custom_start_time || !this.form.custom_end_time)) {
      this.toast.warning('Please specify custom start and end times.');
      return;
    }

    const payloadBase = this.buildPayloadBase();
    this.saving = true;

    if (this.editingShift) {
      this.api
        .put<any>(`/shifts/${this.editingShift.id}`, { ...payloadBase, date: dates[0] })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.saving = false;
            this.toast.success('Shift updated.');
            this.saved.emit();
          },
          error: err => {
            this.saving = false;
            this.toast.error(err?.error?.message || 'Failed to update shift.');
            this.cdr.markForCheck();
          },
        });
      return;
    }

    if (dates.length === 1 && !this.overwriteOnConflict) {
      this.api
        .post<any>('/shifts', { ...payloadBase, date: dates[0] })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.saving = false;
            this.toast.success(this.formMode === 'LEAVE' ? 'Leave scheduled.' : 'Shift scheduled.');
            this.saved.emit();
          },
          error: err => {
            this.saving = false;
            this.toast.error(err?.error?.message || 'Failed to schedule shift.');
            this.cdr.markForCheck();
          },
        });
      return;
    }

    this.api
      .post<any>('/shifts/bulk', {
        ...payloadBase,
        dates,
        overwrite: this.overwriteOnConflict,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.saving = false;
          const d = res?.data || {};
          const parts = [
            d.createdCount ? `${d.createdCount} created` : '',
            d.updatedCount ? `${d.updatedCount} updated` : '',
            d.skippedCount ? `${d.skippedCount} skipped` : '',
          ].filter(Boolean);
          this.toast.success(`Bulk schedule applied: ${parts.join(', ')}.`);
          this.saved.emit();
        },
        error: err => {
          this.saving = false;
          this.toast.error(err?.error?.message || 'Bulk scheduling failed.');
          this.cdr.markForCheck();
        },
      });
  }

  private initializeFormState(): void {
    this.saving = false;
    this.dateSelectionMode = 'single';
    this.skipWeekends = true;
    this.overwriteOnConflict = false;

    if (this.editingShift) {
      this.autoSyncOvertime = false;
      const info = getShiftEffectiveInfo(this.editingShift, this.shiftTypes);
      this.formMode = info.isLeave ? 'LEAVE' : info.isCustom ? 'CUSTOM' : 'WORK';
      const parsedDate = this.editingShift.date ? new Date(`${this.editingShift.date}T00:00:00`) : new Date();

      const initialOt = Number(this.editingShift.overtime_hours) || 0;
      const otParts = splitHoursToHm(initialOt);
      this.form = {
        user_id: this.editingShift.user_id,
        shift_type_id: this.editingShift.shift_type_id,
        supervisor_id: this.editingShift.supervisor_id ?? null,
        date: parsedDate,
        status: this.editingShift.status,
        custom_start_time: info.start || info.standardStart,
        custom_end_time: info.end || info.standardEnd,
        overtime_hours: initialOt,
        ot_hours_part: otParts.hours,
        ot_minutes_part: otParts.minutes,
        adjustment_reason: this.editingShift.adjustment_reason || '',
        leave_type: info.leaveType,
        notes: this.editingShift.notes || '',
      };
    } else {
      this.autoSyncOvertime = true;
      this.formMode = this.defaultMode || 'WORK';
      const ref = this.defaultDate || this.weekStart || new Date();
      const baseDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
      this.selectedWeekdays = [formatLocalYmd(baseDate)];
      this.rangeStartDate = new Date(baseDate);
      this.rangeEndDate = this.weekEnd ? new Date(this.weekEnd) : new Date(baseDate);

      const defaultType = this.pickDefaultType(this.formMode);
      this.form = {
        user_id: this.defaultUserId ?? null,
        shift_type_id: defaultType?.id ?? null,
        supervisor_id: null,
        date: baseDate,
        status: this.formMode === 'LEAVE' ? 'ON_LEAVE' : 'SCHEDULED',
        custom_start_time: formatTimeShort(defaultType?.start_time) || '08:00',
        custom_end_time: formatTimeShort(defaultType?.end_time) || '16:00',
        overtime_hours: 0,
        ot_hours_part: 0,
        ot_minutes_part: 0,
        adjustment_reason: '',
        leave_type: this.formMode === 'LEAVE' ? inferLeaveType(defaultType) : null,
        notes: '',
      };
    }

    this.refreshLaborLawAdvisory();
    this.cdr.markForCheck();
  }

  private buildPayloadBase(): Record<string, unknown> {
    const entryKind: ShiftEntryKind = this.formMode;
    const base: Record<string, unknown> = {
      user_id: this.form.user_id,
      shift_type_id: this.form.shift_type_id,
      supervisor_id: this.form.supervisor_id || null,
      entry_kind: entryKind,
      status: this.formMode === 'LEAVE' ? 'ON_LEAVE' : this.form.status,
      notes: this.form.notes?.trim() || null,
    };

    if (this.formMode === 'LEAVE') {
      base['leave_type'] = this.form.leave_type;
      base['adjustment_reason'] = this.form.adjustment_reason?.trim() || null;
      base['overtime_hours'] = 0;
    } else if (this.formMode === 'CUSTOM') {
      base['custom_start_time'] = toHms(this.form.custom_start_time);
      base['custom_end_time'] = toHms(this.form.custom_end_time);
      base['overtime_hours'] = Number(this.form.overtime_hours) || 0;
      base['adjustment_reason'] = this.form.adjustment_reason?.trim() || null;
    } else {
      base['custom_start_time'] = null;
      base['custom_end_time'] = null;
      base['overtime_hours'] = Number(this.form.overtime_hours) || 0;
      base['adjustment_reason'] = this.form.adjustment_reason?.trim() || null;
    }

    return base;
  }

  private pickDefaultType(mode: ShiftFormMode): ShiftType | undefined {
    if (mode === 'LEAVE') {
      return this.leaveShiftTypes.find(t => t.code === 'VAC') || this.leaveShiftTypes[0];
    }
    if (mode === 'CUSTOM') {
      return this.workShiftTypes.find(t => t.code === 'CST') || this.workShiftTypes[0];
    }
    return this.standardWorkShiftTypes[0];
  }

  private syncOvertimeFromCustomHours(): void {
    if (!this.autoSyncOvertime) return;
    const { deltaHours } = this.previewEffectiveTiming;
    this.setOvertimeDecimal(deltaHours > 0 ? deltaHours : 0);
  }

  private setOvertimeDecimal(decimalHours: number): void {
    const clean = Math.max(0, Number(decimalHours) || 0);
    this.form.overtime_hours = clean;
    const parts = splitHoursToHm(clean);
    this.form.ot_hours_part = parts.hours;
    this.form.ot_minutes_part = parts.minutes;
  }

  private emptyForm() {
    return {
      user_id: null as number | null,
      shift_type_id: null as number | null,
      supervisor_id: null as number | null,
      date: new Date() as Date | null,
      status: 'SCHEDULED' as ShiftStatus,
      custom_start_time: '08:00',
      custom_end_time: '16:00',
      overtime_hours: 0,
      ot_hours_part: 0,
      ot_minutes_part: 0,
      adjustment_reason: '',
      leave_type: null as ShiftLeaveType | null,
      notes: '',
    };
  }
}
