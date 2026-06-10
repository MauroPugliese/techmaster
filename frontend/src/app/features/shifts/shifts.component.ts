// =============================================================================
// shifts.component.ts — updated: ToastService + ConfirmService (inline template)
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService }       from '../../core/services/api.service';
import { DateFilterService } from '../../core/services/date-filter.service';
import { ToastService }     from '../../core/services/toast.service';
import { ConfirmService }   from '../../core/services/confirm.service';
import { Shift, ShiftType } from '../../core/models/interfaces';

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule, MatNativeDateModule],
  template: `
<div class="shifts-page fade-in">

  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <button class="btn btn-secondary btn-sm" (click)="prevWeek()">
        <span class="btn-icon">chevron_left</span>
      </button>
      <h3 style="font-size:1rem;font-weight:700">
        Week of {{weekStart | date:'MMM d'}} – {{weekEnd | date:'MMM d, y'}}
      </h3>
      <button class="btn btn-secondary btn-sm" (click)="nextWeek()">
        <span class="btn-icon">chevron_right</span>
      </button>
      <button class="btn btn-ghost btn-sm" (click)="goToday()">Today</button>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-secondary btn-sm" (click)="exportShift('xlsx')">
        <span class="btn-icon">table_view</span> Excel
      </button>
      <button class="btn btn-secondary btn-sm" (click)="exportShift('pdf')">
        <span class="btn-icon">picture_as_pdf</span> PDF
      </button>
      <button class="btn btn-secondary btn-sm" (click)="exportShift('docx')">
        <span class="btn-icon">description</span> Word
      </button>
      <button class="btn btn-primary" (click)="openModal()">
        <span class="btn-icon">add</span> Schedule Shift
      </button>
    </div>
  </div>

  <!-- Legend -->
  <div class="flex gap-3 mb-5" style="flex-wrap:wrap">
    <div *ngFor="let st of shiftTypes"
         class="flex items-center gap-2"
         style="background:var(--surface);border:1px solid var(--border);
                border-radius:20px;padding:4px 12px 4px 8px">
      <div style="width:10px;height:10px;border-radius:50%" [style.background]="st.color"></div>
      <span style="font-size:0.8rem;font-weight:600">{{st.name}}</span>
      <span style="font-size:0.75rem;color:#9CA3AF">
        ({{st.start_time.slice(0,5)}} – {{st.end_time.slice(0,5)}})
      </span>
    </div>
  </div>

  <!-- Calendar -->
  <div class="table-container">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:160px">Employee</th>
          <th *ngFor="let day of weekDays" style="text-align:center;min-width:110px">
            <div [style.color]="isToday(day) ? 'var(--primary)' : ''"
                 [style.font-weight]="isToday(day) ? '800' : '600'">
              {{day | date:'EEE'}}
            </div>
            <div style="font-size:0.75rem;color:#9CA3AF">{{day | date:'MMM d'}}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let emp of employees">
          <td>
            <div class="flex items-center gap-2">
              <div style="width:30px;height:30px;border-radius:50%;background:var(--blue-200);
                          display:flex;align-items:center;justify-content:center;
                          font-size:0.7rem;font-weight:700;color:var(--primary)">
                {{emp.first_name[0]}}{{emp.last_name[0]}}
              </div>
              <div>
                <div style="font-weight:600;font-size:0.85rem">{{emp.first_name}} {{emp.last_name}}</div>
                <div style="font-size:0.72rem;color:#9CA3AF">{{emp.department}}</div>
              </div>
            </div>
          </td>
          <td *ngFor="let day of weekDays" style="text-align:center;padding:8px 6px">
            <ng-container *ngIf="getShift(emp.id, day) as shift; else emptyCell">
              <div style="border-radius:6px;padding:4px 8px;font-size:0.72rem;font-weight:700;cursor:pointer"
                   [style.background]="getShiftTypeColor(shift.shift_type_id) + '22'"
                   [style.color]="getShiftTypeColor(shift.shift_type_id)"
                   [style.border]="'1px solid ' + getShiftTypeColor(shift.shift_type_id) + '44'"
                   (click)="editShift(shift)">
                {{getShiftTypeName(shift.shift_type_id)}}
                <div *ngIf="shift.status==='ABSENT'" style="font-weight:400;opacity:0.8;margin-top:1px">Absent</div>
              </div>
            </ng-container>
            <ng-template #emptyCell>
              <button (click)="openModal(emp.id, day)"
                      style="width:100%;border:1.5px dashed var(--border);border-radius:6px;
                             background:none;cursor:pointer;padding:6px;color:#D1D5DB;font-size:0.7rem">
                +
              </button>
            </ng-template>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="flex items-center justify-between mt-4" *ngIf="pageCount() > 1">
      <div class="text-sm text-muted">Page {{employeePage}} of {{pageCount()}}</div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" type="button" (click)="prevPage()" [disabled]="employeePage === 1">Previous</button>
        <button class="btn btn-ghost btn-sm" type="button" (click)="nextPage()" [disabled]="employeePage === pageCount()">Next</button>
      </div>
    </div>
    <div class="empty-state" *ngIf="!employees.length && !loading">
      <span class="empty-icon">group</span><h3>No employees found</h3>
    </div>
  </div>
</div>

<!-- Shift Modal -->
<div class="modal-overlay" *ngIf="showModal" (click)="closeModal($event)">
  <div class="modal" style="max-width:440px" (click)="$event.stopPropagation()">
    <div class="modal-header">
      <h3>{{editingShift ? 'Edit Shift' : 'Schedule Shift'}}</h3>
      <button class="btn btn-ghost btn-icon-only" (click)="showModal=false">
        <span class="btn-icon">close</span>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Employee *</label>
        <select class="form-control" [(ngModel)]="shiftForm.user_id">
          <option [ngValue]="null">— Select employee —</option>
          <option *ngFor="let e of employees" [ngValue]="e.id">
            {{e.first_name}} {{e.last_name}}
          </option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Shift Type *</label>
          <select class="form-control" [(ngModel)]="shiftForm.shift_type_id">
            <option [ngValue]="null">— Select type —</option>
            <option *ngFor="let st of shiftTypes" [ngValue]="st.id">{{st.name}} ({{st.code}})</option>
          </select>
        </div>
        <div class="form-group">
          <mat-form-field appearance="fill" style="width:100%">
            <mat-label>Date *</mat-label>
            <input matInput [matDatepicker]="shiftDatePicker" [(ngModel)]="shiftForm.date">
            <mat-datepicker-toggle matSuffix [for]="shiftDatePicker"></mat-datepicker-toggle>
            <mat-datepicker #shiftDatePicker></mat-datepicker>
          </mat-form-field>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-control" [(ngModel)]="shiftForm.status">
          <option value="SCHEDULED">Scheduled</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="ABSENT">Absent</option>
          <option value="SWAPPED">Swapped</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-control" [(ngModel)]="shiftForm.notes" style="min-height:72px"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button *ngIf="editingShift" class="btn btn-ghost"
              style="color:#EF4444;margin-right:auto" (click)="deleteShift()">
        <span class="btn-icon" style="font-size:17px">delete</span> Delete
      </button>
      <button class="btn btn-ghost" (click)="showModal=false">Cancel</button>
      <button class="btn btn-primary" (click)="saveShift()" [disabled]="saving">
        {{saving ? 'Saving…' : (editingShift ? 'Update' : 'Schedule')}}
      </button>
    </div>
  </div>
</div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShiftsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  shifts:     Shift[]     = [];
  shiftTypes: ShiftType[] = [];
  employees:  any[]       = [];
  loading        = true;
  saving         = false;
  weekOffset     = 0;
  employeePage   = 1;
  employeeLimit  = 20;
  employeeTotal  = 0;

  showModal      = false;
  editingShift: Shift | null = null;
  shiftForm: { user_id: number|null; shift_type_id: number|null; date: string | Date | null; status: string; notes: string; }
    = this.emptyShiftForm();

  get weekStart(): Date {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1 + this.weekOffset * 7);
    d.setHours(0, 0, 0, 0); return d;
  }
  get weekEnd(): Date { const d = new Date(this.weekStart); d.setDate(d.getDate() + 6); return d; }
  get weekDays(): Date[] {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(this.weekStart); d.setDate(d.getDate() + i); return d; });
  }

  constructor(
    private api:     ApiService,
    private dateFilter: DateFilterService,
    private toast:   ToastService,
    private confirm: ConfirmService,
    private cdr:     ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.get<any>('/shifts/types').subscribe(r => { this.shiftTypes = r?.data || []; this.cdr.markForCheck(); });
    this.loadEmployees();
  }

  private loadEmployees(): void {
    this.loading = true;
    this.api.get<any>('/users', { page: this.employeePage, limit: this.employeeLimit }).subscribe({
      next: r => {
        this.employees = r?.data?.items || r?.data || [];
        this.employeeTotal = r?.data?.total || 0;
        this.loadShifts();
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  loadShifts(): void {
    const from = this.weekStart.toISOString().slice(0, 10);
    const to   = this.weekEnd.toISOString().slice(0, 10);
    this.api.get<any>('/shifts', { from, to, limit: this.employeeLimit }).subscribe({
      next: r => {
        this.shifts = r?.data?.items || r?.data || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  prevWeek(): void { this.weekOffset--; this.loadShifts(); }
  nextWeek(): void { this.weekOffset++; this.loadShifts(); }
  goToday():  void { this.weekOffset = 0; this.loadShifts(); }

  prevPage(): void {
    if (this.employeePage > 1) {
      this.employeePage--;
      this.loadEmployees();
    }
  }

  nextPage(): void {
    if (this.employeePage * this.employeeLimit < this.employeeTotal) {
      this.employeePage++;
      this.loadEmployees();
    }
  }

  pageCount(): number {
    return Math.max(1, Math.ceil(this.employeeTotal / this.employeeLimit));
  }

  isToday(day: Date): boolean {
    const t = new Date();
    return day.getDate() === t.getDate() && day.getMonth() === t.getMonth() && day.getFullYear() === t.getFullYear();
  }
  getShift(userId: number, day: Date): Shift | undefined {
    return this.shifts.find(s => s.user_id === userId && s.date === day.toISOString().slice(0, 10));
  }
  getShiftTypeColor(id: number): string { return this.shiftTypes.find(st => st.id === id)?.color || '#1565C0'; }
  getShiftTypeName(id: number):  string { return this.shiftTypes.find(st => st.id === id)?.code  || '?'; }

  private emptyShiftForm() {
    return { user_id: null as number|null, shift_type_id: null as number|null, date: null, status:'SCHEDULED', notes:'' };
  }

  openModal(userId?: number, date?: Date): void {
    this.editingShift = null;
    this.shiftForm = { user_id: userId ?? null, shift_type_id: this.shiftTypes[0]?.id ?? null,
                       date: date ? date : null, status:'SCHEDULED', notes:'' };
    this.showModal = true; this.cdr.markForCheck();
  }
  editShift(shift: Shift): void {
    this.editingShift = shift;
    this.shiftForm = { user_id: shift.user_id, shift_type_id: shift.shift_type_id,
                       date: shift.date ? new Date(shift.date + 'T00:00:00') : null,
                       status: shift.status, notes: (shift as any).notes ?? '' };
    this.showModal = true; this.cdr.markForCheck();
  }
  closeModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.showModal = false;
  }

  saveShift(): void {
    if (!this.shiftForm.user_id)       { this.toast.warning('Please select an employee.'); return; }
    if (!this.shiftForm.shift_type_id) { this.toast.warning('Please select a shift type.'); return; }
    if (!this.shiftForm.date)          { this.toast.warning('Please select a date.'); return; }

    const selectedDate = this.shiftForm.date instanceof Date
      ? this.shiftForm.date.toISOString().slice(0, 10)
      : this.shiftForm.date;

    if (!this.editingShift) {
      const existing = this.getShift(this.shiftForm.user_id, new Date(selectedDate + 'T00:00:00'));
      if (existing) { this.toast.warning('This employee already has a shift that day.'); return; }
    }

    this.saving = true;
    const payload = { ...this.shiftForm, date: selectedDate };
    const isEdit = !!this.editingShift;
    const req$   = isEdit
      ? this.api.put<any>(`/shifts/${this.editingShift!.id}`, payload)
      : this.api.post<any>('/shifts', payload);

    req$.subscribe({
      next: () => {
        this.saving = false; this.showModal = false; this.loadShifts();
        this.toast.success(isEdit ? 'Shift updated.' : 'Shift scheduled.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save shift.');
        this.cdr.markForCheck();
      }
    });
  }


  async exportShift(format: 'xlsx' | 'pdf' | 'docx'): Promise<void> {
    try {
      const date = this.weekStart.toISOString().slice(0, 10);
      const token = localStorage.getItem('access_token');
      const url = `${this.api.baseUrl}/export/shift-report?format=${format}&date=${date}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `shift_report_${date}.${format}`;
      a.click();
      URL.revokeObjectURL(href);
      this.toast.success(`Shift report exported (${format.toUpperCase()}).`);
    } catch {
      this.toast.error('Shift export failed.');
    }
  }
  async deleteShift(): Promise<void> {
    if (!this.editingShift) return;
    const ok = await this.confirm.confirm('Delete this shift? This cannot be undone.', 'Delete Shift');
    if (!ok) return;
    this.api.delete<any>(`/shifts/${this.editingShift.id}`).subscribe({
      next: () => { this.showModal = false; this.loadShifts(); this.toast.success('Shift deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }
}

