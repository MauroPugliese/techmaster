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
import { ApiService } from '../../../core/services/api.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { UiCustomizationService, UiSectionPreferences } from '../../../core/services/ui-customization.service';
import {
  Asset,
  AssetCategory,
  AssetStatus,
  InventoryItem,
  MaintenancePartUsage,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceType,
  Priority,
  Simulator,
  SimulatorSubsystemCode
} from '../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../shared/components/datetime-picker/datetime-picker.component';
import { formatLocalYmd } from '../../../shared/components/datetime-picker/datetime-picker.utils';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { SUBSYSTEM_OPTIONS } from '../../simulators/simulator-helpers';
import {
  combineDowntimeHours,
  computeNextCycleDate,
  formatDowntime,
  formatEnumLabel,
  formatMoney,
  formatTechnicianName,
  getAssetStatusMeta,
  getPriorityBadgeClass,
  getStatusBadgeClass,
  isMaintenanceOverdue,
  splitDowntimeHours
} from '../maintenance-helpers';

@Component({
  selector: 'app-maintenance-modals',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DateTimePickerComponent, DropdownComponent, DropdownOptionComponent],
  templateUrl: './maintenance-modals.component.html',
  styleUrls: ['./maintenance-modals.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceModalsComponent {
  @Input() simulators: Simulator[] = [];
  @Input() assets: Asset[] = [];
  @Input() assetCategories: AssetCategory[] = [];
  @Input() warehouseItems: InventoryItem[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;

  readonly subsystemOptions = SUBSYSTEM_OPTIONS;

  @Output() mutated = new EventEmitter<void>();
  @Output() assetsMutated = new EventEmitter<void>();

  // ── Work Order Create / Edit Modal ─────────────────────────────────────────
  showRecordModal = false;
  editingRecord: MaintenanceRecord | null = null;
  recordError = '';
  savingRecord = false;
  recordForm: any = this.emptyRecordForm();
  downtimeHoursPart = 0;
  downtimeMinutesPart = 0;
  partsList: MaintenancePartUsage[] = [];
  selectedWarehouseItemId: number | null = null;
  selectedPartQty = 1;
  deductStock = true;

  // ── Work Order Detail Modal ────────────────────────────────────────────────
  detailRecord: MaintenanceRecord | null = null;

  // ── Asset Create / Edit Modal ──────────────────────────────────────────────
  showAssetModal = false;
  editingAsset: Asset | null = null;
  assetError = '';
  savingAsset = false;
  assetForm: any = this.emptyAssetForm();

  readonly nextCyclePresets = [
    { label: '+30 days', days: 30 },
    { label: '+90 days', days: 90 },
    { label: '+6 months', days: 180 },
    { label: '+1 year', days: 365 }
  ];

  constructor(
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.showAssetModal) {
      this.showAssetModal = false;
      this.cdr.markForCheck();
    } else if (this.showRecordModal) {
      this.showRecordModal = false;
      this.cdr.markForCheck();
    } else if (this.detailRecord) {
      this.detailRecord = null;
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

  // ── Work Order Create / Edit ───────────────────────────────────────────────
  private emptyRecordForm() {
    return {
      simulator_id: null as number | null,
      asset_id: undefined as number | undefined,
      subsystem_code: '' as '' | SimulatorSubsystemCode,
      severity: 'MINOR' as 'MINOR' | 'DEGRADED' | 'AOG',
      lost_training_hours: 0,
      is_snag: false,
      type: 'PREVENTIVE' as MaintenanceType,
      priority: 'MEDIUM' as Priority,
      status: 'SCHEDULED' as MaintenanceStatus,
      title: '',
      description: '',
      findings: '',
      scheduled_date: new Date() as Date | null,
      next_scheduled: null as Date | null,
      cost: null as number | null
    };
  }

  openRecordModal(record?: MaintenanceRecord, prefill?: Partial<MaintenanceRecord>): void {
    this.recordError = '';
    this.selectedWarehouseItemId = null;
    this.selectedPartQty = 1;
    this.deductStock = !record;

    if (record) {
      this.editingRecord = record;
      this.recordForm = {
        simulator_id: record.simulator_id ?? record.simulator?.id ?? null,
        asset_id: record.asset_id ?? undefined,
        subsystem_code: (record.subsystem_code || '') as '' | SimulatorSubsystemCode,
        severity: (record.severity || 'MINOR') as 'MINOR' | 'DEGRADED' | 'AOG',
        lost_training_hours: record.lost_training_hours ?? 0,
        is_snag: Boolean(record.is_snag),
        type: record.type,
        priority: record.priority,
        status: record.status,
        title: record.title,
        description: record.description ?? '',
        findings: record.findings ?? '',
        scheduled_date: record.scheduled_date ? new Date(record.scheduled_date) : null,
        next_scheduled: record.next_scheduled ? new Date(record.next_scheduled) : null,
        cost: record.cost ?? null
      };
      const split = splitDowntimeHours(record.downtime_hours);
      this.downtimeHoursPart = split.hours;
      this.downtimeMinutesPart = split.minutes;
      this.partsList = Array.isArray(record.parts_used) ? record.parts_used.map(p => ({ ...p })) : [];
    } else {
      this.editingRecord = null;
      const base = this.emptyRecordForm();
      this.recordForm = {
        ...base,
        simulator_id: prefill?.simulator_id ?? null,
        asset_id: prefill?.asset_id ?? undefined,
        subsystem_code: (prefill?.subsystem_code || '') as '' | SimulatorSubsystemCode,
        severity: (prefill?.severity || 'MINOR') as 'MINOR' | 'DEGRADED' | 'AOG',
        lost_training_hours: prefill?.lost_training_hours ?? 0,
        is_snag: Boolean(prefill?.is_snag),
        type: prefill?.type ?? 'PREVENTIVE',
        priority: prefill?.priority ?? 'MEDIUM',
        status: prefill?.status ?? 'SCHEDULED',
        title: prefill?.title ?? '',
        description: prefill?.description ?? '',
        scheduled_date: prefill?.scheduled_date ? new Date(prefill.scheduled_date) : new Date(),
        next_scheduled: prefill?.next_scheduled ? new Date(prefill.next_scheduled) : null,
        cost: prefill?.cost ?? null
      };
      this.downtimeHoursPart = 0;
      this.downtimeMinutesPart = 0;
      this.partsList = [];
    }

    this.showRecordModal = true;
    this.cdr.markForCheck();
  }

  closeRecordModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showRecordModal = false;
    }
  }

  applyNextCyclePreset(days: number): void {
    this.recordForm.next_scheduled = computeNextCycleDate(this.recordForm.scheduled_date || new Date(), days);
    this.cdr.markForCheck();
  }

  clearNextCycle(): void {
    this.recordForm.next_scheduled = null;
    this.cdr.markForCheck();
  }

  addWarehousePart(): void {
    if (!this.selectedWarehouseItemId) return;
    const item = this.warehouseItems.find(w => Number(w.id) === Number(this.selectedWarehouseItemId));
    if (!item) return;

    const qty = Math.max(1, Math.floor(Number(this.selectedPartQty) || 1));
    const idx = this.partsList.findIndex(p => Number(p.item_id) === Number(item.id));
    if (idx >= 0) {
      this.partsList = this.partsList.map((p, i) => i === idx ? { ...p, quantity: p.quantity + qty } : p);
    } else {
      this.partsList = [
        ...this.partsList,
        {
          item_id: item.id,
          sku: item.sku,
          name: item.name,
          quantity: qty,
          unit: item.unit || 'pcs'
        }
      ];
    }

    this.selectedWarehouseItemId = null;
    this.selectedPartQty = 1;
    this.cdr.markForCheck();
  }

  removePart(index: number): void {
    this.partsList = this.partsList.filter((_, i) => i !== index);
    this.cdr.markForCheck();
  }

  saveRecord(): void {
    this.recordError = '';
    if (this.showFormField('title') && !String(this.recordForm.title || '').trim()) {
      this.recordError = 'Title is required.';
      return;
    }
    if (!this.recordForm.simulator_id && !this.recordForm.asset_id) {
      this.recordError = 'Please select a Simulator Bay or an Asset.';
      return;
    }
    if (this.showFormField('scheduled_date') && !this.recordForm.scheduled_date) {
      this.recordError = 'Scheduled date is required.';
      return;
    }
    if (this.showFormField('description') && !String(this.recordForm.description || '').trim()) {
      this.recordError = 'Description is required.';
      return;
    }

    const downtime = combineDowntimeHours(this.downtimeHoursPart, this.downtimeMinutesPart);
    const payload: Record<string, any> = {
      ...this.recordForm,
      simulator_id: this.recordForm.simulator_id ? Number(this.recordForm.simulator_id) : null,
      asset_id: this.recordForm.asset_id ? Number(this.recordForm.asset_id) : null,
      subsystem_code: this.recordForm.subsystem_code || null,
      lost_training_hours: Number(this.recordForm.lost_training_hours || 0),
      is_snag: Boolean(this.recordForm.is_snag),
      downtime_hours: downtime,
      parts_used: this.partsList,
      next_scheduled: this.recordForm.next_scheduled ? new Date(this.recordForm.next_scheduled).toISOString() : null
    };

    if (payload['scheduled_date']) {
      payload['scheduled_date'] = new Date(payload['scheduled_date']).toISOString();
    }
    if (payload['status'] === 'COMPLETED') {
      payload['completed_date'] = new Date().toISOString();
    }
    if (this.deductStock && this.partsList.some(p => p.item_id)) {
      payload['deduct_stock'] = true;
    }

    this.savingRecord = true;
    const isEdit = !!this.editingRecord;
    const req$ = isEdit
      ? this.api.put<any>(`/maintenance/${this.editingRecord!.id}`, payload)
      : this.api.post<any>('/maintenance', payload);

    req$.subscribe({
      next: () => {
        this.savingRecord = false;
        this.showRecordModal = false;
        this.toast.success(isEdit ? 'Work order updated.' : 'Work order created.');
        this.mutated.emit();
        this.assetsMutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.savingRecord = false;
        this.recordError = e?.error?.message || 'Failed to save work order.';
        this.toast.error(this.recordError);
        this.cdr.markForCheck();
      }
    });
  }

  // ── Work Order Detail & Quick Actions ──────────────────────────────────────
  openDetailModal(record: MaintenanceRecord): void {
    this.detailRecord = record;
    this.cdr.markForCheck();
  }

  closeDetailModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.detailRecord = null;
    }
  }

  editFromDetail(): void {
    if (!this.detailRecord) return;
    const rec = this.detailRecord;
    this.detailRecord = null;
    this.openRecordModal(rec);
  }

  updateRecordStatus(record: MaintenanceRecord, status: MaintenanceStatus): void {
    const body: Record<string, any> = { status };
    if (status === 'COMPLETED') body['completed_date'] = new Date().toISOString();

    this.api.put<any>(`/maintenance/${record.id}`, body).subscribe({
      next: () => {
        if (this.detailRecord?.id === record.id) this.detailRecord = null;
        this.toast.success(`Status updated to ${formatEnumLabel(status)}.`);
        this.mutated.emit();
        this.assetsMutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update status.')
    });
  }

  async deleteRecord(record: MaintenanceRecord): Promise<void> {
    const ok = await this.confirm.confirm(
      `Delete work order "${record.title}"? This cannot be undone.`,
      'Delete Work Order',
      true
    );
    if (!ok) return;

    this.api.delete<any>(`/maintenance/${record.id}`).subscribe({
      next: () => {
        if (this.detailRecord?.id === record.id) this.detailRecord = null;
        this.toast.success('Work order deleted.');
        this.mutated.emit();
        this.assetsMutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete work order.')
    });
  }

  // ── Asset Create / Edit Modal ──────────────────────────────────────────────
  private emptyAssetForm() {
    return {
      name: '',
      category_id: undefined as number | undefined,
      status: 'ACTIVE' as AssetStatus,
      serial_number: '',
      manufacturer: '',
      model: '',
      location: '',
      purchase_date: null as Date | null,
      warranty_expiry: null as Date | null,
      notes: ''
    };
  }

  openAssetModal(asset?: Asset): void {
    this.assetError = '';
    if (asset) {
      this.editingAsset = asset;
      this.assetForm = {
        name: asset.name,
        category_id: asset.category_id ?? asset.category?.id ?? undefined,
        status: asset.status || 'ACTIVE',
        serial_number: asset.serial_number ?? '',
        manufacturer: asset.manufacturer ?? '',
        model: asset.model ?? '',
        location: asset.location ?? '',
        purchase_date: asset.purchase_date ? new Date(asset.purchase_date + 'T00:00:00') : null,
        warranty_expiry: asset.warranty_expiry ? new Date(asset.warranty_expiry + 'T00:00:00') : null,
        notes: asset.notes ?? ''
      };
    } else {
      this.editingAsset = null;
      this.assetForm = this.emptyAssetForm();
    }
    this.showAssetModal = true;
    this.cdr.markForCheck();
  }

  closeAssetModal(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showAssetModal = false;
    }
  }

  private toYmd(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatLocalYmd(value);
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : formatLocalYmd(d);
  }

  saveAsset(): void {
    this.assetError = '';
    if (!String(this.assetForm.name || '').trim()) {
      this.assetError = 'Asset name is required.';
      return;
    }
    if (!this.assetForm.category_id) {
      this.assetError = 'Please select an asset category.';
      return;
    }

    const payload = {
      ...this.assetForm,
      purchase_date: this.toYmd(this.assetForm.purchase_date),
      warranty_expiry: this.toYmd(this.assetForm.warranty_expiry)
    };

    this.savingAsset = true;
    const isEdit = !!this.editingAsset;
    const req$ = isEdit
      ? this.api.put<any>(`/maintenance/assets/${this.editingAsset!.id}`, payload)
      : this.api.post<any>('/maintenance/assets', payload);

    req$.subscribe({
      next: () => {
        this.savingAsset = false;
        this.showAssetModal = false;
        this.toast.success(isEdit ? 'Asset updated.' : 'Asset added.');
        this.assetsMutated.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.savingAsset = false;
        this.assetError = e?.error?.message || 'Failed to save asset.';
        this.toast.error(this.assetError);
        this.cdr.markForCheck();
      }
    });
  }

  // ── Exposed Formatting Helpers ─────────────────────────────────────────────
  label(val?: string | null): string { return formatEnumLabel(val); }
  downtime(val?: number | null): string { return formatDowntime(val); }
  money(val?: number | null): string { return formatMoney(val); }
  overdue(r: MaintenanceRecord | null): boolean { return isMaintenanceOverdue(r); }
  statusBadge(s?: string | null): string { return getStatusBadgeClass(s); }
  priorityBadge(p?: string | null): string { return getPriorityBadgeClass(p); }
  techName(r: MaintenanceRecord): string { return formatTechnicianName(r.technician); }
  assetStatusMeta(s?: AssetStatus | null) { return getAssetStatusMeta(s); }
}
