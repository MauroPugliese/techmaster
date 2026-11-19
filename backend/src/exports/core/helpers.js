// =============================================================================
// exports/core/helpers.js — Shared Formatting, Numeric & Spec Utilities
// -----------------------------------------------------------------------------
// Pure, dependency-free helpers used by export module builders and renderers.
// =============================================================================

const EXPORT_FORMATS = new Set(['xlsx', 'pdf', 'docx', 'pptx']);

/** MIME type + file extension per supported format. */
const FORMAT_META = {
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf:  { ext: 'pdf',  mime: 'application/pdf' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
};

/** Resolve the requested export format, falling back to a safe default. */
const resolveFormat = (raw, fallback = 'xlsx') => {
  const f = String(raw || fallback).toLowerCase();
  return EXPORT_FORMATS.has(f) ? f : fallback;
};

/** Format a value as DD/MM/YYYY date, or a dash when empty. */
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB');
};

/** Format a value as DD/MM/YYYY HH:mm date-time, or a dash when empty. */
const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Format a value as HH:mm time, or a dash when empty. */
const fmtTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Strip HTML tags, control characters, and collapse whitespace. */
const stripControlChars = (s = '') => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

const cleanText = (s = '') => stripControlChars(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Coerce a value to finite Number or fallback. */
const toNumber = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Format a number with locale separators (en-US thousands, dots). */
const fmtNumber = (v, decimals = 0) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

/** Format a numeric value as currency string (e.g. $1,250.00). */
const fmtMoney = (v, currency = '$') => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${currency}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Format a percentage value (0–100 scale) cleanly. */
const fmtPercent = (v, decimals = 1) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
};

/** Format hours concisely (e.g. 12.5 h). */
const fmtHours = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)} h`;
};

/** Format a duration in minutes as human-readable "Xh Ym" or "Ym". */
const fmtDurationMin = (mins) => {
  const m = Math.max(0, Math.round(toNumber(mins, 0)));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!h) return `${rem} min`;
  if (!rem) return `${h} h`;
  return `${h} h ${rem} min`;
};

/** Safe percentage helper (returns 0 when total <= 0). */
const pct = (part, total) => (total > 0 ? (toNumber(part, 0) / toNumber(total, 1)) * 100 : 0);

/** Return top N [key, value] entries sorted descending by numeric value. */
const topEntries = (mapObj = {}, limit = 8) =>
  Object.entries(mapObj)
    .map(([k, v]) => [k, toNumber(v, 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

/** Safe display of nullable values. */
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/** Full name from a User-like association. */
const fullName = (u, fallback = '—') =>
  (u && (u.first_name || u.last_name)) ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : fallback;

/** Build a safe download filename: slug + date stamp, no extension. */
const buildFilename = (base) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(base || 'report')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `SMaRT_${slug}_${stamp}`;
};

/** Force a value into a printable string for table cells. */
const str = (v) => (v === null || v === undefined ? '' : stripControlChars(v));

/**
 * Format a cell value for text-based renderers (PDF, DOCX, PPTX) respecting column type.
 * Raw numbers can live in row[col.key] so XLSX uses true Excel numeric cells while
 * PDF/DOCX/PPTX get clean human formatting.
 */
const formatCell = (row, col) => {
  const raw = row ? row[col.key] : undefined;
  if (raw === null || raw === undefined || raw === '') return '—';

  switch (col.type) {
    case 'currency':
      return typeof raw === 'number' ? fmtMoney(raw, col.currency || '$') : str(raw);
    case 'percent':
      return typeof raw === 'number' ? fmtPercent(raw, col.decimals ?? 1) : str(raw);
    case 'number':
      return typeof raw === 'number' ? fmtNumber(raw, col.decimals ?? 0) : str(raw);
    default:
      return str(raw);
  }
};

/**
 * Compute formatted totals row object for PDF/DOCX/PPTX when any column defines `total`
 * ('sum' | 'avg' | 'count' | 'label'). Returns null if no columns define `total`.
 */
const computeColumnTotals = (table) => {
  const columns = table?.columns || [];
  const rows = table?.rows || [];
  if (!columns.length || !rows.length || !columns.some((c) => c.total)) return null;

  const totalsRow = {};
  let labelPlaced = false;

  columns.forEach((col, idx) => {
    if (col.total === 'label' || (idx === 0 && !col.total && !labelPlaced)) {
      totalsRow[col.key] = col.totalLabel || (columns[0].total ? '' : `TOTAL (${rows.length})`);
      labelPlaced = true;
      return;
    }

    if (!col.total) {
      totalsRow[col.key] = '';
      return;
    }

    if (col.total === 'count') {
      const count = rows.filter((r) => r[col.key] !== null && r[col.key] !== undefined && r[col.key] !== '').length;
      totalsRow[col.key] = fmtNumber(count, 0);
      return;
    }

    const nums = rows
      .map((r) => Number(r[col.key]))
      .filter((n) => Number.isFinite(n));

    if (!nums.length) {
      totalsRow[col.key] = '—';
      return;
    }

    const sum = nums.reduce((a, b) => a + b, 0);
    const val = col.total === 'avg' ? sum / nums.length : sum;

    if (col.type === 'currency') {
      totalsRow[col.key] = fmtMoney(val, col.currency || '$');
    } else if (col.type === 'percent') {
      totalsRow[col.key] = fmtPercent(val, col.decimals ?? 1);
    } else {
      const decimals = col.decimals !== undefined ? col.decimals : (Number.isInteger(val) ? 0 : 2);
      totalsRow[col.key] = col.total === 'avg' ? `avg ${fmtNumber(val, decimals)}` : fmtNumber(val, decimals);
    }
  });

  if (!labelPlaced && columns[0]) {
    totalsRow[columns[0].key] = totalsRow[columns[0].key] || 'TOTAL';
  }

  return totalsRow;
};

/**
 * Parse an inclusive date range from request query (`from` / `to`).
 * Accepts ISO strings or YYYY-MM-DD; returns { from, to } as Date|null.
 */
const parseRange = (query = {}) => {
  const parse = (v, endOfDay) => {
    if (!v) return null;
    const raw = String(v);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`)
      : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { from: parse(query.from, false), to: parse(query.to, true) };
};

/** Human label for an active date range used in the document filter block. */
const rangeLabel = ({ from, to }) => {
  if (from && to) return `${fmtDate(from)} → ${fmtDate(to)}`;
  if (from) return `From ${fmtDate(from)}`;
  if (to) return `Until ${fmtDate(to)}`;
  return 'All time';
};

module.exports = {
  EXPORT_FORMATS,
  FORMAT_META,
  resolveFormat,
  fmtDate,
  fmtDateTime,
  fmtTime,
  fmtNumber,
  fmtMoney,
  fmtPercent,
  fmtHours,
  fmtDurationMin,
  toNumber,
  pct,
  topEntries,
  stripControlChars,
  cleanText,
  dash,
  fullName,
  str,
  formatCell,
  computeColumnTotals,
  buildFilename,
  parseRange,
  rangeLabel
};
