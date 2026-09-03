// =============================================================================
// shared/components/export-menu/export-menu.component.ts
// -----------------------------------------------------------------------------
// Reusable dropdown that offers Excel / Word / PDF export for any module via the
// unified ExportService. Drop it into any toolbar:
//
//   <app-export-menu endpoint="operations" filename="Operations"
//                    [params]="{ status: filterStatus }"></app-export-menu>
// =============================================================================
import { Component, ElementRef, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExportService, ExportFormat } from '../../../core/services/export.service';

@Component({
  selector: 'app-export-menu',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="export-menu" [class.open]="open">
      <button type="button" class="btn btn-secondary" (click)="toggle($event)" [disabled]="busy">
        <span class="btn-icon">{{ busy ? 'hourglass_empty' : 'file_download' }}</span> {{ label }}
        <span class="btn-icon caret">expand_more</span>
      </button>
      <div class="export-menu__dropdown" *ngIf="open">
        <button type="button" class="export-menu__item"
                *ngFor="let f of formats" (click)="pick(f.value)">
          <span class="export-menu__icon">{{ f.icon }}</span>
          <span class="export-menu__label">{{ f.label }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .export-menu { position: relative; display: inline-block; }
    .export-menu .caret {
      margin-left: 2px;
      font-size: 16px;
      transition: transform 0.2s ease;
    }
    .export-menu.open .caret { transform: rotate(180deg); }
    .export-menu__dropdown {
      position: absolute; right: 0; top: calc(100% + 4px); z-index: 50;
      min-width: 170px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      padding: 6px;
      overflow: hidden;
    }
    .export-menu__item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      background: transparent;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--blue-900);
      border-radius: var(--radius-sm);
      text-align: left;
      transition: var(--transition);
    }
    .export-menu__item:hover { background: var(--blue-50); color: var(--primary); }
    .export-menu__icon {
      font-family: 'Material Icons Round';
      font-style: normal;
      font-size: 18px;
      color: var(--primary);
      line-height: 1;
    }
    .export-menu__label { line-height: 1.2; }
  `]
})
export class ExportMenuComponent {
  /** Module key or full path (e.g. 'operations', 'wiki/12'). */
  @Input() endpoint = '';
  /** Base download filename (without extension). */
  @Input() filename = 'SMaRT_Report';
  /** Button label. */
  @Input() label = 'Export';
  /** Query filters forwarded to the backend. */
  @Input() params: Record<string, string | number | boolean | null | undefined> = {};

  readonly formats = ExportService.FORMATS;
  open = false;
  busy = false;

  constructor(private exportService: ExportService, private host: ElementRef) {}

  toggle(ev: Event): void {
    ev.stopPropagation();
    this.open = !this.open;
  }

  async pick(format: ExportFormat): Promise<void> {
    this.open = false;
    this.busy = true;
    try {
      await this.exportService.download(this.endpoint, format, this.filename, this.params);
    } finally {
      this.busy = false;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(ev.target)) this.open = false;
  }
}
