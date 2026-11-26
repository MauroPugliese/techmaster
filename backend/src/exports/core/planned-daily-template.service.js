// =============================================================================
// exports/core/planned-daily-template.service.js
// -----------------------------------------------------------------------------
// Renders Daily Planned Maintenance Checklists & Daily Reports:
//   - DOCX: fills official Word templates in /docs via docxtemplater
//   - PDF: uses LibreOffice if installed, or automatically falls back to a
//     publication-grade CAE native PDFKit renderer with bundled Red Hat fonts
// =============================================================================

const fs = require('fs/promises');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const PDFDocument = require('pdfkit');

let expressionParser = null;
try {
  expressionParser = require('docxtemplater/expressions.js');
} catch {
  expressionParser = null;
}

const { getTasksForDate } = require('../../services/planned-recurrence.service');
const { resolveFormat, FORMAT_META, buildFilename, fullName, fmtDurationMin } = require('./helpers');
const { COLORS, COMPANY, getLogoBuffer } = require('./branding');
const { registerPdfFonts } = require('./fonts');

const TEMPLATE_FILES = {
  checklist: 'maintenance_daily_checklist.docx',
  report: 'maintenance_daily_report.docx'
};

const TASK_SHUTDOWN = 'Shutdown all systems in Server Room';
const TASK_RESTORE = 'Restore all systems in Server Room';
const TASK_LOTO = 'Apply Lockout-Tagout Procedure to Server Room Electrical Panels';
const SPECIAL_TASKS = new Set([TASK_SHUTDOWN, TASK_RESTORE, TASK_LOTO]);

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
  return xml.replace(/\{([^{}]+)\}/g, (_, inner) => `{${normalizeTemplateTagInner(inner)}}`);
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
      // Try next candidate
    }
  }

  const err = new Error(`Template not found: ${fileName}. Checked: ${candidates.join(' | ')}`);
  err.statusCode = 500;
  throw err;
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

function formatUtcTime(isoDate) {
  if (!isoDate) return '00:00';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '00:00';
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function taskDurationMinutes(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function buildTemplateData(tasks, dateStr, user) {
  const baseDate = new Date(`${dateStr}T00:00:00Z`);
  const monthName = baseDate.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = String(baseDate.getUTCFullYear());
  const day = String(baseDate.getUTCDate()).padStart(2, '0');

  const hasShutdown = tasks.some((t) => t.task === TASK_SHUTDOWN) || tasks.length >= 0;
  const hasRestore = tasks.some((t) => t.task === TASK_RESTORE) || tasks.length >= 0;

  // Include ALL tasks so template filters for LOTO in Section 1 and excludes
  // Shutdown/Restore/LOTO in Section 2 accurately.
  const allRows = tasks.map((t) => {
    const mins = taskDurationMinutes(t.operationDateStart, t.operationDateEnd);
    return {
      Subsystem: t.subsystem || '',
      Task: t.task || '',
      FormattedDuration: fmtDurationMin(mins),
      DurationMinutes: mins,
      Status: t.status === 'DONE' ? 'Done' : 'Todo',
      ReportTemplate: t.reportTemplate || ''
    };
  });

  const maintRows = allRows.filter((r) => !SPECIAL_TASKS.has(r.Task));
  const durationPool = maintRows.length ? maintRows : allRows;
  const totalMinutes = durationPool.reduce((acc, row) => acc + row.DurationMinutes, 0);
  const totalDuration = fmtDurationMin(totalMinutes);

  // Compute StartOpsTime / EndOpsTime from tasks that specify explicit non-midnight times
  const timedTasks = tasks.filter((t) => {
    const st = formatUtcTime(t.operationDateStart);
    const en = formatUtcTime(t.operationDateEnd);
    return st !== '00:00' || en !== '00:00';
  });

  const timeSource = timedTasks.length ? timedTasks : tasks;
  const startTimes = timeSource
    .map((t) => new Date(t.operationDateStart).getTime())
    .filter((v) => !Number.isNaN(v));
  const endTimes = timeSource
    .map((t) => new Date(t.operationDateEnd).getTime())
    .filter((v) => !Number.isNaN(v));

  const startOpsTime = startTimes.length ? formatUtcTime(new Date(Math.min(...startTimes)).toISOString()) : '00:00';
  const endOpsTime = endTimes.length ? formatUtcTime(new Date(Math.max(...endTimes)).toISOString()) : '00:00';

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
    TASKS: allRows,
    MAINT_TASKS: maintRows,
    HAS_LOTO: tasks.some((t) => t.task === TASK_LOTO),
    TOTAL_DURATION: totalDuration
  };
}

async function renderTemplateDocx(templateType, data) {
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

  if (expressionParser) {
    options.parser = expressionParser;
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
    const err = new Error('Missing PDF converter dependency: libreoffice-convert.');
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
      // Try next candidate
    }
  }
  return { available: false, binary: null };
}

