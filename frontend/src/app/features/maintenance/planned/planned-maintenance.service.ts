// =============================================================================
// planned-maintenance.service.ts — Real API CRUD (NO mock data)
// =============================================================================
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';

@Injectable({ providedIn: 'root' })
export class PlannedMaintenanceService {

  private basePath = '/api/maintenance/planned';

  constructor(private api: ApiService) {}

  /** Get all tasks (table view — only task definitions, no recurrence expansion) */
  getAll(params: Record<string, any> = {}): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(this.basePath, { ...params, limit: 200 }).pipe(
      map(res => res.data?.items || res.data || [])
    );
  }

  /** Get single task by ID */
  getById(id: number): Observable<PlannedMaintenanceTask> {
    return this.api.get<any>(`${this.basePath}/${id}`).pipe(
      map(res => res.data)
    );
  }

  /** Get tasks for a specific date (with recurrence expansion — for event list) */
  getTasksForDate(dateStr: string): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(`${this.basePath}/date/${dateStr}`).pipe(
      map(res => res.data || [])
    );
  }

  /** Get calendar indicators for a month (with recurrence expansion) */
  getCalendarIndicators(year: number, month: number): Observable<CalendarIndicators> {
    return this.api.get<any>(`${this.basePath}/calendar/${year}/${month}`).pipe(
      map(res => res.data || {})
    );
  }

  /** Create a new task */
  create(task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.post<any>(this.basePath, this.toSnakeCase(task)).pipe(
      map(res => res.data)
    );
  }

  /** Update existing task */
  update(id: number, task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.put<any>(`${this.basePath}/${id}`, this.toSnakeCase(task)).pipe(
      map(res => res.data)
    );
  }

  /** Delete task */
  delete(id: number): Observable<any> {
    return this.api.delete<any>(`${this.basePath}/${id}`);
  }

  /** Convert camelCase form to snake_case for backend */
  private toSnakeCase(task: Partial<PlannedMaintenanceTask>): any {
    return {
      system: task.system,
      subsystem: task.subsystem,
      task: task.task,
      reference: task.reference || '',
      operation_date_start: task.operationDateStart,
      operation_date_end: task.operationDateEnd,
      repeat_task_type: task.repeatTaskType,
      repeat_task_number: task.repeatTaskNumber,
      report_template: task.reportTemplate || '',
      status: task.status,
      optional: task.optional || false
    };
  }
}