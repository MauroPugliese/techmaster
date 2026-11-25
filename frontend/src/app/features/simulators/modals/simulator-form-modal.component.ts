import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ToastService } from '../../../core/services/services';
import {
  Simulator,
  SimulatorPlatformCategory,
  SimulatorStationKind,
  SimulatorStatus
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';

interface SectionToggles {
  identity: boolean;
  qualification: boolean;
  hardware: boolean;
  opsNotes: boolean;
}

@Component({
  selector: 'app-simulator-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent, DateTimePickerComponent],
  templateUrl: './simulator-form-modal.component.html',
  styleUrls: ['./simulator-form-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SimulatorFormModalComponent {
  @Output() saved = new EventEmitter<Simulator>();

  visible = false;
  saving = false;
  errorMsg = '';
  editingSim: Simulator | null = null;
  private fleetSnapshot: Simulator[] = [];

  sections: SectionToggles = {
    identity: false,
    qualification: false,
    hardware: false,
    opsNotes: false
  };

  form: {
    code: string;
    name: string;
    bay_code: string;
    station_kind: SimulatorStationKind;
    sort_order: number;
    platform_category: SimulatorPlatformCategory;
    aircraft_type: string;
    manufacturer: string;
    serial_number: string;
    authority: string;
    qualification_level: string;
    certificate_code: string;
    certificate_expiry: Date | null;
    last_eval_date: Date | null;
    daily_available_hours: number;
    engine_avionics: string;
    software_load: string;
    airac_cycle: string;
    visual_system: string;
    motion_system: string;
    control_loading: string;
    ios_config: string;
    status: SimulatorStatus;
    power_on_hours: number;
    motion_hours: number;
    visual_lamp_hours: number;
    limitations_mel: string;
    notes: string;
    scaffold_subsystems: boolean;
    scaffold_qtg: boolean;
  } = this.createEmptyForm();

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible) {
      this.close();
    }
  }

  get modalTitle(): string {
    if (this.editingSim) return `Edit Station · ${this.editingSim.code}`;
    if (this.form.station_kind === 'TEST_PLACE') return 'Add Test Place';
    if (this.form.station_kind === 'IOS_CONSOLE') return 'Add IOS Console';
    return 'Add Flight Simulator Bay';
  }

  get submitLabel(): string {
    if (this.saving) return 'Saving…';
    if (this.editingSim) return 'Save Changes';
    if (this.form.station_kind === 'TEST_PLACE') return 'Create Test Place';
    if (this.form.station_kind === 'IOS_CONSOLE') return 'Create IOS Console';
    return 'Create Simulator';
  }

  get enabledSectionsCount(): number {
    return Object.values(this.sections).filter(Boolean).length;
  }

  private createEmptyForm() {
    return {
      code: '',
      name: '',
      bay_code: '',
      station_kind: 'TEST_PLACE' as SimulatorStationKind,
      sort_order: 1,
      platform_category: 'FTD_FNPT' as SimulatorPlatformCategory,
      aircraft_type: '',
      manufacturer: 'CAE',
      serial_number: '',
      authority: 'EASA',
      qualification_level: 'CS-FSTD Level D',
      certificate_code: '',
      certificate_expiry: null as Date | null,
      last_eval_date: null as Date | null,
      daily_available_hours: 16,
      engine_avionics: '',
      software_load: '',
      airac_cycle: '',
      visual_system: '',
      motion_system: '',
      control_loading: '',
      ios_config: '',
      status: 'READY' as SimulatorStatus,
      power_on_hours: 0,
      motion_hours: 0,
      visual_lamp_hours: 0,
      limitations_mel: '',
      notes: '',
      scaffold_subsystems: false,
      scaffold_qtg: false
    };
  }

  private applyKindPreset(kind: SimulatorStationKind): void {
    const sameKindCount = this.fleetSnapshot.filter((s) => (s.station_kind || 'FFS_BAY') === kind).length;
    const nextNum = sameKindCount + 1;
    const pad2 = String(nextNum).padStart(2, '0');
    const base = this.createEmptyForm();

    if (kind === 'TEST_PLACE') {
      base.station_kind = 'TEST_PLACE';
      base.sort_order = nextNum;
      base.code = `TP-${pad2}`;
      base.name = `TEST PLACE ${nextNum}`;
      base.bay_code = `TPS-${pad2}`;
      base.platform_category = 'FTD_FNPT';
      base.aircraft_type = 'CAE Test Place';
      base.daily_available_hours = 16;
      base.scaffold_subsystems = false;
      base.scaffold_qtg = false;
      this.sections = { identity: false, qualification: false, hardware: false, opsNotes: false };
    } else if (kind === 'IOS_CONSOLE') {
      base.station_kind = 'IOS_CONSOLE';
      base.sort_order = nextNum;
      base.code = `IOS-${pad2}`;
      base.name = `IOS CONSOLE ${nextNum}`;
      base.bay_code = `IOS-${pad2}`;
      base.platform_category = 'FTD_FNPT';
      base.aircraft_type = 'CAE IOS Console';
      base.daily_available_hours = 16;
      base.scaffold_subsystems = false;
      base.scaffold_qtg = false;
      this.sections = { identity: false, qualification: false, hardware: false, opsNotes: false };
    } else {
      base.station_kind = 'FFS_BAY';
      base.sort_order = nextNum;
      base.platform_category = 'COMMERCIAL_FIXED_WING';
      base.manufacturer = 'CAE 7000XR';
      base.daily_available_hours = 20;
      base.visual_system = 'CAE Tropos 6000XR · 200x40 Laser';
      base.motion_system = 'CAE 6-DOF Electric eMotion';
      base.control_loading = 'CAE Digital CLS-500';
      base.ios_config = 'Dual-Screen IOS v8';
      base.scaffold_subsystems = true;
      base.scaffold_qtg = true;
      this.sections = { identity: true, qualification: true, hardware: false, opsNotes: false };
    }

    this.form = base;
  }

  selectKind(kind: SimulatorStationKind): void {
    if (this.form.station_kind === kind) return;
    if (!this.editingSim) {
      this.applyKindPreset(kind);
    } else {
      this.form.station_kind = kind;
    }
    this.errorMsg = '';
    this.cdr.markForCheck();
  }

  setAllSections(enabled: boolean): void {
    this.sections = {
      identity: enabled,
      qualification: enabled,
      hardware: enabled,
      opsNotes: enabled
    };
    this.cdr.markForCheck();
  }

  open(
    sim?: Simulator | null,
    defaultKind: SimulatorStationKind = 'TEST_PLACE',
    existingFleet: Simulator[] = []
  ): void {
    this.errorMsg = '';
    this.editingSim = sim || null;
    this.fleetSnapshot = existingFleet || [];

    if (sim) {
      const base = this.createEmptyForm();
      const kind = sim.station_kind || 'FFS_BAY';
      this.form = {
        ...base,
        code: sim.code || '',
        name: sim.name || '',
        bay_code: sim.bay_code || '',
        station_kind: kind,
        sort_order: Number(sim.sort_order ?? 100),
        platform_category: sim.platform_category || 'COMMERCIAL_FIXED_WING',
        aircraft_type: sim.aircraft_type || '',
        manufacturer: sim.manufacturer || 'CAE',
        serial_number: sim.serial_number || '',
        authority: sim.authority || '',
        qualification_level: sim.qualification_level || '',
        certificate_code: sim.certificate_code || '',
        certificate_expiry: sim.certificate_expiry ? new Date(`${sim.certificate_expiry.slice(0, 10)}T00:00:00`) : null,
        last_eval_date: sim.last_eval_date ? new Date(`${sim.last_eval_date.slice(0, 10)}T00:00:00`) : null,
        daily_available_hours: Number(sim.daily_available_hours ?? (kind === 'FFS_BAY' ? 20 : 16)),
        engine_avionics: sim.engine_avionics || '',
        software_load: sim.software_load || '',
        airac_cycle: sim.airac_cycle || '',
        visual_system: sim.visual_system || '',
        motion_system: sim.motion_system || '',
        control_loading: sim.control_loading || '',
        ios_config: sim.ios_config || '',
        status: sim.status || 'READY',
        power_on_hours: Number(sim.power_on_hours ?? 0),
        motion_hours: Number(sim.motion_hours ?? 0),
        visual_lamp_hours: Number(sim.visual_lamp_hours ?? 0),
        limitations_mel: sim.limitations_mel || '',
        notes: sim.notes || ''
      };

      // Auto-enable only the optional subsections that actually have data
      this.sections = {
        identity: kind === 'FFS_BAY' || Boolean(sim.serial_number),
        qualification: Boolean(sim.certificate_code || sim.certificate_expiry || sim.last_eval_date || (kind === 'FFS_BAY' && (sim.authority || sim.qualification_level))),
        hardware: Boolean(sim.engine_avionics || sim.software_load || sim.airac_cycle || sim.visual_system || sim.motion_system || sim.control_loading || sim.ios_config),
        opsNotes: Boolean(sim.limitations_mel || sim.notes || Number(sim.power_on_hours) > 0 || Number(sim.motion_hours) > 0 || Number(sim.visual_lamp_hours) > 0)
      };
    } else {
      this.applyKindPreset(defaultKind);
    }

    this.visible = true;
    this.cdr.markForCheck();
  }

  close(): void {
    this.visible = false;
    this.editingSim = null;
    this.cdr.markForCheck();
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close();
    }
  }

  private toDateOnlyString(d: Date | null): string | null {
    if (!d) return null;
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  private defaultAircraftForKind(kind: SimulatorStationKind): string {
    if (kind === 'TEST_PLACE') return 'CAE Test Place';
    if (kind === 'IOS_CONSOLE') return 'CAE IOS Console';
    return 'Full Flight Simulator';
  }

  save(): void {
    if (this.saving) return;
    if (!this.form.code.trim() || !this.form.name.trim() || !this.form.bay_code.trim()) {
      this.errorMsg = 'Station Code, Title, and Bay / Hall Code are required.';
      this.cdr.markForCheck();
      return;
    }

    const kind = this.form.station_kind;
    const fallbackAircraft = this.defaultAircraftForKind(kind);

    this.saving = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    const payload: any = {
      code: this.form.code.trim().toUpperCase(),
      name: this.form.name.trim(),
      bay_code: this.form.bay_code.trim().toUpperCase(),
      station_kind: kind,
      status: this.form.status,

      // Section 1: Identity & Platform Details (falls back to clean defaults when disabled)
      sort_order: this.sections.identity ? (Number(this.form.sort_order) || 100) : (Number(this.form.sort_order) || 100),
      platform_category: this.sections.identity
        ? this.form.platform_category
        : (kind === 'FFS_BAY' ? 'COMMERCIAL_FIXED_WING' : 'FTD_FNPT'),
      aircraft_type: this.sections.identity
        ? (this.form.aircraft_type.trim() || fallbackAircraft)
        : fallbackAircraft,
      manufacturer: this.sections.identity ? (this.form.manufacturer.trim() || 'CAE') : 'CAE',
      serial_number: this.sections.identity ? (this.form.serial_number.trim() || null) : null,
      daily_available_hours: this.sections.identity
        ? (Number(this.form.daily_available_hours) || 16)
        : (kind === 'FFS_BAY' ? 20 : 16),

      // Section 2: Qualification & Compliance
      authority: this.sections.qualification ? (this.form.authority.trim() || null) : null,
      qualification_level: this.sections.qualification ? (this.form.qualification_level.trim() || null) : null,
      certificate_code: this.sections.qualification ? (this.form.certificate_code.trim() || null) : null,
      certificate_expiry: this.sections.qualification ? this.toDateOnlyString(this.form.certificate_expiry) : null,
      last_eval_date: this.sections.qualification ? this.toDateOnlyString(this.form.last_eval_date) : null,

      // Section 3: Technical Hardware & Software Baseline
      engine_avionics: this.sections.hardware ? (this.form.engine_avionics.trim() || null) : null,
      software_load: this.sections.hardware ? (this.form.software_load.trim() || null) : null,
      airac_cycle: this.sections.hardware ? (this.form.airac_cycle.trim() || null) : null,
      visual_system: this.sections.hardware ? (this.form.visual_system.trim() || null) : null,
      motion_system: this.sections.hardware ? (this.form.motion_system.trim() || null) : null,
      control_loading: this.sections.hardware ? (this.form.control_loading.trim() || null) : null,
      ios_config: this.sections.hardware ? (this.form.ios_config.trim() || null) : null,

      // Section 4: Cumulative Counters, MEL & Notes
      power_on_hours: this.sections.opsNotes ? (Number(this.form.power_on_hours) || 0) : 0,
      motion_hours: this.sections.opsNotes ? (Number(this.form.motion_hours) || 0) : 0,
      visual_lamp_hours: this.sections.opsNotes ? (Number(this.form.visual_lamp_hours) || 0) : 0,
      limitations_mel: this.sections.opsNotes ? (this.form.limitations_mel.trim() || null) : null,
      notes: this.sections.opsNotes ? (this.form.notes.trim() || null) : null
    };

    if (!this.editingSim) {
      payload.scaffold_subsystems = this.sections.opsNotes
        ? this.form.scaffold_subsystems
        : kind === 'FFS_BAY';
      payload.scaffold_qtg = this.sections.opsNotes
        ? this.form.scaffold_qtg
        : kind === 'FFS_BAY';
    }

    const req$ = this.editingSim
      ? this.api.put<any>(`/simulators/${this.editingSim.id}`, payload)
      : this.api.post<any>('/simulators', payload);

    req$.subscribe({
      next: (res) => {
        this.saving = false;
        const sim = res?.data;
        this.toast.success(this.editingSim ? 'Station updated.' : 'New station added.');
        this.close();
        if (sim) this.saved.emit(sim);
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.message || 'Unable to save station.';
        this.cdr.markForCheck();
      }
    });
  }
}
