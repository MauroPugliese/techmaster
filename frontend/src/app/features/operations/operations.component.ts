// =============================================================================
// operations.component.ts — updated: ToastService + ConfirmService
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiService }       from '../../core/services/services';
import { DateFilterService } from '../../core/services/services';
import { ToastService }     from '../../core/services/toast.service';
import { ConfirmService }   from '../../core/services/confirm.service';
import { Operation, OperationType } from '../../core/models/interfaces';

@Component({
  selector: 'app-operations',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, TitleCasePipe],
  templateUrl: './operations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private search$  = new Subject<string>();

  operations: Operation[]     = [];
  opTypes:    OperationType[] = [];
  loading  = true;
  saving   = false;
  total    = 0;
  page     = 1;
  pageSize = 20;
  viewMode: 'table' | 'cards' = 'table';

  searchQuery    = '';
  statusFilter   = '';
  priorityFilter = '';

  showModal  = false;
  editingOp: Operation | null = null;
  form:      Partial<Operation> = this.emptyForm();
  Math = Math;

  constructor(
    private api:     ApiService,
    private dateFilter: DateFilterService,
    private toast:   ToastService,
    private confirm: ConfirmService,
    private cdr:     ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.get<any>('/operations/types').subscribe(res => {
      this.opTypes = res?.data || []; this.cdr.markForCheck();
    });
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.loadOperations(); });
    this.dateFilter.range$.pipe(takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.loadOperations(); });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  loadOperations(): void {
    this.loading = true;
    this.api.get<any>('/operations', {
      status: this.statusFilter, priority: this.priorityFilter,
      page: this.page, limit: this.pageSize, search: this.searchQuery
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.operations = res.data.items; this.total = res.data.total;
        this.loading = false; this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  onSearch(): void { this.search$.next(this.searchQuery); }
  get totalPages(): number { return Math.ceil(this.total / this.pageSize); }
  changePage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p; this.loadOperations();
  }

  openModal(op?: Operation): void {
    this.editingOp = op || null;
    this.form      = op ? { ...op } : this.emptyForm();
    this.showModal = true;
  }
  editOperation(op: Operation): void { this.openModal(op); }
  closeModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  saveOperation(): void {
    if (!this.form.title || !this.form.type_id || !this.form.start_date) return;
    this.saving = true;
    const isEdit = !!this.editingOp;
    const req$   = isEdit
      ? this.api.put<any>(`/operations/${this.editingOp!.id}`, this.form)
      : this.api.post<any>('/operations', this.form);
    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.loadOperations();
        this.toast.success(isEdit ? 'Operation updated.' : 'Operation created.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save operation.');
        this.cdr.markForCheck();
      }
    });
  }

  async deleteOperation(op: Operation): Promise<void> {
    const ok = await this.confirm.confirm(
      `Delete "${op.title}"? This cannot be undone.`, 'Delete Operation');
    if (!ok) return;
    this.api.delete<any>(`/operations/${op.id}`).subscribe({
      next: () => { this.loadOperations(); this.toast.success('Operation deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  getStatusBadge(s: string): string {
    const m: Record<string,string> = {
      PLANNED:'badge-planned', IN_PROGRESS:'badge-in-progress',
      COMPLETED:'badge-completed', CANCELLED:'badge-cancelled', ON_HOLD:'badge-on-hold'
    };
    return m[s] || 'badge-planned';
  }
  getPriorityBadge(p: string): string {
    const m: Record<string,string> = { LOW:'badge-low', MEDIUM:'badge-medium', HIGH:'badge-high', CRITICAL:'badge-critical' };
    return m[p] || 'badge-medium';
  }
  getInitials(u?: Partial<{first_name:string;last_name:string}>): string {
    if (!u) return '?';
    return `${u.first_name?.[0]||''}${u.last_name?.[0]||''}`.toUpperCase();
  }
  private emptyForm(): Partial<Operation> {
    return { title:'', description:'', status:'PLANNED', priority:'MEDIUM', location:'', start_date:'', end_date:'', notes:'' };
  }
}
