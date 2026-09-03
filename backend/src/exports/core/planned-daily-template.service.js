const fs = require('fs/promises');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

let expressionParser = null;
try {
  expressionParser = require('docxtemplater/expressions.js');
} catch {
  expressionParser = null;
}

const { Op } = require('sequelize');
const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('../../models');
const { resolveFormat, FORMAT_META, buildFilename, fullName } = require('./helpers');

const DAY_MS = 24 * 60 * 60 * 1000;

const TEMPLATE_FILES = {
  checklist: 'maintenance_daily_checklist.docx',
  report: 'maintenance_daily_report.docx'
};

function normalizeTemplateTagInner(inner) {
  let out = String(inner || '');
  out = out.replace(/[’‘]/g, "'");
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/^#\s+/, '#');
  out = out.replace(/^\/\s+/, '/');
  out = out.replace(/!\s*=+/g, '!=');
  out = out.replace(/=\s*=+/g, '==');
  out = out.replace(/\bStart\s+OpsTime\b/g, 'StartOpsTime');
  out = out.replace(/\bEnd\s+OpsTime\b/g, 'EndOpsTime');
  out = out.replace(/\bRESTORE\s*_\s*TASK\b/g, 'RESTORE_TASK');
  return out;
}

function normalizeTemplateXml(xml) {
  if (!xml) return xml;
  return xml.replace(/\{([^{}]+)\}/g, (full, inner) => `{${normalizeTemplateTagInner(inner)}}`);
}

async function resolveTemplatePath(fileName) {
  const candidates = [
    path.resolve(__dirname, '../../../../docs', fileName),
    path.resolve(__dirname, '../../../docs', fileName),
    path.resolve(process.cwd(), 'docs', fileName)
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  const err = new Error(`Template not found: ${fileName}. Checked: ${candidates.join(' | ')}`);
  err.statusCode = 500;
  throw err;
}

const TASK_SHUTDOWN = 'Shutdown all systems in Server Room';
const TASK_RESTORE = 'Restore all systems in Server Room';
const TASK_LOTO = 'Apply Lockout-Tagout Procedure to Server Room Electrical Panels';

function toUtcDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function taskOccursOnDate(task, targetDate) {
  try {
    const start = new Date(task.operation_date_start);
    if (Number.isNaN(start.getTime())) return false;

    const startDay = toUtcDateOnly(start);
    const target = toUtcDateOnly(targetDate);
    if (!startDay || !target) return false;

    if (task.recurrence_end_date) {
      const end = toUtcDateOnly(task.recurrence_end_date);
      if (end && target > end) return false;
    }

    if (target < startDay) return false;

    const diffDays = Math.round((target.getTime() - startDay.getTime()) / DAY_MS);
    const type = task.repeat_task_type;
    const interval = task.repeat_task_number || 1;

    if (type === 'DAY') return diffDays % interval === 0;

    if (type === 'WEEK') {
      if (start.getUTCDay() !== target.getUTCDay()) return false;
      const diffWeeks = Math.floor(diffDays / 7);
      return diffWeeks % interval === 0;
    }

    if (type === 'MONTH') {
      if (start.getUTCDate() !== target.getUTCDate()) return false;
      const diffMonths = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + (target.getUTCMonth() - start.getUTCMonth());
      return diffMonths >= 0 && diffMonths % interval === 0;
    }

    return false;
  } catch {
    return false;
  }
}

function buildOccurrenceDateTime(occurrenceDate, baseDateTime) {
  const base = new Date(baseDateTime);
  if (Number.isNaN(base.getTime())) return null;

  const [y, m, d] = occurrenceDate.split('-').map(Number);
  return new Date(Date.UTC(
    y,
    m - 1,
    d,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  ));
}

function addDuration(startDate, durationMs) {
  return new Date(startDate.getTime() + durationMs);
}

function normalizeOccurrence(master, occurrenceDate, instance) {
  if (instance && instance.exception_type === 'DELETED') return null;

  const source = instance || master;
  const baseStart = new Date(source.operation_date_start || master.operation_date_start);
  const baseEnd = new Date(source.operation_date_end || master.operation_date_end);
  if (Number.isNaN(baseStart.getTime()) || Number.isNaN(baseEnd.getTime())) return null;

  const occurrenceStart = source.operation_date_start
    ? new Date(source.operation_date_start)
    : buildOccurrenceDateTime(occurrenceDate, master.operation_date_start);

  if (!occurrenceStart || Number.isNaN(occurrenceStart.getTime())) return null;

  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const occurrenceEnd = source.operation_date_end
    ? new Date(source.operation_date_end)
    : addDuration(occurrenceStart, durationMs);

  return {
    id: source.id || master.id,
    masterId: master.id,
    occurrenceDate,
    system: source.system || master.system,
    subsystem: source.subsystem || master.subsystem,
    task: source.task || master.task,
    reference: source.reference || master.reference || '',
    operationDateStart: occurrenceStart.toISOString(),
    operationDateEnd: occurrenceEnd.toISOString(),
    status: source.status || master.status || 'TODO',
    reportTemplate: source.report_template || master.report_template || ''
  };
}

async function getTasksForDate(dateStr) {
  const queryEnd = `${dateStr}T23:59:59.999Z`;

  const masters = await PlannedMaintenanceTask.findAll({
    where: { operation_date_start: { [Op.lte]: queryEnd } },
    order: [['operation_date_start', 'ASC']]
  });

  const instances = await PlannedMaintenanceTaskInstance.findAll({
    where: { occurrence_date: dateStr },
    order: [['updated_at', 'DESC']]
  });

  const instancesByKey = new Map();
  const deletedKeys = new Set();

  for (const instance of instances) {
    const key = `${instance.planned_task_id}|${instance.occurrence_date}`;
    if (instance.exception_type === 'DELETED') {
      deletedKeys.add(key);
      continue;
    }
    if (!instancesByKey.has(key)) instancesByKey.set(key, instance);
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d));

  const results = [];
  const seen = new Set();

  for (const master of masters) {
    const key = `${master.id}|${dateStr}`;
    const instance = instancesByKey.get(key);

    if (deletedKeys.has(key)) continue;
    if (!taskOccursOnDate(master, targetDate) && !instance) continue;

    const occurrence = normalizeOccurrence(master, dateStr, instance);
    if (!occurrence) continue;

    results.push(occurrence);
    seen.add(key);
  }

  for (const [key, instance] of instancesByKey.entries()) {
    if (seen.has(key) || deletedKeys.has(key)) continue;
    const master = masters.find((mItem) => mItem.id === instance.planned_task_id);
    if (!master) continue;

    const occurrence = normalizeOccurrence(master, dateStr, instance);
    if (occurrence) results.push(occurrence);
  }

  results.sort((a, b) => new Date(a.operationDateStart) - new Date(b.operationDateStart));
  return results;
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-GB');
}

