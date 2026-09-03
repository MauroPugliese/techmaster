// =============================================================================
// core/services/export.service.ts — Unified document export client
// -----------------------------------------------------------------------------
// Centralises the authenticated download of branded Excel / Word / PDF reports
// produced by the backend unified export engine (GET /api/export/:module).
// =============================================================================
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ToastService } from './toast.service';

export type ExportFormat = 'xlsx' | 'pdf' | 'docx';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly baseUrl = environment.apiUrl;

  /** Friendly file extension + label per format. */
  static readonly FORMATS: { value: ExportFormat; label: string; icon: string }[] = [
    { value: 'xlsx', label: 'Excel',  icon: 'table_view' },
    { value: 'docx', label: 'Word',   icon: 'description' },
    { value: 'pdf',  label: 'PDF',    icon: 'picture_as_pdf' }
  ];

  constructor(private toast: ToastService) {}

  /**
   * Download a report from an export endpoint as the given format.
   *
   * @param endpoint Module key (e.g. 'operations') or full path (e.g. 'wiki/12').
   * @param format   Target document format.
   * @param filename Base file name (without extension).
   * @param params   Optional query filters forwarded to the backend.
   */
  async download(
    endpoint: string,
    format: ExportFormat,
    filename: string,
    params: Record<string, string | number | boolean | null | undefined> = {}
  ): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const query = new URLSearchParams({ format });
      Object.entries(params).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') query.set(k, String(v));
      });

      const res = await fetch(`${this.baseUrl}/export/${endpoint}?${query.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        if (res.status === 403) throw new Error('You do not have permission to export this module.');
        throw new Error('Export request failed.');
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      this.toast.success(`Report exported (${format.toUpperCase()}).`);
    } catch (err: any) {
      this.toast.error(err?.message || 'Export failed.');
    }
  }
}
