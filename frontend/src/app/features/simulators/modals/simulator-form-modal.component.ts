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
  SimulatorScheduleConfig,
  SimulatorSchedulingMode,
  SimulatorShiftPreset,
  SimulatorSlotPreset,
  SimulatorStationKind,
  SimulatorStatus
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import {
  buildDefaultScheduleConfig,
  computeOperatingWindowHours,
  resolveSimulatorSchedulingMode
} from '../simulator-helpers';

interface SectionToggles {
  identity: boolean;
  qualification: boolean;
  hardware: boolean;
  opsNotes: boolean;
}

@Component({
  selector: 'app-simulator-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent, DateTimePickerComponent, TimePickerComponent],
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
    scheduling_mode: SimulatorSchedulingMode;
    operating_start: string;
    operating_end: string;
    default_slot_hours: number;
    turnaround_minutes: number;
    slot_presets: SimulatorSlotPreset[];
    shift_presets: SimulatorShiftPreset[];
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
    const defCfg = buildDefaultScheduleConfig('SHIFTS');
    return {
      code: '',
      name: '',
      bay_code: '',
      station_kind: 'TEST_PLACE' as SimulatorStationKind,
      scheduling_mode: 'SHIFTS' as SimulatorSchedulingMode,
      operating_start: defCfg.operating_start,
      operating_end: defCfg.operating_end,
      default_slot_hours: defCfg.default_slot_hours,
      turnaround_minutes: defCfg.turnaround_minutes,
      slot_presets: [...(defCfg.slot_presets || [])],
      shift_presets: [...(defCfg.shift_presets || [])],
      sort_order: 1,
      platform_category: 'FTD_FNPT' as SimulatorPlatformCategory,
      aircraft_type: '',
      manufacturer: 'FSTD OEM',
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
      const cfg = buildDefaultScheduleConfig('SHIFTS');
      base.station_kind = 'TEST_PLACE';
      base.scheduling_mode = 'SHIFTS';
      base.operating_start = cfg.operating_start;
      base.operating_end = cfg.operating_end;
      base.default_slot_hours = cfg.default_slot_hours;
      base.turnaround_minutes = cfg.turnaround_minutes;
      base.slot_presets = [];
      base.shift_presets = (cfg.shift_presets || []).map(p => ({ ...p }));
      base.sort_order = nextNum;
      base.code = `TP-${pad2}`;
      base.name = `TEST PLACE ${nextNum}`;
      base.bay_code = `TPS-${pad2}`;
      base.platform_category = 'FTD_FNPT';
      base.aircraft_type = 'Test Place';
      base.daily_available_hours = computeOperatingWindowHours(cfg.operating_start, cfg.operating_end);
      base.scaffold_subsystems = false;
      base.scaffold_qtg = false;
      this.sections = { identity: false, qualification: false, hardware: false, opsNotes: false };
    } else if (kind === 'IOS_CONSOLE') {
      const cfg = buildDefaultScheduleConfig('SHIFTS');
      base.station_kind = 'IOS_CONSOLE';
      base.scheduling_mode = 'SHIFTS';
      base.operating_start = cfg.operating_start;
      base.operating_end = cfg.operating_end;
      base.default_slot_hours = cfg.default_slot_hours;
      base.turnaround_minutes = cfg.turnaround_minutes;
      base.slot_presets = [];
      base.shift_presets = (cfg.shift_presets || []).map(p => ({ ...p }));
      base.sort_order = nextNum;
      base.code = `IOS-${pad2}`;
      base.name = `IOS CONSOLE ${nextNum}`;
      base.bay_code = `IOS-${pad2}`;
      base.platform_category = 'FTD_FNPT';
      base.aircraft_type = 'IOS Console';
      base.daily_available_hours = computeOperatingWindowHours(cfg.operating_start, cfg.operating_end);
      base.scaffold_subsystems = false;
      base.scaffold_qtg = false;
      this.sections = { identity: false, qualification: false, hardware: false, opsNotes: false };
    } else {
      const cfg = buildDefaultScheduleConfig('SORTIES');
      base.station_kind = 'FFS_BAY';
      base.scheduling_mode = 'SORTIES';
      base.operating_start = cfg.operating_start;
      base.operating_end = cfg.operating_end;
      base.default_slot_hours = cfg.default_slot_hours;
      base.turnaround_minutes = cfg.turnaround_minutes;
      base.slot_presets = (cfg.slot_presets || []).map(p => ({ ...p }));
      base.shift_presets = [];
      base.sort_order = nextNum;
      base.platform_category = 'COMMERCIAL_FIXED_WING';
      base.manufacturer = 'FSTD Series';
      base.daily_available_hours = computeOperatingWindowHours(cfg.operating_start, cfg.operating_end);
      base.visual_system = 'Collimated Visual · Laser Projection';
      base.motion_system = '6-DOF Electric Motion';
      base.control_loading = 'Digital Control Loading System';
      base.ios_config = 'Dual-Screen Instructor Operating Station';
      base.scaffold_subsystems = true;
      base.scaffold_qtg = true;
      this.sections = { identity: true, qualification: false, hardware: false, opsNotes: false };
    }

    this.form = base;
  }

  selectSchedulingMode(mode: SimulatorSchedulingMode): void {
    if (this.form.scheduling_mode === mode) return;
    const def = buildDefaultScheduleConfig(mode);
    const nextSlotPresets = mode === 'SORTIES'
      ? (this.form.slot_presets.length > 0 ? this.form.slot_presets : (def.slot_presets || []).map(p => ({ ...p })))
      : this.form.slot_presets;
    const nextShiftPresets = mode === 'SHIFTS'
      ? (this.form.shift_presets.length > 0 ? this.form.shift_presets : (def.shift_presets || []).map(p => ({ ...p })))
      : this.form.shift_presets;
    this.form = {
      ...this.form,
      scheduling_mode: mode,
      default_slot_hours: mode === 'SORTIES' ? (this.form.default_slot_hours || 4) : (this.form.default_slot_hours || 6),
      slot_presets: nextSlotPresets,
      shift_presets: nextShiftPresets
    };
    this.cdr.markForCheck();
  }

  onOperatingHoursChange(): void {
    const hrs = computeOperatingWindowHours(this.form.operating_start, this.form.operating_end);
    this.form = { ...this.form, daily_available_hours: hrs };
    this.cdr.markForCheck();
  }

  addSlotPreset(): void {
    if (this.form.slot_presets.length >= 12) return;
    const last = this.form.slot_presets[this.form.slot_presets.length - 1];
    const start = last?.end && last.end !== '24:00' ? last.end : this.form.operating_start || '08:00';
    const [sh, sm] = start.split(':').map(Number);
    const durMin = Math.round((Number(this.form.default_slot_hours) || 4) * 60);
    const endTotal = Math.min(23 * 60 + 45, (sh * 60 + sm) + durMin);
    const end = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
    this.form = {
      ...this.form,
      slot_presets: [...this.form.slot_presets, { label: `${start}–${end}`, start, end }]
    };
    this.cdr.markForCheck();
  }

  removeSlotPreset(index: number): void {
    this.form = {
      ...this.form,
      slot_presets: this.form.slot_presets.filter((_, i) => i !== index)
    };
    this.cdr.markForCheck();
  }

  updateSlotPresetTime(index: number, field: 'start' | 'end', val: string): void {
    this.form = {
      ...this.form,
      slot_presets: this.form.slot_presets.map((p, i) => {
        if (i !== index) return p;
        const next = { ...p, [field]: val || '00:00' };
        next.label = `${next.start}–${next.end}`;
        return next;
      })
    };
    this.cdr.markForCheck();
  }

  addShiftPreset(): void {
    if (this.form.shift_presets.length >= 6) return;
    const nextNum = this.form.shift_presets.length + 1;
    const defaults: Record<number, SimulatorShiftPreset> = {
      1: { name: 'SHIFT 1', start: '07:00', end: '13:00', pre_flight: '06:40' },
      2: { name: 'SHIFT 2', start: '13:30', end: '19:30', pre_flight: '13:00' },
      3: { name: 'SHIFT 3', start: '20:00', end: '02:00', pre_flight: '19:40' }
    };
    const item = defaults[nextNum] || { name: `SHIFT ${nextNum}`, start: '08:00', end: '14:00', pre_flight: '07:40' };
    this.form = {
      ...this.form,
      shift_presets: [...this.form.shift_presets, item]
    };
    this.cdr.markForCheck();
  }

  removeShiftPreset(index: number): void {
    this.form = {
      ...this.form,
      shift_presets: this.form.shift_presets.filter((_, i) => i !== index)
    };
    this.cdr.markForCheck();
  }

  get computedOperatingHours(): number {
    return computeOperatingWindowHours(this.form.operating_start, this.form.operating_end);
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
      const mode = resolveSimulatorSchedulingMode(sim);
      const defCfg = buildDefaultScheduleConfig(mode);
      const cfg: SimulatorScheduleConfig = {
        ...defCfg,
        ...(sim.schedule_config || {})
      };
      this.form = {
        ...base,
        code: sim.code || '',
        name: sim.name || '',
        bay_code: sim.bay_code || '',
        station_kind: kind,
        scheduling_mode: mode,
        operating_start: cfg.operating_start || defCfg.operating_start,
        operating_end: cfg.operating_end || defCfg.operating_end,
        default_slot_hours: Number(cfg.default_slot_hours ?? defCfg.default_slot_hours),
        turnaround_minutes: Number(cfg.turnaround_minutes ?? 0),
        slot_presets: Array.isArray(cfg.slot_presets) && cfg.slot_presets.length > 0
          ? cfg.slot_presets.map(p => ({ ...p }))
          : (mode === 'SORTIES' ? (defCfg.slot_presets || []).map(p => ({ ...p })) : []),
        shift_presets: Array.isArray(cfg.shift_presets) && cfg.shift_presets.length > 0
          ? cfg.shift_presets.map(p => ({ ...p }))
          : (mode === 'SHIFTS' ? (defCfg.shift_presets || []).map(p => ({ ...p })) : []),
        sort_order: Number(sim.sort_order ?? 100),
        platform_category: sim.platform_category || 'COMMERCIAL_FIXED_WING',
        aircraft_type: sim.aircraft_type || '',
        manufacturer: sim.manufacturer || 'OEM',
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

      // Auto-enable every optional subsection that has populated data (prevents silent data loss on edit)
      this.sections = {
        identity: Boolean(sim.aircraft_type || sim.manufacturer || sim.serial_number || sim.daily_available_hours || sim.platform_category),
        qualification: Boolean(sim.certificate_code || sim.certificate_expiry || sim.last_eval_date || sim.authority || sim.qualification_level),
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
    if (kind === 'TEST_PLACE') return 'Test Place';
    if (kind === 'IOS_CONSOLE') return 'IOS Console';
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
    const isEdit = Boolean(this.editingSim);

    this.saving = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    const scheduleConfig: SimulatorScheduleConfig = {
      operating_start: this.form.operating_start || '06:00',
      operating_end: this.form.operating_end || '22:00',
      default_slot_hours: Number(this.form.default_slot_hours) || (this.form.scheduling_mode === 'SORTIES' ? 4 : 6),
      turnaround_minutes: Number(this.form.turnaround_minutes) || 0,
      slot_presets: this.form.scheduling_mode === 'SORTIES'
        ? this.form.slot_presets.map(p => ({ label: p.label || `${p.start}–${p.end}`, start: p.start, end: p.end }))
        : [],
      shift_presets: this.form.scheduling_mode === 'SHIFTS'
        ? this.form.shift_presets.map((p, idx) => ({
            name: (p.name || `SHIFT ${idx + 1}`).trim().toUpperCase(),
            start: p.start,
            end: p.end,
            pre_flight: p.pre_flight || p.start
          }))
        : []
    };

    const payload: any = {
      code: this.form.code.trim().toUpperCase(),
      name: this.form.name.trim(),
      bay_code: this.form.bay_code.trim().toUpperCase(),
      station_kind: kind,
      scheduling_mode: this.form.scheduling_mode,
      schedule_config: scheduleConfig,
      daily_available_hours: this.sections.identity
        ? (Number(this.form.daily_available_hours) || this.computedOperatingHours)
        : this.computedOperatingHours,
      status: this.form.status
    };

    // Section 1: Identity & Platform Details — on edit, omit when collapsed so existing DB values are preserved
    if (this.sections.identity || !isEdit) {
      payload.sort_order = Number(this.form.sort_order) || 100;
      payload.platform_category = this.sections.identity
        ? this.form.platform_category
        : (kind === 'FFS_BAY' ? 'COMMERCIAL_FIXED_WING' : 'FTD_FNPT');
      payload.aircraft_type = this.sections.identity
        ? (this.form.aircraft_type.trim() || fallbackAircraft)
        : fallbackAircraft;
      payload.manufacturer = this.sections.identity
        ? (this.form.manufacturer.trim() || null)
        : null;
      payload.serial_number = this.sections.identity ? (this.form.serial_number.trim() || null) : null;
      payload.daily_available_hours = this.sections.identity
        ? (Number(this.form.daily_available_hours) || 16)
        : (kind === 'FFS_BAY' ? 20 : 16);
    }

    // Section 2: Qualification & Compliance
    if (this.sections.qualification || !isEdit) {
      payload.authority = this.sections.qualification ? (this.form.authority.trim() || null) : null;
      payload.qualification_level = this.sections.qualification ? (this.form.qualification_level.trim() || null) : null;
      payload.certificate_code = this.sections.qualification ? (this.form.certificate_code.trim() || null) : null;
      payload.certificate_expiry = this.sections.qualification ? this.toDateOnlyString(this.form.certificate_expiry) : null;
      payload.last_eval_date = this.sections.qualification ? this.toDateOnlyString(this.form.last_eval_date) : null;
    }

    // Section 3: Technical Hardware & Software Baseline
    if (this.sections.hardware || !isEdit) {
      payload.engine_avionics = this.sections.hardware ? (this.form.engine_avionics.trim() || null) : null;
      payload.software_load = this.sections.hardware ? (this.form.software_load.trim() || null) : null;
      payload.airac_cycle = this.sections.hardware ? (this.form.airac_cycle.trim() || null) : null;
      payload.visual_system = this.sections.hardware ? (this.form.visual_system.trim() || null) : null;
      payload.motion_system = this.sections.hardware ? (this.form.motion_system.trim() || null) : null;
      payload.control_loading = this.sections.hardware ? (this.form.control_loading.trim() || null) : null;
      payload.ios_config = this.sections.hardware ? (this.form.ios_config.trim() || null) : null;
    }

    // Section 4: Cumulative Counters, MEL & Notes
    if (this.sections.opsNotes || !isEdit) {
      payload.power_on_hours = this.sections.opsNotes ? (Number(this.form.power_on_hours) || 0) : 0;
      payload.motion_hours = this.sections.opsNotes ? (Number(this.form.motion_hours) || 0) : 0;
      payload.visual_lamp_hours = this.sections.opsNotes ? (Number(this.form.visual_lamp_hours) || 0) : 0;
      payload.limitations_mel = this.sections.opsNotes ? (this.form.limitations_mel.trim() || null) : null;
      payload.notes = this.sections.opsNotes ? (this.form.notes.trim() || null) : null;
    }

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
