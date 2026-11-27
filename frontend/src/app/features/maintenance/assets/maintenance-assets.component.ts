import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { Asset, AssetCategory, AssetStatus } from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { formatEnumLabel, getAssetStatusMeta } from '../maintenance-helpers';

@Component({
  selector: 'app-maintenance-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DropdownComponent, DropdownOptionComponent],
  templateUrl: './maintenance-assets.component.html',
  styleUrls: ['./maintenance-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceAssetsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() assetCategories: AssetCategory[] = [];
  @Input() refreshTick = 0;

  @Output() addAssetRequested = new EventEmitter<void>();
  @Output() editAssetRequested = new EventEmitter<Asset>();
  @Output() logMaintenanceRequested = new EventEmitter<Asset>();
  @Output() assetsMutated = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private initialized = false;

  assets: Asset[] = [];
  loading = true;
  search = '';
  categoryFilter: number | '' = '';
  statusFilter = '';
  showRetired = false;
  openMenuAssetId: number | null = null;

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.search = val;
        this.loadAssets();
      });

    this.initialized = true;
    this.loadAssets();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadAssets();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenuAssetId !== null) {
      this.openMenuAssetId = null;
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.openMenuAssetId !== null) {
      this.openMenuAssetId = null;
    }
  }

  loadAssets(): void {
    this.loading = true;
    this.openMenuAssetId = null;

    this.api.get<any>('/maintenance/assets', {
      search: this.search.trim(),
      category_id: this.categoryFilter || '',
      status: this.statusFilter,
      include_retired: this.showRetired ? 'true' : ''
    }).subscribe({
      next: r => {
        this.assets = r?.data || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearchModelChange(val: string): void {
    this.search = val;
    this.searchInput$.next(val);
  }

  clearSearch(): void {
    this.search = '';
    this.searchInput$.next('');
    this.loadAssets();
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.search.trim() || this.categoryFilter !== '' || this.statusFilter || this.showRetired);
  }

  resetFilters(): void {
    this.search = '';
    this.categoryFilter = '';
    this.statusFilter = '';
    this.showRetired = false;
    this.loadAssets();
  }

  toggleRowMenu(assetId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuAssetId = this.openMenuAssetId === assetId ? null : assetId;
  }

  closeRowMenu(): void {
    this.openMenuAssetId = null;
  }

  setAssetStatus(asset: Asset, status: AssetStatus): void {
    this.closeRowMenu();
    this.api.put<any>(`/maintenance/assets/${asset.id}`, { status }).subscribe({
      next: () => {
        this.toast.success(`Asset marked ${getAssetStatusMeta(status).label}.`);
        this.loadAssets();
        this.assetsMutated.emit();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update asset status.')
    });
  }

  async deleteOrRetireAsset(asset: Asset): Promise<void> {
    this.closeRowMenu();
    const ok = await this.confirm.confirm(
      `Remove or retire "${asset.name}"? Assets with historical maintenance records will be retired to preserve audit history.`,
      'Retire / Delete Asset',
      true
    );
    if (!ok) return;

    this.api.delete<any>(`/maintenance/assets/${asset.id}`).subscribe({
      next: r => {
        const retired = Boolean(r?.data?.retired);
        this.toast.success(retired ? 'Asset marked as Retired.' : 'Asset deleted.');
        this.loadAssets();
        this.assetsMutated.emit();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to remove asset.')
    });
  }

  assetSubline(a: Asset): string {
    const parts: string[] = [];
    if (a.serial_number) parts.push(`S/N ${a.serial_number}`);
    const modelStr = [a.manufacturer, a.model].filter(Boolean).join(' ');
    if (modelStr) parts.push(modelStr);
    return parts.join(' · ');
  }

  warrantyTone(a: Asset): 'expired' | 'soon' | 'ok' | 'none' {
    if (!a.warranty_expiry) return 'none';
    const exp = new Date(a.warranty_expiry + 'T23:59:59');
    if (Number.isNaN(exp.getTime())) return 'none';
    const diffDays = (exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return 'expired';
    if (diffDays <= 30) return 'soon';
    return 'ok';
  }

  statusMeta(status: AssetStatus) { return getAssetStatusMeta(status); }
  enumLabel(val?: string | null) { return formatEnumLabel(val); }
}
