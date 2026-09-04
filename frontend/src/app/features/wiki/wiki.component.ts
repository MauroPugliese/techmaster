// =============================================================================
// wiki.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ApiService } from '../../core/services/services';
import { UiCustomizationService, UiSectionPreferences } from '../../core/services/services';
import { WikiArticle, WikiCategory } from '../../core/models/interfaces';
import { ToastService }   from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ExportMenuComponent } from '../../shared/components/export-menu/export-menu.component';

@Component({
  selector: 'app-wiki',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, ExportMenuComponent],
  templateUrl: './wiki.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private search$  = new Subject<string>();
  Math = Math;

  articles:       WikiArticle[] = [];
  pinnedArticles: WikiArticle[] = [];
  categories:     WikiCategory[] = [];
  loading         = true;
  saving          = false;
  total           = 0;
  page            = 1;
  pageSize        = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];

  searchQuery       = '';
  statusFilter      = 'PUBLISHED';
  selectedCategory: number | null = null;

  viewingArticle:  WikiArticle | null = null;
  showEditor       = false;
  editingArticle:  WikiArticle | null = null;
  articleForm:     Partial<WikiArticle> = this.emptyArticle();
  articleTagsInput = '';
  showMarkdownLegend = true;
  showPreviewDialog = false;
  uiPrefs: UiSectionPreferences | null = null;
  readonly markdownLegend = [
    { syntax: '# Heading', description: 'Large section title' },
    { syntax: '## Subheading', description: 'Secondary section title' },
    { syntax: '**bold**', description: 'Bold text' },
    { syntax: '*italic*', description: 'Italic text' },
    { syntax: '- item', description: 'Bullet list item' },
    { syntax: '1. item', description: 'Numbered list item' },
    { syntax: '[label](https://example.com)', description: 'Link' },
    { syntax: '`code`', description: 'Inline code' },
    { syntax: '```\ncode block\n```', description: 'Code block' },
    { syntax: '> quote', description: 'Blockquote' },
    { syntax: '---', description: 'Horizontal divider' },
    { syntax: '![alt text](https://image-url)', description: 'Image' }
  ];

  constructor(
    private api: ApiService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef,
    private toast: ToastService,
    private confirm: ConfirmService,
  ) {}

  ngOnInit(): void {
    marked.setOptions({ gfm: true, breaks: true });

    this.uiCustomization.load('wiki').subscribe(p => {
      this.uiPrefs = p;
      this.cdr.markForCheck();
    });

    this.api.get<any>('/wiki/categories').subscribe(res => {
      this.categories = res.data;
      this.cdr.markForCheck();
    });

    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadArticles();
      });

    this.loadArticles();
  }

  loadArticles(): void {
    this.loading = true;
    this.api.get<any>('/wiki/articles', {
      status:      this.statusFilter,
      category_id: this.selectedCategory || '',
      search:      this.searchQuery,
      page: this.page,
      limit: this.pageSize
    }).subscribe({
      next: res => {
        this.articles       = res.data.items;
        this.pinnedArticles = this.articles.filter(a => a.is_pinned);
        this.total          = res.data.total;
        this.loading        = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  onSearch(): void { this.search$.next(this.searchQuery); }
  filterByCategory(id: number): void {
    this.selectedCategory = id;
    this.page = 1;
    this.loadArticles();
  }
  clearCategory(): void {
    this.selectedCategory = null;
    this.page = 1;
    this.loadArticles();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
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

  viewArticle(a: WikiArticle): void {
    this.api.get<any>(`/wiki/articles/${a.slug}`).subscribe(res => {
      this.viewingArticle = res.data;
      this.cdr.markForCheck();
    });
  }

  openEditor(): void {
    this.editingArticle  = null;
    this.articleForm     = this.emptyArticle();
    this.articleTagsInput = '';
    this.showEditor      = true;
  }

  editArticle(a: WikiArticle): void {
    this.editingArticle  = a;
    this.articleForm     = { ...a };
    this.articleTagsInput = (a.tags || []).join(', ');
    this.showEditor      = true;
  }

  closeEditor(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) this.showEditor = false;
  }

  saveArticle(): void {
    if (this.showFormField('title') && !this.articleForm.title) return;
    if (this.showFormField('content') && !this.articleForm.content) return;
    this.saving = true;
    this.articleForm.tags = this.articleTagsInput
      ? this.articleTagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isEdit = !!this.editingArticle;
    const req$   = isEdit
      ? this.api.put<any>(`/wiki/articles/${this.editingArticle!.id}`, this.articleForm)
      : this.api.post<any>('/wiki/articles', this.articleForm);
    req$.subscribe({
      next: () => {
        this.saving = false; this.showEditor = false; this.loadArticles();
        this.toast.success(isEdit ? 'Article updated.' : 'Article published.');
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save article.');
        this.cdr.markForCheck();
      }
    });
  }

  exportArticlesCsv(): void {
    if (!this.articles.length) {
      this.toast.info('No articles available to export.');
      return;
    }

    const headers = ['Title', 'Category', 'Status', 'Author', 'Views', 'Updated At'];
    const rows = this.articles.map(a => [
      this.escapeCsv(a.title),
      this.escapeCsv(a.category?.name || ''),
      a.status || '',
      this.escapeCsv(`${a.author?.first_name || ''} ${a.author?.last_name || ''}`.trim()),
      String(a.view_count || 0),
      a.updated_at || ''
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wiki_articles_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: string): string {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  async deleteArticle(a: WikiArticle): Promise<void> {
    const ok = await this.confirm.confirm(`Delete "${a.title}"? This cannot be undone.`, 'Delete Article');
    if (!ok) return;
    this.api.delete<any>(`/wiki/articles/${a.id}`).subscribe({
      next: () => { this.loadArticles(); this.toast.success('Article deleted.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to delete.')
    });
  }

  togglePin(a: WikiArticle): void {
    this.api.put<any>(`/wiki/articles/${a.id}`, { is_pinned: !a.is_pinned }).subscribe({
      next: () => { this.loadArticles(); this.toast.info(a.is_pinned ? 'Article unpinned.' : 'Article pinned.'); },
      error: (e: any) => this.toast.error(e?.error?.message || 'Failed to update.')
    });
  }

  renderContent(md: string): string {
    if (!md?.trim()) return '';
    const html = marked.parse(md, { async: false }) as string;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  openPreviewDialog(): void {
    const source = String(this.articleForm.content || '').trim();
    if (!source) {
      this.toast.info('Write some content first, then open preview.');
      return;
    }
    this.showPreviewDialog = true;
  }

  closePreviewDialog(event?: MouseEvent): void {
    if (!event) {
      this.showPreviewDialog = false;
      return;
    }
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showPreviewDialog = false;
    }
  }

  insertMarkdownTemplate(): void {
    if (String(this.articleForm.content || '').trim()) return;
    this.articleForm.content = [
      '# Overview',
      '',
      'Write a short summary of this article.',
      '',
      '## Steps',
      '',
      '1. First step',
      '2. Second step',
      '3. Final step',
      '',
      '## Notes',
      '',
      '- Important detail',
      '- Risk or warning',
      '',
      '## References',
      '',
      '- [Official Documentation](https://example.com)'
    ].join('\n');
  }

  async exportCurrentArticle(format: 'xlsx' | 'pdf' | 'docx'): Promise<void> {
    if (!this.viewingArticle?.id) {
      this.toast.info('Open an article first to export it.');
      return;
    }
    try {
      const token = localStorage.getItem('access_token');
      const url = `${this.api.baseUrl}/export/wiki/${this.viewingArticle.id}?format=${format}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `wiki_${this.viewingArticle.slug || this.viewingArticle.id}.${format}`;
      a.click();
      URL.revokeObjectURL(href);
      this.toast.success(`Wiki article exported (${format.toUpperCase()}).`);
    } catch {
      this.toast.error('Wiki export failed.');
    }
  }
  getArticleStatusBadge(s: string): string {
    const m: Record<string,string> = { 'PUBLISHED':'badge-completed','DRAFT':'badge-planned','REVIEW':'badge-in-progress','ARCHIVED':'badge-cancelled' };
    return m[s] || 'badge-planned';
  }

  private emptyArticle(): Partial<WikiArticle> {
    return { title: '', content: '', excerpt: '', status: 'DRAFT', category_id: undefined, tags: [] };
  }

  showTableField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'table', fieldKey, true);
  }

  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}


