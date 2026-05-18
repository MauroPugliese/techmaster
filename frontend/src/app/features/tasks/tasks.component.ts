// =============================================================================
// tasks.component.ts — Recursive Task Manager
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { ToastService }   from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

import { ApiService } from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { Task, IntervalType, TaskStatus, Priority } from '../../core/models/interfaces';

interface Column { status: TaskStatus; label: string; color: string; }

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TasksComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  tasks:    Task[] = [];
  allTasks: Task[] = []; // flat list for parent selector
  loading = true;
  saving  = false;

  activeInterval: IntervalType | '' = '';
  statusFilter = '';

  showModal   = false;
  editingTask: Task | null = null;
  form:        Partial<Task> = this.emptyForm();
  tagsInput   = '';

  intervals = [
    { value: '' as const,         label: 'All',     icon: 'apps' },
    { value: 'DAILY' as const,    label: 'Daily',   icon: 'today' },
    { value: 'WEEKLY' as const,   label: 'Weekly',  icon: 'view_week' },
    { value: 'MONTHLY' as const,  label: 'Monthly', icon: 'calendar_month' },
    { value: 'YEARLY' as const,   label: 'Yearly',  icon: 'event' },
    { value: 'ONCE' as const,     label: 'Once',    icon: 'looks_one' },
  ];

  columns: Column[] = [
    { status: 'TODO',        label: 'To Do',      color: '#6B7280' },
    { status: 'IN_PROGRESS', label: 'In Progress', color: '#0288D1' },
    { status: 'REVIEW',      label: 'In Review',   color: '#F59E0B' },
    { status: 'DONE',        label: 'Done',        color: '#10B981' },
  ];

  get taskStats() {
    return [
      { label: 'Total',       count: this.tasks.length,                                icon: 'task_alt',  color: '#1565C0' },
      { label: 'In Progress', count: this.tasks.filter(t => t.status==='IN_PROGRESS').length, icon: 'pending', color: '#0288D1' },
      { label: 'Overdue',     count: this.tasks.filter(t => this.isOverdue(t)).length, icon: 'warning',   color: '#EF4444' },
      { label: 'Done',        count: this.tasks.filter(t => t.status==='DONE').length, icon: 'check_circle', color: '#10B981' },
    ];
  }

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef,
    private toast:   ToastService,
    private confirm: ConfirmService,
  ) {}

  ngOnInit(): void {
    this.dateFilter.range$.pipe(
      takeUntil(this.destroy$),
      switchMap(() => {
        this.loading = true;
        this.cdr.markForCheck();
        return this.api.get<any>('/tasks', {
          interval_type: this.activeInterval,
          status: this.statusFilter,
          limit: 100
        });
      })
    ).subscribe({
      next: res => {
        this.tasks = res.data.items;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });

    // Load all tasks for parent selector
    this.api.get<any>('/tasks', { limit: 200 }).subscribe(res => {
      this.allTasks = res.data.items;
      this.cdr.markForCheck();
    });
  }

  loadTasks(): void {
    this.loading = true;
    this.api.get<any>('/tasks', {
      interval_type: this.activeInterval,
      status: this.statusFilter,
      limit: 100
    }).subscribe({
      next: res => { this.tasks = res.data.items; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  setInterval(v: IntervalType | ''): void {
    this.activeInterval = v;
    this.loadTasks();
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.tasks.filter(t => t.status === status);
  }

  getDoneSubtasks(task: Task): number {
    return task.subtasks?.filter(s => s.status === 'DONE').length ?? 0;
  }

  isOverdue(task: Task): boolean {
    if (!task.due_date || task.status === 'DONE') return false;
    return new Date(task.due_date) < new Date();
  }

  openModal(defaultStatus?: TaskStatus): void {
    this.editingTask = null;
    this.form = this.emptyForm();
    if (defaultStatus) this.form.status = defaultStatus;
    if (this.activeInterval) this.form.interval_type = this.activeInterval as IntervalType;
    this.tagsInput = '';
    this.showModal = true;
  }

  editTask(task: Task): void {
    this.editingTask = task;
    this.form = { ...task };
    this.tagsInput = (task.tags || []).join(', ');
    this.showModal = true;
  }

  closeModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  saveTask(): void {
    if (!this.form.title) return;
    this.saving = true;
    this.form.tags = this.tagsInput ? this.tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isEdit = !!this.editingTask;
    const req$   = isEdit
      ? this.api.put<any>(`/tasks/${this.editingTask!.id}`, this.form)
      : this.api.post<any>('/tasks', this.form);
    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.loadTasks();
        this.toast.success(isEdit ? 'Task updated.' : 'Task created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save task.');
        this.cdr.markForCheck();
      }
    });
  }

  quickStatusChange(task: Task, event: MouseEvent): void {
    event.stopPropagation();
    const nextStatus: Record<TaskStatus, TaskStatus> = {
      'TODO':'IN_PROGRESS','IN_PROGRESS':'REVIEW','REVIEW':'DONE',
      'DONE':'TODO','CANCELLED':'TODO','OVERDUE':'IN_PROGRESS'
    };
    this.api.put<any>(`/tasks/${task.id}`, { status: nextStatus[task.status] }).subscribe({
      next: () => { this.loadTasks(); this.toast.info('Status updated.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update status.')
    });
  }

  async deleteTask(task: Task, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const ok = await this.confirm.confirm(`Delete "${task.title}"? This cannot be undone.`, 'Delete Task');
    if (!ok) return;
    this.api.delete<any>(`/tasks/${task.id}`).subscribe({
      next: () => { this.loadTasks(); this.toast.success('Task deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  addSubtaskToEditing(): void {
    if (!this.editingTask) return;
    const title = prompt('Subtask title:');
    if (!title) return;
    this.api.post<any>('/tasks', {
      title, parent_id: this.editingTask.id,
      interval_type: 'ONCE', status: 'TODO', priority: 'MEDIUM'
    }).subscribe(() => {
      this.api.get<any>(`/tasks/${this.editingTask!.id}`).subscribe(res => {
        this.editingTask = res.data;
        this.cdr.markForCheck();
      });
      this.loadTasks();
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  getPriorityColor(p: Priority): string {
    const m: Record<string,string> = { LOW:'#10B981', MEDIUM:'#F59E0B', HIGH:'#EF4444', CRITICAL:'#9D174D' };
    return m[p] || '#F59E0B';
  }

  getPriorityBadge(p: Priority): string {
    const m: Record<string,string> = { LOW:'badge-low', MEDIUM:'badge-medium', HIGH:'badge-high', CRITICAL:'badge-critical' };
    return m[p] || 'badge-medium';
  }

  getInitials(user: Partial<{ first_name: string; last_name: string }>): string {
    return `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase();
  }

  private emptyForm(): Partial<Task> {
    return {
      title: '', description: '', interval_type: 'ONCE', status: 'TODO',
      priority: 'MEDIUM', due_date: '', estimated_hours: undefined,
      parent_id: undefined, tags: []
    };
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
