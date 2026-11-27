import {
  QtgStatus,
  ShiftUsageStatus,
  Simulator,
  SimulatorPlatformCategory,
  SimulatorScheduleConfig,
  SimulatorSchedulingMode,
  SimulatorStationKind,
  SimulatorStatus,
  SimulatorSubsystemCode,
  SimulatorSubsystemStatus
} from '../../core/models/interfaces';

export interface BadgeStyle {
  label: string;
  bg: string;
  color: string;
  border?: string;
}

export const STATION_KIND_LABELS: Record<SimulatorStationKind, string> = {
  TEST_PLACE: 'Test Place',
  IOS_CONSOLE: 'IOS Console',
  FFS_BAY: 'FFS Simulator Bay'
};

export const SCHEDULING_MODE_META: Record<SimulatorSchedulingMode, { label: string; short: string; icon: string; bg: string; color: string; border: string }> = {
  SORTIES: { label: 'Sorties', short: 'SORTIES', icon: 'flight_takeoff', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  SHIFTS:  { label: 'Shifts',  short: 'SHIFTS',  icon: 'schedule',       bg: '#ECFEFF', color: '#0F766E', border: '#A5F3FC' }
};

export function resolveSimulatorSchedulingMode(sim?: Partial<Simulator> | null): SimulatorSchedulingMode {
  if (sim?.scheduling_mode === 'SORTIES' || sim?.scheduling_mode === 'SHIFTS') {
    return sim.scheduling_mode;
  }
  const kind = sim?.station_kind || 'FFS_BAY';
  return (kind === 'TEST_PLACE' || kind === 'IOS_CONSOLE') ? 'SHIFTS' : 'SORTIES';
}

export function buildDefaultScheduleConfig(mode: SimulatorSchedulingMode): SimulatorScheduleConfig {
  if (mode === 'SHIFTS') {
    return {
      operating_start: '06:30',
      operating_end: '18:00',
      default_slot_hours: 6,
      turnaround_minutes: 0,
      slot_presets: [],
      shift_presets: [
        { name: 'SHIFT 1', start: '07:00', end: '13:00', pre_flight: '06:40' },
        { name: 'SHIFT 2', start: '13:30', end: '19:30', pre_flight: '13:00' }
      ]
    };
  }
  return {
    operating_start: '06:00',
    operating_end: '22:00',
    default_slot_hours: 4,
    turnaround_minutes: 0,
    slot_presets: [
      { label: '06:00–10:00', start: '06:00', end: '10:00' },
      { label: '10:00–14:00', start: '10:00', end: '14:00' },
      { label: '14:00–18:00', start: '14:00', end: '18:00' },
      { label: '18:00–22:00', start: '18:00', end: '22:00' }
    ],
    shift_presets: []
  };
}

export function computeOperatingWindowHours(startHhMm?: string, endHhMm?: string): number {
  const parse = (v?: string): number | null => {
    const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };
  const s = parse(startHhMm);
  const e = parse(endHhMm);
  if (s === null || e === null || s === e) return 16;
  const diffMin = e > s ? (e - s) : (24 * 60 - s + e);
  return Math.max(1, Math.round((diffMin / 60) * 2) / 2);
}

export const SHIFT_USAGE_STATUS_META: Record<ShiftUsageStatus, { label: string; bg: string; color: string; dot: string; border: string }> = {
  IN_USE: { label: 'IN USE', bg: '#E0F2FE', color: '#0369A1', dot: '#0288D1', border: '#7DD3FC' },
  READY:  { label: 'READY',  bg: '#DCFCE7', color: '#15803D', dot: '#16A34A', border: '#86EFAC' },
  NA:     { label: 'NA',     bg: '#FEE2E2', color: '#B91C1C', dot: '#DC2626', border: '#FCA5A5' }
};

export function formatMinutesHhMm(minutes?: number | null): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m === 0) return '0:00';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${String(rem).padStart(2, '0')}m`;
}

export const SIM_CATEGORY_LABELS: Record<SimulatorPlatformCategory, string> = {
  COMMERCIAL_FIXED_WING: 'Commercial Fixed-Wing',
  ROTORCRAFT: 'Rotorcraft / Helicopter',
  DEFENSE_FMS: 'Defense / Full Mission',
  FTD_FNPT: 'FTD / FNPT Fixed-Base'
};

export const SIM_STATUS_META: Record<SimulatorStatus, BadgeStyle> = {
  READY:       { label: 'Ready',       bg: '#DCFCE7', color: '#15803D', border: '#86EFAC' },
  IN_SORTIE:   { label: 'In Sortie',   bg: '#DBEAFE', color: '#1D4ED8', border: '#93C5FD' },
  PRE_FLIGHT:  { label: 'Pre-Flight',  bg: '#E0F2FE', color: '#0369A1', border: '#7DD3FC' },
  DEGRADED:    { label: 'Degraded',    bg: '#FEF3C7', color: '#B45309', border: '#FCD34D' },
  MAINTENANCE: { label: 'Maintenance', bg: '#FFF7ED', color: '#C2410C', border: '#FDBA74' },
  AOG:         { label: 'AOG / Down',  bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' }
};

export const SUBSYSTEM_STATUS_META: Record<SimulatorSubsystemStatus, BadgeStyle> = {
  NOMINAL:     { label: 'Nominal',     bg: '#DCFCE7', color: '#15803D' },
  DEGRADED:    { label: 'Degraded',    bg: '#FEF3C7', color: '#B45309' },
  FAULT:       { label: 'Fault',       bg: '#FEE2E2', color: '#B91C1C' },
  MAINTENANCE: { label: 'Maintenance', bg: '#E0F2FE', color: '#0369A1' }
};

export const QTG_STATUS_META: Record<QtgStatus, BadgeStyle> = {
  PENDING:        { label: 'Pending',        bg: '#F1F5F9', color: '#475569' },
  PASSED:         { label: 'Passed',         bg: '#DCFCE7', color: '#15803D' },
  TOLERANCE_WARN: { label: 'Tolerance Warn', bg: '#FEF3C7', color: '#B45309' },
  FAILED:         { label: 'Failed',         bg: '#FEE2E2', color: '#B91C1C' }
};

export const SUBSYSTEM_META: Record<SimulatorSubsystemCode, { label: string; icon: string }> = {
  VISUAL:           { label: 'Visual Display & Projectors', icon: 'visibility' },
  MOTION:           { label: 'Motion System (6-DOF)',       icon: 'vibration' },
  CONTROL_LOADING:  { label: 'Control Loading (CLS)',       icon: 'tune' },
  AVIONICS_COCKPIT: { label: 'Avionics & Cockpit',          icon: 'speed' },
  IOS:              { label: 'Instructor Station (IOS)',    icon: 'desktop_windows' },
  HOST_COMPUTE:     { label: 'Host Compute & SimCore',      icon: 'dns' },
  SOUND:            { label: '3D Sound & Comms',            icon: 'volume_up' },
  HVAC_POWER:       { label: 'Bay Power & Chiller HVAC',    icon: 'bolt' }
};

export const SUBSYSTEM_OPTIONS: Array<{ code: SimulatorSubsystemCode; label: string }> = [
  { code: 'VISUAL', label: 'Visual Display & Projectors' },
  { code: 'MOTION', label: 'Motion System (6-DOF)' },
  { code: 'CONTROL_LOADING', label: 'Control Loading (CLS)' },
  { code: 'AVIONICS_COCKPIT', label: 'Avionics & Cockpit' },
  { code: 'IOS', label: 'Instructor Station (IOS)' },
  { code: 'HOST_COMPUTE', label: 'Host Compute & SimCore' },
  { code: 'SOUND', label: '3D Sound & Comms' },
  { code: 'HVAC_POWER', label: 'Bay Power & Chiller HVAC' }
];

export function formatCertExpiryBadge(cert?: { status: string; daysRemaining: number | null } | null): { label: string; tone: string } {
  if (!cert || cert.status === 'UNSET') return { label: 'No Expiry Set', tone: 'neutral' };
  if (cert.status === 'EXPIRED') {
    const abs = Math.abs(cert.daysRemaining ?? 0);
    return { label: `Expired ${abs}d ago`, tone: 'danger' };
  }
  if (cert.status === 'EXPIRING_SOON') {
    return { label: `Expires in ${cert.daysRemaining ?? 0}d`, tone: 'warning' };
  }
  return { label: `Valid (${cert.daysRemaining ?? 0}d)`, tone: 'success' };
}
