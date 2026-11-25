import {
  QtgStatus,
  ShiftUsageStatus,
  SimulatorPlatformCategory,
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
