// =============================================================================
// maintenance.component.ts — updated: ToastService + ConfirmService
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService }       from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { ToastService }     from '../../core/services/toast.service';
import { ConfirmService }   from '../../core/services/confirm.service';
import { MaintenanceRecord, Asset } from '../../core/models/interfaces';
import { OwlDateTimeModule, OwlNativeDateTimeModule } from '@danielmoncada/angular-datetime-picker';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, TitleCasePipe, OwlDateTimeModule, OwlNativeDateTimeModule],
  templateUrl: './maintenance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  records: MaintenanceRecord[] = [];
  assets:  Asset[]             = [];
  loading  = true;
  saving   = false;
  statusFilter   = '';
  priorityFilter = '';
  showModal = false;
  editing:  MaintenanceRecord | null = null;
  form:     any = this.emptyForm();

  get stats() {
    return [
      { label:'Scheduled',   count: this.records.filter(r=>r.status==='SCHEDULED').length,   icon:'event',        color:'#0288D1' },
      { label:'In Progress', count: this.records.filter(r=>r.status==='IN_PROGRESS').length,  icon:'pending',      color:'#F59E0B' },
      { label:'Completed',   count: this.records.filter(r=>r.status==='COMPLETED').length,   icon:'check_circle', color:'#10B981' },
      { label:'Failed',      count: this.records.filter(r=>r.status==='FAILED').length,      icon:'error',        color:'#EF4444' },
      { label:'Deferred',    count: this.records.filter(r=>r.status==='DEFERRED').length,    icon:'schedule',     color:'#9CA3AF' },
    ];
  }

  constructor(
    private api:     ApiService,
    private dateFilter: DateFilterService,
    private toast:   ToastService,
    private confirm: ConfirmService,
    private cdr:     ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.get<any>('/maintenance/assets').subscribe({
      next: r => { this.assets = r?.data || []; this.cdr.markForCheck(); }
    });
    this.dateFilter.range$.pipe(takeUntil(this.destroy$)).subscribe(() => this.load());
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  load(): void {
    this.loading = true;
    this.api.get<any>('/maintenance', { status: this.statusFilter, priority: this.priorityFilter, limit: 100 }).subscribe({
      next: r => { this.records = r?.data?.items || []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  private emptyForm() {
    return { asset_id: undefined, type:'PREVENTIVE', priority:'MEDIUM', status:'SCHEDULED',
             title:'', description:'', findings:'', scheduled_date: null,
             downtime_hours: undefined, cost: undefined };
  }

  openModal(): void {
    this.editing = null; this.form = this.emptyForm(); this.showModal = true; this.cdr.markForCheck();
  }
  editRecord(r: MaintenanceRecord): void {
    this.editing = r;
    this.form    = { 
      ...r, 
      description: r.description ?? '', 
      findings: r.findings ?? '',
      scheduled_date: r.scheduled_date ? new Date(r.scheduled_date) : null
    };
    this.showModal = true; this.cdr.markForCheck();
  }
  closeModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  save(): void {
    if (!this.form.title?.trim())       { this.toast.warning('Title is required.');          return; }
    if (!this.form.asset_id)            { this.toast.warning('Please select an asset.');     return; }
    if (!this.form.scheduled_date)      { this.toast.warning('Scheduled date is required.'); return; }
    if (!this.form.description?.trim()) { this.toast.warning('Description is required.');    return; }

    const payload: any = { ...this.form };
    if (payload.status === 'COMPLETED' && !payload.completed_date)
      payload.completed_date = new Date().toISOString();

    this.saving = true;
    const isEdit = !!this.editing;
    const req$   = isEdit
      ? this.api.put<any>(`/maintenance/${this.editing!.id}`, payload)
      : this.api.post<any>('/maintenance', payload);

    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.load();
        this.toast.success(isEdit ? 'Record updated.' : 'Maintenance record created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save record.');
        this.cdr.markForCheck();
      }
    });
  }

  completeRecord(r: MaintenanceRecord): void {
    this.api.put<any>(`/maintenance/${r.id}`, { status:'COMPLETED', completed_date: new Date().toISOString() }).subscribe({
      next: () => { this.load(); this.toast.success('Marked as completed.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update.')
    });
  }

  async deleteRecord(r: MaintenanceRecord): Promise<void> {
    const ok = await this.confirm.confirm(`Delete "${r.title}"? This cannot be undone.`, 'Delete Record');
    if (!ok) return;
    this.api.delete<any>(`/maintenance/${r.id}`).subscribe({
      next: () => { this.load(); this.toast.success('Record deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  getStatusBadge(s: string): string {
    const m: Record<string,string> = { SCHEDULED:'badge-planned', IN_PROGRESS:'badge-in-progress', COMPLETED:'badge-completed', FAILED:'badge-cancelled', DEFERRED:'badge-on-hold' };
    return m[s] || 'badge-planned';
  }
  getPriorityBadge(p: string): string {
    const m: Record<string,string> = { LOW:'badge-low', MEDIUM:'badge-medium', HIGH:'badge-high', CRITICAL:'badge-critical' };
    return m[p] || 'badge-medium';
  }
}
