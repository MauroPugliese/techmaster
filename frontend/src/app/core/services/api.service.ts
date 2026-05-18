import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateFilterService } from './date-filter.service';
import { DateRange } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly baseUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private dateFilter: DateFilterService
  ) {}

  buildParams(extra: Record<string, any> = {}, dateRange?: DateRange): HttpParams {
    let params = new HttpParams();
    const range = dateRange ?? this.dateFilter.currentRange;
    if (range.from) params = params.set('from', range.from.toISOString());
    if (range.to)   params = params.set('to',   range.to.toISOString());
    Object.entries(extra).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') {
        params = params.set(k, String(v));
      }
    });
    return params;
  }

  get<T>(path: string, extra: Record<string, any> = {}, dateRange?: DateRange): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, {
      params: this.buildParams(extra, dateRange)
    });
  }

  post<T>(path: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body);
  }

  put<T>(path: string, body: any): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${path}`, body);
  }

  patch<T>(path: string, body: any): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`);
  }
}
