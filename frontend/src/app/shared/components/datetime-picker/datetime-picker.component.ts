// =============================================================================
// datetime-picker.component.ts — Compact Immediate Date & Time Overlay Picker
// =============================================================================
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ConnectedPosition, Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Subscription } from 'rxjs';

import {
  buildCalendarGrid,
  buildMinuteOptions,
  CalendarDay,
  clampInt,
  DateTimePickerMode,
  formatDisplayDate,
  HOURS_24,
  MONTH_LONG,
  MONTH_SHORT,
  pad2,
  parseDefaultTime,
  parseIncomingDate,
  WEEKDAY_LABELS,
  withDatePart,
  withTimePart
} from './datetime-picker.utils';

const OVERLAY_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 }
];

@Component({
  selector: 'app-datetime-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, OverlayModule],
  templateUrl: './datetime-picker.component.html',
  styleUrls: ['./datetime-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateTimePickerComponent),
      multi: true
    }
  ]
})
export class DateTimePickerComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() mode: DateTimePickerMode = 'datetime';
  @Input() placeholder = '';
  @Input() clearable = true;
  @Input() disabled = false;
  @Input() defaultTime = 'now';
  @Input() minuteStep = 5;
  @Input() minDate: Date | string | null = null;
  @Input() maxDate: Date | string | null = null;
  @Input() ariaLabel = '';

  @Output() valueChange = new EventEmitter<Date | null>();

  @ViewChild('triggerOrigin', { static: true }) triggerOrigin!: ElementRef<HTMLElement>;
  @ViewChild('popoverTpl', { static: true }) popoverTpl!: TemplateRef<unknown>;
  @ViewChild('hourList') hourListRef?: ElementRef<HTMLElement>;
  @ViewChild('minuteList') minuteListRef?: ElementRef<HTMLElement>;

  readonly weekdayLabels = WEEKDAY_LABELS;
  readonly monthShort = MONTH_SHORT;
  readonly hours24 = HOURS_24;
  readonly pad2 = pad2;

  minuteOptions: number[] = buildMinuteOptions(5);
  value: Date | null = null;
  open = false;
  showMonthYear = false;

  viewYear = new Date().getFullYear();
  viewMonth = new Date().getMonth();
  calendarDays: CalendarDay[] = [];

  hourText = '09';
  minuteText = '00';

  private overlayRef: OverlayRef | null = null;
  private overlaySubs = new Subscription();
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (val: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(
    private overlay: Overlay,
    private vcr: ViewContainerRef,
    private cdr: ChangeDetectorRef
  ) {
    this.rebuildGrid();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['minuteStep']) {
      this.minuteOptions = buildMinuteOptions(this.minuteStep);
    }
    if (changes['minDate'] || changes['maxDate'] || changes['mode']) {
      this.rebuildGrid();
    }
  }

  // ── Display getters ────────────────────────────────────────────────────────
  get displayValue(): string {
    return formatDisplayDate(this.value, this.mode);
  }

  get effectivePlaceholder(): string {
    if (this.placeholder) return this.placeholder;
    return this.mode === 'datetime' ? 'Select date & time' : 'Select date';
  }

  get monthLabel(): string {
    return MONTH_LONG[this.viewMonth] || MONTH_LONG[0];
  }

  get activeHour(): number {
    return clampInt(this.hourText, 0, 23, this.fallbackTime().hours);
  }

  get activeMinute(): number {
    return clampInt(this.minuteText, 0, 59, this.fallbackTime().minutes);
  }

  // ── ControlValueAccessor ───────────────────────────────────────────────────
  writeValue(raw: Date | string | null | undefined): void {
    this.value = parseIncomingDate(raw);
    this.syncViewFromValue();
    this.rebuildGrid();
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (val: Date | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (isDisabled && this.open) this.closePopover();
    this.cdr.markForCheck();
  }

  // ── Overlay Lifecycle ──────────────────────────────────────────────────────
  togglePopover(): void {
    if (this.disabled) return;
    if (this.open) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  openPopover(): void {
    if (this.disabled || this.open) return;

    this.showMonthYear = false;
    this.syncViewFromValue();
    this.rebuildGrid();

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.triggerOrigin)
      .withPositions(OVERLAY_POSITIONS)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withViewportMargin(8);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop'
    });

    this.overlaySubs.unsubscribe();
    this.overlaySubs = new Subscription();

    this.overlaySubs.add(
      this.overlayRef.backdropClick().subscribe(() => this.closePopover())
    );
    this.overlaySubs.add(
      this.overlayRef.keydownEvents().subscribe((ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          this.closePopover();
        }
      })
    );

    const portal = new TemplatePortal(this.popoverTpl, this.vcr);
    this.overlayRef.attach(portal);
    this.open = true;
    this.cdr.markForCheck();

    if (this.mode === 'datetime') {
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.scrollTimeColumnsToActive(), 0);
    }
  }

  closePopover(): void {
    if (!this.open && !this.overlayRef) return;
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.overlaySubs.unsubscribe();
    this.overlaySubs = new Subscription();
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    this.open = false;
    this.showMonthYear = false;
    this.onTouched();
    this.cdr.markForCheck();
  }

  // ── Calendar & Time Interactions ───────────────────────────────────────────
  prevMonth(): void {
    if (this.viewMonth === 0) {
      this.viewMonth = 11;
      this.viewYear -= 1;
    } else {
      this.viewMonth -= 1;
    }
    this.rebuildGrid();
  }

  nextMonth(): void {
    if (this.viewMonth === 11) {
      this.viewMonth = 0;
      this.viewYear += 1;
    } else {
      this.viewMonth += 1;
    }
    this.rebuildGrid();
  }

  toggleMonthYear(): void {
    this.showMonthYear = !this.showMonthYear;
  }

  prevYear(): void {
    this.viewYear -= 1;
    this.rebuildGrid();
  }

  nextYear(): void {
    this.viewYear += 1;
    this.rebuildGrid();
  }

  pickMonth(monthIndex: number): void {
    this.viewMonth = monthIndex;
    this.showMonthYear = false;
    this.rebuildGrid();
  }

  selectDay(cell: CalendarDay): void {
    if (cell.isDisabled) return;

    const time = this.mode === 'date'
      ? { hours: 0, minutes: 0 }
      : { hours: this.activeHour, minutes: this.activeMinute };

    const baseForTime = this.mode === 'datetime'
      ? (this.value ?? new Date(2000, 0, 1, time.hours, time.minutes, 0, 0))
      : null;

    const next = withDatePart(
      baseForTime,
      cell.date.getFullYear(),
      cell.date.getMonth(),
      cell.date.getDate(),
      time
    );

    this.viewYear = next.getFullYear();
    this.viewMonth = next.getMonth();
    this.commitValue(next);

    if (this.mode === 'date') {
      this.closePopover();
    }
  }

  selectHour(h: number): void {
    const cleanH = clampInt(h, 0, 23, this.activeHour);
    this.hourText = pad2(cleanH);
    const base = this.value ?? new Date(this.viewYear, this.viewMonth, new Date().getDate());
    this.commitValue(withTimePart(base, cleanH, this.activeMinute));
  }

  selectMinute(m: number): void {
    const cleanM = clampInt(m, 0, 59, this.activeMinute);
    this.minuteText = pad2(cleanM);
    const base = this.value ?? new Date(this.viewYear, this.viewMonth, new Date().getDate());
    this.commitValue(withTimePart(base, this.activeHour, cleanM));
  }

  onHourInputCommit(): void {
    const fallback = this.value ? this.value.getHours() : this.fallbackTime().hours;
    const h = clampInt(this.hourText, 0, 23, fallback);
    this.selectHour(h);
    this.scrollTimeColumnsToActive();
  }

  onMinuteInputCommit(): void {
    const fallback = this.value ? this.value.getMinutes() : this.fallbackTime().minutes;
    const m = clampInt(this.minuteText, 0, 59, fallback);
    this.selectMinute(m);
    this.scrollTimeColumnsToActive();
  }

  selectNow(): void {
    const now = new Date();
    const next = this.mode === 'date'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

    this.viewYear = next.getFullYear();
    this.viewMonth = next.getMonth();
    this.commitValue(next);
    this.closePopover();
  }

  clearValue(event?: Event): void {
    event?.stopPropagation();
    if (this.disabled) return;
    this.commitValue(null);
    this.closePopover();
  }

  trackByDayKey = (_: number, day: CalendarDay) => day.key;

  // ── Internal helpers ───────────────────────────────────────────────────────
  private fallbackTime(): { hours: number; minutes: number } {
    return parseDefaultTime(this.defaultTime);
  }

  private syncViewFromValue(): void {
    if (this.value) {
      this.viewYear = this.value.getFullYear();
      this.viewMonth = this.value.getMonth();
      this.hourText = pad2(this.value.getHours());
      this.minuteText = pad2(this.value.getMinutes());
      return;
    }

    const ref = new Date();
    const fb = this.fallbackTime();
    this.viewYear = ref.getFullYear();
    this.viewMonth = ref.getMonth();
    this.hourText = pad2(fb.hours);
    this.minuteText = pad2(fb.minutes);
  }

  private commitValue(next: Date | null): void {
    this.value = next ? new Date(next.getTime()) : null;
    if (this.value) {
      this.hourText = pad2(this.value.getHours());
      this.minuteText = pad2(this.value.getMinutes());
    }
    this.rebuildGrid();
    this.onChange(this.value);
    this.valueChange.emit(this.value);
    this.cdr.markForCheck();
  }

  private rebuildGrid(): void {
    const min = parseIncomingDate(this.minDate);
    const max = parseIncomingDate(this.maxDate);
    this.calendarDays = buildCalendarGrid(this.viewYear, this.viewMonth, this.value, min, max);
  }

  private scrollTimeColumnsToActive(): void {
    this.centerSelectedInColumn(this.hourListRef?.nativeElement);
    this.centerSelectedInColumn(this.minuteListRef?.nativeElement);
  }

  private centerSelectedInColumn(colEl?: HTMLElement): void {
    if (!colEl) return;
    const activeEl = colEl.querySelector('.dtp-t-opt.active') as HTMLElement | null;
    if (!activeEl) return;
    colEl.scrollTop = Math.max(0, activeEl.offsetTop - colEl.clientHeight / 2 + activeEl.clientHeight / 2);
  }

  ngOnDestroy(): void {
    this.closePopover();
  }
}
