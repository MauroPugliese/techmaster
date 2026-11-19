// =============================================================================
// exports/core/markdown.parser.js — Structured Markdown Block Parser
// -----------------------------------------------------------------------------
// Converts Wiki Markdown content into clean semantic blocks consumed natively
// by PDF, DOCX, PPTX, and XLSX renderers without external DOM dependencies.
// =============================================================================

const { stripControlChars } = require('./helpers');

/** Clean inline markdown syntax for plain/structured display while keeping links readable. */
function cleanInlineMarkdown(text = '') {
  return stripControlChars(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => (alt ? `[Image: ${alt}] (${url})` : `[Image] (${url})`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
}

/**
 * Parse inline bold/italic/code runs from a line of Markdown text.
 * Returns an array of { text, bold, italic, code } tokens.
 */
function parseInlineRuns(input = '') {
  const text = cleanInlineMarkdown(input);
  if (!text) return [];

  const tokens = [];
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false, code: false });
    }
    const raw = match[0];
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ text: raw.slice(2, -2), bold: true, italic: false, code: false });
    } else if (raw.startsWith('`')) {
      tokens.push({ text: raw.slice(1, -1), bold: false, italic: false, code: true });
    } else {
      tokens.push({ text: raw.slice(1, -1), bold: false, italic: true, code: false });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), bold: false, italic: false, code: false });
  }

  return tokens;
}

/** Strip inline markdown markers completely when plain text is needed. */
function stripInlineMarkers(input = '') {
  return parseInlineRuns(input).map((t) => t.text).join('');
}

function isTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripInlineMarkers(cell.trim()));
}

/**
 * Parse raw Markdown text into structured document blocks:
 * - h1, h2, h3
 * - paragraph (with inline runs)
 * - bullets / ordered (items with inline runs)
 * - code (language, content)
 * - quote (text, runs)
 * - table (headers, rows)
 * - divider
 */
function parseMarkdownBlocks(markdown = '') {
  const lines = stripControlChars(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];

  let i = 0;
  let paragraphBuf = [];

  const flushParagraph = () => {
    if (!paragraphBuf.length) return;
    const joined = paragraphBuf.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) {
      blocks.push({
        type: 'paragraph',
        text: stripInlineMarkers(joined),
        runs: parseInlineRuns(joined)
      });
    }
    paragraphBuf = [];
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Blank line
    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    // Fenced code block ```lang
    if (trimmed.startsWith('```')) {
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing ```
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n').trimEnd()
      });
      continue;
    }

    // Horizontal divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      i += 1;
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(3, headingMatch[1].length);
      blocks.push({
        type: `h${level}`,
        text: stripInlineMarkers(headingMatch[2])
      });
      i += 1;
      continue;
    }

    // Markdown pipe table (header + separator row)
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const headers = splitTableRow(trimmed);
      i += 2; // skip header & separator
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const quoteText = quoteLines.join(' ').trim();
      blocks.push({
        type: 'quote',
        text: stripInlineMarkers(quoteText),
        runs: parseInlineRuns(quoteText)
      });
      continue;
    }

    // Unordered list (-, *, +)
    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemRaw = lines[i].replace(/^\s*[-*+]\s+/, '').trim();
        items.push({
          text: stripInlineMarkers(itemRaw),
          runs: parseInlineRuns(itemRaw)
        });
        i += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }

    // Ordered list (1. 2. ...)
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemRaw = lines[i].replace(/^\s*\d+\.\s+/, '').trim();
        items.push({
          text: stripInlineMarkers(itemRaw),
          runs: parseInlineRuns(itemRaw)
        });
        i += 1;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    // Regular paragraph text
    paragraphBuf.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return blocks;
}

module.exports = {
  parseMarkdownBlocks,
  parseInlineRuns,
  stripInlineMarkers
};