function formatTime(isoDate) {
  if (!isoDate) return '00:00';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '00:00';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '0 min';

  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

function buildTemplateData(tasks, dateStr, user) {
  const baseDate = new Date(`${dateStr}T00:00:00Z`);
  const monthName = baseDate.toLocaleString('en-US', { month: 'long' });
  const year = String(baseDate.getUTCFullYear());
  const day = String(baseDate.getUTCDate()).padStart(2, '0');

  // Keep the original 3-section layout always visible in generated Word files.
  const hasShutdown = true;
  const hasRestore = true;

  const taskRows = tasks
    .filter((t) => ![TASK_SHUTDOWN, TASK_RESTORE, TASK_LOTO].includes(t.task))
    .map((t) => ({
      Subsystem: t.subsystem || '',
      Task: t.task || '',
      FormattedDuration: formatDuration(t.operationDateStart, t.operationDateEnd),
      Status: t.status === 'DONE' ? 'Done' : 'Todo',
      ReportTemplate: t.reportTemplate || ''
    }));

  const safeTaskRows = taskRows.length ? taskRows : tasks.map((t) => ({
    Subsystem: t.subsystem || '',
    Task: t.task || '',
    FormattedDuration: formatDuration(t.operationDateStart, t.operationDateEnd),
    Status: t.status === 'DONE' ? 'Done' : 'Todo',
    ReportTemplate: t.reportTemplate || ''
  }));

  const totalMinutes = safeTaskRows.reduce((acc, row) => {
    const match = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?/i.exec(row.FormattedDuration || '');
    if (!match) return acc;
    const hours = Number(match[1] || 0);
    const mins = Number(match[2] || 0);
    return acc + (hours * 60) + mins;
  }, 0);

  const totalDuration = (() => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (!h) return `${m} min`;
    if (!m) return `${h} h`;
    return `${h} h ${m} min`;
  })();

  const startTimes = tasks.map((t) => t.operationDateStart).filter(Boolean).map((v) => new Date(v).getTime()).filter((v) => !Number.isNaN(v));
  const endTimes = tasks.map((t) => t.operationDateEnd).filter(Boolean).map((v) => new Date(v).getTime()).filter((v) => !Number.isNaN(v));

  const startOpsTime = startTimes.length ? formatTime(new Date(Math.min(...startTimes)).toISOString()) : '00:00';
  const endOpsTime = endTimes.length ? formatTime(new Date(Math.max(...endTimes)).toISOString()) : '00:00';

  return {
    block_name: true,
    DATE: formatDate(dateStr),
    DAYDATE: day,
    MONTHNAME: monthName,
    YEAR: year,
    SHUTDOWN_TASK: hasShutdown,
    RESTORE_TASK: hasRestore,
    StartOpsTime: startOpsTime,
    EndOpsTime: endOpsTime,
    AssignedTo: fullName(user, 'All') || 'All',
    TASKS: safeTaskRows,
    TOTAL_DURATION: totalDuration
  };
}

