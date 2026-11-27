// =============================================================================
// wiki.component.ts — Full-Width GitBook Knowledge Workspace Orchestrator
// =============================================================================
import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';

import {
  ApiService, AuthService, ConfirmService, ToastService,
  UiCustomizationService, UiSectionPreferences
} from '../../core/services/services';
import { WikiArticle, WikiCategory } from '../../core/models/interfaces';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';
import { DropdownComponent, DropdownOptionComponent } from '../../shared/components/dropdown/dropdown.component';
import { WikiSidebarComponent } from './components/wiki-sidebar/wiki-sidebar.component';
import { WikiArticleViewerComponent } from './components/wiki-article-viewer/wiki-article-viewer.component';
import { WikiEditorComponent } from './components/wiki-editor/wiki-editor.component';
import {
  estimateReadingMinutes, getArticleStatusBadge, getArticleStatusLabel
} from './wiki-templates';

type ExplorerViewMode = 'cards' | 'table';
type SortOption = 'recent' | 'views' | 'title' | 'oldest';

export interface WikiTagFacet { tag: string; count: number; }

const LS_VIEW_MODE = 'wiki.viewMode.v1';
const LS_SIDEBAR   = 'wiki.sidebarCollapsed.v1';

@Component({
  selector: 'app-wiki',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    ExportMenuComponent,
    DropdownComponent,
    DropdownOptionComponent,
    WikiSidebarComponent,
    WikiArticleViewerComponent,
    WikiEditorComponent
  ],
  templateUrl: './wiki.component.html',
  styleUrls:   ['./wiki.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiComponent implements OnInit, OnDestroy {
  @ViewChild('wikiHost') wikiHostRef?: ElementRef<HTMLDivElement>;
  @ViewChild('tagPickerWrap') tagPickerWrapRef?: ElementRef<HTMLElement>;

  private destroy$ = new Subject<void>();
  private search$  = new Subject<string>();
  Math = Math;

  articles:       WikiArticle[] = [];
  pinnedArticles: WikiArticle[] = [];
  categories:     WikiCategory[] = [];
  availableTags:  WikiTagFacet[] = [];

  loading  = true;
  saving   = false;
  total    = 0;
  unfilteredTotal = 0;
  page     = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  // Tag bar & popover state
  readonly maxQuickTags = 5;
  showTagPicker  = false;
  tagPickerQuery = '';

  // Filters & view state
  searchQuery      = '';
  statusFilter     = 'ALL';
  selectedCategory: number | null = null;
  selectedTag:      string | null = null;
  sortBy: SortOption = 'recent';
  viewMode: ExplorerViewMode = this.restoreViewMode();
  sidebarCollapsed = this.restoreSidebar();

  // Active subviews
  viewingArticle: WikiArticle | null = null;
  showEditor      = false;
  editingArticle: WikiArticle | null = null;
  uiPrefs: UiSectionPreferences | null = null;

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef,
    private toast: ToastService,
    private confirm: ConfirmService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  get canManageCategories(): boolean {
    return this.auth.canManage;
  }

  get hasActiveFilters(): boolean {
    return (
      this.selectedCategory !== null ||
      this.selectedTag !== null ||
      this.statusFilter !== 'ALL' ||
      !!this.searchQuery.trim()
    );
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  get quickTags(): WikiTagFacet[] {
    return this.availableTags
      .filter(item => item.tag !== this.selectedTag)
      .slice(0, this.maxQuickTags);
  }

  get hiddenTagsCount(): number {
    const shownCount = this.quickTags.length + (this.selectedTag ? 1 : 0);
    return Math.max(0, this.availableTags.length - shownCount);
  }

  get filteredPickerTags(): WikiTagFacet[] {
    const q = this.tagPickerQuery.trim().toLowerCase();
    if (!q) return this.availableTags;
    return this.availableTags.filter(item => item.tag.toLowerCase().includes(q));
  }

  ngOnInit(): void {
    this.uiCustomization.load('wiki').pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.loadCategories();
    this.loadTags();
    this.loadArticles();

    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadArticles();
      });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const slug = params.get('article') || params.get('slug');
      if (slug && this.viewingArticle?.slug !== slug) {
        this.openArticleBySlug(slug, false);
      } else if (!slug && this.viewingArticle) {
        this.viewingArticle = null;
        this.cdr.markForCheck();
      }

      if (params.get('action') === 'new' && this.auth.canWrite) {
        setTimeout(() => {
          this.openEditor(null);
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { action: null },
            queryParamsHandling: 'merge',
            replaceUrl: true
          });
          this.cdr.markForCheck();
        }, 0);
      }
    });
  }

  loadCategories(): void {
    this.api.get<any>('/wiki/categories', { status: this.statusFilter })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.categories = res.data || [];
          this.cdr.markForCheck();
        }
      });
  }

  loadTags(): void {
    this.api.get<any>('/wiki/tags', { status: this.statusFilter })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.availableTags = res.data || [];
          this.cdr.markForCheck();
        }
      });
  }

  loadArticles(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.api.get<any>('/wiki/articles', {
      status:      this.statusFilter,
      category_id: this.selectedCategory || '',
      tag:         this.selectedTag || '',
      search:      this.searchQuery.trim(),
      sort:        this.sortBy,
      page:        this.page,
      limit:       this.pageSize
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.articles       = res.data.items || [];
        if (this.page === 1 || this.pinnedArticles.length === 0) {
          this.pinnedArticles = this.articles.filter(a => a.is_pinned);
        }
        this.total          = res.data.total || 0;
        if (this.selectedCategory === null && !this.selectedTag && !this.searchQuery.trim()) {
          this.unfilteredTotal = this.total;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(): void {
    this.search$.next(this.searchQuery);
  }

  onStatusChange(nextStatus: string): void {
    this.statusFilter = nextStatus || 'ALL';
    this.page = 1;
    this.loadCategories();
    this.loadTags();
    this.loadArticles();
  }

  onSortChange(nextSort: SortOption): void {
    this.sortBy = nextSort || 'recent';
    this.page = 1;
    this.loadArticles();
  }

  selectCategoryFromRail(catId: number | null): void {
    this.selectedCategory = catId;
    this.page = 1;
    this.closeArticleView();
    this.loadArticles();
  }

  filterByTag(tag: string | null): void {
    this.selectedTag = this.selectedTag === tag ? null : tag;
    this.page = 1;
    this.closeArticleView();
    this.loadArticles();
  }

  toggleTagPicker(event: MouseEvent): void {
    event.stopPropagation();
    this.showTagPicker = !this.showTagPicker;
    if (this.showTagPicker) {
      this.tagPickerQuery = '';
    }
  }

  selectTagFromPicker(tag: string | null): void {
    this.showTagPicker = false;
    this.tagPickerQuery = '';
    this.filterByTag(tag);
  }

  @HostListener('document:click', ['$event.target'])
  onDocumentClick(target: EventTarget | null): void {
    if (this.showTagPicker && target instanceof Node && !this.tagPickerWrapRef?.nativeElement.contains(target)) {
      this.showTagPicker = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showTagPicker) {
      this.showTagPicker = false;
      this.cdr.markForCheck();
    }
  }

  clearAllFilters(): void {
    this.selectedCategory = null;
    this.selectedTag      = null;
    this.statusFilter     = 'ALL';
    this.searchQuery      = '';
    this.showTagPicker    = false;
    this.tagPickerQuery   = '';
    this.page             = 1;
    this.loadCategories();
    this.loadTags();
    this.loadArticles();
  }

  setViewMode(mode: ExplorerViewMode): void {
    this.viewMode = mode;
    try { localStorage.setItem(LS_VIEW_MODE, mode); } catch { /* noop */ }
  }

  toggleSidebarCollapse(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem(LS_SIDEBAR, String(this.sidebarCollapsed)); } catch { /* noop */ }
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.loadArticles();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadArticles();
  }

  // ── Article Detail / Deep-Link Navigation ──────────────────────────────────
  viewArticle(a: WikiArticle): void {
    this.openArticleBySlug(a.slug || String(a.id), true);
  }

  private openArticleBySlug(slug: string, syncUrl: boolean): void {
    this.api.get<any>(`/wiki/articles/${encodeURIComponent(slug)}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.viewingArticle = res.data;
          if (syncUrl && res.data?.slug) {
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { article: res.data.slug },
              queryParamsHandling: 'merge',
              replaceUrl: true
            });
          }
          const pageContent = this.wikiHostRef?.nativeElement.closest('.page-content') as HTMLElement | null;
          pageContent?.scrollTo({ top: 0, behavior: 'smooth' });
          this.cdr.markForCheck();
        },
        error: () => {
          this.toast.error('Requested document was not found.');
          this.closeArticleView();
        }
      });
  }

  closeArticleView(): void {
    this.viewingArticle = null;
    if (this.route.snapshot.queryParamMap.has('article') || this.route.snapshot.queryParamMap.has('slug')) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { article: null, slug: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  // ── Editor CRUD ────────────────────────────────────────────────────────────
  openEditor(article: WikiArticle | null = null): void {
    if (!this.auth.canWrite) return;
    this.editingArticle = article;
    this.showEditor     = true;
  }

  onEditorSave(ev: { id: number | null; payload: any }): void {
    this.saving = true;
    const isEdit = ev.id !== null;
    const req$ = isEdit
      ? this.api.put<any>(`/wiki/articles/${ev.id}`, ev.payload)
      : this.api.post<any>('/wiki/articles', ev.payload);

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const saved: WikiArticle = res.data;
        this.saving     = false;
        this.showEditor = false;
        if (this.viewingArticle && saved && this.viewingArticle.id === saved.id) {
          this.viewingArticle = saved;
        } else if (!isEdit && saved?.slug) {
          this.viewingArticle = saved;
        }
        this.loadCategories();
        this.loadTags();
        this.loadArticles();
        this.toast.success(isEdit ? 'Document updated.' : 'Document saved.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save document.');
        this.cdr.markForCheck();
      }
    });
  }

  togglePin(a: WikiArticle, event?: MouseEvent): void {
    event?.stopPropagation();
    const nextPinned = !a.is_pinned;
    this.api.patch<any>(`/wiki/articles/${a.id}/pin`, { is_pinned: nextPinned })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          const updated: WikiArticle = res.data || { ...a, is_pinned: nextPinned };
          this.articles       = this.articles.map(item => item.id === a.id ? updated : item);
          this.pinnedArticles = this.articles.filter(item => item.is_pinned);
          if (this.viewingArticle?.id === a.id) this.viewingArticle = updated;
          this.toast.info(nextPinned ? 'Document pinned.' : 'Document unpinned.');
          this.cdr.markForCheck();
        },
        error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update pin.')
      });
  }

  async deleteArticle(a: WikiArticle, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const ok = await this.confirm.confirm(`Delete "${a.title}"? This cannot be undone.`, 'Delete Document');
    if (!ok) return;

    this.api.delete<any>(`/wiki/articles/${a.id}`).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (this.viewingArticle?.id === a.id) this.closeArticleView();
        this.loadCategories();
        this.loadTags();
        this.loadArticles();
        this.toast.success('Document deleted.');
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  // ── Preferences & Field Mapping ────────────────────────────────────────────
  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  readonly readingMinutes = estimateReadingMinutes;
  readonly statusBadge    = getArticleStatusBadge;
  readonly statusLabel    = getArticleStatusLabel;

  trackById = (_: number, item: { id: number }) => item.id;

  private restoreViewMode(): ExplorerViewMode {
    try {
      return localStorage.getItem(LS_VIEW_MODE) === 'table' ? 'table' : 'cards';
    } catch { return 'cards'; }
  }

  private restoreSidebar(): boolean {
    try { return localStorage.getItem(LS_SIDEBAR) === 'true'; }
    catch { return false; }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
