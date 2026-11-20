// =============================================================================
// wiki-markdown.service.ts — Marked + Highlight.js + Callouts + Lazy Mermaid
// =============================================================================
import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Marked, Renderer, Tokens } from 'marked';
import DOMPurify from 'dompurify';

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import powershell from 'highlight.js/lib/languages/powershell';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import ini from 'highlight.js/lib/languages/ini';
import nginx from 'highlight.js/lib/languages/nginx';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

import { estimateReadingMinutes } from './wiki-templates';

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

export interface RenderedMarkdown {
  safeHtml: SafeHtml;
  toc: TocHeading[];
  hasMermaid: boolean;
  readingMinutes: number;
}

type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const CALLOUT_LABELS: Record<CalloutKind, { label: string; svg: string }> = {
  note: {
    label: 'Note',
    svg: '<svg class="callout-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6.5h.01" stroke-linecap="round"/></svg>'
  },
  tip: {
    label: 'Tip',
    svg: '<svg class="callout-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7.5 14h5M8 16.5h4M6.5 11.5A5 5 0 1113.5 11.5c-.6.6-1 1.3-1 2.5h-5c0-1.2-.4-1.9-1-2.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  important: {
    label: 'Important',
    svg: '<svg class="callout-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3l7 13H3L10 3z" stroke-linejoin="round"/><path d="M10 8v4M10 14h.01" stroke-linecap="round"/></svg>'
  },
  warning: {
    label: 'Warning',
    svg: '<svg class="callout-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3l7 13H3L10 3z" stroke-linejoin="round"/><path d="M10 8v4M10 14h.01" stroke-linecap="round"/></svg>'
  },
  caution: {
    label: 'Caution',
    svg: '<svg class="callout-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6.5 2.5h7l4 4v7l-4 4h-7l-4-4v-7l4-4z" stroke-linejoin="round"/><path d="M10 6.5v4.5M10 13.5h.01" stroke-linecap="round"/></svg>'
  }
};

