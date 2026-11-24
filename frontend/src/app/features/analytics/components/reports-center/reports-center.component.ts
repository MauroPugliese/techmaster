import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../../core/services/api.service';
import { ExportFormat, ExportService } from '../../../../core/services/export.service';
import { AnalyticsOverview, ExportModuleCatalogItem } from '../../analytics-helpers';

@Component({
  selector: 'app-reports-center',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports-center.component.html',
  styleUrls: ['./reports-center.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReportsCenterComponent implements OnInit, OnDestroy {
  @Input() dateLabel = 'All time';
  @Input() overview: AnalyticsOverview | null = null;
  @Output() exportJsonRequested = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  loading = true;
  modules: ExportModuleCatalogItem[] = [];
  searchQuery = '';
  activeCategory = 'ALL';
  busyKey: string | null = null;

  readonly formatMeta: Array<{ fmt: ExportFormat; label: string }> = [
    { fmt: 'pdf', label: 'PDF' },
    { fmt: 'xlsx', label: 'XLSX' },
    { fmt: 'docx', label: 'DOCX' },
    { fmt: 'pptx', label: 'PPTX' }
  ];

  constructor(
    private api: ApiService,
    private exportSvc: ExportService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api
      .get<any>('/export')
      .pipe(catchError(() => of({ data: [] })), takeUntil(this.destroy$))
      .subscribe(res => {
        const list: ExportModuleCatalogItem[] = res?.data || [];
        this.modules = list.filter(m => m.allowed !== false);
        this.loading = false;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get categories(): string[] {
    const cats = Array.from(new Set(this.modules.map(m => m.category).filter(Boolean)));
    return ['ALL', ...cats];
  }

  get filteredModules(): ExportModuleCatalogItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.modules.filter(m => {
      if (this.activeCategory !== 'ALL' && m.category !== this.activeCategory) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.subtitle.toLowerCase().includes(q) ||
        m.docCode.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      );
    });
  }

  isBusy(moduleKey: string, fmt: ExportFormat): boolean {
    return this.busyKey === `${moduleKey}:${fmt}`;
  }

  async downloadModule(mod: ExportModuleCatalogItem, fmt: ExportFormat): Promise<void> {
    if (this.busyKey) return;
    this.busyKey = `${mod.key}:${fmt}`;
    this.cdr.markForCheck();

    try {
      await this.exportSvc.download(mod.key, fmt, mod.title, {}, { includeDateRange: true });
    } finally {
      this.busyKey = null;
      this.cdr.markForCheck();
    }
  }
}
