// =============================================================================
// shifts.component.ts — Weekly Roster Grid, List, KPIs & Modals Orchestrator
// =============================================================================
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/ui-customization.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import {
  Shift,
  ShiftEmployee,
  ShiftStatus,
  ShiftType,
} from '../../core/models/interfaces';
import { DateTimePickerComponent } from '../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd } from '../../shared/components/datetime-picker/datetime-picker.utils';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import { ShiftDetailModalComponent } from './shift-detail-modal/shift-detail-modal.component';
import { ShiftFormModalComponent, ShiftFormMode } from './shift-form-modal/shift-form-modal.component';
import { ShiftTypesModalComponent } from './shift-types-modal/shift-types-modal.component';
import { ShiftHandoverModalComponent } from './shift-handover-modal/shift-handover-modal.component';
import {
  addDays,
  buildWeekDays,
  computeDayCoverage,
  computeEmployeeSummaries,
  computeWeekKpis,
  DayCoverageSummary,
  EmployeeWeekSummary,
  emptyShiftKpis,
  formatHours,
  formatTimeShort,
  getLeaveMeta,
  getMondayOfWeek,
  getShiftEffectiveInfo,
  getStatusMeta,
  LeaveTypeMeta,
  ShiftEffectiveInfo,
  ShiftStatusMeta,
  ShiftWeekKpis,
} from './shift-helpers';

