import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DateFilterService } from '../../core/services/date-filter.service';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { OperationsDeepDiveComponent } from '../analytics/components/operations-deep-dive/operations-deep-dive.component';
import { AnalyticsPeriod } from '../analytics/analytics-helpers';

@Component({
  selector: 'app-operations-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink, ExportMenuComponent, OperationsDeepDiveComponent],
  templateUrl: './operations-analytics.component.html',
  styleUrls: ['./operations-analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsAnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild(OperationsDeepDiveComponent) deepDive?: OperationsDeepDiveComponent;

  private destroy$ = new Subject<void>();

  period: AnalyticsPeriod = 'all';
  dateLabel = 'All time';

  readonly periodOptions: Array<{ value: AnalyticsPeriod; label: string }> = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' }
  ];

  constructor(
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.dateFilter.range$.pipe(takeUntil(this.destroy$)).subscribe(range => {
      if (range?.from || range?.to) {
        this.period = 'custom';
      } else if (this.period === 'custom') {
        this.period = 'all';
      }
      this.dateLabel = this.buildScopeLabel();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectPeriod(next: AnalyticsPeriod): void {
    this.period = next;
    if (this.dateFilter.currentRange.from || this.dateFilter.currentRange.to) {
      this.dateFilter.clearRange();
    }
    this.dateLabel = this.buildScopeLabel();
    this.cdr.markForCheck();
  }

  private buildScopeLabel(): string {
    const global = this.dateFilter.getLabel();
    if (global !== 'All time') return global;
    const labels: Record<AnalyticsPeriod, string> = {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      '90d': 'Last 90 days',
      ytd: 'Year to date',
      all: 'All time',
      custom: global
    };
    return labels[this.period];
  }

  get exportMenuParams(): Record<string, string | number | boolean | null | undefined> {
    if (this.period === 'all' || this.period === 'custom') return {};
    return { period: this.period };
  }

  exportJson(): void {
    const payload = this.deepDive?.payload;
    if (!payload) return;
    const report = {
      generated: new Date().toISOString(),
      scope: this.dateLabel,
      ...payload
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `operations-analytics-${new Date().toISOString().slice(0, 10)}.json`
    });
    a.click();
    URL.revokeObjectURL(url);
  }
}
