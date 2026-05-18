// =============================================================================
// planned-maintenance-dashboard.component.ts — Full page with CRUD
// Same pattern as operations.component.ts and warehouse.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';
import { PlannedMaintenanceService } from './planned-maintenance.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { MaintenanceCalendarComponent } from './maintenance-calendar/maintenance-calendar.component';
import { TaskEventListComponent } from './task-event-list/task-event-list.component';

@Component({
  selector: 'app-planned-maintenance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, MaintenanceCalendarComponent, TaskEventListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-maintenance-dashboard.component.html',
  styleUrls: ['./planned-maintenance-dashboard.component.scss']
})
export class PlannedMaintenanceDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Table data
  tasks: PlannedMaintenanceTask[] = [];
  loading = true;
  saving  = false;
  total   = 0;
  search  = '';

  // Calendar + Events
  dayTasks: PlannedMaintenanceTask[] = [];
  indicators: CalendarIndicators = {};
  selectedDate = this.todayStr();
  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth() + 1;

  // Modal
  showModal = false;
  editing: PlannedMaintenanceTask | null = null;
  form: any = this.emptyForm();

  constructor(
    private svc: PlannedMaintenanceService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadTasks();
    this.loadDayTasks();
    this.loadIndicators();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  // ── Table ────────────────────────────────────────────────────────────────────
  loadTasks(): void {
    this.loading = true;
    this.svc.getTasks({ search: this.search, limit: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe(res => {
        this.tasks = res.items;
        this.total = res.total;
        this.loading = false;
        this.cdr.markForCheck();
      });
  }

  // ── Calendar / Events ────────────────────────────────────────────────────────
  onDateSelected(dateStr: string): void {
    this.selectedDate = dateStr;
    this.loadDayTasks();
  }

  onMonthChanged(event: { year: number; month: number }): void {
    this.calYear = event.year;
    this.calMonth = event.month;
    this.loadIndicators();
  }

  loadDayTasks(): void {
    this.svc.getTasksForDate(this.selectedDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe(tasks => { this.dayTasks = tasks; this.cdr.markForCheck(); });
  }

  loadIndicators(): void {
    this.svc.getCalendarIndicators(this.calYear, this.calMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe(ind => { this.indicators = ind; this.cdr.markForCheck(); });
  }

  // ── CRUD Modal ───────────────────────────────────────────────────────────────
  openModal(task?: PlannedMaintenanceTask): void {
    if (task) {
      this.editing = task;
      this.form = {
        system: task.system,
        subsystem: task.subsystem,
        task: task.task,
        reference: task.reference || '',
        operation_date_start: this.toLocalDatetime(task.operation_date_start),
        operation_date_end: this.toLocalDatetime(task.operation_date_end),
        repeat_task_type: task.repeat_task_type,
        repeat_task_number: task.repeat_task_number,
        report_template: task.report_template || '',
        status: task.status,
        optional: task.optional || false
      };
    } else {
      this.editing = null;
      this.form = this.emptyForm();
    }
    this.showModal = true;
    this.cdr.markForCheck();
  }

  closeModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  save(): void {
    if (!this.form.system?.trim())   { this.toast.warning('System is required.'); return; }
    if (!this.form.subsystem?.trim()) { this.toast.warning('Subsystem is required.'); return; }
    if (!this.form.task?.trim())      { this.toast.warning('Task description is required.'); return; }
    if (!this.form.operation_date_start) { this.toast.warning('Start date is required.'); return; }
    if (!this.form.operation_date_end)   { this.toast.warning('End date is required.'); return; }

    const payload = {
      ...this.form,
      operation_date_start: new Date(this.form.operation_date_start).toISOString(),
      operation_date_end: new Date(this.form.operation_date_end).toISOString(),
      repeat_task_number: Number(this.form.repeat_task_number) || 1,
      optional: this.form.optional ? true : false
    };

    this.saving = true;
    const isEdit = !!this.editing;
    const req$ = isEdit
      ? this.svc.updateTask(this.editing!.id, payload)
      : this.svc.createTask(payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showModal = false;
        this.toast.success(isEdit ? 'Task updated.' : 'Task created.');
        this.loadTasks();
        this.loadDayTasks();
        this.loadIndicators();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save task.');
        this.cdr.markForCheck();
      }
    });
  }

  async deleteTask(task: PlannedMaintenanceTask): Promise<void> {
    const ok = await this.confirm.confirm(
      `Delete "${task.task}"? This cannot be undone.`, 'Delete Task');
    if (!ok) return;
    this.svc.deleteTask(task.id).subscribe({
      next: () => {
        this.toast.success('Task deleted.');
        this.loadTasks();
        this.loadDayTasks();
        this.loadIndicators();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  async toggleTaskStatus(task: PlannedMaintenanceTask): Promise<void> {
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    this.svc.updateTask(task.id, { status: newStatus }).subscribe({
      next: () => {
        this.toast.success(`Task marked as ${newStatus}.`);
        this.loadTasks();
        this.loadDayTasks();
        this.loadIndicators();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update.')
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  getRepeatBadge(type: string): string {
    switch (type) {
      case 'DAY':   return 'badge-day';
      case 'WEEK':  return 'badge-week';
      case 'MONTH': return 'badge-month';
      default:      return '';
    }
  }

  getStatusBadge(status: string): string {
    return status === 'DONE' ? 'badge-completed' : 'badge-planned';
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    return iso.replace('T', ' ').substring(0, 16);
  }

  private emptyForm(): any {
    return {
      system: '', subsystem: '', task: '', reference: '',
      operation_date_start: '', operation_date_end: '',
      repeat_task_type: 'WEEK', repeat_task_number: 1,
      report_template: '', status: 'TODO', optional: false
    };
  }

  private todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private toLocalDatetime(iso: string): string {
    if (!iso) return '';
    return iso.substring(0, 16);
  }
}
