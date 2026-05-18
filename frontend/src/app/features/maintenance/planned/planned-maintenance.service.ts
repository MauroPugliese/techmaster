// =============================================================================
// planned-maintenance.service.ts — Full CRUD via ApiService
// =============================================================================
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { PlannedMaintenanceTask, CalendarIndicators } from '../../../core/models/interfaces';

@Injectable({ providedIn: 'root' })
export class PlannedMaintenanceService {

  constructor(private api: ApiService) {}

  // GET /api/maintenance/planned?search=&limit=&page=&status=&repeat_task_type=
  getTasks(params: any = {}): Observable<{ items: PlannedMaintenanceTask[]; total: number }> {
    return this.api.get<any>('/maintenance/planned', params).pipe(
      map(res => ({
        items: res?.data?.items || res?.data || [],
        total: res?.data?.total || 0
      })),
      catchError(() => of({ items: [], total: 0 }))
    );
  }

  // GET /api/maintenance/planned/:id
  getTask(id: number): Observable<PlannedMaintenanceTask | null> {
    return this.api.get<any>(`/maintenance/planned/${id}`).pipe(
      map(res => res?.data || null),
      catchError(() => of(null))
    );
  }

  // GET /api/maintenance/planned/date/:date
  getTasksForDate(date: string): Observable<PlannedMaintenanceTask[]> {
    return this.api.get<any>(`/maintenance/planned/date/${date}`).pipe(
      map(res => res?.data || []),
      catchError(() => of([]))
    );
  }

  // GET /api/maintenance/planned/calendar/:year/:month
  getCalendarIndicators(year: number, month: number): Observable<CalendarIndicators> {
    return this.api.get<any>(`/maintenance/planned/calendar/${year}/${month}`).pipe(
      map(res => res?.data || {}),
      catchError(() => of({}))
    );
  }

  // POST /api/maintenance/planned
  createTask(payload: Partial<PlannedMaintenanceTask>): Observable<any> {
    return this.api.post<any>('/maintenance/planned', payload);
  }

  // PUT /api/maintenance/planned/:id
  updateTask(id: number, payload: Partial<PlannedMaintenanceTask>): Observable<any> {
    return this.api.put<any>(`/maintenance/planned/${id}`, payload);
  }

  // DELETE /api/maintenance/planned/:id
  deleteTask(id: number): Observable<any> {
    return this.api.delete<any>(`/maintenance/planned/${id}`);
  }
}
