// =============================================================================
// planned-maintenance-dashboard.component.ts — Full CRUD with real API
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';
import { PlannedMaintenanceService } from './planned-maintenance.service';
import { ToastService } from '../../../core/services/services';
import { ConfirmService } from '../../../core/services/services';
import { OwlDateTimeModule, OwlNativeDateTimeModule } from '@danielmoncada/angular-datetime-picker';

@Component({
  selector: 'app-planned-maintenance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, OwlDateTimeModule, OwlNativeDateTimeModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-maintenance-dashboard.component.html',
  styleUrls: ['./planned-maintenance-dashboard.component.scss']
})
export class PlannedMaintenanceDashboardComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  // Table
  tasks: PlannedMaintenanceTask[] = [];
  searchTerm = '';
  loading = false;

  // Calendar
  indicators: CalendarIndicators = {};
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth() + 1;
  calendarDays: (number | null)[] = [];
  weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Event list
  selectedDate = this.formatDateStr(new Date());
  dayTasks: PlannedMaintenanceTask[] = [];

  // Modal
  showModal = false;
  editing = false;
  editingScope: 'series' | 'occurrence' = 'series';
  saving = false;
  editId: number | null = null;
  occurrenceMeta: { masterId: number; occurrenceDate: string } | null = null;
  form: any = this.emptyForm();

  constructor(
    private svc: PlannedMaintenanceService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadTasks();
    this.buildCalendar();
    this.loadIndicators();
    this.loadDayTasks();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Table CRUD ───────────────────────────────────────────────────────────

  loadTasks(): void {
    this.loading = true;
    this.svc.getAll({ search: this.searchTerm })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: tasks => {
          this.tasks = tasks;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load tasks');
          this.cdr.markForCheck();
        }
      });
  }

  onSearch(): void {
    this.loadTasks();
  }

  openModal(task?: PlannedMaintenanceTask): void {
    this.editingScope = 'series';
    this.occurrenceMeta = null;
    if (task) {
      this.editing = true;
      this.editId = task.id;
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
    } else {
      this.editing = false;
      this.editId = null;
      this.form = this.emptyForm();
    }
    this.showModal = true;
  }

  openOccurrenceModal(task: PlannedMaintenanceTask): void {
    this.editingScope = 'occurrence';
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
  }

  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showModal = false;
    }
  }

  save(): void {
    if (!this.form.system || !this.form.subsystem || !this.form.task || !this.form.operationDateStart) {
      this.toast.error('Please fill required fields');
      return;
    }

    this.saving = true;
    const operationDateStart = this.form.operationDateStart ? new Date(this.form.operationDateStart).toISOString() : '';
    const operationDateEnd = this.form.operationDateEnd ? new Date(this.form.operationDateEnd).toISOString() : operationDateStart;
    const recurrenceEndDate = this.form.recurrenceEndDate
      ? (this.form.recurrenceEndDate instanceof Date
          ? this.form.recurrenceEndDate.toISOString().slice(0, 10)
          : new Date(this.form.recurrenceEndDate).toISOString().slice(0, 10))
      : null;
    const payload: Partial<PlannedMaintenanceTask> = {
      system: this.form.system,
      subsystem: this.form.subsystem,
      task: this.form.task,
      reference: this.form.reference,
      operationDateStart,
      operationDateEnd,
      repeatTaskType: this.form.repeatTaskType,
      repeatTaskNumber: this.form.repeatTaskNumber,
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
        this.toast.success(this.editing ? 'Task updated' : 'Task created');
        this.showModal = false;
        this.saving = false;
        this.loadTasks();
        this.loadIndicators();
        this.loadDayTasks();
        this.cdr.markForCheck();
      },
      error: () => {
        this.toast.error('Save failed');
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  deleteTask(task: PlannedMaintenanceTask): void {
    this.confirm.confirm(`Delete "${task.task}"?`, 'Delete Task', true).then(confirmed => {
      if (!confirmed) return;
      this.svc.delete(task.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toast.success('Task deleted');
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
    this.confirm.confirm(`Delete this occurrence of "${task.task}"?`, 'Delete Occurrence', true).then(confirmed => {
      if (!confirmed) return;
      this.svc.deleteOccurrence(masterId, occurrenceDate).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toast.success('Occurrence deleted');
          this.loadTasks();
          this.loadIndicators();
          this.loadDayTasks();
        },
        error: () => this.toast.error('Failed to delete occurrence')
      });
    });
  }

  toggleStatus(task: PlannedMaintenanceTask): void {
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    const masterId = task.masterId || task.id;
    const occurrenceDate = task.occurrenceDate || this.selectedDate;
    const obs = task.isOccurrence
      ? this.svc.updateOccurrence(masterId, occurrenceDate, { status: newStatus })
      : this.svc.update(task.id, { status: newStatus });

    obs
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadTasks();
          this.loadIndicators();
          this.loadDayTasks();
        },
        error: () => this.toast.error('Update failed')
      });
  }

  // ─── Calendar ─────────────────────────────────────────────────────────────

  buildCalendar(): void {
    const firstDay = new Date(this.calYear, this.calMonth - 1, 1);
    const lastDay = new Date(this.calYear, this.calMonth, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Monday=0
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
    this.loadIndicators();
    this.selectedDate = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-01`;
    this.loadDayTasks();
  }

  nextMonth(): void {
    this.calMonth++;
    if (this.calMonth > 12) { this.calMonth = 1; this.calYear++; }
    this.buildCalendar();
    this.loadIndicators();
    this.selectedDate = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-01`;
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
    const d = new Date(this.calYear, this.calMonth - 1, 1);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  // ─── Event List ───────────────────────────────────────────────────────────

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
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  getTypeColor(type: string): string {
    if (type === 'DAY') return '#0288D1';
    if (type === 'WEEK') return '#F59E0B';
    if (type === 'MONTH') return '#EF4444';
    return '#64748b';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getRepeatBadgeClass(type: string): string {
    if (type === 'DAY') return 'badge-day';
    if (type === 'WEEK') return 'badge-week';
    return 'badge-month';
  }

  getStatusBadgeClass(status: string): string {
    return status === 'DONE' ? 'badge-completed' : 'badge-scheduled';
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private formatDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private toDateInputValue(value?: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value).slice(0, 10);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toDateTimeLocalValue(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return value.slice(0, 16);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoString(value: string): string {
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toISOString();
  }

  
  async exportPlanned(format: 'xlsx' | 'pdf' | 'docx'): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const periodStart = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-01`;
      const periodEnd = `${this.calYear}-${String(this.calMonth).padStart(2, '0')}-${String(new Date(this.calYear, this.calMonth, 0).getDate()).padStart(2, '0')}`;
      const url = this.svc.getExportUrl(format, periodStart, periodEnd);
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `planned_maintenance_${periodStart}_${periodEnd}.${format}`;
      a.click();
      URL.revokeObjectURL(href);
      this.toast.success(`Planned maintenance report exported (${format.toUpperCase()}).`);
    } catch {
      this.toast.error('Planned maintenance export failed.');
    }
  }
  private emptyForm(): any {
    return {
      system: '',
      subsystem: '',
      task: '',
      reference: '',
      operationDateStart: null,
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

