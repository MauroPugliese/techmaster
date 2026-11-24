import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ExportFormat,
  ExportFormatOption,
  ExportService,
} from '../../../core/services/export.service';

@Component({
  selector: 'app-export-menu',
  standalone: true,
  imports: [CommonModule],
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

      <div class="export-dropdown" role="menu" *ngIf="open">
        <div class="export-dropdown-header">Export A4 Executive Report</div>
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
      min-width: 262px;
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #e1eaf5);
      border-radius: var(--radius-md, 10px);
      box-shadow: var(--shadow-lg, 0 10px 30px rgba(21, 101, 192, 0.15));
      padding: 6px;
      z-index: 60;
    }
    .export-dropdown-header {
      padding: 6px 10px 4px;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--blue-800, #1565c0);
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
  @Input() formats: readonly ExportFormatOption[] = ExportService.FORMATS;

  open = false;
  busy = false;

  constructor(
    private exportSvc: ExportService,
    private elRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.open = !this.open;
    this.cdr.markForCheck();
  }

  async download(format: ExportFormat): Promise<void> {
    if (this.busy || !this.endpoint) return;
    this.open = false;
    this.busy = true;
    this.cdr.markForCheck();

    try {
      await this.exportSvc.download(this.endpoint, format, this.filename, this.params, {
        includeDateRange: this.includeDateRange,
      });
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:click', ['$event.target'])
  onDocumentClick(target: EventTarget | null): void {
    if (this.open && target instanceof Node && !this.elRef.nativeElement.contains(target)) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }
}
