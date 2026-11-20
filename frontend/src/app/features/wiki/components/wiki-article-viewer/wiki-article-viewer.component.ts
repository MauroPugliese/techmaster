// =============================================================================
// wiki-article-viewer.component.ts — 2-Pane Docs Reader with Sticky TOC & Lightbox
// =============================================================================
import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

import { ToastService } from '../../../../core/services/services';
import { WikiArticle } from '../../../../core/models/interfaces';
import { ExportMenuComponent } from '../../../../shared/components/export-menu/export-menu.component';
import { RenderedMarkdown, TocHeading, WikiMarkdownService } from '../../wiki-markdown.service';
import { getArticleStatusBadge, getArticleStatusLabel } from '../../wiki-templates';

@Component({
  selector: 'app-wiki-article-viewer',
  standalone: true,
  imports: [CommonModule, DatePipe, ExportMenuComponent],
  templateUrl: './wiki-article-viewer.component.html',
  styleUrls: ['./wiki-article-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiArticleViewerComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() article!: WikiArticle;

  @Output() back          = new EventEmitter<void>();
  @Output() edit          = new EventEmitter<WikiArticle>();
  @Output() togglePin     = new EventEmitter<WikiArticle>();
  @Output() remove        = new EventEmitter<WikiArticle>();
  @Output() tagClick      = new EventEmitter<string>();
  @Output() categoryClick = new EventEmitter<number>();

  @ViewChild('proseContainer') proseRef?: ElementRef<HTMLDivElement>;

  rendered: RenderedMarkdown = { safeHtml: '', toc: [], hasMermaid: false, readingMinutes: 1 };
  activeHeadingId = '';
  readingProgress = 0;

  // Zoom Lightbox state (image URL or sanitized Mermaid SVG)
  lightboxImgSrc: string | null = null;
  lightboxSvgHtml: SafeHtml | null = null;

  private scrollTarget: HTMLElement | Window | null = null;
  private boundOnScroll = () => this.updateScrollTracking();
  private hydrateTimer: any = null;

  constructor(
    private mdSvc: WikiMarkdownService,
    private toast: ToastService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['article'] && this.article) {
      this.rendered = this.mdSvc.renderMarkdown(this.article.content || '');
      this.activeHeadingId = this.rendered.toc[0]?.id || '';
      this.readingProgress = 0;
      this.scheduleHydrate();
    }
  }

  ngAfterViewInit(): void {
    this.attachScrollListener();
    this.scheduleHydrate();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.lightboxImgSrc || this.lightboxSvgHtml) {
      this.closeLightbox();
    }
  }

  get authorName(): string {
    const a = this.article?.author;
    return a ? `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username || 'Author' : 'Unknown';
  }

  get lastEditorName(): string | null {
    const e = this.article?.lastEditor;
    if (!e) return null;
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.username;
    return name || null;
  }

  scrollToHeading(heading: TocHeading, event: MouseEvent): void {
    event.preventDefault();
    const el = document.getElementById(heading.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.activeHeadingId = heading.id;
    }
  }

  copyShareLink(): void {
    if (!this.article?.slug) return;
    const url = `${window.location.origin}/wiki?article=${encodeURIComponent(this.article.slug)}`;
    navigator.clipboard?.writeText(url).then(
      () => this.toast.success('Article link copied to clipboard.'),
      () => this.toast.info(`Share link: ${url}`)
    );
  }

  onProseClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const copyBtn = target.closest<HTMLButtonElement>('.wiki-copy-btn[data-copy-code]');
    if (copyBtn) {
      const code = decodeURIComponent(copyBtn.dataset['copyCode'] || '');
      navigator.clipboard?.writeText(code).then(() => {
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev || 'Copy'; }, 1800);
      });
      return;
    }

    const mermaidWrap = target.closest<HTMLElement>('.wiki-mermaid-host[data-rendered="1"]');
    if (mermaidWrap) {
      const svgEl = mermaidWrap.querySelector('svg');
      if (svgEl) {
        const cleanSvg = DOMPurify.sanitize(svgEl.outerHTML, {
          USE_PROFILES: { svg: true, svgFilters: true }
        });
        this.lightboxSvgHtml = this.sanitizer.bypassSecurityTrustHtml(cleanSvg);
        this.lightboxImgSrc = null;
        this.cdr.markForCheck();
      }
      return;
    }

    if (target.tagName === 'IMG') {
      const src = (target as HTMLImageElement).src;
      if (src) {
        this.lightboxImgSrc = src;
        this.lightboxSvgHtml = null;
        this.cdr.markForCheck();
      }
    }
  }

  closeLightbox(): void {
    this.lightboxImgSrc = null;
    this.lightboxSvgHtml = null;
  }

  private scheduleHydrate(): void {
    if (this.hydrateTimer) clearTimeout(this.hydrateTimer);
    this.hydrateTimer = setTimeout(() => {
      const el = this.proseRef?.nativeElement;
      if (el && this.rendered.hasMermaid) {
        this.mdSvc.hydrateMermaid(el);
      }
    }, 0);
  }

  private attachScrollListener(): void {
    const host = this.proseRef?.nativeElement;
    const container = host?.closest('.page-content') as HTMLElement | null;
    this.scrollTarget = container || window;
    this.scrollTarget.addEventListener('scroll', this.boundOnScroll, { passive: true });
  }

  private updateScrollTracking(): void {
    const container = this.scrollTarget instanceof HTMLElement ? this.scrollTarget : null;
    const scrollTop = container ? container.scrollTop : window.scrollY;
    const maxScroll = container
      ? Math.max(1, container.scrollHeight - container.clientHeight)
      : Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

    const nextPct = Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));

    let nextHeading = this.activeHeadingId;
    for (const h of this.rendered.toc) {
      const el = document.getElementById(h.id);
      if (el && el.getBoundingClientRect().top <= 150) {
        nextHeading = h.id;
      }
    }

    if (nextPct !== this.readingProgress || nextHeading !== this.activeHeadingId) {
      this.readingProgress = nextPct;
      this.activeHeadingId = nextHeading;
      this.cdr.markForCheck();
    }
  }

  readonly statusBadge = getArticleStatusBadge;
  readonly statusLabel = getArticleStatusLabel;

  ngOnDestroy(): void {
    if (this.hydrateTimer) clearTimeout(this.hydrateTimer);
    this.scrollTarget?.removeEventListener('scroll', this.boundOnScroll);
  }
}
