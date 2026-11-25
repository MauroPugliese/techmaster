import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  QtgStatus,
  Simulator,
  SimulatorQtgRecord
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { QTG_STATUS_META } from '../../simulators/simulator-helpers';

@Component({
  selector: 'app-maintenance-qtg',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, RouterLink, DropdownComponent, DropdownOptionComponent],
  templateUrl: './maintenance-qtg.component.html',
  styleUrls: ['./maintenance-qtg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceQtgComponent implements OnInit, OnChanges {
  @Input() simulators: Simulator[] = [];
  @Input() preselectedSimulatorId: number | null = null;
  @Input() refreshTick = 0;

  @Output() mutated = new EventEmitter<void>();

  loading = true;
  allRecords: SimulatorQtgRecord[] = [];
  filteredRecords: SimulatorQtgRecord[] = [];

  simulatorFilter: number | '' = '';
  quarterFilter: 'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4' = 'ALL';
  statusFilter: 'ALL' | QtgStatus = 'ALL';
  searchQuery = '';
  updatingId: number | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.preselectedSimulatorId) {
      this.simulatorFilter = this.preselectedSimulatorId;
    }
    this.loadQtg();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preselectedSimulatorId'] && !changes['preselectedSimulatorId'].firstChange) {
      this.simulatorFilter = this.preselectedSimulatorId || '';
      this.applyFilters();
    }
    if (changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadQtg();
    }
  }

  loadQtg(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.api.get<any>('/simulators/qtg/all').subscribe({
      next: (res) => {
        this.allRecords = res?.data || [];
        this.applyFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load QTG compliance schedule.');
        this.cdr.markForCheck();
      }
    });
  }

  applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();
    this.filteredRecords = this.allRecords.filter((rec) => {
      if (this.simulatorFilter !== '' && Number(rec.simulator_id) !== Number(this.simulatorFilter)) {
        return false;
      }
      if (this.quarterFilter !== 'ALL' && rec.quarter !== this.quarterFilter) {
        return false;
      }
      if (this.statusFilter !== 'ALL' && rec.status !== this.statusFilter) {
        return false;
      }
      if (q) {
        const hay = [
          rec.test_code,
          rec.title,
          rec.category,
          rec.measured_delta,
          rec.simulator?.code,
          rec.simulator?.bay_code,
          rec.simulator?.aircraft_type
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    this.cdr.markForCheck();
  }

  resetFilters(): void {
    this.simulatorFilter = '';
    this.quarterFilter = 'ALL';
    this.statusFilter = 'ALL';
    this.searchQuery = '';
    this.applyFilters();
  }

  setStatus(rec: SimulatorQtgRecord, status: QtgStatus): void {
    if (this.updatingId === rec.id || rec.status === status) return;
    this.updatingId = rec.id;
    this.cdr.markForCheck();

    this.api.put<any>(`/simulators/${rec.simulator_id}/qtg/${rec.id}`, { status }).subscribe({
      next: (res) => {
        const updated = res?.data || { ...rec, status };
        this.allRecords = this.allRecords.map(r => (r.id === rec.id ? { ...r, ...updated } : r));
        this.updatingId = null;
        this.applyFilters();
        this.toast.success(`QTG ${rec.test_code} marked ${status}.`);
        this.mutated.emit();
      },
      error: (err: any) => {
        this.updatingId = null;
        this.toast.error(err?.error?.message || 'Unable to update QTG status.');
        this.cdr.markForCheck();
      }
    });
  }

  get kpis() {
    const list = this.simulatorFilter !== ''
      ? this.allRecords.filter(r => Number(r.simulator_id) === Number(this.simulatorFilter))
      : this.allRecords;
    const total = list.length;
    const passed = list.filter(r => r.status === 'PASSED').length;
    const pending = list.filter(r => r.status === 'PENDING').length;
    const issues = list.filter(r => r.status === 'TOLERANCE_WARN' || r.status === 'FAILED').length;
    return { total, passed, pending, issues };
  }

  statusMeta(st?: QtgStatus) {
    return QTG_STATUS_META[st || 'PENDING'] || QTG_STATUS_META.PENDING;
  }

  trackById(_: number, r: SimulatorQtgRecord): number {
    return r.id;
  }
}
