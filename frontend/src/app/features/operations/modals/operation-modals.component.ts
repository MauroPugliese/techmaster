import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, AuthService, ConfirmService, ToastService, UiCustomizationService, UiSectionPreferences } from '../../../core/services/services';
import {
  ExternalCrewSuggestions,
  Operation,
  OperationLog,
  OperationMember,
  OperationStatus,
  OperationType,
  Priority,
  ShiftUsageStatus,
  Simulator,
  SimulatorShiftPreset,
  SimulatorSlotPreset,
  SimulatorSubsystemCode,
  SortieOutcome,
  TimelineShiftBlock,
  User
} from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import {
  CREW_ROLE_SUGGESTIONS,
  DURATION_PRESETS,
  SORTIE_OUTCOME_META,
  WEATHER_PRESETS,
  addHoursToDate,
  formatDurationRange,
  formatEnumLabel,
  getOutcomeMeta,
  getPriorityBadgeClass,
  getStatusBadgeClass,
  getUserDisplayName,
  getUserInitials,
  isOperationOverdue
} from '../operation-helpers';
import {
  SHIFT_USAGE_STATUS_META,
  SUBSYSTEM_OPTIONS,
  resolveSimulatorSchedulingMode
} from '../../simulators/simulator-helpers';

interface DraftMember {
  user_id: number;
  role_in_op: string;
  user?: Partial<User>;
}

