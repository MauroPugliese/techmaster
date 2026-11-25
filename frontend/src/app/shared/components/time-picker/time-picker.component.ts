// =============================================================================
// time-picker.component.ts — Compact CDK Overlay 24h HH:MM Picker (SMaRT UI)
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
  buildMinuteOptions,
  clampInt,
  HOURS_24,
  pad2
} from '../datetime-picker/datetime-picker.utils';

const OVERLAY_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 5 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 5 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -5 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -5 }
];

function parseHhMm(raw: unknown): { h: number; m: number } {
  const s = String(raw ?? '').trim();
  const match = /^(\d{1,2}):(\d{1,2})/.exec(s);
  if (!match) return { h: 0, m: 0 };
  return {
    h: clampInt(match[1], 0, 23, 0),
    m: clampInt(match[2], 0, 59, 0)
  };
}

@Component({
  selector: 'app-time-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, OverlayModule],
  templateUrl: './time-picker.component.html',
  styleUrls: ['./time-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TimePickerComponent),
      multi: true
    }
  ]
})
export class TimePickerComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() compact = false;
  @Input() borderless = false;
  @Input() allowReset = true;
  @Input() dimZero = false;
  @Input() showIcon = true;
  @Input() minuteStep = 5;
  @Input() disabled = false;
  @Input() ariaLabel = 'Select time';

  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('triggerOrigin', { static: true }) triggerOrigin!: ElementRef<HTMLElement>;
  @ViewChild('popoverTpl', { static: true }) popoverTpl!: TemplateRef<unknown>;
  @ViewChild('hourList') hourListRef?: ElementRef<HTMLElement>;
  @ViewChild('minuteList') minuteListRef?: ElementRef<HTMLElement>;

  readonly hours24 = HOURS_24;
  readonly pad2 = pad2;

  minuteOptions: number[] = buildMinuteOptions(5);
  value = '00:00';
  activeHour = 0;
  activeMinute = 0;
  hourText = '00';
  minuteText = '00';
  open = false;

  private overlayRef: OverlayRef | null = null;
  private overlaySubs = new Subscription();
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (val: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(
    private overlay: Overlay,
    private vcr: ViewContainerRef,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['minuteStep']) {
      this.minuteOptions = buildMinuteOptions(this.minuteStep);
    }
  }

  ngOnDestroy(): void {
    this.destroyOverlay();
  }

  get isZero(): boolean {
    return this.value === '00:00';
  }

  // ── ControlValueAccessor ───────────────────────────────────────────────────
  writeValue(raw: unknown): void {
    const { h, m } = parseHhMm(raw);
    this.activeHour = h;
    this.activeMinute = m;
    this.hourText = pad2(h);
    this.minuteText = pad2(m);
    this.value = `${this.hourText}:${this.minuteText}`;
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (val: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (isDisabled && this.open) {
      this.closePopover();
    }
    this.cdr.markForCheck();
  }

  // ── Popover Lifecycle ──────────────────────────────────────────────────────
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

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.triggerOrigin)
      .withPositions(OVERLAY_POSITIONS)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withViewportMargin(10);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop'
    });

    const portal = new TemplatePortal(this.popoverTpl, this.vcr);
    this.overlayRef.attach(portal);
    this.open = true;

    this.overlaySubs = new Subscription();
    this.overlaySubs.add(
      this.overlayRef.backdropClick().subscribe(() => this.closePopover())
    );
    this.overlaySubs.add(
      this.overlayRef.keydownEvents().subscribe((ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          this.closePopover();
        }
      })
    );

    this.cdr.markForCheck();
    this.scheduleTimeScroll();
  }

  closePopover(): void {
    if (!this.open && !this.overlayRef) return;
    this.open = false;
    this.destroyOverlay();
    this.onTouched();
    this.cdr.markForCheck();
  }

  private destroyOverlay(): void {
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
  }

  private scheduleTimeScroll(): void {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      this.scrollActiveIntoView(this.hourListRef?.nativeElement);
      this.scrollActiveIntoView(this.minuteListRef?.nativeElement);
    }, 0);
  }

  private scrollActiveIntoView(container?: HTMLElement): void {
    if (!container) return;
    const active = container.querySelector('.tp-opt.active') as HTMLElement | null;
    if (!active) return;
    container.scrollTop = Math.max(0, active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2);
  }

  // ── Time Actions ───────────────────────────────────────────────────────────
  selectHour(h: number): void {
    this.commitTime(h, this.activeMinute);
  }

  selectMinute(m: number): void {
    this.commitTime(this.activeHour, m);
  }

  onHourInputCommit(closeOnEnter = false): void {
    const h = clampInt(this.hourText, 0, 23, this.activeHour);
    this.commitTime(h, this.activeMinute);
    if (closeOnEnter) this.closePopover();
  }

  onMinuteInputCommit(closeOnEnter = false): void {
    const m = clampInt(this.minuteText, 0, 59, this.activeMinute);
    this.commitTime(this.activeHour, m);
    if (closeOnEnter) this.closePopover();
  }

  setNow(): void {
    const now = new Date();
    this.commitTime(now.getHours(), now.getMinutes());
    this.scheduleTimeScroll();
  }

  resetZero(): void {
    this.commitTime(0, 0);
    this.closePopover();
  }

  private commitTime(h: number, m: number): void {
    const safeH = clampInt(h, 0, 23, 0);
    const safeM = clampInt(m, 0, 59, 0);
    const next = `${pad2(safeH)}:${pad2(safeM)}`;
    const changed = next !== this.value;
    this.activeHour = safeH;
    this.activeMinute = safeM;
    this.hourText = pad2(safeH);
    this.minuteText = pad2(safeM);
    this.value = next;

    if (changed) {
      this.onChange(next);
      this.valueChange.emit(next);
    }
    this.cdr.markForCheck();
  }
}
