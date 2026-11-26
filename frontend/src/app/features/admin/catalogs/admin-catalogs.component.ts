// =============================================================================
// features/admin/catalogs/admin-catalogs.component.ts
// =============================================================================
import {
  Component, OnChanges, SimpleChanges, Input, Output, EventEmitter,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/services';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import {
  AdminTab,
  COLOR_SWATCHES,
  ICON_PRESETS,
  formatShiftDuration,
} from '../admin-helpers';

export type CatalogTab =
  | 'operation-types'
  | 'shift-types'
  | 'asset-categories'
  | 'item-categories'
  | 'wiki-categories'
  | 'warehouse-locations';

@Component({
  selector: 'app-admin-catalogs',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent, TimePickerComponent],
  templateUrl: './admin-catalogs.component.html',
  styleUrls: ['./admin-catalogs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCatalogsComponent implements OnChanges {
  Math = Math;

  @Input() activeTab: CatalogTab = 'operation-types';
  @Input() tabLabel = 'Catalogs';

  @Output() catalogChanged = new EventEmitter<void>();

  readonly iconPresets = ICON_PRESETS;
  readonly colorSwatches = COLOR_SWATCHES;

  items: any[] = [];
  loading = false;
  saving = false;

  search = '';
  categoryFilter = 'all'; // WORK / LEAVE / HARDWARE / active / etc.

  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  showModal = false;
  editingItem: any = null;
  itemForm: any = {};
  formError = '';

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  formatShiftDuration = formatShiftDuration;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeTab']) {
      this.showModal = false;
      this.search = '';
      this.categoryFilter = 'all';
      this.page = 1;
      this.loadItems();
    }
  }

  private apiPath(tab: AdminTab): string {
    return '/admin/' + tab;
  }

  get filterChips(): { value: string; label: string }[] {
    switch (this.activeTab) {
      case 'shift-types':
        return [
          { value: 'all', label: 'All' },
          { value: 'WORK', label: 'Work Shifts' },
          { value: 'LEAVE', label: 'Leave & Time Off' },
        ];
      case 'asset-categories':
        return [
          { value: 'all', label: 'All' },
          { value: 'HARDWARE', label: 'Hardware' },
          { value: 'SOFTWARE', label: 'Software' },
          { value: 'NETWORK', label: 'Network' },
          { value: 'OTHER', label: 'Other' },
        ];
      case 'warehouse-locations':
        return [
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ];
      default:
        return [];
    }
  }

  get filteredItems(): any[] {
    const q = this.search.trim().toLowerCase();
    return this.items.filter(item => {
      if (this.categoryFilter !== 'all') {
        if (this.activeTab === 'shift-types' && String(item.category || 'WORK').toUpperCase() !== this.categoryFilter) {
          return false;
        }
        if (this.activeTab === 'asset-categories' && String(item.type || '').toUpperCase() !== this.categoryFilter) {
          return false;
        }
        if (this.activeTab === 'warehouse-locations') {
          if (this.categoryFilter === 'active' && !item.is_active) return false;
          if (this.categoryFilter === 'inactive' && item.is_active) return false;
        }
      }
      if (!q) return true;
      return (
        String(item.name || '').toLowerCase().includes(q) ||
        String(item.code || '').toLowerCase().includes(q) ||
        String(item.description || '').toLowerCase().includes(q) ||
        String(item.slug || '').toLowerCase().includes(q)
      );
    });
  }

  get paginatedItems(): any[] {
    const list = this.filteredItems;
    const start = (this.page - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize));
  }

  get liveShiftDuration(): string {
    if (this.itemForm?.category === 'LEAVE') return 'Leave entry (0h worked)';
    return formatShiftDuration(this.itemForm?.start_time, this.itemForm?.end_time);
  }

  loadItems(): void {
    this.loading = true;
    this.api.get<any>(this.apiPath(this.activeTab)).subscribe({
      next: res => {
        this.items = res.data || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load items.');
        this.cdr.markForCheck();
      }
    });
  }

  setCategoryFilter(value: string): void {
    this.categoryFilter = value;
    this.page = 1;
  }

  onSearchChange(): void {
    this.page = 1;
  }

  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages) return;
    this.page = nextPage;
  }

  onPageSizeChange(): void {
    this.page = 1;
  }

  private defaultForm(tab: CatalogTab): any {
    switch (tab) {
      case 'operation-types':
        return { name: '', color: '#1565C0', icon: 'rocket_launch', description: '' };
      case 'shift-types':
        return { name: '', code: '', category: 'WORK', start_time: '08:00', end_time: '16:00', color: '#1565C0', description: '' };
      case 'asset-categories':
        return { name: '', type: 'HARDWARE', description: '' };
      case 'item-categories':
        return { name: '', description: '' };
      case 'wiki-categories':
        return { name: '', icon: 'folder', sort_order: 0 };
      case 'warehouse-locations':
        return { name: '', code: '', description: '', is_active: true };
    }
  }

  openItemModal(item?: any): void {
    this.editingItem = item ?? null;
    if (item) {
      this.itemForm = {
        ...item,
        start_time: item.start_time ? String(item.start_time).slice(0, 5) : '08:00',
        end_time: item.end_time ? String(item.end_time).slice(0, 5) : '16:00',
        category: item.category || 'WORK',
      };
    } else {
      this.itemForm = this.defaultForm(this.activeTab);
    }
    this.formError = '';
    this.showModal = true;
    this.cdr.markForCheck();
  }

  onShiftCategoryChange(category: 'WORK' | 'LEAVE'): void {
    this.itemForm = { ...this.itemForm, category };
    if (category === 'LEAVE') {
      this.itemForm.start_time = '00:00';
      this.itemForm.end_time = '00:00';
    } else if (this.itemForm.start_time === '00:00' && this.itemForm.end_time === '00:00') {
      this.itemForm.start_time = '08:00';
      this.itemForm.end_time = '16:00';
    }
  }

  selectIcon(icon: string): void {
    this.itemForm = { ...this.itemForm, icon };
  }

  selectColor(color: string): void {
    this.itemForm = { ...this.itemForm, color };
  }

  saveItem(): void {
    this.formError = '';
    if (!this.itemForm.name?.trim()) {
      this.formError = 'Name is required.';
      return;
    }
    if ((this.activeTab === 'shift-types' || this.activeTab === 'warehouse-locations') && !this.itemForm.code?.trim()) {
      this.formError = 'Code is required.';
      return;
    }
    if (this.activeTab === 'shift-types' && this.itemForm.category === 'WORK') {
      if (!this.itemForm.start_time || !this.itemForm.end_time) {
        this.formError = 'Start and end time are required for work shifts.';
        return;
      }
    }

    this.saving = true;
    const payload = { ...this.itemForm };
    if (this.activeTab === 'shift-types') {
      payload.code = String(payload.code || '').trim().toUpperCase();
    }

    const req$ = this.editingItem
      ? this.api.put<any>(this.apiPath(this.activeTab) + '/' + this.editingItem.id, payload)
      : this.api.post<any>(this.apiPath(this.activeTab), payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showModal = false;
        this.toast.success(this.editingItem ? 'Item updated.' : 'Item created.');
        this.loadItems();
        this.catalogChanged.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saving = false;
        this.formError = err?.error?.message || 'Failed to save item.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleLocationActive(item: any): void {
    this.api.patch<any>('/admin/warehouse-locations/' + item.id + '/toggle', {}).subscribe({
      next: res => {
        const nextActive = Boolean(res.data?.is_active);
        this.items = this.items.map(row => row.id === item.id ? { ...row, is_active: nextActive } : row);
        this.toast.success(nextActive ? 'Location activated.' : 'Location deactivated.');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.toast.error(err?.error?.message || 'Failed to toggle location.');
        this.loadItems();
      }
    });
  }

  async deleteItem(item: any): Promise<void> {
    if ((item.used_count || 0) > 0) {
      this.toast.warning(`Cannot delete "${item.name}" while referenced by ${item.used_count} record(s).`);
      return;
    }
    const ok = await this.confirm.confirm(
      `Delete "${item.name}"? This cannot be undone.`,
      'Delete Item'
    );
    if (!ok) return;

    this.api.delete<any>(this.apiPath(this.activeTab) + '/' + item.id).subscribe({
      next: () => {
        this.toast.success('Item deleted.');
        this.loadItems();
        this.catalogChanged.emit();
      },
      error: (err: any) => this.toast.error(err?.error?.message || 'Cannot delete this item.')
    });
  }
}