@Component({
  selector: 'app-operation-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent, TimePickerComponent, DropdownComponent, DropdownOptionComponent],
  templateUrl: './operation-modals.component.html',
  styleUrls: ['./operation-modals.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationModalsComponent implements OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private conflictSeq = 0;
  private detailSeq = 0;

  @Input() opTypes: OperationType[] = [];
  @Input() simulators: Simulator[] = [];
  @Input() staffUsers: Partial<User>[] = [];
  @Input() crewSuggestions: ExternalCrewSuggestions = { instructors: [], pilots: [], missions: [], scenarios: [], customers: [] };
  @Input() uiPrefs: UiSectionPreferences | null = null;

  @Output() mutated = new EventEmitter<void>();
  @Output() openFullDailySheet = new EventEmitter<{ stationKind: string; dateIso: string }>();

  readonly durationPresets = DURATION_PRESETS;
  readonly defaultSlotPresets: SimulatorSlotPreset[] = [
    { label: '06:00–10:00', start: '06:00', end: '10:00' },
    { label: '10:00–14:00', start: '10:00', end: '14:00' },
    { label: '14:00–18:00', start: '14:00', end: '18:00' },
    { label: '18:00–22:00', start: '18:00', end: '22:00' }
  ];
  readonly shiftStatusChoices: ShiftUsageStatus[] = ['IN_USE', 'READY', 'NA'];
  readonly roleSuggestions = CREW_ROLE_SUGGESTIONS;
  readonly weatherPresets = WEATHER_PRESETS;
  readonly subsystemOptions = SUBSYSTEM_OPTIONS;
  readonly outcomeOptions: Array<{ value: SortieOutcome; label: string }> = [
    { value: 'PENDING', label: SORTIE_OUTCOME_META.PENDING.label },
    { value: 'CLEAN', label: SORTIE_OUTCOME_META.CLEAN.label },
    { value: 'COMPLETED_WITH_SNAGS', label: SORTIE_OUTCOME_META.COMPLETED_WITH_SNAGS.label },
    { value: 'INTERRUPTED_TECH', label: SORTIE_OUTCOME_META.INTERRUPTED_TECH.label },
    { value: 'NO_SHOW', label: SORTIE_OUTCOME_META.NO_SHOW.label },
    { value: 'CANCELLED', label: SORTIE_OUTCOME_META.CANCELLED.label }
  ];

  // ── Create / Edit Modal ────────────────────────────────────────────────────
  showFormModal = false;
  editingOp: Operation | null = null;
  form: any = this.emptyForm();
  formError = '';
  saving = false;
  draftMembers: DraftMember[] = [];
  selectedDraftUserId: number | null = null;
  selectedDraftRole = '';
  showFlightDetails = false;
  showDebriefSection = false;
  conflictWarning: { hasOverlap: boolean; overlappingSorties: any[]; warnings: string[] } | null = null;

  // ── Quick Shift Modal (for SHIFTS-mode simulators right from 24h Timeline) ──
  showQuickShiftModal = false;
  quickShiftSim: Simulator | null = null;
  quickShiftDate = '';
  quickShiftAvailableShifts: Array<{ id: number; shift_number: number; shift_name: string }> = [];
  quickShiftSaving = false;
  quickShiftError = '';
  quickShiftForm: {
    shift_id: number | 'NEW' | null;
    usage_status: ShiftUsageStatus;
    sim_testing_start: string;
    sim_testing_end: string;
    mission_name: string;
    instructor_name: string;
    pilot_name: string;
    copilot_name: string;
    scenario_code: string;
    weather_profile: string;
    notes: string;
  } = {
    shift_id: null,
    usage_status: 'IN_USE',
    sim_testing_start: '07:00',
    sim_testing_end: '13:00',
    mission_name: '',
    instructor_name: '',
    pilot_name: '',
    copilot_name: '',
    scenario_code: '',
    weather_profile: '',
    notes: ''
  };

  // ── Mission Brief (Detail) Modal & 1-Click Snag DR ─────────────────────────
  detailOp: Operation | null = null;
  detailLogs: OperationLog[] = [];
  detailMembers: OperationMember[] = [];
  detailLoading = false;

  newMemberUserId: number | null = null;
  newMemberRole = '';
  memberBusy = false;

  newLogAction = '';
  newLogDetails = '';
  logBusy = false;

  showSnagForm = false;
  submittingSnag = false;
  snagForm: {
    title: string;
    subsystem_code: SimulatorSubsystemCode;
    severity: 'MINOR' | 'DEGRADED' | 'AOG';
    lost_training_minutes: number;
    description: string;
  } = {
    title: '',
    subsystem_code: 'VISUAL',
    severity: 'MINOR',
    lost_training_minutes: 0,
    description: ''
  };

  // ── 1-Click Quick Debrief & Close ──────────────────────────────────────────
  showDebriefForm = false;
  submittingDebrief = false;
  debriefForm: {
    outcome: SortieOutcome;
    actual_flight_hours: number;
    lost_training_minutes: number;
    snag_summary: string;
    open_snag_wo: boolean;
    subsystem_code: SimulatorSubsystemCode;
    severity: 'MINOR' | 'DEGRADED' | 'AOG';
  } = {
    outcome: 'CLEAN',
    actual_flight_hours: 4,
    lost_training_minutes: 0,
    snag_summary: '',
    open_snag_wo: false,
    subsystem_code: 'VISUAL',
    severity: 'DEGRADED'
  };

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (typeof document !== 'undefined' && document.querySelector('.confirm-overlay, .cdk-overlay-pane')) {
      return;
    }
    if (this.showQuickShiftModal) {
      this.showQuickShiftModal = false;
      this.cdr.markForCheck();
    } else if (this.showFormModal) {
      this.showFormModal = false;
      this.cdr.markForCheck();
    } else if (this.detailOp) {
      this.detailOp = null;
      this.cdr.markForCheck();
    }
  }

  // ── UI Customization Helpers ───────────────────────────────────────────────
  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  // ── Create / Edit Modal ────────────────────────────────────────────────────
  private emptyForm() {
    return {
      title: '',
      mission_name: '',
      instructor_name: '',
      pilot_name: '',
      copilot_name: '',
      type_id: undefined as number | undefined,
      simulator_id: null as number | null,
      sortie_code: '',
      customer_operator: '',
      scenario_code: '',
      weather_profile: '',
      motion_required: true,
      scheduled_hours: 4,
      actual_flight_hours: null as number | null,
      lost_training_minutes: 0,
      outcome: 'PENDING' as SortieOutcome,
      snag_summary: '',
      priority: 'MEDIUM' as Priority,
      status: 'PLANNED' as OperationStatus,
      location: '',
      start_date: new Date() as Date | null,
      end_date: addHoursToDate(new Date(), 4) as Date | null,
      description: '',
      notes: '',
      repeat_days: 1
    };
  }

  openFormModal(op?: Operation): void {
    this.formError = '';
    this.conflictWarning = null;
    this.selectedDraftUserId = null;
    this.selectedDraftRole = '';

    if (op) {
      this.editingOp = op;
      this.form = {
        title: op.title,
        mission_name: op.mission_name ?? '',
        instructor_name: op.instructor_name ?? '',
        pilot_name: op.pilot_name ?? '',
        copilot_name: op.copilot_name ?? '',
        type_id: op.type_id ?? op.type?.id,
        simulator_id: op.simulator_id ?? op.simulator?.id ?? null,
        sortie_code: op.sortie_code ?? '',
        customer_operator: op.customer_operator ?? '',
        scenario_code: op.scenario_code ?? '',
        weather_profile: op.weather_profile ?? '',
        motion_required: op.motion_required !== false,
        scheduled_hours: op.scheduled_hours ?? 4,
        actual_flight_hours: op.actual_flight_hours ?? null,
        lost_training_minutes: op.lost_training_minutes ?? 0,
        outcome: (op.outcome || 'PENDING') as SortieOutcome,
        snag_summary: op.snag_summary ?? '',
        priority: op.priority || 'MEDIUM',
        status: op.status || 'PLANNED',
        location: op.location ?? '',
        start_date: op.start_date ? new Date(op.start_date) : null,
        end_date: op.end_date ? new Date(op.end_date) : null,
        description: op.description ?? '',
        notes: op.notes ?? ''
      };
      this.draftMembers = (op.members || []).map(m => ({
        user_id: m.user_id,
        role_in_op: m.role_in_op || '',
        user: m.user
      }));
      this.showFlightDetails = false;
      this.showDebriefSection = Boolean(
        op.status === 'COMPLETED' || (op.outcome && op.outcome !== 'PENDING')
      );
      this.checkBayConflict();
    } else {
      this.editingOp = null;
      this.form = this.emptyForm();
      if (this.opTypes.length === 1) {
        this.form.type_id = this.opTypes[0].id;
      }
      this.draftMembers = [];
      this.showFlightDetails = false;
      this.showDebriefSection = false;
    }

    this.showFormModal = true;
    this.cdr.markForCheck();
  }

  openFormWithSlot(simulatorId: number, startDate: Date, endDate?: Date): void {
    this.openFormModal(undefined);
    this.form.simulator_id = simulatorId;
    const sim = this.simulators.find(s => Number(s.id) === Number(simulatorId));
    const defaultHrs = Number(sim?.schedule_config?.default_slot_hours) || 4;
    this.form.start_date = startDate;
    this.form.end_date = endDate || addHoursToDate(startDate, defaultHrs);
    this.form.scheduled_hours = Math.max(
      0.5,
      Math.round(((this.form.end_date.getTime() - startDate.getTime()) / 3600000) * 10) / 10
    );
    this.checkBayConflict();
    this.cdr.markForCheck();
  }

  get orderedSimulatorsForSortie(): Simulator[] {
    return [...(this.simulators || [])].sort((a, b) => {
      const ma = resolveSimulatorSchedulingMode(a) === 'SORTIES' ? 0 : 1;
      const mb = resolveSimulatorSchedulingMode(b) === 'SORTIES' ? 0 : 1;
      if (ma !== mb) return ma - mb;
      return String(a.bay_code || a.code).localeCompare(String(b.bay_code || b.code));
    });
  }

  simulatorModeOf(sim?: Simulator | null): 'SORTIES' | 'SHIFTS' {
    return resolveSimulatorSchedulingMode(sim);
  }

  get activeSlotPresets(): SimulatorSlotPreset[] {
    const custom = this.selectedSimulator?.schedule_config?.slot_presets;
    if (Array.isArray(custom) && custom.length > 0) return custom;
    return this.defaultSlotPresets;
  }

  get selectedSimulator(): Simulator | null {
    if (!this.form?.simulator_id) return null;
    return this.simulators.find(s => Number(s.id) === Number(this.form.simulator_id)) || null;
  }

  get flightDetailsBadge(): string {
    const bits: string[] = [];
    if (String(this.form.copilot_name || '').trim()) bits.push('Co-Pilot');
    if (String(this.form.customer_operator || '').trim()) bits.push(this.form.customer_operator.trim());
    if (!this.editingOp && Number(this.form.repeat_days) > 1) bits.push(`${this.form.repeat_days}d series`);
    if (String(this.form.scenario_code || '').trim() || String(this.form.weather_profile || '').trim()) {
      bits.push('Scenario/Wx');
    }
    return bits.slice(0, 3).join(' · ');
  }

  get debriefSectionBadge(): string {
    if (this.form.outcome && this.form.outcome !== 'PENDING') {
      return this.outcomeMeta(this.form.outcome).label;
    }
    if (this.form.actual_flight_hours || Number(this.form.lost_training_minutes) > 0) {
      return 'Hours logged';
    }
    return '';
  }

  checkBayConflict(): void {
    const simId = this.form?.simulator_id;
    const startObj = this.form?.start_date ? new Date(this.form.start_date) : null;
    if (!simId || !startObj || Number.isNaN(startObj.getTime())) {
      this.conflictWarning = null;
      this.cdr.markForCheck();
      return;
    }
    const endObj = this.form?.end_date ? new Date(this.form.end_date) : addHoursToDate(startObj, 2);
    if (startObj && endObj && !Number.isNaN(endObj.getTime())) {
      const hrs = Math.round(((endObj.getTime() - startObj.getTime()) / 3600000) * 10) / 10;
      if (hrs > 0) this.form.scheduled_hours = hrs;
    }

    const params: Record<string, any> = {
      simulator_id: simId,
      start_date: startObj.toISOString(),
      end_date: endObj.toISOString(),
      motion_required: this.form.motion_required !== false
    };
    if (this.editingOp?.id) params['exclude_id'] = this.editingOp.id;

    const seq = ++this.conflictSeq;
    this.api.get<any>('/operations/check-conflict', params).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (seq !== this.conflictSeq) return;
        this.conflictWarning = res?.data || null;
        this.cdr.markForCheck();
      },
      error: () => {
        if (seq !== this.conflictSeq) return;
        this.conflictWarning = null;
      }
    });
  }

  closeFormModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showFormModal = false;
    }
  }

  applyDurationPreset(hours: number): void {
    const start = this.form.start_date ? new Date(this.form.start_date) : new Date();
    this.form.start_date = start;
    this.form.end_date = addHoursToDate(start, hours);
    this.form.scheduled_hours = hours;
    this.formError = '';
    this.checkBayConflict();
    this.cdr.markForCheck();
  }

  applySlotPreset(slot: SimulatorSlotPreset): void {
    const base = this.form.start_date ? new Date(this.form.start_date) : new Date();
    const [sh, sm] = String(slot.start || '06:00').split(':').map(Number);
    const [eh, em] = String(slot.end || '10:00').split(':').map(Number);
    const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh || 0, sm || 0, 0, 0);
    let e = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh || 0, em || 0, 0, 0);
    if (e.getTime() <= s.getTime()) {
      e = new Date(e.getTime() + 24 * 3600 * 1000);
    }
    this.form.start_date = s;
    this.form.end_date = e;
    this.form.scheduled_hours = Math.max(0.5, Math.round(((e.getTime() - s.getTime()) / 3600000) * 10) / 10);
    this.formError = '';
    this.checkBayConflict();
    this.cdr.markForCheck();
  }

  // ── Quick Shift Modal (SHIFTS-mode simulators directly from 24h Timeline) ──
  openQuickShiftModal(opts: {
    simulator: Simulator;
    dateIso: string;
    block?: TimelineShiftBlock | null;
    startHour?: number;
    availableShifts?: Array<{ id: number; shift_number: number; shift_name: string }>;
  }): void {
    this.quickShiftSim = opts.simulator;
    this.quickShiftDate = opts.block?.log_date || opts.dateIso;
    this.quickShiftAvailableShifts = opts.availableShifts || [];
    this.quickShiftError = '';
    this.quickShiftSaving = false;

    const presets = opts.simulator.schedule_config?.shift_presets || [];
    const defaultStart = opts.startHour !== undefined
      ? `${String(opts.startHour).padStart(2, '0')}:00`
      : (presets[0]?.start || '07:00');
    const defaultDur = Number(opts.simulator.schedule_config?.default_slot_hours) || 6;
    const endHr = opts.startHour !== undefined ? ((opts.startHour + Math.round(defaultDur)) % 24) : 13;
    const defaultEnd = opts.startHour !== undefined
      ? `${String(endHr).padStart(2, '0')}:00`
      : (presets[0]?.end || '13:00');

    const b = opts.block;
    this.quickShiftForm = {
      shift_id: b?.shift_id ?? (this.quickShiftAvailableShifts[0]?.id ?? null),
      usage_status: b?.usage_status || 'IN_USE',
      sim_testing_start: b?.display_start_time || b?.start_time || defaultStart,
      sim_testing_end: b?.display_end_time || (b?.end_time === '24:00' ? '00:00' : b?.end_time) || defaultEnd,
      mission_name: b?.mission_name || '',
      instructor_name: b?.instructor_name || '',
      pilot_name: b?.pilot_name || '',
      copilot_name: b?.copilot_name || '',
      scenario_code: b?.scenario_code || '',
      weather_profile: b?.weather_profile || '',
      notes: b?.notes || ''
    };
    this.showQuickShiftModal = true;
    this.cdr.markForCheck();
  }

  closeQuickShiftModal(e?: MouseEvent): void {
    if (!e || (e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showQuickShiftModal = false;
      this.cdr.markForCheck();
    }
  }

  quickShiftPresets(): SimulatorShiftPreset[] {
    const p = this.quickShiftSim?.schedule_config?.shift_presets;
    if (Array.isArray(p) && p.length > 0) return p;
    return [
      { name: 'SHIFT 1', start: '07:00', end: '13:00' },
      { name: 'SHIFT 2', start: '13:30', end: '19:30' }
    ];
  }

  applyQuickShiftPreset(p: SimulatorShiftPreset): void {
    this.quickShiftForm = {
      ...this.quickShiftForm,
      usage_status: 'IN_USE',
      sim_testing_start: p.start,
      sim_testing_end: p.end
    };
    this.cdr.markForCheck();
  }

  shiftStatusMeta(st: ShiftUsageStatus) {
    return SHIFT_USAGE_STATUS_META[st] || SHIFT_USAGE_STATUS_META.READY;
  }

  saveQuickShift(): void {
    if (!this.quickShiftSim || this.quickShiftSaving) return;
    this.quickShiftSaving = true;
    this.quickShiftError = '';
    this.cdr.markForCheck();

    const isNewShift = this.quickShiftForm.shift_id === 'NEW';
    const payload: Record<string, any> = {
      date: this.quickShiftDate,
      simulator_id: this.quickShiftSim.id,
      create_new_shift: isNewShift,
      shift_id: !isNewShift && this.quickShiftForm.shift_id ? Number(this.quickShiftForm.shift_id) : undefined,
      usage_status: this.quickShiftForm.usage_status,
      sim_testing_start: this.quickShiftForm.usage_status === 'IN_USE' ? (this.quickShiftForm.sim_testing_start || '00:00') : '00:00',
      sim_testing_end: this.quickShiftForm.usage_status === 'IN_USE' ? (this.quickShiftForm.sim_testing_end || '00:00') : '00:00',
      mission_name: this.quickShiftForm.mission_name.trim() || null,
      instructor_name: this.quickShiftForm.instructor_name.trim() || null,
      pilot_name: this.quickShiftForm.pilot_name.trim() || null,
      copilot_name: this.quickShiftForm.copilot_name.trim() || null,
      scenario_code: this.quickShiftForm.scenario_code.trim() || null,
      weather_profile: this.quickShiftForm.weather_profile.trim() || null,
      notes: this.quickShiftForm.notes.trim() || null
    };

    this.api.post<any>('/simulators/daily-sheet/quick-entry', payload).subscribe({
      next: () => {
        this.quickShiftSaving = false;
        this.showQuickShiftModal = false;
        this.toast.success(`Shift updated for ${this.quickShiftSim?.code}.`);
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.quickShiftSaving = false;
        this.quickShiftError = err?.error?.message || 'Failed to save shift entry.';
        this.cdr.markForCheck();
      }
    });
  }

  jumpToFullDailySheet(): void {
    if (!this.quickShiftSim) return;
    const stationKind = this.quickShiftSim.station_kind || 'TEST_PLACE';
    const dateIso = this.quickShiftDate;
    this.showQuickShiftModal = false;
    this.openFullDailySheet.emit({ stationKind, dateIso });
    this.cdr.markForCheck();
  }

  get plannedFormDuration(): string {
    return formatDurationRange(this.form.start_date, this.form.end_date);
  }

  get availableDraftStaff(): Partial<User>[] {
    const chosen = new Set(this.draftMembers.map(m => Number(m.user_id)));
    return this.staffUsers.filter(u => u.id && !chosen.has(Number(u.id)));
  }

  addDraftMember(): void {
    if (!this.selectedDraftUserId) return;
    const userId = Number(this.selectedDraftUserId);
    const user = this.staffUsers.find(u => Number(u.id) === userId);
    const role = this.selectedDraftRole.trim();

    const exists = this.draftMembers.findIndex(m => Number(m.user_id) === userId);
    if (exists >= 0) {
      this.draftMembers = this.draftMembers.map((m, idx) => idx === exists ? { ...m, role_in_op: role } : m);
    } else {
      this.draftMembers = [...this.draftMembers, { user_id: userId, role_in_op: role, user }];
    }

    this.selectedDraftUserId = null;
    this.selectedDraftRole = '';
    this.cdr.markForCheck();
  }

  removeDraftMember(userId: number): void {
    this.draftMembers = this.draftMembers.filter(m => Number(m.user_id) !== Number(userId));
    this.cdr.markForCheck();
  }

  quickCreateOperationType(rawName: string): void {
    const name = rawName.trim();
    if (!name) return;
    this.api.post<any>('/operations/types', { name }).subscribe({
      next: res => {
        const created: OperationType = res?.data;
        if (created) {
          if (!this.opTypes.some(t => t.id === created.id)) {
            this.opTypes = [...this.opTypes, created];
          }
          this.form.type_id = created.id;
          this.toast.success(`Training profile "${created.name}" created.`);
          this.mutated.emit();
          this.cdr.markForCheck();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Unable to create training profile.')
    });
  }

  quickCreateSimulator(rawLabel: string): void {
    const label = rawLabel.trim();
    if (!label) return;
    const cleanCode = label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || `SIM-${Date.now().toString().slice(-4)}`;
    this.api.post<any>('/simulators', {
      code: cleanCode,
      name: label,
      bay_code: cleanCode.slice(0, 12),
      station_kind: 'FFS_BAY',
      status: 'READY'
    }).subscribe({
      next: res => {
        const created: Simulator = res?.data;
        if (created) {
          this.simulators = [...this.simulators, created];
          this.form.simulator_id = created.id;
          this.checkBayConflict();
          this.toast.success(`Simulator "${created.name}" created and selected.`);
          this.mutated.emit();
          this.cdr.markForCheck();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Unable to create simulator bay.')
    });
  }

  saveOperation(): void {
    this.formError = '';
    if (this.showFormField('start_date') && !this.form.start_date) {
      this.formError = 'Start date & time is required.';
      return;
    }

    const startObj = this.form.start_date ? new Date(this.form.start_date) : null;
    const endObj = this.form.end_date ? new Date(this.form.end_date) : null;
    if (startObj && endObj && endObj.getTime() < startObj.getTime()) {
      this.formError = 'End date must be on or after start date.';
      return;
    }

    const sim = this.selectedSimulator;
    const resolvedTitle = String(this.form.title || '').trim()
      || String(this.form.mission_name || '').trim()
      || (sim ? `${sim.code} Sortie` : 'Simulator Sortie');
    const resolvedTypeId = this.form.type_id || this.opTypes[0]?.id;

    const payload: Record<string, any> = {
      ...this.form,
      title: resolvedTitle,
      type_id: resolvedTypeId,
      mission_name: String(this.form.mission_name || '').trim() || null,
      instructor_name: String(this.form.instructor_name || '').trim() || null,
      pilot_name: String(this.form.pilot_name || '').trim() || null,
      copilot_name: String(this.form.copilot_name || '').trim() || null,
      customer_operator: String(this.form.customer_operator || '').trim() || null,
      scenario_code: String(this.form.scenario_code || '').trim() || null,
      weather_profile: String(this.form.weather_profile || '').trim() || null,
      simulator_id: this.form.simulator_id ? Number(this.form.simulator_id) : null,
      scheduled_hours: this.form.scheduled_hours !== null && this.form.scheduled_hours !== '' ? Number(this.form.scheduled_hours) : null,
      actual_flight_hours: this.form.actual_flight_hours !== null && this.form.actual_flight_hours !== '' ? Number(this.form.actual_flight_hours) : null,
      lost_training_minutes: Number(this.form.lost_training_minutes || 0),
      motion_required: this.form.motion_required !== false,
      start_date: startObj ? startObj.toISOString() : null,
      end_date: endObj ? endObj.toISOString() : null,
      repeat_days: this.editingOp ? 1 : Math.min(7, Math.max(1, Number(this.form.repeat_days) || 1)),
      members: this.draftMembers.map(m => ({
        user_id: m.user_id,
        role_in_op: m.role_in_op.trim() || null
      }))
    };

    this.saving = true;
    const isEdit = !!this.editingOp;
    const req$ = isEdit
      ? this.api.put<any>(`/operations/${this.editingOp!.id}`, payload)
      : this.api.post<any>('/operations', payload);

    req$.subscribe({
      next: (res) => {
        this.saving = false;
        this.showFormModal = false;
        const createdCount = res?.meta?.createdCount || 1;
        this.toast.success(
          isEdit
            ? 'Operation updated.'
            : (createdCount > 1 ? `Scheduled ${createdCount}-day training sortie series.` : 'Operation created.')
        );
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.formError = e?.error?.message || 'Failed to save operation.';
        this.toast.error(this.formError);
        this.cdr.markForCheck();
      }
    });
  }

  // ── Mission Brief (Detail) Modal ───────────────────────────────────────────
  openDetailModal(op: Operation): void {
    this.detailOp = op;
    this.detailMembers = [...(op.members || [])];
    this.detailLogs = [];
    this.detailLoading = true;
    this.showSnagForm = false;
    this.submittingSnag = false;
    this.showDebriefForm = false;
    this.submittingDebrief = false;
    this.debriefForm = {
      outcome: (op.outcome && op.outcome !== 'PENDING') ? op.outcome : 'CLEAN',
      actual_flight_hours: Number(op.actual_flight_hours ?? op.scheduled_hours ?? 4),
      lost_training_minutes: Number(op.lost_training_minutes ?? 0),
      snag_summary: op.snag_summary || '',
      open_snag_wo: false,
      subsystem_code: 'VISUAL',
      severity: 'DEGRADED'
    };
    this.snagForm = {
      title: '',
      subsystem_code: 'VISUAL',
      severity: 'MINOR',
      lost_training_minutes: 0,
      description: ''
    };
    this.newMemberUserId = null;
    this.newMemberRole = '';
    this.newLogAction = '';
    this.newLogDetails = '';
    this.cdr.markForCheck();

    const seq = ++this.detailSeq;
    this.api.get<any>(`/operations/${op.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        if (seq !== this.detailSeq) return;
        const full: Operation | undefined = r?.data;
        if (full && this.detailOp?.id === op.id) {
          this.detailOp = full;
          this.detailMembers = full.members || [];
          this.detailLogs = full.logs || [];
        }
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (seq !== this.detailSeq) return;
        this.detailLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeDetailModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.detailOp = null;
    }
  }

  get availableDetailStaff(): Partial<User>[] {
    const chosen = new Set(this.detailMembers.map(m => Number(m.user_id)));
    return this.staffUsers.filter(u => u.id && !chosen.has(Number(u.id)));
  }

  addDetailMember(): void {
    if (!this.detailOp || !this.newMemberUserId || this.memberBusy) return;
    this.memberBusy = true;
    this.api.post<any>(`/operations/${this.detailOp.id}/members`, {
      user_id: this.newMemberUserId,
      role_in_op: this.newMemberRole.trim() || null
    }).subscribe({
      next: r => {
        this.detailMembers = r?.data || [];
        this.newMemberUserId = null;
        this.newMemberRole = '';
        this.memberBusy = false;
        this.toast.success('Crew member assigned.');
        this.refreshLogsOnly();
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.memberBusy = false;
        this.toast.error(e?.error?.message || 'Failed to assign member.');
        this.cdr.markForCheck();
      }
    });
  }

  removeDetailMember(member: OperationMember): void {
    if (!this.detailOp || this.memberBusy) return;
    this.memberBusy = true;
    this.api.delete<any>(`/operations/${this.detailOp.id}/members/${member.user_id}`).subscribe({
      next: () => {
        this.detailMembers = this.detailMembers.filter(m => Number(m.user_id) !== Number(member.user_id));
        this.memberBusy = false;
        this.toast.success('Crew member removed.');
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.memberBusy = false;
        this.toast.error(e?.error?.message || 'Failed to remove member.');
        this.cdr.markForCheck();
      }
    });
  }

  addLogEntry(): void {
    if (!this.detailOp || !this.newLogAction.trim() || this.logBusy) return;
    this.logBusy = true;
    this.api.post<any>(`/operations/${this.detailOp.id}/logs`, {
      action: this.newLogAction.trim(),
      details: this.newLogDetails.trim() || null
    }).subscribe({
      next: r => {
        if (r?.data) {
          this.detailLogs = [r.data, ...this.detailLogs];
        }
        this.newLogAction = '';
        this.newLogDetails = '';
        this.logBusy = false;
        this.toast.success('Mission log recorded.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.logBusy = false;
        this.toast.error(e?.error?.message || 'Failed to post log.');
        this.cdr.markForCheck();
      }
    });
  }

  private refreshLogsOnly(): void {
    if (!this.detailOp) return;
    this.api.get<any>(`/operations/${this.detailOp.id}/logs`).subscribe({
      next: r => {
        this.detailLogs = r?.data || [];
        this.cdr.markForCheck();
      }
    });
  }

  editFromDetail(): void {
    if (!this.detailOp) return;
    const op: Operation = { ...this.detailOp, members: [...this.detailMembers] };
    this.detailOp = null;
    this.openFormModal(op);
  }

  toggleSnagForm(): void {
    this.showSnagForm = !this.showSnagForm;
    if (this.showSnagForm) this.showDebriefForm = false;
    this.cdr.markForCheck();
  }

  toggleDebriefForm(): void {
    this.showDebriefForm = !this.showDebriefForm;
    if (this.showDebriefForm) {
      this.showSnagForm = false;
      if (this.detailOp) {
        this.debriefForm = {
          outcome: (this.detailOp.outcome && this.detailOp.outcome !== 'PENDING') ? this.detailOp.outcome : 'CLEAN',
          actual_flight_hours: Number(this.detailOp.actual_flight_hours ?? this.detailOp.scheduled_hours ?? 4),
          lost_training_minutes: Number(this.detailOp.lost_training_minutes ?? 0),
          snag_summary: this.detailOp.snag_summary || '',
          open_snag_wo: false,
          subsystem_code: 'VISUAL',
          severity: 'DEGRADED'
        };
      }
    }
    this.cdr.markForCheck();
  }

  submitDebrief(): void {
    if (!this.detailOp || this.submittingDebrief) return;
    this.submittingDebrief = true;
    this.cdr.markForCheck();

    this.api.post<any>(`/operations/${this.detailOp.id}/debrief`, {
      outcome: this.debriefForm.outcome,
      actual_flight_hours: Number(this.debriefForm.actual_flight_hours) || 0,
      lost_training_minutes: Number(this.debriefForm.lost_training_minutes) || 0,
      snag_summary: this.debriefForm.snag_summary.trim() || null,
      open_snag_wo: this.debriefForm.open_snag_wo && Boolean(this.debriefForm.snag_summary.trim()),
      subsystem_code: this.debriefForm.subsystem_code,
      severity: this.debriefForm.severity
    }).subscribe({
      next: (res) => {
        this.submittingDebrief = false;
        this.showDebriefForm = false;
        const wo = res?.data?.maintenanceRecord;
        this.toast.success(
          wo
            ? `Sortie debriefed & closed · Corrective WO #${wo.id} opened in Maintenance.`
            : 'Sortie debriefed & closed · Simulator hours updated.'
        );
        this.mutated.emit();
        if (this.detailOp) {
          this.openDetailModal(this.detailOp);
        }
      },
      error: (err: any) => {
        this.submittingDebrief = false;
        this.toast.error(err?.error?.message || 'Failed to complete sortie debrief.');
        this.cdr.markForCheck();
      }
    });
  }

  submitSnag(): void {
    if (!this.detailOp || this.submittingSnag) return;
    if (!this.snagForm.title.trim()) {
      this.toast.error('Snag title is required.');
      return;
    }

    const simId = this.detailOp.simulator_id ?? this.detailOp.simulator?.id;
    if (!simId) {
      this.toast.error('Assign a simulator bay to this sortie before raising a DR.');
      return;
    }

    this.submittingSnag = true;
    this.cdr.markForCheck();

    this.api.post<any>(`/operations/${this.detailOp.id}/snag`, {
      simulator_id: simId,
      title: this.snagForm.title.trim(),
      subsystem_code: this.snagForm.subsystem_code,
      severity: this.snagForm.severity,
      lost_training_minutes: Number(this.snagForm.lost_training_minutes || 0),
      description: this.snagForm.description.trim() || this.snagForm.title.trim()
    }).subscribe({
      next: () => {
        this.submittingSnag = false;
        this.showSnagForm = false;
        this.toast.success('Discrepancy Report (DR) created and linked to Maintenance & Simulator.');
        this.mutated.emit();
        if (this.detailOp) {
          this.openDetailModal(this.detailOp);
        }
      },
      error: (err: any) => {
        this.submittingSnag = false;
        this.toast.error(err?.error?.message || 'Failed to report simulator snag.');
        this.cdr.markForCheck();
      }
    });
  }

  outcomeMeta(outcome?: SortieOutcome | string | null) {
    return getOutcomeMeta(outcome);
  }

  // ── Shared Actions (Called from Shell or Mission Brief) ────────────────────
  updateStatus(op: Operation, status: OperationStatus): void {
    this.api.put<any>(`/operations/${op.id}`, { status }).subscribe({
      next: r => {
        if (this.detailOp?.id === op.id && r?.data) {
          this.detailOp = r.data;
          this.refreshLogsOnly();
        }
        this.toast.success(`Status set to ${formatEnumLabel(status)}.`);
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update status.')
    });
  }

  duplicateOperation(op: Operation): void {
    this.api.post<any>(`/operations/${op.id}/duplicate`, {}).subscribe({
      next: () => {
        if (this.detailOp?.id === op.id) this.detailOp = null;
        this.toast.success(`Duplicated "${op.title}".`);
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to duplicate operation.')
    });
  }

  async deleteOperation(op: Operation): Promise<void> {
    const ok = await this.confirm.confirm(
      `Delete "${op.title}"? Crew assignments and mission logs will also be removed.`,
      'Delete Operation',
      true
    );
    if (!ok) return;

    this.api.delete<any>(`/operations/${op.id}`).subscribe({
      next: () => {
        if (this.detailOp?.id === op.id) this.detailOp = null;
        this.toast.success('Operation deleted.');
        this.mutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete operation.')
    });
  }

  // ── Formatting Helpers ─────────────────────────────────────────────────────
  label(v?: string | null): string { return formatEnumLabel(v); }
  duration(start?: string | null, end?: string | null): string { return formatDurationRange(start, end); }
  overdue(op: Operation | null): boolean { return isOperationOverdue(op); }
  statusBadge(s?: string | null): string { return getStatusBadgeClass(s); }
  priorityBadge(p?: string | null): string { return getPriorityBadgeClass(p); }
  userName(u?: Partial<User> | null): string { return getUserDisplayName(u); }
  userInitials(u?: Partial<User> | null): string { return getUserInitials(u); }
}
