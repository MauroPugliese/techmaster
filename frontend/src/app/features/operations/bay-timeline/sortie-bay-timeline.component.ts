import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Operation,
  ShiftUsageStatus,
  Simulator,
  SimulatorStationKind,
  SimulatorStatus,
  TimelineMaintenanceBlock,
  TimelineShiftBlock
} from '../../../core/models/interfaces';
import { SHIFT_USAGE_STATUS_META, SIM_STATUS_META } from '../../simulators/simulator-helpers';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';

interface PositionedSortie {
  op: Operation;
  leftPct: number;
  widthPct: number;
  toneClass: string;
  timeRangeLabel: string;
  hasSnag: boolean;
}

interface PositionedShiftBlock {
  block: TimelineShiftBlock;
  leftPct: number;
  widthPct: number;
  toneClass: string;
  timeRangeLabel: string;
  titleLabel: string;
}

interface PositionedMaintenanceBlock {
  block: TimelineMaintenanceBlock;
  leftPct: number;
  widthPct: number;
  timeRangeLabel: string;
}

const KIND_ORDER: Record<SimulatorStationKind, number> = {
  FFS_BAY: 0,
  TEST_PLACE: 1,
  IOS_CONSOLE: 2
};

@Component({
  selector: 'app-sortie-bay-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent],
  templateUrl: './sortie-bay-timeline.component.html',
  styleUrls: ['./sortie-bay-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SortieBayTimelineComponent implements OnInit, OnChanges, OnDestroy {
  @Input() simulators: Simulator[] = [];
  @Input() operations: Operation[] = [];
  @Input() shiftBlocks: TimelineShiftBlock[] = [];
  @Input() maintenanceBlocks: TimelineMaintenanceBlock[] = [];
  @Input() shiftStatusBySimulator: Record<number, ShiftUsageStatus> = {};
  @Input() selectedDate = SortieBayTimelineComponent.todayIso();

  @Output() dateChange = new EventEmitter<string>();
  @Output() selectSortie = new EventEmitter<Operation>();
  @Output() selectShiftBlock = new EventEmitter<TimelineShiftBlock>();
  @Output() selectMaintenance = new EventEmitter<TimelineMaintenanceBlock>();
  @Output() scheduleSlot = new EventEmitter<{ simulatorId: number; hour: number }>();
  @Output() openSimulator = new EventEmitter<number>();

  readonly hours: number[] = Array.from({ length: 24 }, (_, i) => i);

  sortedSimulators: Simulator[] = [];
  barsBySimulator = new Map<number, PositionedSortie[]>();
  shiftBarsBySimulator = new Map<number, PositionedShiftBlock[]>();
  maintBarsBySimulator = new Map<number, PositionedMaintenanceBlock[]>();
  unassignedBars: PositionedSortie[] = [];
  nowLinePct: number | null = null;
  nowPillPct: number | null = null;
  nowTimeLabel = '';
  daySortieCount = 0;
  dayShiftInUseCount = 0;
  dayShiftReadyCount = 0;
  dayMaintCount = 0;
  displayDateObj = new Date();
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
    this.rebuildTimeline();
  }

  ngOnDestroy(): void {
    if (this.nowTimer) {
      clearInterval(this.nowTimer);
      this.nowTimer = null;
    }
  }

  get isTodaySelected(): boolean {
    return this.selectedDate === SortieBayTimelineComponent.todayIso();
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

  onDateInputChange(val: string): void {
    if (val) {
      this.dateChange.emit(val);
    }
  }

  laneStatusBadge(sim: Simulator): { label: string; bg: string; color: string } {
    const shiftSt = this.shiftStatusBySimulator?.[sim.id];
    if (shiftSt && SHIFT_USAGE_STATUS_META[shiftSt]) {
      const m = SHIFT_USAGE_STATUS_META[shiftSt];
      return { label: m.label, bg: m.bg, color: m.color };
    }
    return this.statusMeta(sim.status);
  }

  statusMeta(st?: SimulatorStatus) {
    return SIM_STATUS_META[st || 'READY'] || SIM_STATUS_META.READY;
  }

  hourLabel(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
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

  private parseIsoDay(iso: string): Date {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  }

  private hhMmToMinutes(hhmm: string): number {
    const parts = String(hhmm || '00:00').split(':').map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) return 0;
    return Math.max(0, Math.min(24 * 60, parts[0] * 60 + parts[1]));
  }

  private updateNowMarker(): void {
    const dayStart = this.parseIsoDay(this.selectedDate);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 3600 * 1000;
    const now = new Date();
    if (now.getTime() >= dayStartMs && now.getTime() < dayEndMs) {
      const pct = ((now.getTime() - dayStartMs) / (24 * 3600 * 1000)) * 100;
      this.nowLinePct = pct;
      this.nowPillPct = Math.min(96.5, Math.max(3.5, pct));
      this.nowTimeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    } else {
      this.nowLinePct = null;
      this.nowPillPct = null;
      this.nowTimeLabel = '';
    }
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

    // 1. Formal Sortie Operations
    const map = new Map<number, PositionedSortie[]>();
    const unassigned: PositionedSortie[] = [];
    let count = 0;

    for (const op of this.operations || []) {
      if (!op.start_date) continue;
      const startMs = new Date(op.start_date).getTime();
      if (Number.isNaN(startMs)) continue;

      let endMs = op.end_date ? new Date(op.end_date).getTime() : NaN;
      if (Number.isNaN(endMs) || endMs <= startMs) {
        const hrs = op.scheduled_hours && Number(op.scheduled_hours) > 0 ? Number(op.scheduled_hours) : 2;
        endMs = startMs + hrs * 3600 * 1000;
      }

      if (endMs <= dayStartMs || startMs >= dayEndMs) {
        continue;
      }

      count += 1;
      const clippedStart = Math.max(startMs, dayStartMs);
      const clippedEnd = Math.min(endMs, dayEndMs);
      const totalMs = 24 * 3600 * 1000;
      const leftPct = ((clippedStart - dayStartMs) / totalMs) * 100;
      const widthPct = Math.max(2.6, ((clippedEnd - clippedStart) / totalMs) * 100);

      const sDate = new Date(startMs);
      const eDate = new Date(endMs);
      const timeRangeLabel = `${String(sDate.getHours()).padStart(2, '0')}:${String(sDate.getMinutes()).padStart(2, '0')}–${String(eDate.getHours()).padStart(2, '0')}:${String(eDate.getMinutes()).padStart(2, '0')}`;

      const hasSnag = op.outcome === 'COMPLETED_WITH_SNAGS' || op.outcome === 'INTERRUPTED_TECH';
      const toneClass = this.resolveTone(op);

      const bar: PositionedSortie = { op, leftPct, widthPct, toneClass, timeRangeLabel, hasSnag };

      if (op.simulator_id) {
        const simId = Number(op.simulator_id);
        const list = map.get(simId) || [];
        list.push(bar);
        map.set(simId, list);
      } else {
        unassigned.push(bar);
      }
    }

    // 2. Daily Station Shift Usage Blocks (IN_USE, READY, NA)
    const shiftMap = new Map<number, PositionedShiftBlock[]>();
    let shiftInUse = 0;
    let shiftReady = 0;

    for (const block of this.shiftBlocks || []) {
      const simId = Number(block.simulator_id);
      if (!simId || !visibleSimIds.has(simId)) continue;

      const startMin = this.hhMmToMinutes(block.start_time);
      let endMin = this.hhMmToMinutes(block.end_time);
      if (endMin <= startMin) {
        endMin = Math.min(24 * 60, startMin + 60);
      }

      const leftPct = (startMin / (24 * 60)) * 100;
      const widthPct = Math.max(3.0, ((endMin - startMin) / (24 * 60)) * 100);
      const timeRangeLabel = `${block.start_time}–${block.end_time}`;

      let toneClass = 'tone-shift-ready';
      let titleLabel = block.notes || 'Ready for testing';
      if (block.block_kind === 'SHIFT_IN_USE') {
        toneClass = 'tone-shift-in-use';
        titleLabel = block.notes || 'Active simulation testing session';
        shiftInUse += 1;
      } else if (block.block_kind === 'SHIFT_NA') {
        toneClass = 'tone-shift-na';
        titleLabel = block.notes || 'Not available / under troubleshooting';
      } else {
        shiftReady += 1;
      }

      const posBlock: PositionedShiftBlock = {
        block,
        leftPct,
        widthPct,
        toneClass,
        timeRangeLabel,
        titleLabel
      };

      const list = shiftMap.get(simId) || [];
      list.push(posBlock);
      shiftMap.set(simId, list);
    }

    // 3. Scheduled & Planned Maintenance Windows (Amber-striped blocks)
    const maintMap = new Map<number, PositionedMaintenanceBlock[]>();
    let maintCount = 0;
    for (const mb of this.maintenanceBlocks || []) {
      const simId = Number(mb.simulator_id);
      if (!simId || !visibleSimIds.has(simId)) continue;
      const startMin = this.hhMmToMinutes(mb.start_time);
      let endMin = this.hhMmToMinutes(mb.end_time);
      if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 90);
      const leftPct = (startMin / (24 * 60)) * 100;
      const widthPct = Math.max(3.4, ((endMin - startMin) / (24 * 60)) * 100);
      const posMaint: PositionedMaintenanceBlock = {
        block: mb,
        leftPct,
        widthPct,
        timeRangeLabel: `${mb.start_time}–${mb.end_time}`
      };
      const list = maintMap.get(simId) || [];
      list.push(posMaint);
      maintMap.set(simId, list);
      maintCount += 1;
    }

    this.barsBySimulator = map;
    this.shiftBarsBySimulator = shiftMap;
    this.maintBarsBySimulator = maintMap;
    this.unassignedBars = unassigned;
    this.daySortieCount = count;
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

  trackBySimId(_: number, s: Simulator): number {
    return s.id;
  }

  trackByBarId(_: number, b: PositionedSortie): number {
    return b.op.id;
  }

  trackByShiftBlockId(_: number, b: PositionedShiftBlock): string {
    return b.block.id;
  }

  trackByMaintBlockId(_: number, b: PositionedMaintenanceBlock): string {
    return b.block.id;
  }
}
