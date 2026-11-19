import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateFilterService } from './date-filter.service';
import { ToastService } from './toast.service';

export type ExportFormat = 'xlsx' | 'pdf' | 'docx' | 'pptx';

export interface ExportFormatOption {
  value: ExportFormat;
  label: string;
  description: string;
  icon: string;
}

export interface ExportDownloadOptions {
  includeDateRange?: boolean;
  successMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly baseUrl = environment.apiUrl;

  /** Supported report export formats with executive descriptions. */
  static readonly FORMATS: readonly ExportFormatOption[] = [
    {
      value: 'xlsx',
      label: 'Excel',
      description: 'Dashboard + live formulas',
      icon: 'table_view',
    },
    {
      value: 'docx',
      label: 'Word',
      description: 'Executive narrative & tables',
      icon: 'description',
    },
    {
      value: 'pdf',
      label: 'PDF',
      description: 'Print-ready deck with charts',
      icon: 'picture_as_pdf',
    },
    {
      value: 'pptx',
      label: 'PowerPoint',
      description: 'CAE slides & editable charts',
      icon: 'slideshow',
    },
  ];

  constructor(
    private http: HttpClient,
    private dateFilter: DateFilterService,
    private toast: ToastService,
  ) {}

  /** Format a Date as local calendar YYYY-MM-DD without UTC midnight shift. */
  private formatCalendarDate(value: Date | null | undefined): string | null {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Extract a safe download filename from Content-Disposition or fall back. */
  private extractFilename(
    contentDisposition: string | null,
    fallbackName: string,
    format: ExportFormat,
  ): string {
    if (contentDisposition) {
      const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
      if (utf8Match?.[1]) {
        try {
          return this.sanitizeFilename(decodeURIComponent(utf8Match[1].trim()));
        } catch {
          // Fall through to plain filename header check
        }
      }
      const plainMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
      if (plainMatch?.[1]) {
        return this.sanitizeFilename(plainMatch[1].trim());
      }
    }
    const cleanFallback = this.sanitizeFilename(fallbackName || 'report');
    return cleanFallback.toLowerCase().endsWith(`.${format}`)
      ? cleanFallback
      : `${cleanFallback}.${format}`;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[/\\:*?"<>|]+/g, '_').trim() || 'report';
  }

  /** Parse backend error payloads, including JSON returned inside error Blobs. */
  private async extractErrorMessage(err: unknown): Promise<string> {
    if (err instanceof HttpErrorResponse) {
      if (err.error instanceof Blob) {
        try {
          const text = await err.error.text();
          const parsed = JSON.parse(text);
          if (parsed?.message) return String(parsed.message);
        } catch {
          // Ignore non-JSON error blob and fall through
        }
      }
      if (typeof err.error === 'object' && err.error?.message) {
        return String(err.error.message);
      }
      if (err.status === 401) return 'Session expired. Please sign in again.';
      if (err.status === 403) return 'You do not have permission to export this report.';
      if (err.message) return err.message;
    }
    if (err instanceof Error && err.message) return err.message;
    return 'Export failed. Check your connection or permissions.';
  }

  /**
   * Request a formatted report via Angular HttpClient (through authInterceptor)
   * and trigger a browser download with the server-provided filename.
   */
  async download(
    endpoint: string,
    format: ExportFormat,
    filename: string,
    params: Record<string, string | number | boolean | null | undefined> = {},
    options: ExportDownloadOptions = {},
  ): Promise<boolean> {
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const url = `${this.baseUrl}/export/${cleanEndpoint}`;

    const merged: Record<string, string | number | boolean | null | undefined> = { ...params };
    if (options.includeDateRange !== false) {
      const range = this.dateFilter.currentRange;
      if (merged['from'] == null && merged['date'] == null && range.from) {
        merged['from'] = this.formatCalendarDate(range.from);
      }
      if (merged['to'] == null && merged['date'] == null && range.to) {
        merged['to'] = this.formatCalendarDate(range.to);
      }
    }

    let httpParams = new HttpParams().set('format', format);
    for (const [key, val] of Object.entries(merged)) {
      if (val !== undefined && val !== null && val !== '') {
        httpParams = httpParams.set(key, String(val));
      }
    }

    try {
      const response = await firstValueFrom(
        this.http.get(url, {
          params: httpParams,
          responseType: 'blob',
          observe: 'response',
        }),
      );

      const blob = response.body;
      if (!blob) throw new Error('Empty response received from export server.');

      const resolvedName = this.extractFilename(
        response.headers.get('Content-Disposition'),
        filename,
        format,
      );

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = resolvedName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      const fmtMeta = ExportService.FORMATS.find(f => f.value === format);
      this.toast.success(
        options.successMessage || `Exported ${fmtMeta?.label || format.toUpperCase()} report.`,
      );
      return true;
    } catch (err) {
      const message = await this.extractErrorMessage(err);
      this.toast.error(message);
      return false;
    }
  }
}
