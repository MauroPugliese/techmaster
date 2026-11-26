import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ConfirmService, ToastService, UiCustomizationService, UiSectionPreferences } from '../../../core/services/services';
import {
  Operation,
  OperationLog,
  OperationMember,
  OperationStatus,
  OperationType,
  Priority,
  Simulator,
  SimulatorSubsystemCode,
  SortieOutcome,
  User
} from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
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
import { SUBSYSTEM_OPTIONS } from '../../simulators/simulator-helpers';

interface DraftMember {
  user_id: number;
  role_in_op: string;
  user?: Partial<User>;
}

@Component({
  selector: 'app-operation-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent, DropdownComponent, DropdownOptionComponent],
  templateUrl: './operation-modals.component.html',
  styleUrls: ['./operation-modals.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OperationModalsComponent {
  @Input() opTypes: OperationType[] = [];
  @Input() simulators: Simulator[] = [];
  @Input() staffUsers: Partial<User>[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;

  @Output() mutated = new EventEmitter<void>();

  readonly durationPresets = DURATION_PRESETS;
  readonly caeSlotPresets: Array<{ label: string; startHour: number; endHour: number }> = [
    { label: '06:00–10:00', startHour: 6, endHour: 10 },
    { label: '10:00–14:00', startHour: 10, endHour: 14 },
    { label: '14:00–18:00', startHour: 14, endHour: 18 },
    { label: '18:00–22:00', startHour: 18, endHour: 22 }
  ];
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
  conflictWarning: { hasOverlap: boolean; overlappingSorties: any[]; warnings: string[] } | null = null;

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
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.showFormModal) {
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
      type_id: undefined as number | undefined,
      simulator_id: null as number | null,
      sortie_code: '',
      customer_operator: '',
      scenario_code: '',
      weather_profile: 'CAVOK / Day',
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
        type_id: op.type_id ?? op.type?.id,
        simulator_id: op.simulator_id ?? op.simulator?.id ?? null,
        sortie_code: op.sortie_code ?? '',
        customer_operator: op.customer_operator ?? '',
        scenario_code: op.scenario_code ?? '',
        weather_profile: op.weather_profile ?? 'CAVOK / Day',
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
      this.checkBayConflict();
    } else {
      this.editingOp = null;
      this.form = this.emptyForm();
      if (this.opTypes.length === 1) {
        this.form.type_id = this.opTypes[0].id;
      }
      this.draftMembers = [];
    }

    this.showFormModal = true;
    this.cdr.markForCheck();
  }

  openFormWithSlot(simulatorId: number, startDate: Date, endDate?: Date): void {
    this.openFormModal(undefined);
    this.form.simulator_id = simulatorId;
    this.form.start_date = startDate;
    this.form.end_date = endDate || addHoursToDate(startDate, 2);
    this.form.scheduled_hours = Math.max(
      0.5,
      Math.round(((this.form.end_date.getTime() - startDate.getTime()) / 3600000) * 10) / 10
    );
    this.checkBayConflict();
    this.cdr.markForCheck();
  }

  get selectedSimulator(): Simulator | null {
    if (!this.form?.simulator_id) return null;
    return this.simulators.find(s => Number(s.id) === Number(this.form.simulator_id)) || null;
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

    this.api.get<any>('/operations/check-conflict', params).subscribe({
      next: res => {
        this.conflictWarning = res?.data || null;
        this.cdr.markForCheck();
      },
      error: () => {
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

  applyCaeSlotPreset(startHour: number, endHour: number): void {
    const base = this.form.start_date ? new Date(this.form.start_date) : new Date();
    const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), startHour, 0, 0, 0);
    const e = new Date(base.getFullYear(), base.getMonth(), base.getDate(), endHour, 0, 0, 0);
    this.form.start_date = s;
    this.form.end_date = e;
    this.form.scheduled_hours = Math.max(0.5, endHour - startHour);
    this.formError = '';
    this.checkBayConflict();
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
    if (this.showFormField('title') && !String(this.form.title || '').trim()) {
      this.formError = 'Operation title is required.';
      return;
    }
    if (this.showFormField('type_id') && !this.form.type_id) {
      this.formError = 'Please select an operation type.';
      return;
    }
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

    const payload: Record<string, any> = {
      ...this.form,
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

    this.api.get<any>(`/operations/${op.id}`).subscribe({
      next: r => {
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
