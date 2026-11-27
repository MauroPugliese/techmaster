import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Operation,
  ShiftUsageStatus,
  Simulator,
  SimulatorSchedulingMode,
  SimulatorStationKind,
  SimulatorStatus,
  TimelineMaintenanceBlock,
  TimelineShiftBlock
} from '../../../core/models/interfaces';
import {
  SCHEDULING_MODE_META,
  SHIFT_USAGE_STATUS_META,
  SIM_STATUS_META,
  computeOperatingWindowHours,
  resolveSimulatorSchedulingMode
} from '../../simulators/simulator-helpers';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';

interface PositionedSortie {
  op: Operation;
  leftPct: number;
  widthPct: number;
  topPx: number;
  toneClass: string;
  timeRangeLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  hasSnag: boolean;
  continuedFromPrev: boolean;
  continuesNextDay: boolean;
  durationLabel: string;
}

interface PositionedShiftBlock {
  block: TimelineShiftBlock;
  leftPct: number;
  widthPct: number;
  topPx: number;
  isBackground: boolean;
  toneClass: string;
  timeRangeLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  continuedFromPrev: boolean;
  continuesNextDay: boolean;
  durationLabel: string;
}

interface PositionedMaintenanceBlock {
  block: TimelineMaintenanceBlock;
  leftPct: number;
  widthPct: number;
  topPx: number;
  timeRangeLabel: string;
  durationLabel: string;
}

interface OffHoursBand {
  leftPct: number;
  widthPct: number;
}

interface SimLaneMeta {
  heightPx: number;
  bookedHours: number;
  availHours: number;
  utilPct: number;
  mode: SimulatorSchedulingMode;
  offBands: OffHoursBand[];
}

export interface TimelineHoverCard {
  kind: 'SORTIE' | 'SHIFT' | 'MAINTENANCE';
  badge: string;
  title: string;
  timeRange: string;
  duration: string;
  status: string;
  mission?: string;
  instructor?: string;
  pilots?: string;
  customer?: string;
  scenario?: string;
  weather?: string;
  notes?: string;
  x: number;
  y: number;
  placeAbove: boolean;
}

const KIND_ORDER: Record<SimulatorStationKind, number> = {
  FFS_BAY: 0,
  TEST_PLACE: 1,
  IOS_CONSOLE: 2
};

const ROW_STEP_PX = 48;
const TOP_PAD_PX = 7;

