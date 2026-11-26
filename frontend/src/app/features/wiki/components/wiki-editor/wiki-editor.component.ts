// =============================================================================
// wiki-editor.component.ts — Full-Screen Dual-Mode (TipTap Visual + MD Split)
// =============================================================================
import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy,
  ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

import { ApiService, ConfirmService, ToastService, UiCustomizationService, UiSectionPreferences } from '../../../../core/services/services';
import { ArticleStatus, WikiArticle, WikiCategory } from '../../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../../shared/components/dropdown/dropdown.component';
import { RenderedMarkdown, WikiMarkdownService } from '../../wiki-markdown.service';
import {
  FlatCategoryOption, WIKI_TEMPLATES, WikiTemplateOption, flattenCategories
} from '../../wiki-templates';

type EditorMode = 'visual' | 'split';

interface SlashCommandItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run: (editor: Editor, from: number, to: number) => void;
}

const LS_EDITOR_MODE = 'wiki.editorMode.v1';

const MERMAID_STARTER = [
  'flowchart LR',
  '  A["Step 1: Verify Safety"] --> B["Step 2: Execute"]',
  '  B --> C["Step 3: Sign Off"]'
].join('\n');

@Component({
  selector: 'app-wiki-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  templateUrl: './wiki-editor.component.html',
  styleUrls: ['./wiki-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WikiEditorComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() article: WikiArticle | null = null;
  @Input() categories: WikiCategory[] = [];
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Input() saving = false;

  @Output() close = new EventEmitter<void>();
  @Output() save  = new EventEmitter<{ id: number | null; payload: any }>();
  @Output() categoriesChanged = new EventEmitter<void>();

  @ViewChild('tiptapHost')  tiptapHostRef?: ElementRef<HTMLDivElement>;
  @ViewChild('mdTextarea')  mdTextareaRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('splitPreview') splitPreviewRef?: ElementRef<HTMLDivElement>;

  editorMode: EditorMode = this.restoreMode();
  showMetaBar = true;
  showTemplatesMenu = false;

  // Form fields (immutable snapshots synced cleanly)
  title       = '';
  status: ArticleStatus = 'DRAFT';
  categoryId: number | null = null;
  excerpt     = '';
  tagsList: string[] = [];
  tagDraft    = '';
  isPinned    = false;
  markdownSource = '';

  // Visual editor + popovers
  private editor: Editor | null = null;
  private initialSnapshot = '';
  private mermaidTimer: any = null;
  livePreview: RenderedMarkdown = { safeHtml: '', toc: [], hasMermaid: false, readingMinutes: 1 };

  showLinkBox  = false;
  linkUrlDraft = '';
  showImgBox   = false;
  imgUrlDraft  = '';

  // Slash command state
  slashItems: SlashCommandItem[] = [];
  slashIndex = 0;
  slashRange: { from: number; to: number } | null = null;
  slashPos = { top: 24, left: 24 };

  readonly templates = WIKI_TEMPLATES;
  readonly slashCatalog: SlashCommandItem[] = [
    {
      id: 'h1', label: 'Heading 1', hint: 'Major section title', icon: 'title',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).toggleHeading({ level: 1 }).run()
    },
    {
      id: 'h2', label: 'Heading 2', hint: 'Subsection heading', icon: 'text_fields',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).toggleHeading({ level: 2 }).run()
    },
    {
      id: 'checklist', label: 'Task Checklist', hint: 'Interactive SOP steps', icon: 'check_box',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).toggleTaskList().run()
    },
    {
      id: 'table', label: 'Table (3x3)', hint: 'Structured matrix', icon: 'table_chart',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      id: 'code', label: 'Code Block', hint: 'Terminal / SQL / YAML', icon: 'code',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).setCodeBlock({ language: 'bash' }).run()
    },
    {
      id: 'mermaid', label: 'Mermaid Diagram', hint: 'Flowchart from text', icon: 'account_tree',
      run: (ed, from, to) => {
        ed.chain().focus().deleteRange({ from, to })
          .insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: MERMAID_STARTER }] })
          .run();
      }
    },
    {
      id: 'warning', label: 'Warning Callout', hint: 'Safety / LOTO notice', icon: 'warning',
      run: (ed, from, to) => {
        ed.chain().focus().deleteRange({ from, to })
          .setBlockquote()
          .insertContent('[!WARNING]\nVerify panel isolation before servicing.')
          .run();
      }
    },
    {
      id: 'tip', label: 'Tip Callout', hint: 'Best-practice guidance', icon: 'lightbulb',
      run: (ed, from, to) => {
        ed.chain().focus().deleteRange({ from, to })
          .setBlockquote()
          .insertContent('[!TIP]\nAdd diagnostic commands here.')
          .run();
      }
    },
    {
      id: 'divider', label: 'Divider', hint: 'Horizontal separator', icon: 'horizontal_rule',
      run: (ed, from, to) => ed.chain().focus().deleteRange({ from, to }).setHorizontalRule().run()
    }
  ];

  flatCategories: FlatCategoryOption[] = [];
  wordCount = 0;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private mdSvc: WikiMarkdownService,
    private confirm: ConfirmService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['categories']) {
      this.flatCategories = flattenCategories(this.categories);
    }
    const openedNow = !!changes['open']?.currentValue && !changes['open']?.previousValue;
    const closedNow = !changes['open']?.currentValue && !!changes['open']?.previousValue;

    if (closedNow) {
      this.destroyEditor();
      return;
    }

    if (openedNow || (this.open && changes['article'])) {
      this.initFromArticle();
    }
  }

  private recomputeWordCount(md?: string): void {
    const text = (md !== undefined ? md : this.currentMarkdown()).trim();
    this.wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  quickCreateCategory(rawName: string): void {
    const name = rawName.trim();
    if (!name) return;
    this.api.post<any>('/wiki/categories', { name }).subscribe({
      next: res => {
        const created: WikiCategory = res?.data;
        if (created) {
          this.categories = [...this.categories, created];
          this.flatCategories = flattenCategories(this.categories);
          this.categoryId = created.id;
          this.toast.success(`Wiki category "${created.name}" created.`);
          this.categoriesChanged.emit();
          this.cdr.markForCheck();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Unable to create wiki category.')
    });
  }

  private initFromArticle(): void {
    this.showTemplatesMenu = false;
    this.showLinkBox = false;
    this.showImgBox = false;
    this.closeSlashMenu();
    this.tagDraft = '';

    if (this.article) {
      this.title          = this.article.title || '';
      this.status         = this.article.status || 'DRAFT';
      this.categoryId     = this.article.category_id ?? null;
      this.excerpt        = this.article.excerpt || '';
      this.tagsList       = [...(this.article.tags || [])];
      this.isPinned       = Boolean(this.article.is_pinned);
      this.markdownSource = this.article.content || '';
    } else {
      this.title          = '';
      this.status         = 'DRAFT';
      this.categoryId     = null;
      this.excerpt        = '';
      this.tagsList       = [];
      this.isPinned       = false;
      this.markdownSource = '';
    }

    this.initialSnapshot = this.buildSnapshot(this.markdownSource);
    this.recomputeWordCount(this.markdownSource);
    this.destroyEditor();

    if (this.editorMode === 'visual') {
      setTimeout(() => this.mountTipTap(), 0);
    } else {
      this.refreshSplitPreview();
    }
    this.cdr.markForCheck();
  }

  // ── Mode Switching (Visual <-> Markdown Split) ─────────────────────────────
  setMode(mode: EditorMode): void {
    if (this.editorMode === mode) return;
    if (mode === 'split') {
      this.markdownSource = this.currentMarkdown();
      this.destroyEditor();
      this.editorMode = 'split';
      this.refreshSplitPreview();
    } else {
      this.editorMode = 'visual';
      setTimeout(() => this.mountTipTap(), 0);
    }
    try { localStorage.setItem(LS_EDITOR_MODE, mode); } catch { /* noop */ }
  }

  private currentMarkdown(): string {
    if (this.editorMode === 'visual' && this.editor) {
      return (this.editor.storage as any).markdown?.getMarkdown() ?? this.markdownSource;
    }
    return this.markdownSource;
  }

  // ── TipTap v2 Initialization & Formatting Commands ─────────────────────────
  private mountTipTap(): void {
    const host = this.tiptapHostRef?.nativeElement;
    if (!host || !this.open || this.editorMode !== 'visual') return;
    this.destroyEditor();

    this.editor = new Editor({
      element: host,
      extensions: [
        StarterKit,
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' }
        }),
        Image,
        Placeholder.configure({
          placeholder: 'Start writing documentation or type "/" for headings, tables, checklists & Mermaid diagrams…'
        }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown.configure({
          html: true,
          tightLists: true,
          transformPastedText: true,
          transformCopiedText: true
        })
      ],
      content: this.markdownSource,
      editorProps: {
        handleKeyDown: (_view, event) => this.handleEditorKeydown(event)
      },
      onUpdate: () => {
        this.recomputeWordCount();
        this.detectSlashQuery();
        this.cdr.markForCheck();
      },
      onSelectionUpdate: () => {
        this.detectSlashQuery();
        this.cdr.markForCheck();
      }
    });
    this.cdr.markForCheck();
  }

  private destroyEditor(): void {
    if (this.mermaidTimer) clearTimeout(this.mermaidTimer);
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  get ed(): Editor | null { return this.editor; }

  toggleHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
    this.cdr.markForCheck();
  }

  toggleMark(mark: 'bold' | 'italic' | 'strike' | 'code'): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    if (mark === 'bold') chain.toggleBold().run();
    else if (mark === 'italic') chain.toggleItalic().run();
    else if (mark === 'strike') chain.toggleStrike().run();
    else chain.toggleCode().run();
    this.cdr.markForCheck();
  }

  toggleBlock(kind: 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock'): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    if (kind === 'bulletList') chain.toggleBulletList().run();
    else if (kind === 'orderedList') chain.toggleOrderedList().run();
    else if (kind === 'taskList') chain.toggleTaskList().run();
    else if (kind === 'blockquote') chain.toggleBlockquote().run();
    else chain.toggleCodeBlock().run();
    this.cdr.markForCheck();
  }

  execAction(action: 'undo' | 'redo' | 'hr' | 'insertTable' | 'addRow' | 'addCol' | 'deleteTable'): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    if (action === 'undo') chain.undo().run();
    else if (action === 'redo') chain.redo().run();
    else if (action === 'hr') chain.setHorizontalRule().run();
    else if (action === 'insertTable') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (action === 'addRow') chain.addRowAfter().run();
    else if (action === 'addCol') chain.addColumnAfter().run();
    else chain.deleteTable().run();
    this.cdr.markForCheck();
  }

  insertCallout(kind: 'WARNING' | 'TIP' | 'CAUTION'): void {
    if (!this.editor) return;
    this.editor.chain().focus().setBlockquote().insertContent(`[!${kind}]\nWrite notice here.`).run();
  }

  insertMermaidNode(): void {
    if (!this.editor) return;
    this.editor.chain().focus()
      .insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: MERMAID_STARTER }] })
      .run();
  }

  applyLink(): void {
    if (!this.editor) return;
    const url = this.linkUrlDraft.trim();
    if (!url) {
      this.editor.chain().focus().unsetLink().run();
    } else {
      this.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    this.showLinkBox = false;
    this.linkUrlDraft = '';
  }

  applyImage(): void {
    if (!this.editor) return;
    const src = this.imgUrlDraft.trim();
    if (src) this.editor.chain().focus().setImage({ src }).run();
    this.showImgBox = false;
    this.imgUrlDraft = '';
  }

  // ── Slash Menu Detection & Navigation ──────────────────────────────────────
  private detectSlashQuery(): void {
    if (!this.editor) return;
    const { selection } = this.editor.state;
    const { $from, empty } = selection;
    if (!empty) { this.closeSlashMenu(); return; }

    const before = $from.parent.textContent.slice(0, $from.parentOffset);
    const match = /(?:^|\s)(\/[a-z0-9-]*)$/i.exec(before);
    if (!match) { this.closeSlashMenu(); return; }

    const query = match[1].slice(1).toLowerCase();
    const filtered = this.slashCatalog.filter(item =>
      item.label.toLowerCase().includes(query) || item.hint.toLowerCase().includes(query)
    );
    if (!filtered.length) { this.closeSlashMenu(); return; }

    const slashStartOffset = before.lastIndexOf('/');
    this.slashRange = { from: $from.start() + slashStartOffset, to: $from.pos };
    this.slashItems = filtered;
    this.slashIndex = Math.min(this.slashIndex, filtered.length - 1);

    try {
      const coords = this.editor.view.coordsAtPos($from.pos);
      const hostRect = this.tiptapHostRef?.nativeElement.getBoundingClientRect();
      if (hostRect) {
        this.slashPos = {
          top:  Math.max(12, coords.bottom - hostRect.top + 6),
          left: Math.min(Math.max(12, coords.left - hostRect.left), Math.max(12, hostRect.width - 270))
        };
      }
    } catch { /* ignore positioning fallback */ }
  }

  private handleEditorKeydown(event: KeyboardEvent): boolean {
    if (!this.slashItems.length) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.slashIndex = (this.slashIndex + 1) % this.slashItems.length;
      this.cdr.markForCheck();
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.slashIndex = (this.slashIndex - 1 + this.slashItems.length) % this.slashItems.length;
      this.cdr.markForCheck();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.executeSlashItem(this.slashItems[this.slashIndex]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSlashMenu();
      this.cdr.markForCheck();
      return true;
    }
    return false;
  }

  executeSlashItem(item: SlashCommandItem): void {
    if (!this.editor || !this.slashRange) return;
    const { from, to } = this.slashRange;
    this.closeSlashMenu();
    item.run(this.editor, from, to);
    this.cdr.markForCheck();
  }

  private closeSlashMenu(): void {
    this.slashItems = [];
    this.slashRange = null;
    this.slashIndex = 0;
  }

  // ── Split Markdown Editor + Live Preview ───────────────────────────────────
  onMarkdownInput(): void {
    this.refreshSplitPreview();
  }

  insertMarkdownSnippet(snippet: string): void {
    const el = this.mdTextareaRef?.nativeElement;
    if (!el) {
      this.markdownSource = `${this.markdownSource}\n${snippet}`;
      this.refreshSplitPreview();
      return;
    }
    const start = el.selectionStart ?? this.markdownSource.length;
    const end   = el.selectionEnd ?? start;
    this.markdownSource = this.markdownSource.slice(0, start) + snippet + this.markdownSource.slice(end);
    this.refreshSplitPreview();
    setTimeout(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  }

  private refreshSplitPreview(): void {
    this.recomputeWordCount(this.markdownSource);
    this.livePreview = this.mdSvc.renderMarkdown(this.markdownSource);
    if (this.mermaidTimer) clearTimeout(this.mermaidTimer);
    if (this.livePreview.hasMermaid) {
      this.mermaidTimer = setTimeout(() => {
        this.mdSvc.hydrateMermaid(this.splitPreviewRef?.nativeElement);
      }, 320);
    }
  }

  // ── Templates, Tags, Close & Save ──────────────────────────────────────────
  async applyTemplate(tpl: WikiTemplateOption): Promise<void> {
    this.showTemplatesMenu = false;
    const current = this.currentMarkdown().trim();
    if (current) {
      const ok = await this.confirm.confirm(
        `Replace current content with the "${tpl.name}" template?`,
        'Apply Template'
      );
      if (!ok) return;
    }
    this.markdownSource = tpl.content;
    if (!this.tagsList.length && tpl.tags.length) {
      this.tagsList = [...tpl.tags];
    }
    if (this.editorMode === 'visual' && this.editor) {
      this.editor.commands.setContent(tpl.content);
    } else {
      this.refreshSplitPreview();
    }
    this.cdr.markForCheck();
  }

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitTagDraft();
    } else if (event.key === 'Backspace' && !this.tagDraft && this.tagsList.length) {
      this.tagsList = this.tagsList.slice(0, -1);
    }
  }

  commitTagDraft(): void {
    const clean = this.tagDraft.replace(/[,#]/g, '').trim().slice(0, 40);
    this.tagDraft = '';
    if (!clean) return;
    if (!this.tagsList.some(t => t.toLowerCase() === clean.toLowerCase()) && this.tagsList.length < 20) {
      this.tagsList = [...this.tagsList, clean];
    }
  }

  removeTag(idx: number): void {
    this.tagsList = this.tagsList.filter((_, i) => i !== idx);
  }

  async requestClose(): Promise<void> {
    const md = this.currentMarkdown();
    if (this.buildSnapshot(md) !== this.initialSnapshot) {
      const discard = await this.confirm.confirm('Discard unsaved document changes?', 'Unsaved Changes');
      if (!discard) return;
    }
    this.close.emit();
  }

  saveClick(): void {
    if (this.saving) return;
    this.commitTagDraft();
    const content = this.currentMarkdown();
    if (this.showFormField('title') && !this.title.trim()) return;
    if (this.showFormField('content') && !content.trim()) return;

    this.save.emit({
      id: this.article ? this.article.id : null,
      payload: {
        title:       this.title.trim(),
        content,
        excerpt:     this.excerpt.trim(),
        status:      this.status,
        category_id: this.categoryId,
        tags:        [...this.tagsList],
        is_pinned:   this.isPinned
      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveClick();
      return;
    }
    if (event.key === 'Escape') {
      if (this.slashItems.length) { this.closeSlashMenu(); return; }
      if (this.showTemplatesMenu) { this.showTemplatesMenu = false; return; }
      if (this.showLinkBox || this.showImgBox) { this.showLinkBox = false; this.showImgBox = false; return; }
      this.requestClose();
    }
  }

  private buildSnapshot(content: string): string {
    return JSON.stringify({
      title: this.title, status: this.status, categoryId: this.categoryId,
      excerpt: this.excerpt, tags: this.tagsList, isPinned: this.isPinned, content
    });
  }

  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  ngOnDestroy(): void {
    this.destroyEditor();
  }

  private restoreMode(): EditorMode {
    try {
      const m = localStorage.getItem(LS_EDITOR_MODE);
      return m === 'split' ? 'split' : 'visual';
    } catch {
      return 'visual';
    }
  }
}