async function renderTemplateDocx(templateType, data) {
  let expression = null;
  try {
    expression = expressionParser;
  } catch {
    expression = null;
  }

  const fileName = TEMPLATE_FILES[templateType];
  const templatePath = await resolveTemplatePath(fileName);
  const templateBuffer = await fs.readFile(templatePath);
  const zip = new PizZip(templateBuffer);

  const docXmlPath = 'word/document.xml';
  const docXml = zip.file(docXmlPath)?.asText?.();
  if (docXml) {
    zip.file(docXmlPath, normalizeTemplateXml(docXml));
  }

  const options = {
    paragraphLoop: true,
    linebreaks: true,
    syntax: {
      allowUnclosedTag: true,
      allowUnopenedTag: true
    }
  };

  if (expression) {
    options.parser = expression;
  }

  const doc = new Docxtemplater(zip, options);

  try {
    doc.render(data);
  } catch (err) {
    const e = new Error(`Template render failed for ${fileName}: ${err?.message || 'unknown parser error'}`);
    e.statusCode = 500;
    throw e;
  }

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function convertDocxToPdf(docxBuffer) {
  let libre;
  try {
    libre = require('libreoffice-convert');
  } catch {
    const err = new Error('Missing PDF converter dependency: install libreoffice-convert.');
    err.statusCode = 500;
    throw err;
  }
  const libreConvertAsync = util.promisify(libre.convert);
  return libreConvertAsync(docxBuffer, '.pdf', undefined);
}

function detectLibreOfficeBinary() {
  const candidates = ['soffice', 'libreoffice'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return { available: true, binary: bin };
    } catch {
      // Try next candidate.
    }
  }
  return { available: false, binary: null };
}

async function streamDailyTemplateExport({ req, res }) {
  const date = String(req.params.date || '');
  const templateType = String(req.params.template || '').toLowerCase();
  const format = resolveFormat(req.query.format, 'docx');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  if (!Object.keys(TEMPLATE_FILES).includes(templateType)) {
    return res.status(400).json({ success: false, message: 'Invalid template type. Use checklist or report.' });
  }

  let docxBuffer;
  try {
    const tasks = await getTasksForDate(date);
    const data = buildTemplateData(tasks, date, req.user || null);
    docxBuffer = await renderTemplateDocx(templateType, data);
  } catch (err) {
    const message = err?.message || 'Failed to render daily template.';
    return res.status(err?.statusCode || 500).json({ success: false, message });
  }

  const baseName = buildFilename(`planned_maintenance_${templateType}_${date}`);

  if (format === 'pdf') {
    try {
      const pdfBuffer = await convertDocxToPdf(docxBuffer);
      res.setHeader('Content-Type', FORMAT_META.pdf.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      res.send(pdfBuffer);
      return undefined;
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err?.message || 'PDF conversion failed on server. Install LibreOffice in the backend runtime to enable template PDF export.'
      });
    }
  }

  res.setHeader('Content-Type', FORMAT_META.docx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.docx"`);
  res.send(docxBuffer);
  return undefined;
}

module.exports = { streamDailyTemplateExport, detectLibreOfficeBinary };
