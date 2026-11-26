import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, ConfirmService, ToastService } from '../../../core/services/services';
import {
  QtgCategory,
  QtgStatus,
  Simulator,
  SimulatorQtgRecord,
  SimulatorStatus,
  SimulatorSubsystem,
  SimulatorSubsystemCode,
  SimulatorSubsystemStatus
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { ExportMenuComponent } from '../../../shared/components/export-menu/export-menu.component';
import {
  QTG_STATUS_META,
  SIM_CATEGORY_LABELS,
  SIM_STATUS_META,
  SUBSYSTEM_META,
  SUBSYSTEM_OPTIONS,
  SUBSYSTEM_STATUS_META,
  formatCertExpiryBadge
} from '../simulator-helpers';

export type SimulatorWorkspaceTab = 'overview' | 'subsystems' | 'qtg' | 'maintenance' | 'sorties';

@Component({
  selector: 'app-simulator-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, RouterLink, DropdownComponent, DropdownOptionComponent, ExportMenuComponent],
  templateUrl: './simulator-workspace.component.html',
  styleUrls: ['./simulator-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SimulatorWorkspaceComponent implements OnChanges, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private dossierReqSeq = 0;

  @Input() simulatorId: number | null = null;
  @Input() fleet: Simulator[] = [];
  @Input() initialTab: SimulatorWorkspaceTab = 'overview';

  @Output() closeWorkspace = new EventEmitter<void>();
  @Output() switchSimulator = new EventEmitter<number>();
  @Output() editSimulatorRequested = new EventEmitter<Simulator>();
  @Output() fleetChanged = new EventEmitter<void>();
  @Output() tabChanged = new EventEmitter<SimulatorWorkspaceTab>();

  activeTab: SimulatorWorkspaceTab = 'overview';
  loading = false;
  dossier: Simulator | null = null;

  // Quick MEL / status edit
  quickStatus: SimulatorStatus = 'READY';
  quickMel = '';
  savingQuickStatus = false;

  // Add/Edit Subsystem inline panel
  showSubForm = false;
  editingSub: SimulatorSubsystem | null = null;
  subForm: {
    subsystem_code: SimulatorSubsystemCode;
    name: string;
    part_number: string;
    serial_number: string;
    firmware_version: string;
    status: SimulatorSubsystemStatus;
    operating_hours: number;
    notes: string;
  } = this.emptySubForm();
  savingSub = false;

  // Add QTG inline panel
  showQtgForm = false;
  qtgFilterQuarter = '';
  qtgForm = {
    test_code: '',
    title: '',
    category: 'PERFORMANCE' as QtgCategory,
    quarter: 'Q4' as 'Q1' | 'Q2' | 'Q3' | 'Q4',
    year: new Date().getUTCFullYear(),
    mode: 'AUTO' as 'AUTO' | 'MANUAL',
    status: 'PENDING' as QtgStatus,
    measured_delta: '',
    notes: ''
  };
  savingQtg = false;
  cloningQtg = false;
  cloneTargetYear = new Date().getUTCFullYear() + 1;

  // Quick Snag (DR) reporter inline panel
  showSnagForm = false;
  snagForm = {
    title: '',
    subsystem_code: 'VISUAL' as SimulatorSubsystemCode,
    severity: 'DEGRADED' as 'MINOR' | 'DEGRADED' | 'AOG',
    lost_training_hours: 0,
    description: ''
  };
  savingSnag = false;

  readonly subsystemOptions = SUBSYSTEM_OPTIONS;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialTab'] && this.initialTab) {
      this.activeTab = this.initialTab;
    }
    if (changes['simulatorId'] && this.simulatorId) {
      this.loadDossier(this.simulatorId);
    }
  }

  private emptySubForm() {
    return {
      subsystem_code: 'VISUAL' as SimulatorSubsystemCode,
      name: '',
      part_number: '',
      serial_number: '',
      firmware_version: '',
      status: 'NOMINAL' as SimulatorSubsystemStatus,
      operating_hours: 0,
      notes: ''
    };
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDossier(id: number): void {
    const seq = ++this.dossierReqSeq;
    this.loading = true;
    this.cdr.markForCheck();

    this.api.get<any>(`/simulators/${id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (seq !== this.dossierReqSeq) return;
        this.dossier = res?.data || null;
        if (this.dossier) {
          this.quickStatus = this.dossier.status;
          this.quickMel = this.dossier.limitations_mel || '';
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (seq !== this.dossierReqSeq) return;
        this.loading = false;
        this.toast.error('Failed to load simulator dossier.');
        this.cdr.markForCheck();
      }
    });
  }

  selectTab(tab: SimulatorWorkspaceTab): void {
    this.activeTab = tab;
    this.tabChanged.emit(tab);
  }

  get currentFleetIndex(): number {
    const id = this.dossier?.id ?? this.simulatorId;
    if (!id || !this.fleet.length) return -1;
    return this.fleet.findIndex((s) => s.id === id);
  }

  onSwitcherSelect(nextId: number): void {
    const numId = Number(nextId);
    if (!numId || numId === (this.dossier?.id ?? this.simulatorId)) return;
    this.switchSimulator.emit(numId);
  }

  stepSimulator(delta: number): void {
    if (this.fleet.length <= 1) return;
    const idx = this.currentFleetIndex;
    const base = idx >= 0 ? idx : 0;
    const nextIdx = (base + delta + this.fleet.length) % this.fleet.length;
    const target = this.fleet[nextIdx];
    if (target) {
      this.switchSimulator.emit(target.id);
    }
  }

  simStatusMeta(st?: SimulatorStatus) {
    return SIM_STATUS_META[st || 'READY'] || SIM_STATUS_META.READY;
  }

  categoryLabel(cat?: string): string {
    return (SIM_CATEGORY_LABELS as any)[cat || 'COMMERCIAL_FIXED_WING'] || cat || 'FFS';
  }

  subMeta(code?: string) {
    return (SUBSYSTEM_META as any)[code || 'VISUAL'] || { label: code || 'Subsystem', icon: 'memory' };
  }

  subStatusMeta(st?: SimulatorSubsystemStatus) {
    return SUBSYSTEM_STATUS_META[st || 'NOMINAL'] || SUBSYSTEM_STATUS_META.NOMINAL;
  }

  qtgStatusMeta(st?: QtgStatus) {
    return QTG_STATUS_META[st || 'PENDING'] || QTG_STATUS_META.PENDING;
  }

  certBadge(d: Simulator | null) {
    return formatCertExpiryBadge(d?.telemetry?.certificate || null);
  }

  saveQuickStatus(): void {
    if (!this.dossier || this.savingQuickStatus) return;
    this.savingQuickStatus = true;
    this.api.patch<any>(`/simulators/${this.dossier.id}/status`, {
      status: this.quickStatus,
      limitations_mel: this.quickMel.trim() || null
    }).subscribe({
      next: () => {
        this.savingQuickStatus = false;
        this.toast.success('Bay status updated.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => {
        this.savingQuickStatus = false;
        this.toast.error(err?.error?.message || 'Unable to update bay status.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Subsystems Sub-section ─────────────────────────────────────────────────
  openAddSubsystem(): void {
    this.editingSub = null;
    this.subForm = this.emptySubForm();
    this.showSubForm = true;
  }

  openEditSubsystem(sub: SimulatorSubsystem): void {
    this.editingSub = sub;
    this.subForm = {
      subsystem_code: sub.subsystem_code,
      name: sub.name,
      part_number: sub.part_number || '',
      serial_number: sub.serial_number || '',
      firmware_version: sub.firmware_version || '',
      status: sub.status,
      operating_hours: Number(sub.operating_hours ?? 0),
      notes: sub.notes || ''
    };
    this.showSubForm = true;
  }

  saveSubsystem(): void {
    if (!this.dossier || this.savingSub) return;
    if (!this.subForm.name.trim()) {
      this.toast.warning('Subsystem name is required.');
      return;
    }

    this.savingSub = true;
    const payload = {
      ...this.subForm,
      name: this.subForm.name.trim(),
      part_number: this.subForm.part_number.trim() || null,
      serial_number: this.subForm.serial_number.trim() || null,
      firmware_version: this.subForm.firmware_version.trim() || null,
      notes: this.subForm.notes.trim() || null
    };

    const req$ = this.editingSub
      ? this.api.put<any>(`/simulators/${this.dossier.id}/subsystems/${this.editingSub.id}`, payload)
      : this.api.post<any>(`/simulators/${this.dossier.id}/subsystems`, payload);

    req$.subscribe({
      next: () => {
        this.savingSub = false;
        this.showSubForm = false;
        this.toast.success(this.editingSub ? 'Subsystem updated.' : 'Subsystem added.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => {
        this.savingSub = false;
        this.toast.error(err?.error?.message || 'Unable to save subsystem.');
        this.cdr.markForCheck();
      }
    });
  }

  changeSubsystemStatus(sub: SimulatorSubsystem, status: SimulatorSubsystemStatus): void {
    if (!this.dossier || sub.status === status) return;
    this.api.put<any>(`/simulators/${this.dossier.id}/subsystems/${sub.id}`, { status }).subscribe({
      next: () => {
        this.toast.success(`${sub.name} marked ${status}.`);
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to update subsystem.')
    });
  }

  async deleteSubsystem(sub: SimulatorSubsystem): Promise<void> {
    if (!this.dossier) return;
    const ok = await this.confirm.confirm(`Remove subsystem "${sub.name}" from ${this.dossier.code}?`, 'Delete Subsystem', true);
    if (!ok) return;

    this.api.delete(`/simulators/${this.dossier.id}/subsystems/${sub.id}`).subscribe({
      next: () => {
        this.toast.success('Subsystem removed.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: () => this.toast.error('Unable to delete subsystem.')
    });
  }

  // ── QTG Sub-section ────────────────────────────────────────────────────────
  get filteredQtg(): SimulatorQtgRecord[] {
    const rows = this.dossier?.qtgRecords || [];
    if (!this.qtgFilterQuarter) return rows;
    return rows.filter(r => r.quarter === this.qtgFilterQuarter);
  }

  quarterSummary(quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'): { total: number; done: number } {
    const rows = (this.dossier?.qtgRecords || []).filter(r => r.quarter === quarter);
    const done = rows.filter(r => r.status === 'PASSED' || r.status === 'TOLERANCE_WARN').length;
    return { total: rows.length, done };
  }

  saveQtgRecord(): void {
    if (!this.dossier || this.savingQtg) return;
    if (!this.qtgForm.test_code.trim() || !this.qtgForm.title.trim()) {
      this.toast.warning('Test Code and Title are required.');
      return;
    }

    this.savingQtg = true;
    this.api.post<any>(`/simulators/${this.dossier.id}/qtg`, this.qtgForm).subscribe({
      next: () => {
        this.savingQtg = false;
        this.showQtgForm = false;
        this.qtgForm = { ...this.qtgForm, test_code: '', title: '', measured_delta: '', notes: '' };
        this.toast.success('QTG test added.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => {
        this.savingQtg = false;
        this.toast.error(err?.error?.message || 'Unable to save QTG test.');
        this.cdr.markForCheck();
      }
    });
  }

  setQtgStatus(q: SimulatorQtgRecord, status: QtgStatus): void {
    if (!this.dossier) return;
    this.api.put<any>(`/simulators/${this.dossier.id}/qtg/${q.id}`, { status }).subscribe({
      next: () => {
        this.toast.success(`${q.test_code} marked ${status}.`);
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: () => this.toast.error('Failed to update QTG status.')
    });
  }

  async deleteQtgRecord(q: SimulatorQtgRecord): Promise<void> {
    if (!this.dossier) return;
    const ok = await this.confirm.confirm(`Delete QTG check "${q.test_code}"?`, 'Delete QTG Record', true);
    if (!ok) return;

    this.api.delete(`/simulators/${this.dossier.id}/qtg/${q.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toast.success('QTG record removed.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Unable to delete QTG record.')
    });
  }

  cloneQtgToNextYear(): void {
    if (!this.dossier || this.cloningQtg) return;
    this.cloningQtg = true;
    this.cdr.markForCheck();

    this.api.post<any>(`/simulators/${this.dossier.id}/qtg/clone-year`, {
      target_year: this.cloneTargetYear
    }).subscribe({
      next: (res) => {
        this.cloningQtg = false;
        const created = res?.data?.created_count ?? 0;
        const skipped = res?.data?.skipped_count ?? 0;
        this.toast.success(
          created > 0
            ? `Cloned ${created} QTG test(s) into ${this.cloneTargetYear}${skipped ? ` (${skipped} already existed)` : ''}.`
            : `All QTG tests for ${this.cloneTargetYear} already exist.`
        );
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => {
        this.cloningQtg = false;
        this.toast.error(err?.error?.message || 'Unable to clone QTG schedule.');
        this.cdr.markForCheck();
      }
    });
  }

  openWoFromFailedQtg(q: SimulatorQtgRecord): void {
    const catToSub: Record<string, SimulatorSubsystemCode> = {
      MOTION_CUEING: 'MOTION',
      VISUAL_SYSTEM: 'VISUAL',
      SOUND: 'SOUND',
      IOS_NAV: 'IOS',
      HANDLING: 'CONTROL_LOADING',
      PERFORMANCE: 'HOST_COMPUTE'
    };
    this.snagForm = {
      title: `QTG Failure: ${q.test_code} — ${q.title}`,
      subsystem_code: catToSub[q.category] || 'HOST_COMPUTE',
      severity: 'DEGRADED',
      lost_training_hours: 0,
      description: `Failed ${q.quarter} ${q.year} QTG (${q.test_code}). Measured delta: ${q.measured_delta || 'Out of tolerance'}. ${q.notes || ''}`.trim()
    };
    this.activeTab = 'maintenance';
    this.showSnagForm = true;
    this.cdr.markForCheck();
  }

  get activeMelRecords(): any[] {
    return ((this.dossier as any)?.melRecords || []) as any[];
  }

  // ── Quick Snag (DR) Logger ─────────────────────────────────────────────────
  saveSnag(): void {
    if (!this.dossier || this.savingSnag) return;
    if (!this.snagForm.title.trim() || !this.snagForm.description.trim()) {
      this.toast.warning('DR Title and Technical Description are required.');
      return;
    }

    this.savingSnag = true;
    this.api.post<any>('/maintenance', {
      simulator_id: this.dossier.id,
      subsystem_code: this.snagForm.subsystem_code,
      severity: this.snagForm.severity,
      lost_training_hours: Number(this.snagForm.lost_training_hours) || 0,
      is_snag: true,
      type: 'CORRECTIVE',
      status: 'SCHEDULED',
      priority: this.snagForm.severity === 'AOG' ? 'CRITICAL' : (this.snagForm.severity === 'DEGRADED' ? 'HIGH' : 'MEDIUM'),
      title: this.snagForm.title.trim(),
      description: this.snagForm.description.trim(),
      scheduled_date: new Date().toISOString()
    }).subscribe({
      next: () => {
        this.savingSnag = false;
        this.showSnagForm = false;
        this.snagForm = { ...this.snagForm, title: '', description: '', lost_training_hours: 0 };
        this.toast.success('Discrepancy Report (DR) logged on simulator.');
        this.loadDossier(this.dossier!.id);
        this.fleetChanged.emit();
      },
      error: (err) => {
        this.savingSnag = false;
        this.toast.error(err?.error?.message || 'Unable to log DR.');
        this.cdr.markForCheck();
      }
    });
  }
}
