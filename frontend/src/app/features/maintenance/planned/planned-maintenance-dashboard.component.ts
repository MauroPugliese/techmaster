// =============================================================================
// planned-maintenance-dashboard.component.ts — Clean Recurrence & Calendar View
// =============================================================================
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import {
  CalendarIndicators,
  PlannedMaintenanceSummary,
  PlannedMaintenanceTask
} from '../../../core/models/interfaces';
import { PlannedMaintenanceService } from './planned-maintenance.service';
import { ConfirmService, ToastService, UiCustomizationService, UiSectionPreferences } from '../../../core/services/services';
import { ExportService } from '../../../core/services/export.service';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd, parseIncomingDate } from '../../../shared/components/datetime-picker/datetime-picker.utils';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { formatRecurrenceText } from '../maintenance-helpers';

@Component({
  selector: 'app-planned-maintenance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DateTimePickerComponent, ExportMenuComponent, DropdownComponent, DropdownOptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-maintenance-dashboard.component.html',
  styleUrls: ['./planned-maintenance-dashboard.component.scss']
})
export class PlannedMaintenanceDashboardComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  @Input() embedded = false;
  @Input() refreshTick = 0;

  @Output() summaryChange = new EventEmitter<PlannedMaintenanceSummary | null>();
  @Output() exportParamsChange = new EventEmitter<Record<string, any>>();

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private initialized = false;
  Math = Math;

  // Table & Filters
  tasks: PlannedMaintenanceTask[] = [];
  systems: string[] = [];
  summary: PlannedMaintenanceSummary | null = null;
  total = 0;
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  searchTerm = '';
  systemFilter = '';
  repeatTypeFilter = '';
  statusFilter = '';
  sortBy = 'operation_date_start';
  sortDir: 'ASC' | 'DESC' = 'ASC';
  loading = false;

  // Menus
  openMenuTaskId: number | null = null;
  dailyExportOpen = false;

  // Calendar
  indicators: CalendarIndicators = {};
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth() + 1;
  calendarDays: (number | null)[] = [];
  readonly weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Event list
  selectedDate = this.formatDateStr(new Date());
  dayTasks: PlannedMaintenanceTask[] = [];

  // Modal
  showModal = false;
  modalError = '';
  detailTask: PlannedMaintenanceTask | null = null;
  detailIsDayEvent = false;
  editing = false;
  editingScope: 'series' | 'occurrence' = 'series';
  saving = false;
  editId: number | null = null;
  occurrenceMeta: { masterId: number; occurrenceDate: string } | null = null;
  form: any = this.emptyForm();
  uiPrefs: UiSectionPreferences | null = null;

  constructor(
    private svc: PlannedMaintenanceService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private exportSvc: ExportService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.uiCustomization.load('planned_maintenance').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.searchInput$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.searchTerm = val;
        this.page = 1;
        this.loadTasks();
      });

    this.initialized = true;
    this.loadSystems();
    this.loadSummary();
    this.loadTasks();
    this.buildCalendar();
    this.loadIndicators();
    this.loadDayTasks();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadSystems();
      this.loadSummary();
      this.loadTasks();
      this.loadIndicators();
      this.loadDayTasks();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuTaskId = null;
    this.dailyExportOpen = false;
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.showModal) {
        this.showModal = false;
        this.cdr.markForCheck();
        return;
      }
      if (this.detailTask) {
        this.detailTask = null;
        this.detailIsDayEvent = false;
        this.cdr.markForCheck();
        return;
      }
      this.openMenuTaskId = null;
      this.dailyExportOpen = false;
      return;
    }

    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable;
    if (isEditable) return;
    if (this.searchInput?.nativeElement) {
      e.preventDefault();
      this.searchInput.nativeElement.focus();
    }
  }

  get exportParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (this.searchTerm.trim()) p['search'] = this.searchTerm.trim();
    if (this.systemFilter) p['system'] = this.systemFilter;
    if (this.repeatTypeFilter) p['repeat_task_type'] = this.repeatTypeFilter;
    if (this.statusFilter) p['status'] = this.statusFilter;
    return p;
  }

  // ── Data Loading ───────────────────────────────────────────────────────────
  loadSystems(): void {
    this.svc.getSystems().pipe(takeUntil(this.destroy$)).subscribe({
      next: list => {
        this.systems = list;
        this.cdr.markForCheck();
      }
    });
  }

  loadSummary(): void {
    const todayStr = this.formatDateStr(new Date());
    this.svc.getSummary(this.calYear, this.calMonth, todayStr).pipe(takeUntil(this.destroy$)).subscribe({
      next: s => {
        this.summary = s;
        this.summaryChange.emit(s);
        this.cdr.markForCheck();
      }
    });
  }

  loadTasks(): void {
    this.loading = true;
    this.openMenuTaskId = null;
    const params: Record<string, any> = {
      search: this.searchTerm.trim(),
      system: this.systemFilter,
      repeat_task_type: this.repeatTypeFilter,
      status: this.statusFilter,
      sort_by: this.sortBy,
      sort_dir: this.sortDir,
      page: this.page,
      limit: this.pageSize
    };

    this.exportParamsChange.emit({
      search: this.searchTerm.trim(),
      system: this.systemFilter,
      repeat_task_type: this.repeatTypeFilter,
      status: this.statusFilter
    });

    this.svc.getAll(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: result => {
        this.tasks = result.items;
        this.total = result.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load planned tasks');
        this.cdr.markForCheck();
      }
    });
  }

  onSearchModelChange(val: string): void {
    this.searchTerm = val;
    this.searchInput$.next(val);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.searchInput$.next('');
    this.page = 1;
    this.loadTasks();
  }

  applyFilters(): void {
    this.page = 1;
    this.loadTasks();
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.searchTerm.trim() || this.systemFilter || this.repeatTypeFilter || this.statusFilter);
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.systemFilter = '';
    this.repeatTypeFilter = '';
    this.statusFilter = '';
    this.applyFilters();
  }

  toggleSort(column: string): void {
    if (this.sortBy === column) {
      this.sortDir = this.sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy = column;
      this.sortDir = 'ASC';
    }
    this.page = 1;
    this.loadTasks();
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return 'unfold_more';
    return this.sortDir === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  toggleRowMenu(id: number, event: Event): void {
    event.stopPropagation();
    this.dailyExportOpen = false;
    this.openMenuTaskId = this.openMenuTaskId === id ? null : id;
  }

  closeRowMenu(): void {
    this.openMenuTaskId = null;
  }

  toggleDailyExport(event: Event): void {
    event.stopPropagation();
    this.openMenuTaskId = null;
    this.dailyExportOpen = !this.dailyExportOpen;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.loadTasks();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadTasks();
  }

  // ── Modals ─────────────────────────────────────────────────────────────────
  openModal(task?: PlannedMaintenanceTask): void {
    this.editingScope = 'series';
    this.occurrenceMeta = null;
    this.modalError = '';
    if (task) {
      this.editing = true;
      this.editId = task.id;
      this.form = {
        system: task.system,
        subsystem: task.subsystem,
        task: task.task,
        reference: task.reference || '',
        operationDateStart: parseIncomingDate(task.operationDateStart),
        operationDateEnd: parseIncomingDate(task.operationDateEnd),
        repeatTaskType: task.repeatTaskType || 'WEEK',
        repeatTaskNumber: task.repeatTaskNumber || 1,
        recurrenceEndDate: parseIncomingDate(task.recurrenceEndDate),
        reportTemplate: task.reportTemplate || '',
        status: task.status || 'TODO',
        optional: task.optional || false
      };
    } else {
      this.editing = false;
      this.editId = null;
      this.form = this.emptyForm();
    }
    this.showModal = true;
    this.cdr.markForCheck();
  }

  openOccurrenceModal(task: PlannedMaintenanceTask): void {
    this.editingScope = 'occurrence';
    this.modalError = '';
    this.occurrenceMeta = {
      masterId: task.masterId || task.id,
      occurrenceDate: task.occurrenceDate || this.selectedDate
    };
    this.editing = true;
    this.editId = task.masterId || task.id;
    this.form = {
      system: task.system,
      subsystem: task.subsystem,
      task: task.task,
      reference: task.reference || '',
      operationDateStart: task.operationDateStart ? new Date(task.operationDateStart) : null,
      operationDateEnd: task.operationDateEnd ? new Date(task.operationDateEnd) : null,
      repeatTaskType: task.repeatTaskType || 'WEEK',
      repeatTaskNumber: task.repeatTaskNumber || 1,
      recurrenceEndDate: task.recurrenceEndDate ? new Date(task.recurrenceEndDate) : null,
      reportTemplate: task.reportTemplate || '',
      status: task.status || 'TODO',
      optional: task.optional || false
    };
    this.showModal = true;
    this.cdr.markForCheck();
  }

  openDetailModal(task: PlannedMaintenanceTask, fromDayList = false): void {
    this.detailTask = task;
    this.detailIsDayEvent = fromDayList || Boolean(task.isOccurrence);
    this.cdr.markForCheck();
  }

  closeDetailModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.detailTask = null;
      this.detailIsDayEvent = false;
    }
  }

  editFromDetail(): void {
    if (!this.detailTask) return;
    const task = this.detailTask;
    const isDayEvent = this.detailIsDayEvent;
    this.detailTask = null;
    this.detailIsDayEvent = false;
    if (isDayEvent) this.openOccurrenceModal(task);
    else this.openModal(task);
  }

  toggleStatusFromDetail(): void {
    if (!this.detailTask) return;
    const task = this.detailTask;
    const isDayEvent = this.detailIsDayEvent;
    this.detailTask = null;
    this.detailIsDayEvent = false;
    this.toggleStatus(task, isDayEvent);
  }

  deleteFromDetail(): void {
    if (!this.detailTask) return;
    const task = this.detailTask;
    const isDayEvent = this.detailIsDayEvent;
    this.detailTask = null;
    this.detailIsDayEvent = false;
    if (isDayEvent) this.deleteOccurrence(task);
    else this.deleteTask(task);
  }

  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showModal = false;
    }
  }

  get formRecurrencePreview(): string {
    return formatRecurrenceText(this.form.repeatTaskType, this.form.repeatTaskNumber);
  }

  save(): void {
    this.modalError = '';
    if (this.showFormField('system') && !String(this.form.system || '').trim()) {
      this.modalError = 'System is required.';
      return;
    }
    if (this.showFormField('subsystem') && !String(this.form.subsystem || '').trim()) {
      this.modalError = 'Subsystem is required.';
      return;
    }
    if (this.showFormField('task') && !String(this.form.task || '').trim()) {
      this.modalError = 'Task description is required.';
      return;
    }
    if (this.showFormField('operationDateStart') && !this.form.operationDateStart) {
      this.modalError = 'Start date is required.';
      return;
    }

    const startDateObj = this.form.operationDateStart ? new Date(this.form.operationDateStart) : null;
    const endDateObj = this.form.operationDateEnd ? new Date(this.form.operationDateEnd) : startDateObj;
    if (startDateObj && endDateObj && endDateObj < startDateObj) {
      this.modalError = 'End date must be on or after start date.';
      return;
    }

    this.saving = true;
    const operationDateStart = startDateObj ? startDateObj.toISOString() : '';
    const operationDateEnd = endDateObj ? endDateObj.toISOString() : operationDateStart;
    const recurrenceEndDate = this.form.recurrenceEndDate
      ? (this.form.recurrenceEndDate instanceof Date
          ? formatLocalYmd(this.form.recurrenceEndDate)
          : formatLocalYmd(new Date(this.form.recurrenceEndDate)))
      : null;

    const payload: Partial<PlannedMaintenanceTask> = {
      system: this.form.system,
      subsystem: this.form.subsystem,
      task: this.form.task,
      reference: this.form.reference,
      operationDateStart,
      operationDateEnd,
      repeatTaskType: this.form.repeatTaskType,
      repeatTaskNumber: Math.max(1, Number(this.form.repeatTaskNumber) || 1),
      recurrenceEndDate,
      reportTemplate: this.form.reportTemplate,
      status: this.form.status,
      optional: this.form.optional
    };

    const obs = this.editing && this.occurrenceMeta
      ? this.svc.updateOccurrence(this.occurrenceMeta.masterId, this.occurrenceMeta.occurrenceDate, payload)
      : this.editing && this.editId
        ? this.svc.update(this.editId, payload)
        : this.svc.create(payload);

    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toast.success(this.editing ? 'Planned task updated.' : 'Planned task created.');
        this.showModal = false;
        this.saving = false;
        this.loadSystems();
        this.loadSummary();
        this.loadTasks();
        this.loadIndicators();
        this.loadDayTasks();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.modalError = e?.error?.message || 'Failed to save planned task.';
        this.toast.error(this.modalError);
        this.cdr.markForCheck();
      }
    });
  }

  deleteTask(task: PlannedMaintenanceTask): void {
    this.confirm.confirm(`Delete planned series "${task.task}"?`, 'Delete Task', true).then(confirmed => {
      if (!confirmed) return;
      this.svc.delete(task.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toast.success('Planned task deleted.');
          this.loadSystems();
          this.loadSummary();
          this.loadTasks();
          this.loadIndicators();
          this.loadDayTasks();
        },
        error: () => this.toast.error('Delete failed')
      });
    });
  }

  deleteOccurrence(task: PlannedMaintenanceTask): void {
    const masterId = task.masterId || task.id;
    const occurrenceDate = task.occurrenceDate || this.selectedDate;
    this.confirm.confirm(`Delete this occurrence of "${task.task}" on ${occurrenceDate}?`, 'Delete Occurrence', true).then(confirmed => {
      if (!confirmed) return;
      this.svc.deleteOccurrence(masterId, occurrenceDate).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toast.success('Occurrence deleted.');
          this.loadSummary();
          this.loadTasks();
          this.loadIndicators();
          this.loadDayTasks();
        },
        error: () => this.toast.error('Failed to delete occurrence')
      });
    });
  }

  toggleStatus(task: PlannedMaintenanceTask, isDayOccurrence = false): void {
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    const masterId = task.masterId || task.id;
    const occurrenceDate = task.occurrenceDate || (isDayOccurrence ? this.selectedDate : null);
    const obs = occurrenceDate
      ? this.svc.updateOccurrence(masterId, occurrenceDate, { status: newStatus })
      : this.svc.update(task.id, { status: newStatus });

    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toast.success(`Marked ${newStatus}.`);
        this.loadSummary();
        this.loadTasks();
        this.loadIndicators();
        this.loadDayTasks();
      },
      error: () => this.toast.error('Status update failed')
    });
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  buildCalendar(): void {
    const firstDay = new Date(this.calYear, this.calMonth - 1, 1);
    const lastDay = new Date(this.calYear, this.calMonth, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();

    this.calendarDays = [];
    for (let i = 0; i < startWeekday; i++) this.calendarDays.push(null);
    for (let d = 1; d <= totalDays; d++) this.calendarDays.push(d);
  }

  loadIndicators(): void {
    this.svc.getCalendarIndicators(this.calYear, this.calMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ind => { this.indicators = ind; this.cdr.markForCheck(); },
        error: () => {}
      });
  }

  prevMonth(): void {
    this.calMonth--;
    if (this.calMonth < 1) { this.calMonth = 12; this.calYear--; }
    this.buildCalendar();
    this.loadSummary();
    this.loadIndicators();
    this.selectedDate = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-01`;
    this.loadDayTasks();
  }

  nextMonth(): void {
    this.calMonth++;
    if (this.calMonth > 12) { this.calMonth = 1; this.calYear++; }
    this.buildCalendar();
    this.loadSummary();
    this.loadIndicators();
    this.selectedDate = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-01`;
    this.loadDayTasks();
  }

  goToToday(): void {
    const now = new Date();
    this.calYear = now.getFullYear();
    this.calMonth = now.getMonth() + 1;
    this.selectedDate = this.formatDateStr(now);
    this.buildCalendar();
    this.loadSummary();
    this.loadIndicators();
    this.loadDayTasks();
  }

  selectDay(day: number | null): void {
    if (!day) return;
    this.selectedDate = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    this.loadDayTasks();
  }

  isToday(day: number | null): boolean {
    if (!day) return false;
    const now = new Date();
    return day === now.getDate() && this.calMonth === now.getMonth() + 1 && this.calYear === now.getFullYear();
  }

  isSelected(day: number | null): boolean {
    if (!day) return false;
    const sel = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return sel === this.selectedDate;
  }

  getIndicators(day: number | null): any[] {
    if (!day) return [];
    return this.indicators[day] || [];
  }

  get monthLabel(): string {
    return new Date(this.calYear, this.calMonth - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  // ── Daily Agenda ───────────────────────────────────────────────────────────
  loadDayTasks(): void {
    this.svc.getTasksForDate(this.selectedDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: tasks => { this.dayTasks = tasks; this.cdr.markForCheck(); },
        error: () => {}
      });
  }

  get selectedDateLabel(): string {
    const d = new Date(this.selectedDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  getTypeColor(type: string): string {
    if (type === 'DAY') return '#0288D1';
    if (type === 'WEEK') return '#D97706';
    if (type === 'MONTH') return '#DC2626';
    return '#64748b';
  }

  getRepeatBadgeClass(type: string): string {
    if (type === 'DAY') return 'badge-day';
    if (type === 'WEEK') return 'badge-week';
    return 'badge-month';
  }

  getStatusBadgeClass(status: string): string {
    return status === 'DONE' ? 'badge-completed' : 'badge-scheduled';
  }

  recurrenceLabel(t: PlannedMaintenanceTask): string {
    return formatRecurrenceText(t.repeatTaskType, t.repeatTaskNumber);
  }

  formatDate(iso?: string | null): string {
    if (!iso) return 'Open-ended';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatDateTime(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return this.formatDate(`${value.trim()}T12:00:00`);
    }
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  getDetailProp(task: PlannedMaintenanceTask | null, camelKey: string, snakeKey: string): any {
    if (!task) return null;
    const raw = task as unknown as Record<string, unknown>;
    return raw[snakeKey] ?? raw[camelKey] ?? null;
  }

  private formatDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  async exportDailyTemplate(template: 'checklist' | 'report', format: 'docx' | 'pdf'): Promise<void> {
    this.dailyExportOpen = false;
    const label = template === 'checklist' ? 'Checklist' : 'Report';
    await this.exportSvc.download(
      `planned-maintenance-daily/${this.selectedDate}/${template}`,
      format,
      `planned_maintenance_${template}_${this.selectedDate}`,
      {},
      {
        includeDateRange: false,
        successMessage: `${label} ${format.toUpperCase()} exported for ${this.selectedDate}.`
      }
    );
  }

  private emptyForm(): any {
    const startDefault = new Date();
    startDefault.setHours(8, 0, 0, 0);
    return {
      system: '',
      subsystem: '',
      task: '',
      reference: '',
      operationDateStart: startDefault,
      operationDateEnd: null,
      repeatTaskType: 'WEEK',
      repeatTaskNumber: 1,
      recurrenceEndDate: null,
      reportTemplate: '',
      status: 'TODO',
      optional: false
    };
  }
}
