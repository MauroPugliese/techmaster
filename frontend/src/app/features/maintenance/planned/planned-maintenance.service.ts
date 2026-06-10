import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';

@Injectable({ providedIn: 'root' })
export class PlannedMaintenanceService {

  private basePath = '/maintenance/planned';

  constructor(private api: ApiService) {}

  getAll(params: Record<string, any> = {}): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(this.basePath, { ...params, limit: 200 }).pipe(
      map(res => res.data?.items || res.data || [])
    );
  }

  getById(id: number): Observable<PlannedMaintenanceTask> {
    return this.api.get<any>(`${this.basePath}/${id}`).pipe(map(res => res.data));
  }

  getTasksForDate(dateStr: string): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(`${this.basePath}/date/${dateStr}`).pipe(
      map(res => res.data || [])
    );
  }

  getCalendarIndicators(year: number, month: number): Observable<CalendarIndicators> {
    return this.api.get<any>(`${this.basePath}/calendar/${year}/${month}`).pipe(
      map(res => res.data || {})
    );
  }

  create(task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.post<any>(this.basePath, task).pipe(map(res => res.data));
  }

  update(id: number, task: Partial<PlannedMaintenanceTask>): Observable<PlannedMaintenanceTask> {
    return this.api.put<any>(`${this.basePath}/${id}`, task).pipe(map(res => res.data));
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`${this.basePath}/${id}`);
  }

  getExportUrl(format: 'xlsx' | 'pdf' | 'docx', from: string, to: string): string {
    return `${this.api.baseUrl}/export/planned-maintenance-report?format=${format}&from=${from}&to=${to}`;
  }
}
