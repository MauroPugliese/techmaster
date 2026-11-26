// =============================================================================
// features/admin/customization/admin-customization.component.ts
// =============================================================================
import {
  Component, OnInit, OnDestroy, Input, HostListener, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/services';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';

@Component({
  selector: 'app-admin-customization',
  standalone: true,
  imports: [CommonModule, FormsModule, TitleCasePipe, DropdownComponent, DropdownOptionComponent],
  templateUrl: './admin-customization.component.html',
  styleUrls: ['./admin-customization.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCustomizationComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private dbLoadSeq = 0;
  private uiLoadSeq = 0;

  @Input() roles: any[] = [];

  mode: 'db' | 'ui' = 'db';
  loading = false;
  actionLoading = false;

  // DB Schema Mode
  tables: any[] = [];
  selectedTable = '';
  columns: any[] = [];
  filteredDbColumns: any[] = [];
  isDbDirty = false;
  private dbSnapshot = '';
  dbSearch = '';

  showColumnModal = false;
  editingColumn: any = null;
  columnForm: any = this.emptyColumnForm();
  columnFormError = '';

  // UI Section Mode
  uiSectionCatalog: Record<string, { table: string[]; form: string[] }> = {};
  uiSections: string[] = [];
  selectedUiSection = '';
  selectedUiScope: 'table' | 'form' = 'table';
  selectedUiRole = 'ALL';
  uiFieldsEditor: any[] = [];
  filteredUiFields: any[] = [];
  visibleUiPreviewFields: any[] = [];
  isUiDirty = false;
  private uiSnapshot = '';
  uiSearch = '';
  uiSourceFilter: 'all' | 'role' | 'global' | 'default' = 'all';

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadTables();
    this.loadUiCatalog();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showColumnModal && !this.actionLoading) {
      this.showColumnModal = false;
      this.cdr.markForCheck();
    }
  }

  get isDirty(): boolean {
    return this.mode === 'db' ? this.isDbDirty : this.isUiDirty;
  }

  recomputeDbState(): void {
    const q = this.dbSearch.trim().toLowerCase();
    this.filteredDbColumns = !q
      ? this.columns
      : this.columns.filter(c =>
          String(c.column_name || '').toLowerCase().includes(q) ||
          String(c.label || '').toLowerCase().includes(q) ||
          String(c.column_type || '').toLowerCase().includes(q)
        );
    this.isDbDirty = this.dbSnapshot !== '' && this.serializeDbCols(this.columns) !== this.dbSnapshot;
  }

  recomputeUiState(): void {
    const q = this.uiSearch.trim().toLowerCase();
    this.filteredUiFields = this.uiFieldsEditor.filter(f => {
      if (this.uiSourceFilter !== 'all' && (f.source || 'default') !== this.uiSourceFilter) return false;
      if (!q) return true;
      return (
        String(f.field_key || '').toLowerCase().includes(q) ||
        String(f.label || '').toLowerCase().includes(q)
      );
    });
    this.visibleUiPreviewFields = this.uiFieldsEditor
      .filter(f => f.is_visible !== false)
      .sort((a, b) => Number(a.display_order) - Number(b.display_order));
    this.isUiDirty = this.uiSnapshot !== '' && this.serializeUiFields(this.uiFieldsEditor) !== this.uiSnapshot;
  }

  setUiSourceFilter(filter: 'all' | 'role' | 'global' | 'default'): void {
    this.uiSourceFilter = filter;
    this.recomputeUiState();
    this.cdr.markForCheck();
  }

  private serializeDbCols(cols: any[]): string {
    return JSON.stringify((cols || []).map((c, idx) => ({
      column_name: c.column_name,
      label: c.label || '',
      is_visible: c.is_visible !== false,
      display_order: Number(c.display_order || idx + 1),
    })));
  }

  private serializeUiFields(fields: any[]): string {
    return JSON.stringify((fields || []).map((f, idx) => ({
      field_key: f.field_key,
      label: f.label || '',
      is_visible: f.is_visible !== false,
      display_order: Number(f.display_order || idx + 1),
    })));
  }

  private async confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.isDirty) return true;
    return this.confirm.confirm(
      'You have unsaved visibility/order changes. Discard them and continue?',
      'Unsaved Changes'
    );
  }

  async setMode(nextMode: 'db' | 'ui'): Promise<void> {
    if (this.mode === nextMode) return;
    if (!(await this.confirmDiscardIfDirty())) return;
    this.mode = nextMode;
    this.cdr.markForCheck();
  }

  // ── DB Schema Customization ──────────────────────────────────────────────
  private emptyColumnForm() {
    return { name: '', type: 'VARCHAR', length: 100, nullable: true, defaultValue: '', label: '' };
  }

  loadTables(): void {
    this.loading = true;
    this.api.get<any>('/admin/schema/tables').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.tables = res.data || [];
        if (!this.selectedTable && this.tables.length) {
          this.selectedTable = this.tables[0].table_name;
        }
        this.loading = false;
        if (this.selectedTable) this.loadTableColumns(this.selectedTable);
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load tables.');
        this.cdr.markForCheck();
      }
    });
  }

  async onTableChange(tableName: string): Promise<void> {
    if (tableName === this.selectedTable) return;
    if (!(await this.confirmDiscardIfDirty())) return;
    this.selectedTable = tableName;
    this.loadTableColumns(tableName);
  }

  loadTableColumns(tableName: string): void {
    if (!tableName) return;
    const seq = ++this.dbLoadSeq;
    this.loading = true;
    this.api.get<any>('/admin/schema/tables/' + tableName + '/columns').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (seq !== this.dbLoadSeq) return;
        const cols = (res.data || []).sort((a: any, b: any) =>
          Number(a.display_order || a.ordinal_position) - Number(b.display_order || b.ordinal_position)
        );
        this.columns = cols.map((c: any) => ({ ...c, is_visible: c.is_visible !== false, label: c.label || '' }));
        this.dbSnapshot = this.serializeDbCols(this.columns);
        this.recomputeDbState();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        if (seq !== this.dbLoadSeq) return;
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load columns.');
        this.cdr.markForCheck();
      }
    });
  }

  setAllDbVisibility(visible: boolean): void {
    this.columns = this.columns.map(c => c.is_system ? c : { ...c, is_visible: visible });
    this.recomputeDbState();
    this.cdr.markForCheck();
  }

  moveColumn(column: any, direction: number): void {
    const idx = this.columns.findIndex(c => c.column_name === column.column_name);
    const nextIdx = idx + direction;
    if (idx < 0 || nextIdx < 0 || nextIdx >= this.columns.length) return;
    const clone = [...this.columns];
    [clone[idx], clone[nextIdx]] = [clone[nextIdx], clone[idx]];
    this.columns = clone.map((c, i) => ({ ...c, display_order: i + 1 }));
    this.recomputeDbState();
    this.cdr.markForCheck();
  }

  saveColumnPreferences(): void {
    if (!this.selectedTable) return;
    this.actionLoading = true;
    const payload = {
      columns: this.columns.map((c, i) => ({
        column_name: c.column_name,
        label: c.label || null,
        is_visible: c.is_visible !== false,
        display_order: i + 1,
        width: c.width || null,
      })),
    };
    this.api.put<any>('/admin/schema/tables/' + this.selectedTable + '/preferences', payload).subscribe({
      next: () => {
        this.actionLoading = false;
        this.toast.success('Column preferences saved.');
        this.loadTableColumns(this.selectedTable);
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.toast.error(err?.error?.message || 'Failed to save preferences.');
        this.cdr.markForCheck();
      }
    });
  }

  discardCurrentEdits(): void {
    if (this.mode === 'db') this.loadTableColumns(this.selectedTable);
    else this.loadUiPreferences();
  }

  openColumnModal(column?: any): void {
    this.editingColumn = column ?? null;
    this.columnForm = column ? {
      name: column.column_name,
      type: this.normalizeColumnType(column.data_type || column.column_type),
      length: this.extractColumnLength(column.column_type),
      nullable: column.is_nullable === 'YES',
      defaultValue: column.column_default ?? '',
      label: column.label || '',
    } : this.emptyColumnForm();
    this.columnFormError = '';
    this.showColumnModal = true;
    this.cdr.markForCheck();
  }

  private normalizeColumnType(type: string): string {
    const t = String(type || '').toUpperCase();
    for (const candidate of ['VARCHAR', 'CHAR', 'LONGTEXT', 'TEXT', 'BIGINT', 'INT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'DATETIME', 'TIMESTAMP', 'DATE', 'JSON']) {
      if (t.includes(candidate)) return candidate;
    }
    if (t.includes('BOOLEAN') || t.includes('TINYINT(1)')) return 'BOOLEAN';
    return 'VARCHAR';
  }

  private extractColumnLength(columnType: string): number {
    const m = String(columnType || '').match(/\((\d+)/);
    return m ? Number(m[1]) : 100;
  }

  needsLength(type: string): boolean {
    const t = String(type || '').toUpperCase();
    return t === 'VARCHAR' || t === 'CHAR' || t === 'DECIMAL';
  }

  saveColumn(): void {
    this.columnFormError = '';
    if (!this.selectedTable) {
      this.columnFormError = 'Select a table first.';
      return;
    }
    if (!this.columnForm.name?.trim()) {
      this.columnFormError = 'Column name is required.';
      return;
    }

    this.actionLoading = true;
    const payload = {
      name: this.columnForm.name,
      newName: this.columnForm.name,
      type: this.columnForm.type,
      length: this.needsLength(this.columnForm.type) ? this.columnForm.length : null,
      nullable: this.columnForm.nullable,
      defaultValue: this.columnForm.defaultValue,
      label: this.columnForm.label,
    };

    const req$ = this.editingColumn
      ? this.api.patch<any>('/admin/schema/tables/' + this.selectedTable + '/columns/' + this.editingColumn.column_name, payload)
      : this.api.post<any>('/admin/schema/tables/' + this.selectedTable + '/columns', payload);

    req$.subscribe({
      next: () => {
        this.actionLoading = false;
        this.showColumnModal = false;
        this.toast.success(this.editingColumn ? 'Column updated.' : 'Column added.');
        this.loadTableColumns(this.selectedTable);
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.columnFormError = err?.error?.message || 'Failed to save column.';
        this.cdr.markForCheck();
      }
    });
  }

  async deleteColumn(column: any): Promise<void> {
    if (column.is_protected) {
      this.toast.warning('Protected columns cannot be deleted.');
      return;
    }
    const ok = await this.confirm.confirm(
      `Drop column "${column.column_name}" from table "${this.selectedTable}"? All data in this column will be permanently lost.`,
      'Drop Database Column'
    );
    if (!ok) return;

    this.actionLoading = true;
    this.api.delete<any>('/admin/schema/tables/' + this.selectedTable + '/columns/' + column.column_name).subscribe({
      next: () => {
        this.actionLoading = false;
        this.toast.success('Column dropped.');
        this.loadTableColumns(this.selectedTable);
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.toast.error(err?.error?.message || 'Failed to delete column.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── UI Section Customization ─────────────────────────────────────────────
  loadUiCatalog(): void {
    this.api.get<any>('/admin/ui-sections/catalog').pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.uiSectionCatalog = res.data || {};
        this.uiSections = Object.keys(this.uiSectionCatalog);
        if (!this.selectedUiSection && this.uiSections.length) {
          this.selectedUiSection = this.uiSections[0];
        }
        this.loadUiPreferences();
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  async onUiSelectionChange(patch: { section?: string; scope?: 'table' | 'form'; role?: string }): Promise<void> {
    if (!(await this.confirmDiscardIfDirty())) return;
    if (patch.section !== undefined) this.selectedUiSection = patch.section;
    if (patch.scope !== undefined) this.selectedUiScope = patch.scope;
    if (patch.role !== undefined) this.selectedUiRole = patch.role;
    this.loadUiPreferences();
  }

  loadUiPreferences(): void {
    if (!this.selectedUiSection) return;
    const seq = ++this.uiLoadSeq;
    this.loading = true;
    this.api.get<any>('/admin/ui-sections/' + this.selectedUiSection + '/preferences', {
      role: this.selectedUiRole,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (seq !== this.uiLoadSeq) return;
        const data = res.data || {};
        const saved = ((this.selectedUiScope === 'table' ? data.table : data.form) || []) as any[];
        this.uiFieldsEditor = saved
          .map((f, idx) => ({
            field_key: f.field_key,
            label: f?.label || '',
            is_visible: !(f?.is_visible === false || f?.is_visible === 0 || f?.is_visible === '0'),
            display_order: Number(f?.display_order || idx + 1),
            source: f?.source || 'default',
          }))
          .sort((a, b) => a.display_order - b.display_order);

        this.uiSnapshot = this.serializeUiFields(this.uiFieldsEditor);
        this.recomputeUiState();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        if (seq !== this.uiLoadSeq) return;
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load section preferences.');
        this.cdr.markForCheck();
      }
    });
  }

  setAllUiVisibility(visible: boolean): void {
    this.uiFieldsEditor = this.uiFieldsEditor.map(f => ({ ...f, is_visible: visible }));
    this.recomputeUiState();
    this.cdr.markForCheck();
  }

  moveUiField(field: any, direction: number): void {
    const idx = this.uiFieldsEditor.findIndex(f => f.field_key === field.field_key);
    const nextIdx = idx + direction;
    if (idx < 0 || nextIdx < 0 || nextIdx >= this.uiFieldsEditor.length) return;
    const clone = [...this.uiFieldsEditor];
    [clone[idx], clone[nextIdx]] = [clone[nextIdx], clone[idx]];
    this.uiFieldsEditor = clone.map((f, i) => ({ ...f, display_order: i + 1 }));
    this.recomputeUiState();
    this.cdr.markForCheck();
  }

  saveUiPreferences(): void {
    if (!this.selectedUiSection) return;
    this.actionLoading = true;
    const payload = {
      scope: this.selectedUiScope,
      role_name: this.selectedUiRole,
      fields: this.uiFieldsEditor.map((f, i) => ({
        field_key: f.field_key,
        label: f.label || null,
        is_visible: f.is_visible !== false,
        display_order: i + 1,
      })),
    };
    this.api.put<any>('/admin/ui-sections/' + this.selectedUiSection + '/preferences', payload).subscribe({
      next: () => {
        this.actionLoading = false;
        this.toast.success('Section preferences saved.');
        this.loadUiPreferences();
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.toast.error(err?.error?.message || 'Failed to save section preferences.');
        this.cdr.markForCheck();
      }
    });
  }

  async resetUiPreferences(): Promise<void> {
    if (!this.selectedUiSection) return;
    const msg = this.selectedUiRole === 'ALL'
      ? 'Reset this scope to defaults for all roles?'
      : `Reset this scope for role "${this.selectedUiRole}" only?`;
    const ok = await this.confirm.confirm(msg, 'Reset to Default');
    if (!ok) return;

    this.actionLoading = true;
    this.api.delete<any>('/admin/ui-sections/' + this.selectedUiSection + '/preferences', {
      scope: this.selectedUiScope,
      role: this.selectedUiRole,
    }).subscribe({
      next: () => {
        this.actionLoading = false;
        this.toast.success('Preferences reset to default.');
        this.loadUiPreferences();
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.toast.error(err?.error?.message || 'Failed to reset preferences.');
        this.cdr.markForCheck();
      }
    });
  }
}
