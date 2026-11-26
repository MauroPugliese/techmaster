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
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../../core/services/api.service';
import { ExportFormat, ExportService } from '../../../../core/services/export.service';
import { Simulator } from '../../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd, MONTH_SHORT } from '../../../../shared/components/datetime-picker/datetime-picker.utils';
import { DropdownComponent, DropdownOptionComponent } from '../../../../shared/components/dropdown/dropdown.component';
import { AnalyticsOverview, ExportModuleCatalogItem } from '../../analytics-helpers';

export type ReportsCenterCadence = 'global' | 'weekly' | 'monthly' | 'custom';

function computeIsoWeek(offsetWeeks = 0): { start: Date; end: Date } {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetWeeks * 7);
  const dow = base.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diffToMon);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end };
}

function computeMonthRange(offsetMonths = 0): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { start, end };
}

function fmtHumanDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

@Component({
  selector: 'app-reports-center',
  standalone: true,
  imports: [CommonModule, FormsModule, DateTimePickerComponent, DropdownComponent, DropdownOptionComponent],
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
  simulators: Simulator[] = [];
  searchQuery = '';
  activeCategory = 'ALL';
  busyKey: string | null = null;

  // Report Periodicity (Global / Weekly / Monthly / Custom)
  cadence: ReportsCenterCadence = 'global';
  weekOffset = 0;
  monthOffset = 0;
  customFrom: Date | null = computeMonthRange(0).start;
  customTo: Date | null = new Date();

  // Contextual selectors for Simulator / Daily Ops cards
  dailyOpsStationKind: 'ALL' | 'TEST_PLACE' | 'IOS_CONSOLE' = 'ALL';
  selectedSimulatorScope: 'ALL' | number = 'ALL';
  selectedSimulatorYear: 'ALL' | number = new Date().getFullYear();
  readonly yearOptions: Array<'ALL' | number> = [
    'ALL',
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2
  ];

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
    forkJoin({
      catalog: this.api.get<any>('/export').pipe(catchError(() => of({ data: [] }))),
      sims: this.api.get<any>('/simulators').pipe(catchError(() => of({ data: [] })))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ catalog, sims }) => {
        const list: ExportModuleCatalogItem[] = catalog?.data || [];
        this.modules = list.filter(m => m.allowed !== false);
        this.simulators = sims?.data || [];
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

  get cadenceWindowLabel(): string {
    if (this.cadence === 'weekly') {
      const { start, end } = computeIsoWeek(this.weekOffset);
      return `${fmtHumanDate(start)} – ${fmtHumanDate(end)}`;
    }
    if (this.cadence === 'monthly') {
      const { start, end } = computeMonthRange(this.monthOffset);
      return `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()} (${fmtHumanDate(start).slice(0, 2)}–${fmtHumanDate(end).slice(0, 2)})`;
    }
    if (this.cadence === 'custom') {
      const fallback = computeMonthRange(0);
      const a = this.customFrom || fallback.start;
      const b = this.customTo || new Date();
      return `${fmtHumanDate(a <= b ? a : b)} – ${fmtHumanDate(a <= b ? b : a)}`;
    }
    return this.dateLabel;
  }

  setCadence(mode: ReportsCenterCadence): void {
    this.cadence = mode;
    if (mode === 'weekly') this.weekOffset = 0;
    if (mode === 'monthly') this.monthOffset = 0;
    if (mode === 'custom') {
      const bounds = computeMonthRange(0);
      if (!this.customFrom) this.customFrom = bounds.start;
      if (!this.customTo) this.customTo = new Date();
    }
    this.cdr.markForCheck();
  }

  stepCadence(delta: number): void {
    if (this.cadence === 'weekly') this.weekOffset += delta;
    else if (this.cadence === 'monthly') this.monthOffset += delta;
    this.cdr.markForCheck();
  }

  isBusy(moduleKey: string, fmt: ExportFormat): boolean {
    return this.busyKey === `${moduleKey}:${fmt}`;
  }

  private buildPeriodParams(): {
    params: Record<string, string | number>;
    includeDateRange: boolean;
  } {
    if (this.cadence === 'global') {
      return { params: {}, includeDateRange: true };
    }
    if (this.cadence === 'weekly') {
      const { start, end } = computeIsoWeek(this.weekOffset);
      return {
        params: {
          report_period: 'weekly',
          from: formatLocalYmd(start),
          to: formatLocalYmd(end)
        },
        includeDateRange: false
      };
    }
    if (this.cadence === 'monthly') {
      const { start, end } = computeMonthRange(this.monthOffset);
      return {
        params: {
          report_period: 'monthly',
          from: formatLocalYmd(start),
          to: formatLocalYmd(end)
        },
        includeDateRange: false
      };
    }
    const fallback = computeMonthRange(0);
    let fromD = this.customFrom || fallback.start;
    let toD = this.customTo || new Date();
    if (fromD.getTime() > toD.getTime()) {
      const tmp = fromD;
      fromD = toD;
      toD = tmp;
    }
    return {
      params: {
        report_period: 'custom',
        from: formatLocalYmd(fromD),
        to: formatLocalYmd(toD)
      },
      includeDateRange: false
    };
  }

  async downloadModule(mod: ExportModuleCatalogItem, fmt: ExportFormat): Promise<void> {
    if (this.busyKey) return;
    this.busyKey = `${mod.key}:${fmt}`;
    this.cdr.markForCheck();

    let endpoint = mod.key;
    let filename = mod.title;
    const { params, includeDateRange } = this.buildPeriodParams();
    const extraParams: Record<string, string | number> = { ...params };

    if (mod.key === 'daily-station-ops' && this.dailyOpsStationKind !== 'ALL') {
      extraParams['station_kind'] = this.dailyOpsStationKind;
    }

    if (mod.key === 'simulators' && this.selectedSimulatorScope !== 'ALL') {
      const simId = Number(this.selectedSimulatorScope);
      const sim = this.simulators.find(s => Number(s.id) === simId);
      endpoint = `simulators/${simId}`;
      filename = sim ? `${sim.code}_Dossier` : `Simulator_${simId}_Dossier`;
      if (this.cadence === 'global') {
        extraParams['year'] = this.selectedSimulatorYear;
      }
    }

    try {
      await this.exportSvc.download(endpoint, fmt, filename, extraParams, {
        includeDateRange
      });
    } finally {
      this.busyKey = null;
      this.cdr.markForCheck();
    }
  }
}