@Component({
  selector: 'app-sortie-bay-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent],
  templateUrl: './sortie-bay-timeline.component.html',
  styleUrls: ['./sortie-bay-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SortieBayTimelineComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('tlScroll') tlScroll?: ElementRef<HTMLDivElement>;

  @Input() simulators: Simulator[] = [];
  @Input() operations: Operation[] = [];
  @Input() shiftBlocks: TimelineShiftBlock[] = [];
  @Input() maintenanceBlocks: TimelineMaintenanceBlock[] = [];
  @Input() shiftStatusBySimulator: Record<number, ShiftUsageStatus> = {};
  @Input() selectedDate = SortieBayTimelineComponent.todayIso();
  @Input() canWrite = true;

  @Output() dateChange = new EventEmitter<string>();
  @Output() selectSortie = new EventEmitter<Operation>();
  @Output() selectShiftBlock = new EventEmitter<TimelineShiftBlock>();
  @Output() selectMaintenance = new EventEmitter<TimelineMaintenanceBlock>();
  @Output() scheduleSlot = new EventEmitter<{ simulatorId: number; simulator: Simulator; hour: number }>();
  @Output() openSimulator = new EventEmitter<number>();

  viewWindow: '24h' | 'prime' = '24h';
  hours: number[] = Array.from({ length: 24 }, (_, i) => i);

  sortedSimulators: Simulator[] = [];
  barsBySimulator = new Map<number, PositionedSortie[]>();
  shiftBarsBySimulator = new Map<number, PositionedShiftBlock[]>();
  maintBarsBySimulator = new Map<number, PositionedMaintenanceBlock[]>();
  laneMetaBySimulator = new Map<number, SimLaneMeta>();
  unassignedBars: PositionedSortie[] = [];
  unassignedHeightPx = 66;

  nowLinePct: number | null = null;
  nowPillPct: number | null = null;
  nowTimeLabel = '';
  daySortieCount = 0;
  dayShiftInUseCount = 0;
  dayShiftReadyCount = 0;
  dayMaintCount = 0;
  displayDateObj = new Date();
  hoverCard: TimelineHoverCard | null = null;

  private lastDateIso = '';
  private nowTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  static todayIso(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  ngOnInit(): void {
    this.nowTimer = setInterval(() => {
      this.updateNowMarker();
      this.cdr.markForCheck();
    }, 60_000);
  }

  ngOnChanges(_: SimpleChanges): void {
    this.hoverCard = null;
    this.rebuildTimeline();
  }

  ngOnDestroy(): void {
    if (this.nowTimer) {
      clearInterval(this.nowTimer);
      this.nowTimer = null;
    }
  }

  get viewStartMin(): number {
    return this.viewWindow === 'prime' ? 6 * 60 : 0;
  }

  get viewEndMin(): number {
    return this.viewWindow === 'prime' ? 22 * 60 : 24 * 60;
  }

  get viewSpanMin(): number {
    return this.viewEndMin - this.viewStartMin;
  }

  get isTodaySelected(): boolean {
    return this.selectedDate === SortieBayTimelineComponent.todayIso();
  }

  setViewWindow(mode: '24h' | 'prime'): void {
    if (this.viewWindow === mode) return;
    this.viewWindow = mode;
    this.hours = mode === 'prime'
      ? Array.from({ length: 16 }, (_, i) => i + 6)
      : Array.from({ length: 24 }, (_, i) => i);
    this.hoverCard = null;
    this.rebuildTimeline();
    this.cdr.markForCheck();
  }

  jumpToNow(): void {
    if (!this.tlScroll?.nativeElement || this.nowLinePct === null) return;
    const container = this.tlScroll.nativeElement;
    const bayColPx = 212;
    const trackWidth = Math.max(0, container.scrollWidth - bayColPx);
    const targetX = bayColPx + (this.nowLinePct / 100) * trackWidth - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' });
  }

  shiftDay(delta: number): void {
    const base = this.parseIsoDay(this.selectedDate);
    base.setDate(base.getDate() + delta);
    const next = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    this.dateChange.emit(next);
  }

  goToday(): void {
    this.dateChange.emit(SortieBayTimelineComponent.todayIso());
  }

  onDatePick(d: Date | null): void {
    if (!d) return;
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (next !== this.selectedDate) {
      this.dateChange.emit(next);
    }
  }

  modeMeta(sim: Simulator) {
    return SCHEDULING_MODE_META[resolveSimulatorSchedulingMode(sim)];
  }

  laneStatusBadge(sim: Simulator): { label: string; bg: string; color: string } {
    if (resolveSimulatorSchedulingMode(sim) === 'SHIFTS') {
      const shiftSt = this.shiftStatusBySimulator?.[sim.id];
      if (shiftSt && SHIFT_USAGE_STATUS_META[shiftSt]) {
        const m = SHIFT_USAGE_STATUS_META[shiftSt];
        return { label: m.label, bg: m.bg, color: m.color };
      }
    }
    return this.statusMeta(sim.status);
  }

  statusMeta(st?: SimulatorStatus) {
    return SIM_STATUS_META[st || 'READY'] || SIM_STATUS_META.READY;
  }

  hourLabel(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
  }

  slotCellTitle(sim: Simulator, h: number): string {
    const mode = resolveSimulatorSchedulingMode(sim);
    return mode === 'SHIFTS'
      ? `Log / edit shift on ${sim.bay_code} at ${this.hourLabel(h)}`
      : `Schedule sortie on ${sim.bay_code} at ${this.hourLabel(h)}`;
  }

  barsForSim(simId: number): PositionedSortie[] {
    return this.barsBySimulator.get(simId) || [];
  }

  shiftBarsForSim(simId: number): PositionedShiftBlock[] {
    return this.shiftBarsBySimulator.get(simId) || [];
  }

  maintBarsForSim(simId: number): PositionedMaintenanceBlock[] {
    return this.maintBarsBySimulator.get(simId) || [];
  }

  laneMeta(simId: number): SimLaneMeta {
    return this.laneMetaBySimulator.get(simId) || {
      heightPx: 66,
      bookedHours: 0,
      availHours: 16,
      utilPct: 0,
      mode: 'SORTIES',
      offBands: []
    };
  }

  // ── Rich Floating Hover Preview ────────────────────────────────────────────
  showSortieHover(bar: PositionedSortie, ev: MouseEvent): void {
    const op = bar.op;
    const pilots = [op.pilot_name, op.copilot_name].filter(Boolean).join(' / ');
    this.openHoverCard(ev, {
      kind: 'SORTIE',
      badge: op.sortie_code || op.type?.name || 'SORTIE',
      title: op.mission_name || op.title,
      timeRange: `${bar.continuedFromPrev ? '← ' : ''}${bar.timeRangeLabel}${bar.continuesNextDay ? ' → +1d' : ''}`,
      duration: bar.durationLabel,
      status: op.status || 'PLANNED',
      mission: op.mission_name && op.mission_name !== op.title ? op.title : undefined,
      instructor: op.instructor_name || undefined,
      pilots: pilots || undefined,
      customer: op.customer_operator || undefined,
      scenario: op.scenario_code || undefined,
      weather: op.weather_profile || undefined,
      notes: op.snag_summary || op.notes || undefined
    });
  }

  showShiftHover(sb: PositionedShiftBlock, ev: MouseEvent): void {
    const b = sb.block;
    const pilots = [b.pilot_name, b.copilot_name].filter(Boolean).join(' / ');
    this.openHoverCard(ev, {
      kind: 'SHIFT',
      badge: `${b.shift_name} · ${b.usage_status === 'IN_USE' ? 'IN USE' : b.usage_status}`,
      title: b.mission_name || (b.usage_status === 'NA' ? 'Station Not Available' : (b.usage_status === 'READY' ? 'Ready / Standby' : 'Active Shift Session')),
      timeRange: `${sb.continuedFromPrev ? '← -1d · ' : ''}${sb.timeRangeLabel}${sb.continuesNextDay ? ' → +1d' : ''}`,
      duration: sb.durationLabel,
      status: b.usage_status,
      instructor: b.instructor_name || undefined,
      pilots: pilots || undefined,
      scenario: b.scenario_code || undefined,
      weather: b.weather_profile || undefined,
      notes: b.notes || undefined
    });
  }

  showMaintHover(mb: PositionedMaintenanceBlock, ev: MouseEvent): void {
    this.openHoverCard(ev, {
      kind: 'MAINTENANCE',
      badge: mb.block.source === 'PLANNED_MAINT' ? 'PLANNED PM' : `MAINT · ${mb.block.severity || 'WO'}`,
      title: mb.block.title,
      timeRange: mb.timeRangeLabel,
      duration: mb.durationLabel,
      status: mb.block.status || 'SCHEDULED'
    });
  }

  clearHover(): void {
    if (this.hoverCard) {
      this.hoverCard = null;
      this.cdr.markForCheck();
    }
  }

  private openHoverCard(
    ev: MouseEvent,
    data: Omit<TimelineHoverCard, 'x' | 'y' | 'placeAbove'>
  ): void {
    const target = ev.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const cardW = 300;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

    let x = rect ? rect.left + rect.width / 2 - cardW / 2 : ev.clientX - cardW / 2;
    x = Math.max(12, Math.min(vw - cardW - 12, x));

    const spaceBelow = rect ? vh - rect.bottom : vh - ev.clientY;
    const placeAbove = spaceBelow < 210;
    const y = rect ? (placeAbove ? rect.top - 8 : rect.bottom + 8) : ev.clientY + 12;

    this.hoverCard = { ...data, x, y, placeAbove };
    this.cdr.markForCheck();
  }

  // ── Time & Geometry Helpers ────────────────────────────────────────────────
  private parseIsoDay(iso: string): Date {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  }

  private hhMmToMinutes(hhmm: string): number {
    const raw = String(hhmm || '00:00').trim();
    if (raw === '24:00') return 24 * 60;
    const parts = raw.split(':').map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) return 0;
    return Math.max(0, Math.min(24 * 60, parts[0] * 60 + parts[1]));
  }

  private fmtMinsDuration(mins: number): string {
    const m = Math.max(0, Math.round(mins));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0) return `${rem}m`;
    return rem === 0 ? `${h}h` : `${h}h ${String(rem).padStart(2, '0')}m`;
  }

  private projectRange(startMin: number, endMin: number): { leftPct: number; widthPct: number } | null {
    const vs = this.viewStartMin;
    const ve = this.viewEndMin;
    if (endMin <= vs || startMin >= ve) return null;
    const cs = Math.max(startMin, vs);
    const ce = Math.min(endMin, ve);
    const span = this.viewSpanMin;
    const leftPct = ((cs - vs) / span) * 100;
    const widthPct = Math.max(2.6, ((ce - cs) / span) * 100);
    return { leftPct, widthPct: Math.min(100 - leftPct, widthPct) };
  }

  private computeOffHoursBands(sim: Simulator): OffHoursBand[] {
    const mode = resolveSimulatorSchedulingMode(sim);
    const opStart = this.hhMmToMinutes(sim.schedule_config?.operating_start || (mode === 'SHIFTS' ? '06:30' : '06:00'));
    const opEnd = this.hhMmToMinutes(sim.schedule_config?.operating_end || (mode === 'SHIFTS' ? '18:00' : '22:00'));
    const bands: OffHoursBand[] = [];

    const pushInterval = (s: number, e: number) => {
      if (e <= s) return;
      const proj = this.projectRange(s, e);
      if (proj) bands.push(proj);
    };

    if (opEnd > opStart) {
      pushInterval(0, opStart);
      pushInterval(opEnd, 1440);
    } else if (opStart > opEnd) {
      // Overnight operating window: off-hours are strictly between opEnd and opStart
      pushInterval(opEnd, opStart);
    }
    return bands;
  }

  private updateNowMarker(): void {
    const dayStart = this.parseIsoDay(this.selectedDate);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 3600 * 1000;
    const now = new Date();
    if (now.getTime() >= dayStartMs && now.getTime() < dayEndMs) {
      const nowMin = (now.getTime() - dayStartMs) / 60000;
      if (nowMin >= this.viewStartMin && nowMin <= this.viewEndMin) {
        const pct = ((nowMin - this.viewStartMin) / this.viewSpanMin) * 100;
        this.nowLinePct = pct;
        this.nowPillPct = Math.min(96.5, Math.max(3.5, pct));
      } else {
        this.nowLinePct = null;
        this.nowPillPct = null;
      }
      this.nowTimeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    } else {
      this.nowLinePct = null;
      this.nowPillPct = null;
      this.nowTimeLabel = '';
    }
  }

  /**
   * Greedy interval packer: keeps back-to-back events on row 0 and stacks
   * genuinely overlapping intervals cleanly onto separate sub-rows.
   */
  private packIntervals<T extends { startMin: number; endMin: number; laneIndex: number }>(items: T[]): number {
    if (items.length === 0) return 1;
    const ordered = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const laneEnds: number[] = [];
    for (const item of ordered) {
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= item.startMin + 1) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(item.endMin);
      } else {
        laneEnds[assigned] = item.endMin;
      }
      item.laneIndex = assigned;
    }
    return Math.max(1, laneEnds.length);
  }

  private rebuildTimeline(): void {
    const dayStart = this.parseIsoDay(this.selectedDate);
    if (this.selectedDate !== this.lastDateIso) {
      this.lastDateIso = this.selectedDate;
      this.displayDateObj = dayStart;
    }
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 3600 * 1000;

    this.sortedSimulators = [...(this.simulators || [])].sort((a, b) => {
      const ma = resolveSimulatorSchedulingMode(a) === 'SORTIES' ? 0 : 1;
      const mb = resolveSimulatorSchedulingMode(b) === 'SORTIES' ? 0 : 1;
      if (ma !== mb) return ma - mb;
      const ka = KIND_ORDER[a.station_kind || 'FFS_BAY'] ?? 0;
      const kb = KIND_ORDER[b.station_kind || 'FFS_BAY'] ?? 0;
      if (ka !== kb) return ka - kb;
      const oa = Number(a.sort_order ?? 100);
      const ob = Number(b.sort_order ?? 100);
      if (oa !== ob) return oa - ob;
      return String(a.bay_code || a.code).localeCompare(String(b.bay_code || b.code));
    });

    const visibleSimIds = new Set(this.sortedSimulators.map((s) => s.id));
    this.updateNowMarker();

    type PackedWrapper = {
      kind: 'sortie' | 'shift' | 'maint';
      startMin: number;
      endMin: number;
      laneIndex: number;
      ref: any;
    };

    const wrappersBySim = new Map<number, PackedWrapper[]>();
    const bgShiftsBySim = new Map<number, PositionedShiftBlock[]>();
    const bookedMinBySim = new Map<number, number>();
    const unassignedWrappers: PackedWrapper[] = [];

    const addWrapper = (simId: number, w: PackedWrapper) => {
      const list = wrappersBySim.get(simId) || [];
      list.push(w);
      wrappersBySim.set(simId, list);
    };
    const addBooked = (simId: number, mins: number) => {
      bookedMinBySim.set(simId, (bookedMinBySim.get(simId) || 0) + Math.max(0, mins));
    };

    let sortieCount = 0;
    let shiftInUse = 0;
    let shiftReady = 0;
    let maintCount = 0;

    // 1. Formal Sortie Operations (exact local-time projection + cross-midnight badges)
    for (const op of this.operations || []) {
      if (!op.start_date) continue;
      const startMs = new Date(op.start_date).getTime();
      if (Number.isNaN(startMs)) continue;

      let endMs = op.end_date ? new Date(op.end_date).getTime() : NaN;
      if (Number.isNaN(endMs) || endMs <= startMs) {
        const hrs = op.scheduled_hours && Number(op.scheduled_hours) > 0 ? Number(op.scheduled_hours) : 2;
        endMs = startMs + hrs * 3600 * 1000;
      }

      if (endMs <= dayStartMs || startMs >= dayEndMs) continue;

      sortieCount += 1;
      const continuedFromPrev = startMs < dayStartMs;
      const continuesNextDay = endMs > dayEndMs;
      const startMin = Math.max(0, (startMs - dayStartMs) / 60000);
      const endMin = Math.min(1440, (endMs - dayStartMs) / 60000);

      if (op.simulator_id && op.status !== 'CANCELLED') {
        addBooked(Number(op.simulator_id), endMin - startMin);
      }

      const proj = this.projectRange(startMin, endMin);
      if (!proj) continue;

      const sDate = new Date(startMs);
      const eDate = new Date(endMs);
      const timeRangeLabel = `${String(sDate.getHours()).padStart(2, '0')}:${String(sDate.getMinutes()).padStart(2, '0')}–${String(eDate.getHours()).padStart(2, '0')}:${String(eDate.getMinutes()).padStart(2, '0')}`;
      const durationLabel = this.fmtMinsDuration((endMs - startMs) / 60000);
      const hasSnag = op.outcome === 'COMPLETED_WITH_SNAGS' || op.outcome === 'INTERRUPTED_TECH';
      const toneClass = this.resolveTone(op);

      const primaryLabel = op.mission_name || op.sortie_code || op.type?.name || 'SORTIE';
      const crewParts: string[] = [];
      if (op.instructor_name) crewParts.push(`I: ${op.instructor_name}`);
      const pilots = [op.pilot_name, op.copilot_name].filter(Boolean).join('/');
      if (pilots) crewParts.push(`P: ${pilots}`);
      const secondaryLabel = crewParts.length > 0
        ? crewParts.join(' · ')
        : `${op.customer_operator ? `${op.customer_operator} · ` : ''}${op.title}`;

      const bar: PositionedSortie = {
        op,
        leftPct: proj.leftPct,
        widthPct: proj.widthPct,
        topPx: TOP_PAD_PX,
        toneClass,
        timeRangeLabel,
        primaryLabel,
        secondaryLabel,
        hasSnag,
        continuedFromPrev,
        continuesNextDay,
        durationLabel
      };

      const wrap: PackedWrapper = { kind: 'sortie', startMin, endMin, laneIndex: 0, ref: bar };
      if (op.simulator_id) {
        addWrapper(Number(op.simulator_id), wrap);
      } else {
        unassignedWrappers.push(wrap);
      }
    }

    // 2. Daily Station Shift Blocks (SHIFTS-mode simulators, including cross-midnight splits)
    for (const block of this.shiftBlocks || []) {
      const simId = Number(block.simulator_id);
      if (!simId || !visibleSimIds.has(simId)) continue;

      const startMin = this.hhMmToMinutes(block.start_time);
      let endMin = this.hhMmToMinutes(block.end_time);
      let continuesNextDay = Boolean(block.continues_next_day);
      const continuedFromPrev = Boolean(block.continued_from_prev_day);

      if (endMin <= startMin && block.end_time !== '24:00') {
        if (block.block_kind === 'SHIFT_IN_USE' && block.end_time !== '00:00') {
          endMin = 1440;
          continuesNextDay = true;
        } else {
          endMin = Math.min(1440, startMin + 60);
        }
      }

      if (block.block_kind === 'SHIFT_IN_USE') {
        shiftInUse += 1;
        addBooked(simId, endMin - startMin);
      } else if (block.block_kind === 'SHIFT_READY') {
        shiftReady += 1;
      }

      const proj = this.projectRange(startMin, endMin);
      if (!proj) continue;

      const dispStart = block.display_start_time || block.start_time;
      const dispEnd = block.display_end_time || block.end_time;
      const timeRangeLabel = `${dispStart}–${dispEnd}`;
      const durationLabel = this.fmtMinsDuration(block.duration_minutes || (endMin - startMin));

      let toneClass = 'tone-shift-ready';
      let primaryLabel = 'READY';
      if (block.block_kind === 'SHIFT_IN_USE') {
        toneClass = 'tone-shift-in-use';
        primaryLabel = block.mission_name ? `${block.shift_name} · ${block.mission_name}` : `${block.shift_name} · IN USE`;
      } else if (block.block_kind === 'SHIFT_NA') {
        toneClass = 'tone-shift-na';
        primaryLabel = `${block.shift_name} · NA`;
      }

      const crewBits: string[] = [];
      if (block.instructor_name) crewBits.push(`I: ${block.instructor_name}`);
      const pilots = [block.pilot_name, block.copilot_name].filter(Boolean).join('/');
      if (pilots) crewBits.push(`P: ${pilots}`);
      const secondaryLabel = crewBits.length > 0
        ? crewBits.join(' · ')
        : (block.notes || (block.block_kind === 'SHIFT_READY' ? 'Ready for testing' : (block.block_kind === 'SHIFT_NA' ? 'Not available' : 'Active shift')));

      const isBackground = block.block_kind === 'SHIFT_READY';
      const posBlock: PositionedShiftBlock = {
        block,
        leftPct: proj.leftPct,
        widthPct: proj.widthPct,
        topPx: TOP_PAD_PX,
        isBackground,
        toneClass,
        timeRangeLabel,
        primaryLabel,
        secondaryLabel,
        continuedFromPrev,
        continuesNextDay,
        durationLabel
      };

      if (isBackground) {
        const list = bgShiftsBySim.get(simId) || [];
        list.push(posBlock);
        bgShiftsBySim.set(simId, list);
      } else {
        addWrapper(simId, { kind: 'shift', startMin, endMin, laneIndex: 0, ref: posBlock });
      }
    }

    // 3. Maintenance Windows (exact local time when ISO timestamps are present)
    for (const mb of this.maintenanceBlocks || []) {
      const simId = Number(mb.simulator_id);
      if (!simId || !visibleSimIds.has(simId)) continue;

      let startMin: number;
      let endMin: number;
      let timeRangeLabel = `${mb.start_time}–${mb.end_time}`;

      if (mb.start_date && mb.end_date) {
        const sMs = new Date(mb.start_date).getTime();
        const eMs = new Date(mb.end_date).getTime();
        if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs <= dayStartMs || sMs >= dayEndMs) continue;
        startMin = Math.max(0, (sMs - dayStartMs) / 60000);
        endMin = Math.min(1440, (eMs - dayStartMs) / 60000);
        const sLocal = new Date(sMs);
        const eLocal = new Date(eMs);
        timeRangeLabel = `${String(sLocal.getHours()).padStart(2, '0')}:${String(sLocal.getMinutes()).padStart(2, '0')}–${String(eLocal.getHours()).padStart(2, '0')}:${String(eLocal.getMinutes()).padStart(2, '0')}`;
      } else {
        startMin = this.hhMmToMinutes(mb.start_time);
        endMin = this.hhMmToMinutes(mb.end_time);
        if (endMin <= startMin) endMin = Math.min(1440, startMin + 90);
      }

      maintCount += 1;
      const proj = this.projectRange(startMin, endMin);
      if (!proj) continue;

      const posMaint: PositionedMaintenanceBlock = {
        block: mb,
        leftPct: proj.leftPct,
        widthPct: proj.widthPct,
        topPx: TOP_PAD_PX,
        timeRangeLabel,
        durationLabel: this.fmtMinsDuration(endMin - startMin)
      };

      addWrapper(simId, { kind: 'maint', startMin, endMin, laneIndex: 0, ref: posMaint });
    }

    // 4. Pack Sub-Lanes per Simulator (Zero Overlaps!) & Compute Utilization
    const nextSortieMap = new Map<number, PositionedSortie[]>();
    const nextShiftMap = new Map<number, PositionedShiftBlock[]>();
    const nextMaintMap = new Map<number, PositionedMaintenanceBlock[]>();
    const nextMetaMap = new Map<number, SimLaneMeta>();

    for (const sim of this.sortedSimulators) {
      const simId = sim.id;
      const wraps = wrappersBySim.get(simId) || [];
      const rowCount = this.packIntervals(wraps);
      const heightPx = Math.max(66, rowCount * ROW_STEP_PX + TOP_PAD_PX * 2);

      const sBars: PositionedSortie[] = [];
      const shBars: PositionedShiftBlock[] = [...(bgShiftsBySim.get(simId) || [])];
      const mBars: PositionedMaintenanceBlock[] = [];

      for (const w of wraps) {
        w.ref.topPx = TOP_PAD_PX + w.laneIndex * ROW_STEP_PX;
        if (w.kind === 'sortie') sBars.push(w.ref);
        else if (w.kind === 'shift') shBars.push(w.ref);
        else mBars.push(w.ref);
      }

      const mode = resolveSimulatorSchedulingMode(sim);
      const cfg = sim.schedule_config;
      const availHours = cfg?.operating_start && cfg?.operating_end
        ? computeOperatingWindowHours(cfg.operating_start, cfg.operating_end)
        : (Number(sim.daily_available_hours) || (mode === 'SHIFTS' ? 12 : 16));
      const bookedHours = Math.round(((bookedMinBySim.get(simId) || 0) / 60) * 10) / 10;
      const utilPct = availHours > 0 ? Math.min(100, Math.round((bookedHours / availHours) * 100)) : 0;

      nextSortieMap.set(simId, sBars);
      nextShiftMap.set(simId, shBars);
      nextMaintMap.set(simId, mBars);
      nextMetaMap.set(simId, {
        heightPx,
        bookedHours,
        availHours,
        utilPct,
        mode,
        offBands: this.computeOffHoursBands(sim)
      });
    }

    // Pack unassigned sorties
    const unassignedRows = this.packIntervals(unassignedWrappers);
    this.unassignedHeightPx = Math.max(66, unassignedRows * ROW_STEP_PX + TOP_PAD_PX * 2);
    this.unassignedBars = unassignedWrappers.map(w => {
      w.ref.topPx = TOP_PAD_PX + w.laneIndex * ROW_STEP_PX;
      return w.ref;
    });

    this.barsBySimulator = nextSortieMap;
    this.shiftBarsBySimulator = nextShiftMap;
    this.maintBarsBySimulator = nextMaintMap;
    this.laneMetaBySimulator = nextMetaMap;
    this.daySortieCount = sortieCount;
    this.dayShiftInUseCount = shiftInUse;
    this.dayShiftReadyCount = shiftReady;
    this.dayMaintCount = maintCount;
  }

  private resolveTone(op: Operation): string {
    if (op.status === 'CANCELLED') return 'tone-cancelled';
    if (op.outcome === 'INTERRUPTED_TECH') return 'tone-tech-abort';
    if (op.outcome === 'COMPLETED_WITH_SNAGS') return 'tone-snag';
    if (op.status === 'IN_PROGRESS') return 'tone-live';
    if (op.status === 'COMPLETED' || op.outcome === 'CLEAN') return 'tone-clean';
    if (op.status === 'ON_HOLD') return 'tone-hold';
    return 'tone-planned';
  }

  trackBySimId(_: number, s: Simulator): number { return s.id; }
  trackByBarId(_: number, b: PositionedSortie): number { return b.op.id; }
  trackByShiftBlockId(_: number, b: PositionedShiftBlock): string { return b.block.id; }
  trackByMaintBlockId(_: number, b: PositionedMaintenanceBlock): string { return b.block.id; }
}
