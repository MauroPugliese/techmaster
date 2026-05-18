import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Operation, ApiResponse, PaginatedResponse } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class OperationsService {
  constructor(private api: ApiService) {}

  getAll(params: Record<string, any> = {}): Observable<ApiResponse<PaginatedResponse<Operation>>> {
    return this.api.get('/operations', params);
  }
  getById(id: number): Observable<ApiResponse<Operation>> {
    return this.api.get(`/operations/${id}`);
  }
  create(data: Partial<Operation>): Observable<ApiResponse<Operation>> {
    return this.api.post('/operations', data);
  }
  update(id: number, data: Partial<Operation>): Observable<ApiResponse<Operation>> {
    return this.api.put(`/operations/${id}`, data);
  }
  remove(id: number): Observable<any> {
    return this.api.delete(`/operations/${id}`);
  }
}