/**
 * Draw a crisp vector checkbox inside PDFKit.
 */
function drawCheckbox(doc, x, y, checked, label, fonts) {
  doc.save();
  doc.lineWidth(1).strokeColor(checked ? COLORS.navy : COLORS.borderStrong);
  if (checked) {
    doc.rect(x, y + 1, 9, 9).fillAndStroke(COLORS.navy, COLORS.navy);
    doc.lineWidth(1.4).strokeColor(COLORS.white)
      .moveTo(x + 2, y + 5.5).lineTo(x + 4, y + 7.5).lineTo(x + 7.5, y + 3).stroke();
  } else {
    doc.rect(x, y + 1, 9, 9).stroke();
  }
  doc.font(fonts.bodyMedium).fontSize(8.5).fillColor(COLORS.body)
    .text(label, x + 13, y + 0.5, { lineBreak: false });
  doc.restore();
}

/**
 * Native PDFKit fallback for Daily Maintenance Checklist / Report using the
 * bundled Red Hat Display & Red Hat Text fonts and CAE corporate layout.
 */
function renderDailyNativePdf(templateType, data, dateStr) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 36, bottom: 44, left: 36, right: 36 },
      bufferPages: true
    });

    const F = registerPdfFonts(doc);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 36;
    const w = doc.page.width - margin * 2;
    const bottomLimit = doc.page.height - 54;
    const isReport = templateType === 'report';
    const titleText = isReport ? 'PLANNED MAINTENANCE DAILY REPORT' : 'PLANNED MAINTENANCE DAILY CHECKLIST';
    const subtitleText = isReport
      ? `Täglicher Wartungsbericht  ·  Report #${data.DAYDATE}-${data.YEAR}  ·  ${data.MONTHNAME} ${data.YEAR}`
      : `Checklist Manutenzione Giornaliera  ·  Scheduled: ${data.DATE}`;

    // Header banner
    const drawTopHeader = () => {
      const y = margin;
      doc.save().rect(margin, y, w, 54).fill(COLORS.navy).restore();
      const logo = getLogoBuffer('light');
      let tx = margin + 14;
      if (logo) {
        doc.image(logo, margin + 12, y + 14, { width: 68, height: 25.5 });
        tx = margin + 92;
      }
      const hdrTextW = w - (tx - margin) - 12;
      doc.font(F.displaySemiBold).fontSize(7.5).fillColor(COLORS.lime)
        .text('CAE · PLANNED MAINTENANCE OPERATIONS', tx, y + 10, { width: hdrTextW, lineBreak: false });
      doc.font(F.displayBold).fontSize(13.5).fillColor(COLORS.white)
        .text(titleText, tx, y + 20, { width: hdrTextW, lineBreak: false });
      doc.font(F.displayLight).fontSize(8.5).fillColor('#CBD5E1')
        .text(subtitleText, tx, y + 37, { width: hdrTextW, lineBreak: false });
      doc.save().rect(margin, y + 54, w, 2.5).fill(COLORS.accent).restore();
      return y + 66;
    };

    let y = drawTopHeader();

    // Metadata strip
    doc.save().roundedRect(margin, y, w, 26, 4).fillAndStroke(COLORS.zebra, COLORS.border).restore();
    doc.font(F.displaySemiBold).fontSize(8.5).fillColor(COLORS.subtle)
      .text('Date: ', margin + 10, y + 8, { continued: true, width: w - 20, lineBreak: false });
    doc.font(F.bodyBold).fillColor(COLORS.ink).text(data.DATE, { continued: true, lineBreak: false });
    doc.font(F.displaySemiBold).fillColor(COLORS.subtle).text('    |    Technician / Owner: ', { continued: true, lineBreak: false });
    doc.font(F.bodyBold).fillColor(COLORS.ink).text(data.AssignedTo || 'All', { continued: true, lineBreak: false });
    doc.font(F.displaySemiBold).fillColor(COLORS.subtle).text('    |    Total Duration: ', { continued: true, lineBreak: false });
    doc.font(F.bodyBold).fillColor(COLORS.accent).text(data.TOTAL_DURATION || '0 min', { lineBreak: false });
    y += 36;

    // Section 1: Shutdown & LOTO
    doc.save().rect(margin, y, w, 20).fill(COLORS.navyLight).restore();
    doc.font(F.displayBold).fontSize(9.5).fillColor(COLORS.white)
      .text('1. MANDATORY SHUTDOWN & LOTO PROCEDURE', margin + 10, y + 5, { width: w - 20, lineBreak: false });
    y += 24;

    doc.save().roundedRect(margin, y, w, 58, 4).fillAndStroke(COLORS.white, COLORS.border).restore();
    const hasOpsTime = data.StartOpsTime && data.StartOpsTime !== '00:00';
    doc.font(F.bodyBold).fontSize(8.5).fillColor(COLORS.ink)
      .text('Mandatory Shutdown Required?', margin + 12, y + 10, { width: 158, lineBreak: false });
    drawCheckbox(doc, margin + 175, y + 9, isReport && hasOpsTime, 'YES', F);
    drawCheckbox(doc, margin + 225, y + 9, isReport && !hasOpsTime, 'NO', F);

    doc.font(F.bodyBold).fontSize(8.5).fillColor(COLORS.ink)
      .text('LOTO Procedure Applied?', margin + 290, y + 10, { width: 120, lineBreak: false });
    drawCheckbox(doc, margin + 415, y + 9, isReport && data.HAS_LOTO, 'YES', F);
    drawCheckbox(doc, margin + 465, y + 9, isReport && !data.HAS_LOTO, 'N/A', F);

    doc.font(F.body).fontSize(8.5).fillColor(COLORS.subtle)
      .text(`Start Time: ${isReport && hasOpsTime ? data.StartOpsTime : '____________'}`, margin + 12, y + 32, { width: 158, lineBreak: false })
      .text('Authorized Technician Signature: ______________________________________', margin + 175, y + 32, { width: w - 187, lineBreak: false });
    y += 68;

    // Section 2: Maintenance Tasks
    doc.save().rect(margin, y, w, 20).fill(COLORS.navyLight).restore();
    doc.font(F.displayBold).fontSize(9.5).fillColor(COLORS.white)
      .text('2. SCHEDULED MAINTENANCE ACTIVITIES', margin + 10, y + 5, { width: w - 20, lineBreak: false });
    y += 24;

    const tasks = data.MAINT_TASKS && data.MAINT_TASKS.length ? data.MAINT_TASKS : data.TASKS;
    const colW = [28, 105, w - 28 - 105 - 70 - 58, 70, 58];
    const headers = ['Done', 'Subsystem', 'Task Description', 'Est. Duration', 'Status'];

    const drawTblHead = (yy) => {
      doc.save().rect(margin, yy, w, 20).fill(COLORS.navy).restore();
      let cx = margin;
      headers.forEach((h, i) => {
        doc.font(F.displayBold).fontSize(8).fillColor(COLORS.white)
          .text(h, cx + 5, yy + 6, { width: colW[i] - 10, align: i >= 3 ? 'center' : 'left', lineBreak: false });
        cx += colW[i];
      });
      return yy + 20;
    };

    y = drawTblHead(y);

    if (!tasks.length) {
      doc.save().rect(margin, y, w, 26).fillAndStroke(COLORS.zebra, COLORS.border).restore();
      doc.font(F.bodyItalic).fontSize(8.5).fillColor(COLORS.subtle)
        .text('No maintenance tasks scheduled for this date.', margin + 10, y + 8, { width: w - 20, lineBreak: false });
      y += 32;
    } else {
      tasks.forEach((t, idx) => {
        const subText = t.Subsystem || '—';
        const taskText = t.Task || '—';
        const h1 = doc.font(F.bodyBold).fontSize(8).heightOfString(subText, { width: colW[1] - 10 });
        const h2 = doc.font(F.body).fontSize(8.5).heightOfString(taskText, { width: colW[2] - 10 });
        const rowH = Math.max(20, Math.ceil(Math.max(h1, h2)) + 10);

        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = drawTopHeader();
          y = drawTblHead(y);
        }

        if (idx % 2 === 1) {
          doc.save().rect(margin, y, w, rowH).fill(COLORS.zebra).restore();
        }
        doc.save().lineWidth(0.4).strokeColor(COLORS.border).rect(margin, y, w, rowH).stroke().restore();

        const isDone = t.Status === 'Done';
        drawCheckbox(doc, margin + 9, y + (rowH - 10) / 2, isReport && isDone, '', F);

        let cx = margin + colW[0];
        doc.font(F.bodyBold).fontSize(8).fillColor(COLORS.ink)
          .text(subText, cx + 5, y + 5, { width: colW[1] - 10, height: rowH - 6, ellipsis: true });
        cx += colW[1];
        doc.font(F.body).fontSize(8.5).fillColor(COLORS.body)
          .text(taskText, cx + 5, y + 5, { width: colW[2] - 10, height: rowH - 6, ellipsis: true });
        cx += colW[2];
        doc.font(F.body).fontSize(8.5).fillColor(COLORS.subtle)
          .text(t.FormattedDuration || '—', cx + 5, y + 5, { width: colW[3] - 10, align: 'center', lineBreak: false });
        cx += colW[3];
        doc.font(F.displayBold).fontSize(8).fillColor(isDone ? COLORS.successFg : COLORS.infoFg)
          .text(isDone ? 'DONE' : 'TODO', cx + 5, y + 5, { width: colW[4] - 10, align: 'center', lineBreak: false });

        y += rowH;
      });

      // Totals row — paginate cleanly if right at bottom limit
      if (y + 24 > bottomLimit) {
        doc.addPage();
        y = drawTopHeader();
      }
      doc.save().rect(margin, y, w, 20).fill(COLORS.navyTint).restore();
      doc.save().lineWidth(1).strokeColor(COLORS.navy).moveTo(margin, y).lineTo(margin + w, y).stroke().restore();
      doc.font(F.displayBold).fontSize(8.5).fillColor(COLORS.navy)
        .text(`TOTAL (${tasks.length} tasks)`, margin + colW[0] + 5, y + 5, { width: colW[1] + colW[2] - 10, lineBreak: false });
      doc.font(F.displayBold).fontSize(8.5).fillColor(COLORS.navy)
        .text(data.TOTAL_DURATION, margin + colW[0] + colW[1] + colW[2] + 5, y + 5, { width: colW[3] - 10, align: 'center', lineBreak: false });
      y += 28;
    }

    // Comments & Section 3 Re-entry into Service (measure exact notes height first)
    const notesText = (data.MAINT_TASKS || []).map((t) => t.ReportTemplate).filter(Boolean).join(' · ');
    const measuredNotesH = notesText
      ? doc.font(F.body).fontSize(8.5).heightOfString(notesText, { width: w - 16 })
      : 0;
    const notesBoxH = Math.max(40, Math.min(92, Math.ceil(measuredNotesH) + 16));
    const closingSectionH = 14 + notesBoxH + 10 + 24 + 38;

    if (y + closingSectionH > bottomLimit) {
      doc.addPage();
      y = drawTopHeader();
    }

    doc.font(F.displayBold).fontSize(9).fillColor(COLORS.navy)
      .text('Remarks / Comments', margin, y, { width: w, lineBreak: false });
    y += 14;
    doc.save().roundedRect(margin, y, w, notesBoxH, 4).fillAndStroke(COLORS.white, COLORS.border).restore();
    if (notesText) {
      doc.font(F.body).fontSize(8.5).fillColor(COLORS.body)
        .text(notesText, margin + 8, y + 8, { width: w - 16, height: notesBoxH - 12, ellipsis: true });
    }
    y += notesBoxH + 10;

    doc.save().rect(margin, y, w, 20).fill(COLORS.navyLight).restore();
    doc.font(F.displayBold).fontSize(9.5).fillColor(COLORS.white)
      .text('3. RE-ENTRY INTO SERVICE & SIGN-OFF', margin + 10, y + 5, { width: w - 20, lineBreak: false });
    y += 24;
    doc.save().roundedRect(margin, y, w, 36, 4).fillAndStroke(COLORS.white, COLORS.border).restore();
    doc.font(F.body).fontSize(8.5).fillColor(COLORS.subtle)
      .text(`Completion Time: ${isReport && data.EndOpsTime !== '00:00' ? data.EndOpsTime : '____________'}`, margin + 12, y + 12, { width: 158, lineBreak: false })
      .text('Authorized Technician Signature: ______________________________________', margin + 175, y + 12, { width: w - 187, lineBreak: false });

    // Footers: temporarily clear bottom margin on each page so PDFKit NEVER spawns blank pages!
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const savedBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 28;
      doc.save()
        .lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(margin, fy - 4).lineTo(margin + w, fy - 4).stroke()
        .font(F.body).fontSize(7.5).fillColor(COLORS.subtle)
        .text(`${COMPANY.name}  ·  Daily Operations (${dateStr})`, margin, fy, { width: w * 0.65, lineBreak: false })
        .text(`Page ${i - range.start + 1} of ${range.count}`, margin + w * 0.65, fy, { width: w * 0.35, align: 'right', lineBreak: false })
        .restore();
      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  });
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

  let data;
  try {
    const tasks = await getTasksForDate(date);
    data = buildTemplateData(tasks, date, req.user || null);
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      success: false,
      message: err?.message || 'Failed to load daily planned maintenance data.'
    });
  }

  const baseName = buildFilename(`planned_maintenance_${templateType}_${date}`);

  if (format === 'pdf') {
    let pdfBuffer = null;
    const lo = detectLibreOfficeBinary();
    if (lo.available) {
      try {
        const docxBuffer = await renderTemplateDocx(templateType, data);
        pdfBuffer = await convertDocxToPdf(docxBuffer);
      } catch {
        pdfBuffer = null;
      }
    }

    if (!pdfBuffer) {
      pdfBuffer = await renderDailyNativePdf(templateType, data, date);
    }

    res.setHeader('Content-Type', FORMAT_META.pdf.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.send(pdfBuffer);
    return undefined;
  }

  let docxBuffer;
  try {
    docxBuffer = await renderTemplateDocx(templateType, data);
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      success: false,
      message: err?.message || 'Failed to render daily template.'
    });
  }

  res.setHeader('Content-Type', FORMAT_META.docx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.docx"`);
  res.send(docxBuffer);
  return undefined;
}

module.exports = {
  streamDailyTemplateExport,
  detectLibreOfficeBinary,
  buildTemplateData,
  renderTemplateDocx,
  renderDailyNativePdf
};
