import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';

@Injectable({ providedIn: 'root' })
export class PlannedMaintenanceService {

  private basePath = '/maintenance/planned';

  constructor(private api: ApiService) {}

  private normalizeTask(task: any): PlannedMaintenanceTask {
    return {
      id: task.id,
      system: task.system,
      subsystem: task.subsystem,
      task: task.task,
      reference: task.reference ?? '',
      operationDateStart: task.operationDateStart ?? task.operation_date_start ?? '',
      operationDateEnd: task.operationDateEnd ?? task.operation_date_end ?? '',
      repeatTaskType: task.repeatTaskType ?? task.repeat_task_type ?? 'WEEK',
      repeatTaskNumber: task.repeatTaskNumber ?? task.repeat_task_number ?? 1,
      recurrenceEndDate: task.recurrenceEndDate ?? task.recurrence_end_date ?? null,
      reportTemplate: task.reportTemplate ?? task.report_template ?? '',
      status: task.status ?? 'TODO',
      optional: task.optional ?? false,
      masterId: task.masterId ?? task.master_id ?? task.planned_task_id ?? task.id,
      instanceId: task.instanceId ?? task.instance_id ?? null,
      occurrenceDate: task.occurrenceDate ?? task.occurrence_date ?? null,
      isOccurrence: task.isOccurrence ?? task.is_occurrence ?? false,
      exceptionType: task.exceptionType ?? task.exception_type ?? null
    };
  }

  private toApiPayload(task: Partial<PlannedMaintenanceTask>): Record<string, any> {
    const payload: Record<string, any> = {};

    if (task.system !== undefined) payload.system = task.system;
    if (task.subsystem !== undefined) payload.subsystem = task.subsystem;
    if (task.task !== undefined) payload.task = task.task;
    if (task.reference !== undefined) payload.reference = task.reference;
    if (task.operationDateStart !== undefined) payload.operation_date_start = task.operationDateStart;
    if (task.operationDateEnd !== undefined) payload.operation_date_end = task.operationDateEnd;
    if (task.repeatTaskType !== undefined) payload.repeat_task_type = task.repeatTaskType;
    if (task.repeatTaskNumber !== undefined) payload.repeat_task_number = task.repeatTaskNumber;
    if (task.recurrenceEndDate !== undefined) payload.recurrence_end_date = task.recurrenceEndDate;
    if (task.reportTemplate !== undefined) payload.report_template = task.reportTemplate;
    if (task.status !== undefined) payload.status = task.status;
    if (task.optional !== undefined) payload.optional = task.optional;

    return payload;
  }

  getAll(params: Record<string, any> = {}): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(this.basePath, { ...params, limit: 200 }).pipe(
      map(res => (res.data?.items || res.data || []).map((task: any) => this.normalizeTask(task)))
    );
  }

  getById(id: number): Observable<PlannedMaintenanceTask> {
    return this.api.get<any>(`${this.basePath}/${id}`).pipe(map(res => this.normalizeTask(res.data)));
  }

  getTasksForDate(dateStr: string): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(`${this.basePath}/date/${dateStr}`).pipe(
      map(res => (res.data || []).map((task: any) => this.normalizeTask(task)))
    );
  }

  getCalendarIndicators(year: number, month: number): Observable<CalendarIndicators> {
    return this.api.get<any>(`${this.basePath}/calendar/${year}/${month}`).pipe(
      map(res => res.data || {})
    );
  }

  create(task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.post<any>(this.basePath, this.toApiPayload(task)).pipe(map(res => this.normalizeTask(res.data)));
  }

  update(id: number, task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.put<any>(`${this.basePath}/${id}`, this.toApiPayload(task)).pipe(map(res => this.normalizeTask(res.data)));
  }

  updateOccurrence(id: number, occurrenceDate: string, task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.put<any>(`${this.basePath}/${id}/occurrence/${occurrenceDate}`, this.toApiPayload(task)).pipe(map(res => this.normalizeTask(res.data)));
  }

  deleteOccurrence(id: number, occurrenceDate: string): Observable<any> {
    return this.api.delete<any>(`${this.basePath}/${id}/occurrence/${occurrenceDate}`);
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`${this.basePath}/${id}`);
  }

  getExportUrl(format: 'xlsx' | 'pdf' | 'docx', from: string, to: string): string {
    return `${this.api.baseUrl}/export/planned-maintenance-report?format=${format}&from=${from}&to=${to}`;
  }
}
