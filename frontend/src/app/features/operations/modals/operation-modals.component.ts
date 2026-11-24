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
  User
} from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import {
  CREW_ROLE_SUGGESTIONS,
  DURATION_PRESETS,
  addHoursToDate,
  formatDurationRange,
  formatEnumLabel,
  getPriorityBadgeClass,
  getStatusBadgeClass,
  getUserDisplayName,
  getUserInitials,
  isOperationOverdue
} from '../operation-helpers';

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
  @Input() staffUsers: Partial<User>[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;

  @Output() mutated = new EventEmitter<void>();

  readonly durationPresets = DURATION_PRESETS;
  readonly roleSuggestions = CREW_ROLE_SUGGESTIONS;

  // ── Create / Edit Modal ────────────────────────────────────────────────────
  showFormModal = false;
  editingOp: Operation | null = null;
  form: any = this.emptyForm();
  formError = '';
  saving = false;
  draftMembers: DraftMember[] = [];
  selectedDraftUserId: number | null = null;
  selectedDraftRole = '';

  // ── Mission Brief (Detail) Modal ───────────────────────────────────────────
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
      priority: 'MEDIUM' as Priority,
      status: 'PLANNED' as OperationStatus,
      location: '',
      start_date: new Date() as Date | null,
      end_date: null as Date | null,
      description: '',
      notes: ''
    };
  }

  openFormModal(op?: Operation): void {
    this.formError = '';
    this.selectedDraftUserId = null;
    this.selectedDraftRole = '';

    if (op) {
      this.editingOp = op;
      this.form = {
        title: op.title,
        type_id: op.type_id ?? op.type?.id,
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

  closeFormModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showFormModal = false;
    }
  }

  applyDurationPreset(hours: number): void {
    const start = this.form.start_date ? new Date(this.form.start_date) : new Date();
    this.form.start_date = start;
    this.form.end_date = addHoursToDate(start, hours);
    this.formError = '';
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
      start_date: startObj ? startObj.toISOString() : null,
      end_date: endObj ? endObj.toISOString() : null,
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
      next: () => {
        this.saving = false;
        this.showFormModal = false;
        this.toast.success(isEdit ? 'Operation updated.' : 'Operation created.');
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
