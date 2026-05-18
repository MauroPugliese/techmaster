// =============================================================================
// wiki.component.ts
// =============================================================================
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiService } from '../../core/services/services';
import { WikiArticle, WikiCategory } from '../../core/models/interfaces';
import { ToastService }   from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

@Component({
  selector: 'app-wiki',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './wiki.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private search$  = new Subject<string>();

  articles:       WikiArticle[] = [];
  pinnedArticles: WikiArticle[] = [];
  categories:     WikiCategory[] = [];
  loading         = true;
  saving          = false;
  total           = 0;

  searchQuery       = '';
  statusFilter      = 'PUBLISHED';
  selectedCategory: number | null = null;

  viewingArticle:  WikiArticle | null = null;
  showEditor       = false;
  editingArticle:  WikiArticle | null = null;
  articleForm:     Partial<WikiArticle> = this.emptyArticle();
  articleTagsInput = '';
  showPreview      = false;

  constructor(private api: ApiService, private cdr: ChangeDetectorRef, private toast: ToastService, private confirm: ConfirmService,) {}

  ngOnInit(): void {
    this.api.get<any>('/wiki/categories').subscribe(res => {
      this.categories = res.data;
      this.cdr.markForCheck();
    });

    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => this.loadArticles());

    this.loadArticles();
  }

  loadArticles(): void {
    this.loading = true;
    this.api.get<any>('/wiki/articles', {
      status:      this.statusFilter,
      category_id: this.selectedCategory || '',
      search:      this.searchQuery,
      limit: 50
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
  filterByCategory(id: number): void { this.selectedCategory = id; this.loadArticles(); }
  clearCategory(): void { this.selectedCategory = null; this.loadArticles(); }

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
    if (!this.articleForm.title || !this.articleForm.content) return;
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
    if (!md) return '';

    const safe = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return safe
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[h|l|p|u])(.+)$/gm, '<p>$1</p>');
  }

  togglePreview(): void {
    this.showPreview = !this.showPreview;
  }

  getArticleStatusBadge(s: string): string {
    const m: Record<string,string> = { 'PUBLISHED':'badge-completed','DRAFT':'badge-planned','REVIEW':'badge-in-progress','ARCHIVED':'badge-cancelled' };
    return m[s] || 'badge-planned';
  }

  private emptyArticle(): Partial<WikiArticle> {
    return { title: '', content: '', excerpt: '', status: 'DRAFT', category_id: undefined, tags: [] };
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}


// =============================================================================
// AUTH: login.component.html  (inline template version)
// =============================================================================
export const LOGIN_TEMPLATE = `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
            background:linear-gradient(135deg, var(--blue-950) 0%, var(--blue-800) 100%);
            padding:20px;position:relative;overflow:hidden">

  <!-- Background decoration -->
  <div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">
    <div style="position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;
                background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)"></div>
    <div style="position:absolute;bottom:-80px;left:-80px;width:300px;height:300px;border-radius:50%;
                background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)"></div>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                width:600px;height:600px;border-radius:50%;
                background:radial-gradient(circle,rgba(33,150,243,0.1) 0%,transparent 70%)"></div>
  </div>

  <div style="background:white;border-radius:24px;padding:48px;width:100%;max-width:440px;
              box-shadow:0 40px 80px rgba(0,0,0,0.4);position:relative;z-index:1;animation:slideUp 0.4s ease">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:36px">
      <div style="width:56px;height:56px;background:var(--blue-800);border-radius:16px;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:28px;color:#fff">dns</span>
      </div>
      <h1 style="font-size:1.6rem;margin-bottom:6px">Welcome back</h1>
      <p style="color:#6B7280;font-size:0.9rem">Sign in to TechManager Platform</p>
    </div>

    <form (ngSubmit)="login()" #f="ngForm">
      <div class="form-group">
        <label class="form-label">Email address</label>
        <input type="email" class="form-control" [(ngModel)]="credentials.email" name="email"
               placeholder="your@email.com" required style="padding:12px 16px;font-size:0.95rem">
      </div>
      <div class="form-group">
        <label class="form-label" style="display:flex;justify-content:space-between">
          Password
          <a href="#" style="color:var(--primary);font-weight:500;font-size:0.82rem">Forgot password?</a>
        </label>
        <div style="position:relative">
          <input [type]="showPassword ? 'text' : 'password'" class="form-control"
                 [(ngModel)]="credentials.password" name="password" placeholder="••••••••"
                 required style="padding:12px 16px;font-size:0.95rem;padding-right:48px">
          <button type="button" (click)="showPassword=!showPassword"
                  style="position:absolute;right:12px;top:50%;transform:translateY(-50%);
                         background:none;border:none;cursor:pointer;color:#9CA3AF">
            <span style="font-family:'Material Icons Round';font-style:normal;font-size:20px">
              {{showPassword ? 'visibility_off' : 'visibility'}}
            </span>
          </button>
        </div>
      </div>

      <div *ngIf="error" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:var(--radius-md);
                                 padding:10px 14px;font-size:0.875rem;color:#DC2626;margin-bottom:16px;
                                 display:flex;align-items:center;gap:8px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:18px">error</span>
        {{error}}
      </div>

      <button type="submit" class="btn btn-primary w-full" style="padding:13px;font-size:1rem;margin-top:4px" [disabled]="loading">
        <div class="spinner" *ngIf="loading" style="width:18px;height:18px;border-width:2px;border-top-color:#fff"></div>
        {{loading ? 'Signing in…' : 'Sign In'}}
      </button>
    </form>

    <div style="text-align:center;margin-top:24px;font-size:0.875rem;color:#6B7280">
      Don't have an account?
      <a routerLink="/auth/register" style="color:var(--primary);font-weight:600;margin-left:4px">Create account</a>
    </div>
  </div>
</div>
`;
