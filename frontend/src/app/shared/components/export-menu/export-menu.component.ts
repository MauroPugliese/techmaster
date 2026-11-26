import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ExportFormat,
  ExportFormatOption,
  ExportService,
} from '../../../core/services/export.service';
import { DateTimePickerComponent } from '../datetime-picker/datetime-picker.component';
import { formatLocalYmd, MONTH_SHORT } from '../datetime-picker/datetime-picker.utils';

export type ReportPeriodMode = 'active' | 'weekly' | 'monthly' | 'custom';

function computeIsoWeekBounds(offsetWeeks = 0): { start: Date; end: Date } {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetWeeks * 7);
  const dow = base.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diffToMon);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end };
}

function computeMonthBounds(offsetMonths = 0): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { start, end };
}

function formatShortHumanDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

@Component({
  selector: 'app-export-menu',
  standalone: true,
  imports: [CommonModule, FormsModule, DateTimePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="export-menu-wrapper">
      <button
        type="button"
        class="btn btn-secondary export-trigger-btn"
        [disabled]="busy"
        [attr.aria-expanded]="open"
        aria-haspopup="menu"
        (click)="toggle($event)">
        <svg *ngIf="!busy" class="export-svg-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14.5v1a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-1"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg *ngIf="busy" class="export-svg-icon export-spin" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.2"/>
          <path d="M10 3a7 7 0 017 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <span>{{ busy ? 'Generating…' : label }}</span>
        <svg class="export-svg-caret" [class.rotated]="open" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4.5 6.25L8 9.75l3.5-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div
        class="export-dropdown"
        [class.align-left]="menuAlign === 'left'"
        role="menu"
        *ngIf="open"
        (click)="$event.stopPropagation()">
        <div class="export-dropdown-header">Export A4 Executive Report</div>

        <!-- Report Period Selector (Default / Weekly / Monthly / Custom) -->
        <div class="export-period-box" *ngIf="showPeriodSelector">
          <div class="export-period-label">Report Period</div>
          <div class="export-period-pills" role="radiogroup" aria-label="Report period">
            <button
              type="button"
              class="period-pill"
              [class.active]="periodMode === 'active'"
              (click)="setPeriodMode('active')">
              Current
            </button>
            <button
              type="button"
              class="period-pill"
              [class.active]="periodMode === 'weekly'"
              (click)="setPeriodMode('weekly')">
              Weekly
            </button>
            <button
              type="button"
              class="period-pill"
              [class.active]="periodMode === 'monthly'"
              (click)="setPeriodMode('monthly')">
              Monthly
            </button>
            <button
              type="button"
              class="period-pill"
              [class.active]="periodMode === 'custom'"
              (click)="setPeriodMode('custom')">
              Custom
            </button>
          </div>

          <div class="export-period-caption" *ngIf="periodMode === 'active'">
            Uses active page filters &amp; current scope
          </div>

          <div class="export-period-nav" *ngIf="periodMode === 'weekly' || periodMode === 'monthly'">
            <button
              type="button"
              class="period-step-btn"
              (click)="stepPeriod(-1)"
              [title]="periodMode === 'weekly' ? 'Previous week' : 'Previous month'">
              ‹
            </button>
            <span class="period-window-text">{{ periodWindowLabel }}</span>
            <button
              type="button"
              class="period-step-btn"
              (click)="stepPeriod(1)"
              [title]="periodMode === 'weekly' ? 'Next week' : 'Next month'">
              ›
            </button>
          </div>

          <div class="export-custom-range" *ngIf="periodMode === 'custom'">
            <div class="custom-date-col">
              <label class="custom-date-lbl">From</label>
              <app-datetime-picker
                class="form-control export-date-input"
                mode="date"
                [clearable]="false"
                ariaLabel="Report start date"
                [(ngModel)]="customFrom">
              </app-datetime-picker>
            </div>
            <div class="custom-date-col">
              <label class="custom-date-lbl">To</label>
              <app-datetime-picker
                class="form-control export-date-input"
                mode="date"
                [clearable]="false"
                ariaLabel="Report end date"
                [(ngModel)]="customTo">
              </app-datetime-picker>
            </div>
          </div>
        </div>

        <div class="export-format-list">
          <button
            *ngFor="let fmt of formats"
            type="button"
            class="export-dropdown-item"
            role="menuitem"
            [disabled]="busy"
            (click)="download(fmt.value)">
            <span class="export-item-icon" [ngClass]="'fmt-' + fmt.value">
              <ng-container [ngSwitch]="fmt.value">
                <!-- Excel -->
                <svg *ngSwitchCase="'xlsx'" class="export-fmt-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <rect x="2.5" y="3" width="15" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/>
                  <path d="M2.5 7.5h15M2.5 12h15M8 7.5V17" stroke="currentColor" stroke-width="1.5"/>
                </svg>
                <!-- Word -->
                <svg *ngSwitchCase="'docx'" class="export-fmt-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 2.5h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                  <path d="M12 2.5v4h4M6.8 10h6.4M6.8 13h6.4M6.8 16h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <!-- PDF -->
                <svg *ngSwitchCase="'pdf'" class="export-fmt-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 2.5h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                  <path d="M12 2.5v4h4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                  <rect x="6" y="10.2" width="8" height="4.8" rx="1" fill="currentColor"/>
                  <path d="M7.2 13.7V11.5h1c.45 0 .7.22.7.58 0 .37-.25.58-.7.58h-.5m2.2-1.16v2.2h.75c.6 0 .95-.42.95-1.1 0-.68-.35-1.1-.95-1.1h-.75zm2.45 0v2.2m0-2.2h1.2m-1.2 1.05h.95"
                        stroke="#FFFFFF" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <!-- PowerPoint -->
                <svg *ngSwitchCase="'pptx'" class="export-fmt-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <rect x="2.5" y="3.5" width="15" height="10.5" rx="1.6" stroke="currentColor" stroke-width="1.6"/>
                  <path d="M10 14v3.2M7 17.2h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                  <path d="M6.2 10.5V7.5M10 10.5V6.2M13.8 10.5V8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </ng-container>
            </span>
            <span class="export-item-body">
              <span class="export-item-title">{{ fmt.label }}</span>
              <span class="export-item-desc">{{ fmt.description }}</span>
            </span>
            <span class="export-item-ext">.{{ fmt.value }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .export-menu-wrapper {
      position: relative;
      display: inline-block;
    }
    .export-trigger-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .export-svg-icon {
      width: 17px;
      height: 17px;
      flex-shrink: 0;
    }
    .export-svg-caret {
      width: 15px;
      height: 15px;
      opacity: 0.75;
      transition: transform 0.15s ease;
      flex-shrink: 0;
    }
    .export-svg-caret.rotated {
      transform: rotate(180deg);
    }
    @keyframes exportSpin {
      to { transform: rotate(360deg); }
    }
    .export-spin {
      animation: exportSpin 0.9s linear infinite;
    }
    .export-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 312px;
      max-width: 92vw;
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #e1eaf5);
      border-radius: var(--radius-md, 10px);
      box-shadow: var(--shadow-lg, 0 12px 32px rgba(15, 23, 42, 0.18));
      padding: 8px;
      z-index: 220;
      font-family: var(--font-sans);
    }
    .export-dropdown.align-left {
      right: auto;
      left: 0;
    }
    .export-dropdown-header {
      padding: 4px 8px 6px;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--blue-800, #1565c0);
    }
    .export-period-box {
      background: var(--surface-raised, #f8fafc);
      border: 1px solid var(--border, #e1eaf5);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .export-period-label {
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 5px;
    }
    .export-period-pills {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .period-pill {
      padding: 5px 4px;
      border-radius: 6px;
      border: 1px solid var(--border, #d8e2ef);
      background: var(--surface, #ffffff);
      color: var(--blue-900, #1e293b);
      font-family: var(--font-sans);
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: all 0.14s ease;
    }
    .period-pill:hover {
      border-color: var(--primary, #1976d2);
      color: var(--primary, #1976d2);
    }
    .period-pill.active {
      background: var(--primary, #1976d2);
      border-color: var(--primary, #1976d2);
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(25, 118, 210, 0.25);
    }
    .export-period-caption {
      margin-top: 6px;
      font-size: 0.71rem;
      color: var(--text-muted);
      text-align: center;
    }
    .export-period-nav {
      margin-top: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #e1eaf5);
      border-radius: 6px;
      padding: 3px 6px;
    }
    .period-step-btn {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--blue-900);
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .period-step-btn:hover {
      background: var(--blue-50, #eff6ff);
      color: var(--primary, #1976d2);
    }
    .period-window-text {
      font-size: 0.72rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--blue-950);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .export-custom-range {
      margin-top: 7px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .custom-date-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .custom-date-lbl {
      font-size: 0.67rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .export-date-input {
      font-size: 0.75rem;
    }
    .export-format-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .export-dropdown-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: none;
      border-radius: var(--radius-sm, 6px);
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-family: var(--font-sans);
      transition: background-color 0.14s ease;
    }
    .export-dropdown-item:hover:not(:disabled) {
      background: var(--blue-50, #f0f7ff);
    }
    .export-dropdown-item:disabled {
      opacity: 0.55;
      cursor: wait;
    }
    .export-item-icon {
      width: 32px;
      height: 32px;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .export-item-icon.fmt-xlsx {
      background: #dcfce7;
      color: #15803d;
    }
    .export-item-icon.fmt-docx {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .export-item-icon.fmt-pdf {
      background: #fee2e2;
      color: #b91c1c;
    }
    .export-item-icon.fmt-pptx {
      background: #ffedd5;
      color: #c2410c;
    }
    .export-fmt-svg {
      width: 18px;
      height: 18px;
    }
    .export-item-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .export-item-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--blue-950, #0a1628);
      line-height: 1.2;
    }
    .export-item-desc {
      font-size: 0.72rem;
      color: var(--text-muted);
      line-height: 1.25;
      margin-top: 1px;
    }
    .export-item-ext {
      font-size: 0.7rem;
      font-weight: 700;
      font-family: var(--font-sans);
      font-variant-numeric: tabular-nums;
      color: var(--blue-900);
      background: var(--surface-raised);
      border: 1px solid var(--border);
      padding: 2px 6px;
      border-radius: 4px;
    }
  `],
})
export class ExportMenuComponent {
  @Input() endpoint = '';
  @Input() filename = 'report';
  @Input() label = 'Export';
  @Input() params: Record<string, string | number | boolean | null | undefined> = {};
  @Input() includeDateRange = true;
  @Input() showPeriodSelector = true;
  @Input() menuAlign: 'right' | 'left' = 'right';
  @Input() formats: readonly ExportFormatOption[] = ExportService.FORMATS;

  open = false;
  busy = false;
  periodMode: ReportPeriodMode = 'active';
  weekOffset = 0;
  monthOffset = 0;
  customFrom: Date | null = computeMonthBounds(0).start;
  customTo: Date | null = new Date();

  constructor(
    private exportSvc: ExportService,
    private elRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  get periodWindowLabel(): string {
    if (this.periodMode === 'weekly') {
      const { start, end } = computeIsoWeekBounds(this.weekOffset);
      return `${formatShortHumanDate(start)} – ${formatShortHumanDate(end)}`;
    }
    if (this.periodMode === 'monthly') {
      const { start, end } = computeMonthBounds(this.monthOffset);
      return `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()} (${formatShortHumanDate(start).slice(0, 2)}–${formatShortHumanDate(end).slice(0, 2)})`;
    }
    return '';
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.open = !this.open;
    this.cdr.markForCheck();
  }

  setPeriodMode(mode: ReportPeriodMode): void {
    this.periodMode = mode;
    if (mode === 'weekly') this.weekOffset = 0;
    if (mode === 'monthly') this.monthOffset = 0;
    if (mode === 'custom' && (!this.customFrom || !this.customTo)) {
      const bounds = computeMonthBounds(0);
      this.customFrom = this.customFrom || bounds.start;
      this.customTo = this.customTo || new Date();
    }
    this.cdr.markForCheck();
  }

  stepPeriod(delta: number): void {
    if (this.periodMode === 'weekly') {
      this.weekOffset += delta;
    } else if (this.periodMode === 'monthly') {
      this.monthOffset += delta;
    }
    this.cdr.markForCheck();
  }

  private buildDownloadParams(): {
    mergedParams: Record<string, string | number | boolean | null | undefined>;
    useGlobalRange: boolean;
  } {
    const base = { ...(this.params || {}) };
    if (!this.showPeriodSelector || this.periodMode === 'active') {
      return { mergedParams: base, useGlobalRange: this.includeDateRange };
    }

    // Multi-day explicit cadence overrides single-day `date`, single-year `year`, or preset `period` filters
    delete base['date'];
    delete base['year'];
    delete base['period'];

    if (this.periodMode === 'weekly') {
      const { start, end } = computeIsoWeekBounds(this.weekOffset);
      return {
        mergedParams: {
          ...base,
          report_period: 'weekly',
          from: formatLocalYmd(start),
          to: formatLocalYmd(end),
        },
        useGlobalRange: false,
      };
    }

    if (this.periodMode === 'monthly') {
      const { start, end } = computeMonthBounds(this.monthOffset);
      return {
        mergedParams: {
          ...base,
          report_period: 'monthly',
          from: formatLocalYmd(start),
          to: formatLocalYmd(end),
        },
        useGlobalRange: false,
      };
    }

    // Custom date range
    const fallback = computeMonthBounds(0);
    let fromD = this.customFrom || fallback.start;
    let toD = this.customTo || new Date();
    if (fromD.getTime() > toD.getTime()) {
      const swap = fromD;
      fromD = toD;
      toD = swap;
    }
    return {
      mergedParams: {
        ...base,
        report_period: 'custom',
        from: formatLocalYmd(fromD),
        to: formatLocalYmd(toD),
      },
      useGlobalRange: false,
    };
  }

  async download(format: ExportFormat): Promise<void> {
    if (this.busy || !this.endpoint) return;
    this.open = false;
    this.busy = true;
    this.cdr.markForCheck();

    const { mergedParams, useGlobalRange } = this.buildDownloadParams();

    try {
      await this.exportSvc.download(this.endpoint, format, this.filename, mergedParams, {
        includeDateRange: useGlobalRange,
      });
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:click', ['$event.target'])
  onDocumentClick(target: EventTarget | null): void {
    if (!this.open || !(target instanceof Node)) return;
    if (target instanceof Element && target.closest('.cdk-overlay-container')) {
      return;
    }
    if (!this.elRef.nativeElement.contains(target)) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open) return;
    if (document.querySelector('.cdk-overlay-container .dtp-panel')) {
      return;
    }
    this.open = false;
    this.cdr.markForCheck();
  }
}
