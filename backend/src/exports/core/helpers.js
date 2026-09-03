// =============================================================================
// exports/core/helpers.js — Shared formatting & spec utilities
// -----------------------------------------------------------------------------
// Pure, dependency-free helpers used by module builders and renderers.
// =============================================================================

const EXPORT_FORMATS = new Set(['xlsx', 'pdf', 'docx']);

/** MIME type + file extension per supported format. */
const FORMAT_META = {
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf:  { ext: 'pdf',  mime: 'application/pdf' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
};

/** Resolve the requested export format, falling back to a safe default. */
const resolveFormat = (raw, fallback = 'xlsx') => {
  const f = String(raw || fallback).toLowerCase();
  return EXPORT_FORMATS.has(f) ? f : fallback;
};

/** Format a value as a DD/MM/YYYY date, or a dash when empty. */
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

/** Format a value as a DD/MM/YYYY HH:mm date-time, or a dash when empty. */
const fmtDateTime = (d) =>
  (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Format a value as HH:mm time, or a dash when empty. */
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');

/** Strip HTML tags and collapse whitespace from rich-text content. */
const cleanText = (s = '') => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Format a number as currency (no symbol coupling — caller adds context). */
const fmtMoney = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(2));

/** Safe display of nullable values. */
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/** Full name from a User-like association. */
const fullName = (u, fallback = '—') =>
  (u && (u.first_name || u.last_name)) ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : fallback;

/** Build a safe download filename: slug + timestamp, no extension. */
const buildFilename = (base) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(base || 'report').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `SMaRT_${slug}_${stamp}`;
};

/** Force a value into a printable string for table cells. */
const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Parse an inclusive date range from request query (`from` / `to`).
 * Accepts ISO strings or YYYY-MM-DD; returns { from, to } as Date|null.
 */
const parseRange = (query = {}) => {
  const parse = (v, endOfDay) => {
    if (!v) return null;
    const raw = String(v);
    // Date-only string → anchor to start/end of day for inclusive ranges.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T${endOfDay ? '23:59:59' : '00:00:00'}`)
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
  EXPORT_FORMATS, FORMAT_META, resolveFormat,
  fmtDate, fmtDateTime, fmtTime, fmtMoney, cleanText, dash, fullName, str,
  buildFilename, parseRange, rangeLabel
};