export type ShiftViewMode = 'grid' | 'list';

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    DateTimePickerComponent,
    ExportMenuComponent,
    DropdownComponent,
    DropdownOptionComponent,
    ShiftDetailModalComponent,
    ShiftFormModalComponent,
    ShiftTypesModalComponent,
    ShiftHandoverModalComponent,
  ],
  templateUrl: './shifts.component.html',
  styleUrl: './shifts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShiftsComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  private readonly destroy$ = new Subject<void>();
  private actionHandled = false;

  // Core datasets
  shifts: Shift[] = [];
  shiftTypes: ShiftType[] = [];
  allEmployees: ShiftEmployee[] = [];
  departments: string[] = [];

  // UI & Loading flags
  loading = true;
  copyingWeek = false;
  checkingId: number | null = null;
  viewMode: ShiftViewMode = 'grid';
  uiPrefs: UiSectionPreferences | null = null;

  // Week navigation
  referenceDate: Date = new Date();
  weekOffset = 0;
  weekStart: Date = getMondayOfWeek(new Date(), 0);
  weekEnd: Date = addDays(this.weekStart, 6);
  weekDays: Date[] = buildWeekDays(this.weekStart);
  jumpPickerDate: Date | null = new Date(this.weekStart);
  exportParams: Record<string, string> = {};

  // Filters & Pagination
  searchTerm = '';
  selectedDepartment = '';
  selectedStatus = '';
  selectedEntryKind = '';
  selectedShiftTypeId: number | null = null;

  employeePage = 1;
  employeeLimit = 20;
  listPage = 1;
  listPageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  // Derived view models
  filteredEmployees: ShiftEmployee[] = [];
  pagedEmployees: ShiftEmployee[] = [];
  filteredShiftsList: Shift[] = [];
  pagedShiftsList: Shift[] = [];
  shiftLookup = new Map<string, Shift>();
  employeeSummaries = new Map<number, EmployeeWeekSummary>();
  dayCoverages: DayCoverageSummary[] = [];
  kpis: ShiftWeekKpis = emptyShiftKpis();

  // Child modal states
  detailShift: Shift | null = null;
  showFormModal = false;
  editingShift: Shift | null = null;
  formDefaultUserId: number | undefined;
  formDefaultDate: Date | undefined;
  formDefaultMode: ShiftFormMode = 'WORK';

  showCopyWeekModal = false;
  copyIncludeLeave = false;
  copyOverwrite = false;
  showShiftTypesModal = false;
  showHandoverModal = false;
  coverageAlerts: Array<{ date: string; sortieCount: number; shiftCount: number; message: string }> = [];

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly uiCustomization: UiCustomizationService,
    private readonly toast: ToastService,
    private readonly confirm: ConfirmService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.rebuildWeekState();
  }

  get canManageShiftTypes(): boolean {
    return this.auth.hasRole('admin', 'manager');
  }

  get workShiftTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category !== 'LEAVE');
  }

  get leaveShiftTypes(): ShiftType[] {
    return this.shiftTypes.filter(st => st.category === 'LEAVE');
  }

  get hasActiveFilters(): boolean {
    return Boolean(
      this.searchTerm.trim() ||
      this.selectedDepartment ||
      this.selectedStatus ||
      this.selectedEntryKind ||
      this.selectedShiftTypeId !== null
    );
  }

  get hasCellHighlightFilter(): boolean {
    return Boolean(this.selectedStatus || this.selectedEntryKind || this.selectedShiftTypeId !== null);
  }

  get prevWeekStart(): Date {
    return addDays(this.weekStart, -7);
  }

  get prevWeekEnd(): Date {
    return addDays(this.weekEnd, -7);
  }

  get employeeStartIndex(): number {
    return this.filteredEmployees.length === 0 ? 0 : (this.employeePage - 1) * this.employeeLimit + 1;
  }

  get employeeEndIndex(): number {
    return Math.min(this.employeePage * this.employeeLimit, this.filteredEmployees.length);
  }

  get listStartIndex(): number {
    return this.filteredShiftsList.length === 0 ? 0 : (this.listPage - 1) * this.listPageSize + 1;
  }

  get listEndIndex(): number {
    return Math.min(this.listPage * this.listPageSize, this.filteredShiftsList.length);
  }

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(qp => {
        if (qp['action'] === 'new' && !this.actionHandled) {
          this.actionHandled = true;
          setTimeout(() => {
            this.openModal();
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { action: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }, 0);
        }
      });

    this.uiCustomization
      .load('shifts')
      .pipe(takeUntil(this.destroy$))
      .subscribe(prefs => {
        this.uiPrefs = prefs;
        this.cdr.markForCheck();
      });

    this.loadShiftTypes();
    this.loadEmployees();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable;
    if (isEditable) return;
    if (this.searchInput?.nativeElement) {
      e.preventDefault();
      this.searchInput.nativeElement.focus();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.showShiftTypesModal) {
      this.showShiftTypesModal = false;
    } else if (this.showCopyWeekModal) {
      this.showCopyWeekModal = false;
    } else if (this.showFormModal) {
      this.showFormModal = false;
    } else if (this.detailShift) {
      this.detailShift = null;
    }
    this.cdr.markForCheck();
  }

  // ── Data Loading ──────────────────────────────────────────────────────────
  loadShiftTypes(): void {
    this.api
      .get<any>('/shifts/types')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: r => {
          this.shiftTypes = r?.data || [];
          this.recomputeViewState();
          this.cdr.markForCheck();
        },
      });
  }

  loadEmployees(): void {
    this.loading = true;
    this.api
      .get<any>('/shifts/employees', { limit: 200 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: r => {
          this.allEmployees = r?.data?.items || r?.data || [];
          const deptSet = new Set<string>();
          for (const emp of this.allEmployees) {
            if (emp.department && emp.department.trim()) deptSet.add(emp.department.trim());
          }
          this.departments = Array.from(deptSet).sort();
          this.loadShifts();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load employees.');
          this.cdr.markForCheck();
        },
      });
  }

  loadShifts(): void {
    const from = formatLocalYmd(this.weekStart);
    const to = formatLocalYmd(this.weekEnd);
    this.loading = true;

    this.api
      .get<any>('/shifts/coverage-alerts', { from, to })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: r => {
          this.coverageAlerts = r?.data?.alerts || [];
          this.cdr.markForCheck();
        },
        error: () => {
          this.coverageAlerts = [];
        }
      });

    this.api
      .get<any>('/shifts', { from, to, limit: 1000 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: r => {
          this.shifts = r?.data?.items || r?.data || [];
          this.loading = false;
          this.recomputeViewState();
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load weekly shifts.');
          this.cdr.markForCheck();
        },
      });
  }

  onShiftTypesUpdated(): void {
    this.loadShiftTypes();
    this.loadShifts();
  }

  onShiftSaved(): void {
    this.showFormModal = false;
    this.loadShifts();
  }

  // ── Week Navigation ───────────────────────────────────────────────────────
  prevWeek(): void {
    this.weekOffset -= 1;
    this.rebuildWeekState();
    this.loadShifts();
  }

  nextWeek(): void {
    this.weekOffset += 1;
    this.rebuildWeekState();
    this.loadShifts();
  }

  goToday(): void {
    this.referenceDate = new Date();
    this.weekOffset = 0;
    this.rebuildWeekState();
    this.loadShifts();
  }

  onJumpDatePicked(picked: Date | null): void {
    if (!picked) return;
    this.referenceDate = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate());
    this.weekOffset = 0;
    this.rebuildWeekState();
    this.loadShifts();
  }

  private rebuildWeekState(): void {
    this.weekStart = getMondayOfWeek(this.referenceDate, this.weekOffset);
    this.weekEnd = addDays(this.weekStart, 6);
    this.weekDays = buildWeekDays(this.weekStart);
    this.jumpPickerDate = new Date(this.weekStart);
    this.exportParams = {
      from: formatLocalYmd(this.weekStart),
      to: formatLocalYmd(this.weekEnd),
    };
  }

  // ── Filtering & Pagination ────────────────────────────────────────────────
  onFilterChanged(): void {
    this.employeePage = 1;
    this.listPage = 1;
    this.recomputeViewState();
    this.cdr.markForCheck();
  }

  toggleLegendTypeFilter(typeId: number): void {
    this.selectedShiftTypeId = this.selectedShiftTypeId === typeId ? null : typeId;
    this.listPage = 1;
    this.recomputeViewState();
    this.cdr.markForCheck();
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.onFilterChanged();
  }

  filterByKpi(kind: 'ALL' | 'ACTIVE' | 'LEAVE' | 'CUSTOM'): void {
    if (kind === 'ALL') {
      this.selectedEntryKind = '';
      this.selectedStatus = '';
      this.selectedShiftTypeId = null;
    } else if (kind === 'ACTIVE') {
      this.selectedEntryKind = '';
      this.selectedStatus = this.selectedStatus === 'IN_PROGRESS' ? '' : 'IN_PROGRESS';
    } else if (kind === 'LEAVE') {
      this.selectedStatus = '';
      this.selectedEntryKind = this.selectedEntryKind === 'LEAVE' ? '' : 'LEAVE';
    } else if (kind === 'CUSTOM') {
      this.selectedStatus = '';
      this.selectedEntryKind = this.selectedEntryKind === 'CUSTOM' ? '' : 'CUSTOM';
    }
    this.onFilterChanged();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedDepartment = '';
    this.selectedStatus = '';
    this.selectedEntryKind = '';
    this.selectedShiftTypeId = null;
    this.employeePage = 1;
    this.listPage = 1;
    this.recomputeViewState();
    this.cdr.markForCheck();
  }

  prevPage(): void {
    if (this.employeePage > 1) {
      this.employeePage -= 1;
      this.updatePagedEmployees();
      this.cdr.markForCheck();
    }
  }

  nextPage(): void {
    if (this.employeePage < this.pageCount()) {
      this.employeePage += 1;
      this.updatePagedEmployees();
      this.cdr.markForCheck();
    }
  }

  pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredEmployees.length / this.employeeLimit));
  }

  onEmployeeLimitChange(): void {
    this.employeePage = 1;
    this.updatePagedEmployees();
    this.cdr.markForCheck();
  }

  prevListPage(): void {
    if (this.listPage > 1) {
      this.listPage -= 1;
      this.updatePagedShiftsList();
      this.cdr.markForCheck();
    }
  }

  nextListPage(): void {
    if (this.listPage < this.listPageCount()) {
      this.listPage += 1;
      this.updatePagedShiftsList();
      this.cdr.markForCheck();
    }
  }

  listPageCount(): number {
    return Math.max(1, Math.ceil(this.filteredShiftsList.length / this.listPageSize));
  }

  onListPageSizeChange(): void {
    this.listPage = 1;
    this.updatePagedShiftsList();
    this.cdr.markForCheck();
  }

  private updatePagedEmployees(): void {
    const start = (this.employeePage - 1) * this.employeeLimit;
    this.pagedEmployees = this.filteredEmployees.slice(start, start + this.employeeLimit);
  }

  private updatePagedShiftsList(): void {
    const start = (this.listPage - 1) * this.listPageSize;
    this.pagedShiftsList = this.filteredShiftsList.slice(start, start + this.listPageSize);
  }

  private recomputeViewState(): void {
    const term = this.searchTerm.trim().toLowerCase();
    const dept = this.selectedDepartment;

    this.filteredEmployees = this.allEmployees.filter(emp => {
      if (dept && (emp.department || '').trim() !== dept) return false;
      if (!term) return true;
      const full = `${emp.first_name} ${emp.last_name}`.toLowerCase();
      return (
        full.includes(term) ||
        (emp.department || '').toLowerCase().includes(term) ||
        (emp.job_title || '').toLowerCase().includes(term)
      );
    });

    if (this.employeePage > this.pageCount()) {
      this.employeePage = 1;
    }
    this.updatePagedEmployees();

    const lookup = new Map<string, Shift>();
    for (const shift of this.shifts) {
      lookup.set(`${shift.user_id}_${shift.date}`, shift);
    }
    this.shiftLookup = lookup;

    const visibleUserIds = new Set(this.filteredEmployees.map(e => e.id));
    const weekShiftsInScope = this.shifts.filter(s => visibleUserIds.has(s.user_id));

    this.filteredShiftsList = weekShiftsInScope.filter(s => this.shiftMatchesAttributeFilters(s));
    if (this.listPage > this.listPageCount()) {
      this.listPage = 1;
    }
    this.updatePagedShiftsList();

    this.kpis = computeWeekKpis(weekShiftsInScope, this.shiftTypes);
    this.employeeSummaries = computeEmployeeSummaries(this.filteredEmployees, this.weekDays, lookup, this.shiftTypes);
    this.dayCoverages = this.weekDays.map(day => computeDayCoverage(day, this.filteredEmployees, lookup, this.shiftTypes));
  }

  private shiftMatchesAttributeFilters(shift: Shift): boolean {
    if (this.selectedShiftTypeId !== null && shift.shift_type_id !== this.selectedShiftTypeId) return false;
    if (this.selectedStatus && shift.status !== this.selectedStatus) return false;
    if (this.selectedEntryKind) {
      const info = this.getShiftInfo(shift);
      if (info.entryKind !== this.selectedEntryKind) return false;
    }
    return true;
  }

  // ── Template Helpers ──────────────────────────────────────────────────────
  getShift(userId: number, day: Date): Shift | undefined {
    return this.shiftLookup.get(`${userId}_${formatLocalYmd(day)}`);
  }

  getShiftInfo(shift: Shift): ShiftEffectiveInfo {
    return getShiftEffectiveInfo(shift, this.shiftTypes);
  }

  getStatusInfo(status: ShiftStatus): ShiftStatusMeta {
    return getStatusMeta(status);
  }

  getLeaveInfo(shift: Shift): LeaveTypeMeta {
    const type = shift.shiftType || this.shiftTypes.find(st => st.id === shift.shift_type_id);
    return getLeaveMeta(shift.leave_type, type);
  }

  getEmployeeSummary(userId: number): EmployeeWeekSummary {
    return this.employeeSummaries.get(userId) || { workedHours: 0, shiftCount: 0, overtimeHours: 0, leaveDays: 0 };
  }

  isCellDimmed(shift: Shift): boolean {
    return this.hasCellHighlightFilter && !this.shiftMatchesAttributeFilters(shift);
  }

  isToday(day: Date): boolean {
    const t = new Date();
    return day.getDate() === t.getDate() && day.getMonth() === t.getMonth() && day.getFullYear() === t.getFullYear();
  }

  isWeekend(day: Date): boolean {
    const dow = day.getDay();
    return dow === 0 || dow === 6;
  }

  formatHours(hours: number): string {
    return formatHours(hours, { zeroLabel: '0h' });
  }

  formatSignedHours(hours: number): string {
    return formatHours(hours, { signed: true });
  }

  formatTime(value?: string | null): string {
    return formatTimeShort(value) || '—';
  }

  getPersonName(person?: { first_name?: string; last_name?: string } | null): string {
    if (!person) return '—';
    return `${person.first_name || ''} ${person.last_name || ''}`.trim() || '—';
  }

  getInitials(person?: { first_name?: string; last_name?: string } | null): string {
    const f = person?.first_name?.[0] || '';
    const l = person?.last_name?.[0] || '';
    return `${f}${l}`.toUpperCase() || '?';
  }

  // ── Modal Launchers & Row Actions ─────────────────────────────────────────
  openModal(userId?: number, date?: Date, defaultMode: ShiftFormMode = 'WORK'): void {
    this.editingShift = null;
    this.formDefaultUserId = userId;
    this.formDefaultDate = date;
    this.formDefaultMode = defaultMode;
    this.showFormModal = true;
    this.cdr.markForCheck();
  }

  editShift(shift: Shift): void {
    this.detailShift = null;
    this.editingShift = shift;
    this.formDefaultUserId = undefined;
    this.formDefaultDate = undefined;
    this.showFormModal = true;
    this.cdr.markForCheck();
  }

  openDetailModal(shift: Shift): void {
    this.detailShift = shift;
    this.cdr.markForCheck();
  }

  canCheckIn(shift: Shift): boolean {
    const info = this.getShiftInfo(shift);
    return !info.isLeave && (shift.status === 'SCHEDULED' || shift.status === 'CONFIRMED');
  }

  canCheckOut(shift: Shift): boolean {
    const info = this.getShiftInfo(shift);
    return !info.isLeave && shift.status === 'IN_PROGRESS';
  }

  checkInShift(shift: Shift): void {
    this.checkingId = shift.id;
    this.api
      .post<any>(`/shifts/${shift.id}/checkin`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.checkingId = null;
          this.toast.success('Clocked in cleanly.');
          if (this.detailShift?.id === shift.id && res?.data) {
            this.detailShift = res.data;
          }
          this.loadShifts();
        },
        error: err => {
          this.checkingId = null;
          this.toast.error(err?.error?.message || 'Check-in failed.');
          this.cdr.markForCheck();
        },
      });
  }

  checkOutShift(shift: Shift): void {
    this.checkingId = shift.id;
    this.api
      .post<any>(`/shifts/${shift.id}/checkout`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.checkingId = null;
          this.toast.success('Clocked out — shift completed.');
          if (this.detailShift?.id === shift.id && res?.data) {
            this.detailShift = res.data;
          }
          this.loadShifts();
        },
        error: err => {
          this.checkingId = null;
          this.toast.error(err?.error?.message || 'Check-out failed.');
          this.cdr.markForCheck();
        },
      });
  }

  async deleteShiftRecord(shift: Shift): Promise<void> {
    const confirmed = await this.confirm.confirm(
      `Remove this entry for ${this.getPersonName(shift.employee)} on ${shift.date}?`,
      'Delete Shift Entry'
    );
    if (!confirmed) return;

    this.api
      .delete<any>(`/shifts/${shift.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showFormModal = false;
          if (this.detailShift?.id === shift.id) this.detailShift = null;
          this.loadShifts();
          this.toast.success('Shift entry deleted.');
        },
        error: err => {
          this.toast.error(err?.error?.message || 'Failed to delete shift.');
        },
      });
  }

  // ── Copy Previous Week ────────────────────────────────────────────────────
  openCopyWeekModal(): void {
    this.copyIncludeLeave = false;
    this.copyOverwrite = false;
    this.showCopyWeekModal = true;
    this.cdr.markForCheck();
  }

  closeCopyWeekModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showCopyWeekModal = false;
    }
  }

  submitCopyPrevWeek(): void {
    this.copyingWeek = true;
    const visibleUserIds = this.selectedDepartment || this.searchTerm.trim()
      ? this.filteredEmployees.map(e => e.id)
      : undefined;

    this.api
      .post<any>('/shifts/copy-week', {
        source_from: formatLocalYmd(this.prevWeekStart),
        source_to: formatLocalYmd(this.prevWeekEnd),
        target_from: formatLocalYmd(this.weekStart),
        include_leave: this.copyIncludeLeave,
        overwrite: this.copyOverwrite,
        user_ids: visibleUserIds,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.copyingWeek = false;
          this.showCopyWeekModal = false;
          this.loadShifts();
          const d = res?.data || {};
          this.toast.success(
            `Copied week: ${d.createdCount || 0} created, ${d.updatedCount || 0} updated, ${d.skippedCount || 0} skipped.`
          );
        },
        error: err => {
          this.copyingWeek = false;
          this.toast.error(err?.error?.message || 'Failed to copy previous week.');
          this.cdr.markForCheck();
        },
      });
  }

  // ── UI Customization Hooks ────────────────────────────────────────────────
  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  dayFieldKey(day: Date): string {
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return dayMap[day.getDay()] || 'sunday';
  }
}
