import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ShiftUsageStatus,
  SimulatorDailySheetResponse,
  SimulatorDailyShift,
  SimulatorShiftEntry,
  SimulatorStationKind
} from '../../../core/models/interfaces';
import { ApiService, ConfirmService, ToastService } from '../../../core/services/services';
import {
  formatMinutesHhMm,
  SHIFT_USAGE_STATUS_META
} from '../simulator-helpers';
import {
  BulkSimTimeModalComponent,
  BulkTimeMode
} from '../modals/bulk-sim-time-modal.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';

function toLocalYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalYyyyMmDd(yyyyMmDd: string): Date {
  const parts = String(yyyyMmDd || '').split('-').map(Number);
  if (parts.length === 3 && !parts.some(Number.isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function shiftLocalDate(yyyyMmDd: string, deltaDays: number): string {
  const parts = String(yyyyMmDd || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return toLocalYyyyMmDd(new Date());
  const d = new Date(parts[0], parts[1] - 1, parts[2] + deltaDays);
  return toLocalYyyyMmDd(d);
}

@Component({
  selector: 'app-station-daily-ops',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BulkSimTimeModalComponent,
    DateTimePickerComponent,
    TimePickerComponent,
    DropdownComponent,
    DropdownOptionComponent,
    ExportMenuComponent
  ],
  templateUrl: './station-daily-ops.component.html',
  styleUrls: ['./station-daily-ops.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StationDailyOpsComponent implements OnInit, OnChanges, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private loadSeq = 0;

  @Input() stationKind: 'TEST_PLACE' | 'IOS_CONSOLE' = 'TEST_PLACE';
  @Input() refreshTick = 0;
  @Input() initialDate: string | null = null;

  @Output() openMntRecords = new EventEmitter<{ simulatorId: number; stationName: string }>();
  @Output() openWorkspace = new EventEmitter<number>();
  @Output() addStationRequested = new EventEmitter<SimulatorStationKind>();
  @Output() sheetUpdated = new EventEmitter<void>();

  @ViewChild('bulkTimeModal') bulkTimeModal!: BulkSimTimeModalComponent;

  selectedDate = toLocalYyyyMmDd(new Date());
  selectedDateObj: Date = parseLocalYyyyMmDd(this.selectedDate);
  sheet: SimulatorDailySheetResponse | null = null;
  activeShiftId: number | null = null;
  statusFilter: 'ALL' | ShiftUsageStatus = 'ALL';

  showDailyNote = false;
  openStatusMenuEntryId: number | null = null;
  noteModalEntry: SimulatorShiftEntry | null = null;
  noteModalText = '';

  loading = false;
  savingLog = false;
  savingShift = false;
  addingShift = false;
  copyingPrev = false;
  signingOff = false;

  // Quick Fault -> Maintenance WO Modal for NA rows
  faultWoEntry: SimulatorShiftEntry | null = null;
  faultWoForm = {
    title: '',
    severity: 'AOG' as 'MINOR' | 'DEGRADED' | 'AOG',
    subsystem_code: 'HOST_COMPUTE',
    description: ''
  };
  savingFaultWo = false;

  logDraft = {
    system_readiness_time: '06:30',
    post_testing_time: '17:00',
    logout_time: '18:00',
    general_notes: ''
  };
  preFlightDraft = '06:40';
  noteDrafts: Record<number, string> = {};
  savingEntryIds = new Set<number>();
  savedEntryId: number | null = null;

  exportParams: Record<string, string> = {
    date: toLocalYyyyMmDd(new Date()),
    station_kind: 'TEST_PLACE'
  };

  readonly statusChoices: ShiftUsageStatus[] = ['IN_USE', 'READY', 'NA'];

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:click')
  onDocClick(): void {
    if (this.openStatusMenuEntryId !== null) {
      this.openStatusMenuEntryId = null;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    let changed = false;
    if (this.openStatusMenuEntryId !== null) {
      this.openStatusMenuEntryId = null;
      changed = true;
    }
    if (this.noteModalEntry) {
      this.noteModalEntry = null;
      changed = true;
    }
    if (this.faultWoEntry) {
      this.faultWoEntry = null;
      changed = true;
    }
    if (changed) this.cdr.markForCheck();
  }

  ngOnInit(): void {
    if (this.initialDate && /^\d{4}-\d{2}-\d{2}$/.test(this.initialDate)) {
      this.setSelectedDate(this.initialDate);
    }
    this.syncExportParams();
    this.loadSheet();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialDate'] && this.initialDate && /^\d{4}-\d{2}-\d{2}$/.test(this.initialDate) && this.initialDate !== this.selectedDate) {
      this.setSelectedDate(this.initialDate);
      this.activeShiftId = null;
      this.syncExportParams();
      if (!changes['initialDate'].firstChange) {
        this.loadSheet();
        return;
      }
    }
    if (changes['stationKind'] && !changes['stationKind'].firstChange) {
      this.activeShiftId = null;
      this.statusFilter = 'ALL';
      this.openStatusMenuEntryId = null;
      this.syncExportParams();
      this.loadSheet();
    } else if (changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadSheet();
    }
  }

  private syncExportParams(): void {
    this.exportParams = {
      date: this.selectedDate,
      station_kind: this.stationKind
    };
  }

  get preFlightTooltip(): string {
    return this.stationKind === 'IOS_CONSOLE'
      ? 'Pre-Flight Test of IOS Consoles'
      : 'Pre-Flight Test of TPs';
  }

  get hasDailyNote(): boolean {
    return Boolean((this.logDraft.general_notes || '').trim());
  }

  get formattedDateShort(): string {
    const parts = this.selectedDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return this.selectedDate;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dd}-${mm}-${yy} · ${weekday}`;
  }

  get isToday(): boolean {
    return this.selectedDate === toLocalYyyyMmDd(new Date());
  }

  get activeShift(): SimulatorDailyShift | null {
    if (!this.sheet?.shifts?.length) return null;
    if (this.activeShiftId !== null) {
      const found = this.sheet.shifts.find((s) => s.id === this.activeShiftId);
      if (found) return found;
    }
    return this.sheet.shifts[0];
  }

  get staffList(): { id: number; first_name: string; last_name: string; username: string }[] {
    return ((this.sheet as any)?.staff || []) as any[];
  }

  copyPreviousDay(): void {
    if (this.copyingPrev) return;
    this.copyingPrev = true;
    this.cdr.markForCheck();

    this.api
      .post<{ data: SimulatorDailySheetResponse; meta?: { copiedFromDate: string; carriedOverNaCount: number } }>(
        '/simulators/daily-sheet/copy-previous',
        { date: this.selectedDate, station_kind: this.stationKind }
      )
      .subscribe({
        next: (res) => {
          this.copyingPrev = false;
          if (res?.data) {
            this.sheet = res.data;
            if (res.data.log) {
              this.logDraft = {
                system_readiness_time: res.data.log.system_readiness_time || '06:30',
                post_testing_time: res.data.log.post_testing_time || '17:00',
                logout_time: res.data.log.logout_time || '18:00',
                general_notes: res.data.log.general_notes || ''
              };
            }
            if (res.data.shifts?.length) {
              this.activeShiftId = res.data.shifts[0].id;
              this.preFlightDraft = res.data.shifts[0].pre_flight_test_time || '06:40';
              this.syncNoteDrafts(res.data.shifts);
            }
          }
          const fromDate = res?.meta?.copiedFromDate || 'previous sheet';
          const naCount = res?.meta?.carriedOverNaCount ?? 0;
          this.toast.success(
            naCount > 0
              ? `Copied from ${fromDate} (${naCount} unresolved NA station${naCount > 1 ? 's' : ''} carried over).`
              : `Copied operating schedule from ${fromDate}.`
          );
          this.sheetUpdated.emit();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.copyingPrev = false;
          this.toast.error(err?.error?.message || 'No previous day sheet found to copy.');
          this.cdr.markForCheck();
        }
      });
  }

  saveShiftLead(leadUserId: number | null): void {
    const shift = this.activeShift;
    if (!shift) return;
    const normalized = leadUserId ? Number(leadUserId) : null;
    if (normalized === (shift.lead_user_id ?? null)) return;

    this.api
      .put<{ data: SimulatorDailyShift }>(`/simulators/daily-sheet/shifts/${shift.id}`, {
        lead_user_id: normalized
      })
      .subscribe({
        next: (res) => {
          if (res?.data) {
            shift.lead_user_id = res.data.lead_user_id;
            shift.lead = res.data.lead;
          }
          this.toast.success('Test Leader assigned.');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Failed to update Test Leader.');
        }
      });
  }

  signOffShift(): void {
    const shift = this.activeShift;
    if (!shift || this.signingOff) return;
    this.signingOff = true;
    this.cdr.markForCheck();

    this.api
      .post<{ data: SimulatorDailyShift }>(`/simulators/daily-sheet/shifts/${shift.id}/sign-off`, {})
      .subscribe({
        next: (res) => {
          this.signingOff = false;
          if (res?.data) {
            shift.signed_off_at = res.data.signed_off_at;
            shift.signed_off_by = res.data.signed_off_by;
            shift.signer = res.data.signer;
          }
          this.toast.success(`${shift.shift_name} handover signed off.`);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.signingOff = false;
          this.toast.error(err?.error?.message || 'Failed to sign off shift.');
          this.cdr.markForCheck();
        }
      });
  }

  openFaultWoModal(entry: SimulatorShiftEntry, ev?: Event): void {
    ev?.stopPropagation();
    const note = (this.noteDrafts[entry.id] ?? entry.notes ?? '').trim();
    const stName = entry.station?.name || entry.station?.code || `Station #${entry.simulator_id}`;
    this.faultWoEntry = entry;
    this.faultWoForm = {
      title: note ? note.slice(0, 120) : `${stName} — Not Available (NA) Fault`,
      severity: 'AOG',
      subsystem_code: this.stationKind === 'IOS_CONSOLE' ? 'IOS' : 'HOST_COMPUTE',
      description: note || `Logged from Daily Station Operations (${this.selectedDate} · ${this.activeShift?.shift_name || 'SHIFT 1'}). Station marked NA.`
    };
    this.cdr.markForCheck();
  }

  closeFaultWoModal(): void {
    this.faultWoEntry = null;
    this.cdr.markForCheck();
  }

  submitFaultWo(): void {
    const entry = this.faultWoEntry;
    if (!entry || this.savingFaultWo || !this.faultWoForm.title.trim()) return;
    this.savingFaultWo = true;
    this.cdr.markForCheck();

    this.api
      .post<any>('/maintenance', {
        simulator_id: entry.simulator_id,
        title: this.faultWoForm.title.trim(),
        description: this.faultWoForm.description.trim() || this.faultWoForm.title.trim(),
        type: 'CORRECTIVE',
        is_snag: true,
        severity: this.faultWoForm.severity,
        subsystem_code: this.faultWoForm.subsystem_code,
        priority: this.faultWoForm.severity === 'AOG' ? 'CRITICAL' : 'HIGH',
        status: 'IN_PROGRESS',
        scheduled_date: new Date().toISOString()
      })
      .subscribe({
        next: (res) => {
          this.savingFaultWo = false;
          const woId = res?.data?.id;
          this.faultWoEntry = null;
          this.toast.success(`Corrective Work Order${woId ? ` #${woId}` : ''} logged in Maintenance.`);
          this.loadSheet();
          this.sheetUpdated.emit();
        },
        error: (err) => {
          this.savingFaultWo = false;
          this.toast.error(err?.error?.message || 'Failed to create maintenance work order.');
          this.cdr.markForCheck();
        }
      });
  }

  get visibleEntries(): SimulatorShiftEntry[] {
    const entries = this.activeShift?.entries || [];
    if (this.statusFilter === 'ALL') return entries;
    return entries.filter((e) => e.usage_status === this.statusFilter);
  }

  get activeShiftStats(): {
    total: number;
    inUse: number;
    ready: number;
    na: number;
    shiftMinutes: number;
  } {
    const entries = this.activeShift?.entries || [];
    let inUse = 0;
    let ready = 0;
    let na = 0;
    let shiftMinutes = 0;
    for (const e of entries) {
      if (e.usage_status === 'IN_USE') inUse += 1;
      else if (e.usage_status === 'NA') na += 1;
      else ready += 1;
      shiftMinutes += Number(e.duration_minutes) || 0;
    }
    return { total: entries.length, inUse, ready, na, shiftMinutes };
  }

  loadSheet(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.openStatusMenuEntryId = null;
    this.syncExportParams();
    this.cdr.markForCheck();

    this.api
      .get<{ data: SimulatorDailySheetResponse }>('/simulators/daily-sheet', {
        date: this.selectedDate,
        station_kind: this.stationKind
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          const data = res?.data;
          this.sheet = data || null;
          this.loading = false;

          if (data?.log) {
            this.logDraft = {
              system_readiness_time: data.log.system_readiness_time || '06:30',
              post_testing_time: data.log.post_testing_time || '17:00',
              logout_time: data.log.logout_time || '18:00',
              general_notes: data.log.general_notes || ''
            };
            this.showDailyNote = Boolean((data.log.general_notes || '').trim());
          }

          if (data?.shifts?.length) {
            const existing = data.shifts.find((s) => s.id === this.activeShiftId);
            this.activeShiftId = existing ? existing.id : data.shifts[0].id;
            const current = data.shifts.find((s) => s.id === this.activeShiftId) || data.shifts[0];
            this.preFlightDraft = current.pre_flight_test_time || '06:40';
            this.syncNoteDrafts(data.shifts);
          } else {
            this.activeShiftId = null;
          }

          this.cdr.markForCheck();
        },
        error: (err) => {
          if (seq !== this.loadSeq) return;
          this.loading = false;
          this.toast.error(err?.error?.message || 'Failed to load daily operating sheet.');
          this.cdr.markForCheck();
        }
      });
  }

  private syncNoteDrafts(shifts: SimulatorDailyShift[]): void {
    const next: Record<number, string> = {};
    for (const shift of shifts) {
      for (const entry of shift.entries || []) {
        next[entry.id] = entry.notes || '';
      }
    }
    this.noteDrafts = next;
  }

  private setSelectedDate(iso: string): void {
    this.selectedDate = iso;
    this.selectedDateObj = parseLocalYyyyMmDd(iso);
  }

  prevDay(): void {
    this.setSelectedDate(shiftLocalDate(this.selectedDate, -1));
    this.activeShiftId = null;
    this.loadSheet();
  }

  nextDay(): void {
    this.setSelectedDate(shiftLocalDate(this.selectedDate, 1));
    this.activeShiftId = null;
    this.loadSheet();
  }

  goToday(): void {
    this.setSelectedDate(toLocalYyyyMmDd(new Date()));
    this.activeShiftId = null;
    this.loadSheet();
  }

  onDatePick(d: Date | null): void {
    if (!d) return;
    const nextIso = toLocalYyyyMmDd(d);
    if (nextIso === this.selectedDate) return;
    this.setSelectedDate(nextIso);
    this.activeShiftId = null;
    this.loadSheet();
  }

  onDateChange(value: string): void {
    if (!value || value === this.selectedDate) return;
    this.setSelectedDate(value);
    this.activeShiftId = null;
    this.loadSheet();
  }

  toggleDailyNote(): void {
    this.showDailyNote = !this.showDailyNote;
    this.cdr.markForCheck();
  }

  saveOperatingHours(): void {
    if (this.savingLog) return;
    this.savingLog = true;
    this.cdr.markForCheck();

    this.api
      .put<{ data: any }>('/simulators/daily-sheet', {
        date: this.selectedDate,
        station_kind: this.stationKind,
        system_readiness_time: this.logDraft.system_readiness_time,
        post_testing_time: this.logDraft.post_testing_time,
        logout_time: this.logDraft.logout_time,
        general_notes: this.logDraft.general_notes
      })
      .subscribe({
        next: (res) => {
          this.savingLog = false;
          if (this.sheet && res?.data) {
            this.sheet.log = res.data;
          }
          this.toast.success('Operating hours saved.');
          this.sheetUpdated.emit();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.savingLog = false;
          this.toast.error(err?.error?.message || 'Could not update operating hours.');
          this.cdr.markForCheck();
        }
      });
  }

  selectShift(shift: SimulatorDailyShift): void {
    this.activeShiftId = shift.id;
    this.preFlightDraft = shift.pre_flight_test_time || '06:40';
    this.openStatusMenuEntryId = null;
    this.cdr.markForCheck();
  }

  addShift(): void {
    if (this.addingShift) return;
    this.addingShift = true;
    this.cdr.markForCheck();

    this.api
      .post<{ data: SimulatorDailySheetResponse; createdShiftId?: number }>(
        '/simulators/daily-sheet/shifts',
        {
          date: this.selectedDate,
          station_kind: this.stationKind
        }
      )
      .subscribe({
        next: (res) => {
          this.addingShift = false;
          if (res?.data) {
            this.sheet = res.data;
            if (res.createdShiftId) {
              this.activeShiftId = res.createdShiftId;
            } else if (res.data.shifts.length) {
              this.activeShiftId = res.data.shifts[res.data.shifts.length - 1].id;
            }
            const cur = this.activeShift;
            if (cur) this.preFlightDraft = cur.pre_flight_test_time;
            this.syncNoteDrafts(res.data.shifts);
          }
          this.toast.success('New shift added.');
          this.sheetUpdated.emit();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.addingShift = false;
          this.toast.error(err?.error?.message || 'Failed to add shift.');
          this.cdr.markForCheck();
        }
      });
  }

  async deleteShift(shift: SimulatorDailyShift, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!this.sheet || this.sheet.shifts.length <= 1) return;
    const ok = await this.confirm.confirm(
      `Remove ${shift.shift_name} and its entries for ${this.formattedDateShort}?`,
      'Delete Shift',
      true
    );
    if (!ok) return;

    this.api.delete<{ data: SimulatorDailySheetResponse }>(`/simulators/daily-sheet/shifts/${shift.id}`).subscribe({
      next: () => {
        this.toast.success(`${shift.shift_name} removed.`);
        this.activeShiftId = null;
        this.loadSheet();
        this.sheetUpdated.emit();
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Could not remove shift.');
      }
    });
  }

  savePreFlightTime(): void {
    const shift = this.activeShift;
    if (!shift || this.savingShift) return;
    if (this.preFlightDraft === shift.pre_flight_test_time) return;

    this.savingShift = true;
    this.cdr.markForCheck();

    this.api
      .put<{ data: SimulatorDailyShift }>(`/simulators/daily-sheet/shifts/${shift.id}`, {
        pre_flight_test_time: this.preFlightDraft
      })
      .subscribe({
        next: (res) => {
          this.savingShift = false;
          if (res?.data) {
            shift.pre_flight_test_time = res.data.pre_flight_test_time;
            this.preFlightDraft = res.data.pre_flight_test_time;
          }
          this.toast.success(`${shift.shift_name} pre-flight saved.`);
          this.sheetUpdated.emit();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.savingShift = false;
          this.toast.error(err?.error?.message || 'Failed to update pre-flight time.');
          this.cdr.markForCheck();
        }
      });
  }

  openBulk(mode: BulkTimeMode): void {
    const shift = this.activeShift;
    if (!shift || !this.bulkTimeModal) return;
    this.openStatusMenuEntryId = null;
    this.bulkTimeModal.open({ shift, mode });
  }

  toggleStatusMenu(entryId: number, ev: Event): void {
    ev.stopPropagation();
    this.openStatusMenuEntryId = this.openStatusMenuEntryId === entryId ? null : entryId;
    this.cdr.markForCheck();
  }

  pickStatus(entry: SimulatorShiftEntry, nextStatus: ShiftUsageStatus, ev: Event): void {
    ev.stopPropagation();
    this.openStatusMenuEntryId = null;
    this.setEntryStatus(entry, nextStatus);
  }

  setEntryStatus(entry: SimulatorShiftEntry, nextStatus: ShiftUsageStatus): void {
    if (entry.usage_status === nextStatus) return;
    const payload: Record<string, any> = { usage_status: nextStatus };
    if (nextStatus === 'READY' || nextStatus === 'NA') {
      payload['sim_testing_start'] = '00:00';
      payload['sim_testing_end'] = '00:00';
    }
    this.patchEntry(entry, payload);
  }

  onEntryTimeChange(entry: SimulatorShiftEntry, field: 'start' | 'end', value: string): void {
    const payload =
      field === 'start'
        ? { sim_testing_start: value || '00:00' }
        : { sim_testing_end: value || '00:00' };
    this.patchEntry(entry, payload);
  }

  isNoteDirty(entry: SimulatorShiftEntry): boolean {
    return (this.noteDrafts[entry.id] ?? '') !== (entry.notes ?? '');
  }

  noteRowCount(entryId: number): number {
    const text = this.noteDrafts[entryId] || '';
    if (!text) return 1;
    const lines = text.split('\n');
    let total = 0;
    for (const line of lines) {
      total += Math.max(1, Math.ceil(line.length / 44));
    }
    return Math.min(5, Math.max(1, total));
  }

  autoResizeTextarea(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  onNoteKeydown(ev: KeyboardEvent, entry: SimulatorShiftEntry): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      (ev.target as HTMLElement)?.blur();
      this.saveEntryNote(entry);
    }
  }

  openNoteModal(entry: SimulatorShiftEntry, ev?: Event): void {
    ev?.stopPropagation();
    this.noteModalEntry = entry;
    this.noteModalText = this.noteDrafts[entry.id] ?? entry.notes ?? '';
    this.cdr.markForCheck();
  }

  closeNoteModal(): void {
    this.noteModalEntry = null;
    this.cdr.markForCheck();
  }

  saveNoteFromModal(): void {
    const entry = this.noteModalEntry;
    if (!entry) return;
    this.noteDrafts[entry.id] = this.noteModalText;
    this.noteModalEntry = null;
    this.patchEntry(entry, { notes: this.noteModalText }, true);
  }

  saveEntryNote(entry: SimulatorShiftEntry): void {
    const draft = this.noteDrafts[entry.id] ?? '';
    if (draft === (entry.notes ?? '')) return;
    this.patchEntry(entry, { notes: draft }, true);
  }

  private patchEntry(entry: SimulatorShiftEntry, payload: Record<string, any>, isNote = false): void {
    this.savingEntryIds.add(entry.id);
    this.cdr.markForCheck();

    this.api
      .patch<{ data: SimulatorShiftEntry }>(`/simulators/daily-sheet/entries/${entry.id}`, payload)
      .subscribe({
        next: (res) => {
          this.savingEntryIds.delete(entry.id);
          if (res?.data) {
            entry.usage_status = res.data.usage_status;
            entry.sim_testing_start = res.data.sim_testing_start;
            entry.sim_testing_end = res.data.sim_testing_end;
            entry.notes = res.data.notes;
            entry.duration_minutes = res.data.duration_minutes;
            this.noteDrafts[entry.id] = res.data.notes || '';
          }
          if (isNote) {
            this.savedEntryId = entry.id;
            setTimeout(() => {
              if (this.savedEntryId === entry.id) {
                this.savedEntryId = null;
                this.cdr.markForCheck();
              }
            }, 1400);
          }
          this.recomputeSummary();
          this.sheetUpdated.emit();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.savingEntryIds.delete(entry.id);
          this.toast.error(err?.error?.message || 'Failed to save station row.');
          this.cdr.markForCheck();
        }
      });
  }

  private recomputeSummary(): void {
    if (!this.sheet) return;
    const rank: Record<string, number> = { READY: 1, IN_USE: 2, NA: 3 };
    const effectiveBySim = new Map<number, ShiftUsageStatus>();
    let totalMinutes = 0;
    for (const s of this.sheet.shifts) {
      for (const e of s.entries || []) {
        const cur = effectiveBySim.get(e.simulator_id);
        const st = e.usage_status || 'READY';
        if (!cur || (rank[st] || 0) >= (rank[cur] || 0)) {
          effectiveBySim.set(e.simulator_id, st);
        }
        totalMinutes += Number(e.duration_minutes) || 0;
      }
    }
    let inUse = 0;
    let ready = 0;
    let na = 0;
    for (const st of effectiveBySim.values()) {
      if (st === 'IN_USE') inUse += 1;
      else if (st === 'NA') na += 1;
      else ready += 1;
    }
    this.sheet.summary = {
      ...this.sheet.summary,
      in_use_count: inUse,
      ready_count: ready,
      na_count: na,
      total_session_minutes: totalMinutes
    };
  }

  onBulkApplied(): void {
    this.loadSheet();
    this.sheetUpdated.emit();
  }

  countShiftInUse(shift: SimulatorDailyShift): number {
    return (shift.entries || []).filter((e) => e.usage_status === 'IN_USE').length;
  }

  countShiftNa(shift: SimulatorDailyShift): number {
    return (shift.entries || []).filter((e) => e.usage_status === 'NA').length;
  }

  statusMeta(status: ShiftUsageStatus) {
    return SHIFT_USAGE_STATUS_META[status] || SHIFT_USAGE_STATUS_META.READY;
  }

  fmtDuration(minutes?: number | null): string {
    return formatMinutesHhMm(minutes);
  }

  fmtHoursCell(minutes?: number | null): string {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return m === 0 ? '—' : formatMinutesHhMm(m);
  }

  triggerMntModal(entry: SimulatorShiftEntry, ev?: Event): void {
    ev?.stopPropagation();
    const label = entry.station?.name || entry.station?.code || `Station #${entry.simulator_id}`;
    this.openMntRecords.emit({ simulatorId: entry.simulator_id, stationName: label });
  }

  triggerWorkspace(entry: SimulatorShiftEntry, ev: Event): void {
    ev.stopPropagation();
    this.openWorkspace.emit(entry.simulator_id);
  }

  trackByShiftId(_: number, s: SimulatorDailyShift): number {
    return s.id;
  }

  trackByEntryId(_: number, e: SimulatorShiftEntry): number {
    return e.id;
  }
}
