// =============================================================================
// wiki-sidebar.component.ts — Nested Categories Tree, Counts, Pinned & CRUD
// =============================================================================
import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ApiService, ConfirmService, ToastService } from '../../../../core/services/services';
import { WikiArticle, WikiCategory } from '../../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../../shared/components/dropdown/dropdown.component';
import { WIKI_ICON_CHOICES } from '../../wiki-templates';

@Component({
  selector: 'app-wiki-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  templateUrl: './wiki-sidebar.component.html',
  styleUrls: ['./wiki-sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiSidebarComponent implements OnChanges, OnDestroy {
  @Input() categories: WikiCategory[] = [];
  @Input() selectedCategoryId: number | null = null;
  @Input() pinnedArticles: WikiArticle[] = [];
  @Input() totalArticles = 0;
  @Input() activeArticleSlug: string | null = null;
  @Input() canManageCategories = false;
  @Input() collapsed = false;

  @Output() selectCategory    = new EventEmitter<number | null>();
  @Output() selectArticle     = new EventEmitter<WikiArticle>();
  @Output() toggleCollapse    = new EventEmitter<void>();
  @Output() categoriesChanged = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  expandedIds = new Set<number>();

  // Category modal state
  showCatModal = false;
  savingCat = false;
  editingCat: WikiCategory | null = null;
  catForm = { name: '', parent_id: null as number | null, icon: 'folder', sort_order: 0 };

  readonly iconChoices = WIKI_ICON_CHOICES;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['categories'] || changes['selectedCategoryId']) {
      this.ensureSelectedParentExpanded();
    }
  }

  get rootCategoryOptions(): WikiCategory[] {
    return this.categories.filter(c => !this.editingCat || c.id !== this.editingCat.id);
  }

  private ensureSelectedParentExpanded(): void {
    if (!this.selectedCategoryId) return;
    for (const root of this.categories) {
      if (root.children?.some(ch => ch.id === this.selectedCategoryId)) {
        const next = new Set(this.expandedIds);
        next.add(root.id);
        this.expandedIds = next;
        break;
      }
    }
  }

  toggleExpand(cat: WikiCategory, event: MouseEvent): void {
    event.stopPropagation();
    const next = new Set(this.expandedIds);
    if (next.has(cat.id)) next.delete(cat.id);
    else next.add(cat.id);
    this.expandedIds = next;
  }

  isExpanded(catId: number): boolean {
    return this.expandedIds.has(catId);
  }

  openCreateCategory(parentId: number | null = null, event?: MouseEvent): void {
    event?.stopPropagation();
    this.editingCat = null;
    this.catForm = { name: '', parent_id: parentId, icon: 'folder', sort_order: 0 };
    this.showCatModal = true;
  }

  openEditCategory(cat: WikiCategory, event: MouseEvent): void {
    event.stopPropagation();
    this.editingCat = cat;
    this.catForm = {
      name:       cat.name,
      parent_id:  cat.parent_id ?? null,
      icon:       cat.icon || 'folder',
      sort_order: cat.sort_order ?? 0
    };
    this.showCatModal = true;
  }

  closeCatModal(event?: MouseEvent): void {
    if (!event || (event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showCatModal = false;
    }
  }

  saveCategory(): void {
    const name = this.catForm.name.trim();
    if (!name || this.savingCat) return;

    this.savingCat = true;
    const isEdit = !!this.editingCat;
    const req$ = isEdit
      ? this.api.put<any>(`/wiki/categories/${this.editingCat!.id}`, { ...this.catForm, name })
      : this.api.post<any>('/wiki/categories', { ...this.catForm, name });

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.savingCat = false;
        this.showCatModal = false;
        this.toast.success(isEdit ? 'Category updated.' : 'Category created.');
        this.categoriesChanged.emit();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.savingCat = false;
        this.toast.error(e?.error?.message || 'Failed to save category.');
        this.cdr.markForCheck();
      }
    });
  }

  async removeCategory(cat: WikiCategory, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const ok = await this.confirm.confirm(
      `Delete category "${cat.name}"? Articles will become uncategorized.`,
      'Delete Category'
    );
    if (!ok) return;

    this.api.delete<any>(`/wiki/categories/${cat.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (this.selectedCategoryId === cat.id) this.selectCategory.emit(null);
        this.toast.success('Category deleted.');
        this.categoriesChanged.emit();
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete category.')
    });
  }

  trackById = (_: number, item: { id: number }) => item.id;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