function registerLanguages(): void {
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('shell', shell);
  hljs.registerLanguage('powershell', powershell);
  hljs.registerLanguage('ps1', powershell);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('yml', yaml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('nginx', nginx);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('plaintext', plaintext);
}

registerLanguages();

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function stripTagsToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

@Injectable({ providedIn: 'root' })
export class WikiMarkdownService {
  private mermaidLoader: Promise<any> | null = null;
  private mermaidSeq = 0;

  constructor(private sanitizer: DomSanitizer) {}

  renderMarkdown(md: string): RenderedMarkdown {
    const source = String(md || '');
    if (!source.trim()) {
      return {
        safeHtml: this.sanitizer.bypassSecurityTrustHtml(''),
        toc: [],
        hasMermaid: false,
        readingMinutes: 1
      };
    }

    const toc: TocHeading[] = [];
    const slugCounts = new Map<string, number>();
    let hasMermaid = false;

    const renderer = new Renderer();
    const baseTable = renderer.table.bind(renderer);

    renderer.heading = function ({ tokens, depth }: Tokens.Heading): string {
      const innerHtml = this.parser.parseInline(tokens);
      const plainText = stripTagsToPlain(innerHtml);
      const base = slugifyHeading(plainText);
      const prev = slugCounts.get(base) || 0;
      slugCounts.set(base, prev + 1);
      const id = prev === 0 ? `sec-${base}` : `sec-${base}-${prev + 1}`;
      if (depth <= 3 && plainText) {
        toc.push({ id, text: plainText, level: depth });
      }
      return `<h${depth} id="${id}">${innerHtml}</h${depth}>\n`;
    };

    renderer.code = function ({ text, lang }: Tokens.Code): string {
      const normalizedLang = String(lang || '').trim().toLowerCase();
      if (normalizedLang === 'mermaid') {
        hasMermaid = true;
        return [
          `<div class="wiki-mermaid-host" data-mermaid="${encodeURIComponent(text)}">`,
          `<div class="mermaid-loading">Rendering diagram…</div>`,
          `</div>`
        ].join('');
      }

      const displayLang = normalizedLang || 'text';
      let highlighted: string;
      if (normalizedLang && hljs.getLanguage(normalizedLang)) {
        highlighted = hljs.highlight(text, { language: normalizedLang, ignoreIllegals: true }).value;
      } else {
        highlighted = escapeHtml(text);
      }

      return [
        `<div class="wiki-code-block">`,
        `<div class="wiki-code-head">`,
        `<span class="wiki-code-lang">${escapeHtml(displayLang)}</span>`,
        `<button type="button" class="wiki-copy-btn" data-copy-code="${encodeURIComponent(text)}">Copy</button>`,
        `</div>`,
        `<pre><code class="hljs language-${escapeHtml(displayLang)}">${highlighted}</code></pre>`,
        `</div>`
      ].join('');
    };

    renderer.blockquote = function ({ tokens }: Tokens.Blockquote): string {
      const innerHtml = this.parser.parse(tokens);
      const alertMatch = /^\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br\s*\/?>|\s)*([\s\S]*?)<\/p>([\s\S]*)$/i.exec(innerHtml);
      if (alertMatch) {
        const kind = alertMatch[1].toLowerCase() as CalloutKind;
        const meta = CALLOUT_LABELS[kind];
        const firstPara = alertMatch[2].trim() ? `<p>${alertMatch[2].trim()}</p>` : '';
        const restBody = alertMatch[3] || '';
        return [
          `<div class="wiki-callout callout-${kind}">`,
          `<div class="wiki-callout-title">${meta.svg}<span>${meta.label}</span></div>`,
          `<div class="wiki-callout-body">${firstPara}${restBody}</div>`,
          `</div>`
        ].join('');
      }
      return `<blockquote>\n${innerHtml}</blockquote>\n`;
    };

    renderer.table = function (token: Tokens.Table): string {
      return `<div class="wiki-table-scroll">${baseTable(token)}</div>`;
    };

    const parser = new Marked({ gfm: true, breaks: true, renderer });
    const rawHtml = parser.parse(source, { async: false }) as string;

    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true, svg: true },
      ADD_ATTR: ['id', 'class', 'data-mermaid', 'data-copy-code', 'target', 'rel', 'type', 'checked', 'disabled'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
    });

    return {
      safeHtml: this.sanitizer.bypassSecurityTrustHtml(cleanHtml),
      toc,
      hasMermaid,
      readingMinutes: estimateReadingMinutes(source)
    };
  }

  async hydrateMermaid(container: HTMLElement | null | undefined): Promise<void> {
    if (!container || !container.isConnected) return;
    const hosts = Array.from(container.querySelectorAll<HTMLElement>('.wiki-mermaid-host[data-mermaid]'));
    if (!hosts.length) return;

    const mermaid = await this.loadMermaid();
    if (!container.isConnected) return;

    for (const host of hosts) {
      if (!host.isConnected || host.dataset['rendered'] === '1') continue;
      const encoded = host.dataset['mermaid'] || '';
      const source = decodeURIComponent(encoded);
      if (!source.trim()) continue;

      try {
        const renderId = `wiki-mmd-${++this.mermaidSeq}`;
        const { svg } = await mermaid.render(renderId, source);
        if (!host.isConnected) continue;

        const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        host.dataset['rendered'] = '1';
        host.replaceChildren();

        const bar = document.createElement('div');
        bar.className = 'wiki-mermaid-bar';
        const badge = document.createElement('span');
        badge.className = 'mmd-badge';
        badge.textContent = 'Mermaid Diagram';
        const zoomBtn = document.createElement('button');
        zoomBtn.type = 'button';
        zoomBtn.className = 'wiki-mermaid-zoom';
        zoomBtn.dataset['zoomMermaid'] = '1';
        zoomBtn.textContent = 'Expand';
        bar.append(badge, zoomBtn);

        const svgWrap = document.createElement('div');
        svgWrap.className = 'wiki-mermaid-svg';
        svgWrap.insertAdjacentHTML('beforeend', cleanSvg);

        host.append(bar, svgWrap);
      } catch (err: any) {
        host.dataset['rendered'] = 'error';
        host.replaceChildren();

        const errBox = document.createElement('div');
        errBox.className = 'wiki-mermaid-error';
        const titleEl = document.createElement('strong');
        titleEl.textContent = `Diagram syntax error: ${err?.message || 'Unable to parse diagram syntax'}`;
        const pre = document.createElement('pre');
        pre.textContent = source;
        errBox.append(titleEl, pre);
        host.append(errBox);
      }
    }
  }

  private async loadMermaid(): Promise<any> {
    if (!this.mermaidLoader) {
      this.mermaidLoader = import('mermaid').then(({ default: lib }) => {
        lib.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          themeVariables: {
            primaryColor:       '#E3F2FD',
            primaryTextColor:   '#0A1628',
            primaryBorderColor: '#1565C0',
            lineColor:          '#1565C0',
            secondaryColor:     '#F0F7FF',
            tertiaryColor:      '#FFFFFF',
            fontFamily:         'Plus Jakarta Sans, system-ui, sans-serif'
          }
        });
        return lib;
      });
    }
    return this.mermaidLoader;
  }
}
