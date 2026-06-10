// =============================================================================
// routes/export.routes.js — Multi-format exports (Excel, PDF, Word)
// =============================================================================
const router = require('express').Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType } = require('docx');
const {
  InventoryItem,
  ItemCategory,
  WikiArticle,
  User,
  Shift,
  ShiftType,
  PlannedMaintenanceTask
} = require('../models');
const { authenticate } = require('../middleware/auth.middleware');
const { Op } = require('sequelize');

const EXPORT_FORMATS = new Set(['xlsx', 'pdf', 'docx']);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : 'N/A');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB') : 'N/A');
const cleanText = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const getFormat = (req, fallback = 'xlsx') => {
  const format = String(req.query.format || fallback).toLowerCase();
  return EXPORT_FORMATS.has(format) ? format : fallback;
};

const sendPdf = (res, filename, renderFn) => {
  const doc = new PDFDocument({ margin: 36, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  renderFn(doc);
  doc.end();
};

const sendDocx = async (res, filename, doc) => {
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

const sendXlsx = async (res, filename, workbook) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
};

const styleHeader = (row) => {
  row.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '334155' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
};

router.get('/warehouse', authenticate, async (req, res, next) => {
  try {
    const format = getFormat(req, 'xlsx');
    const items = await InventoryItem.findAll({
      where: { is_active: true },
      include: [{ model: ItemCategory, as: 'category' }],
      order: [['name', 'ASC']]
    });

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Warehouse');
      ws.mergeCells('A1:H1');
      ws.getCell('A1').value = 'SMaRT Warehouse Inventory Report';
      ws.getCell('A1').font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFF' } };
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
      ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 32;
      ws.addRow([`Generated: ${new Date().toLocaleString('en-GB')}`]);
      ws.addRow([]);
      const header = ws.addRow(['SKU', 'Item', 'Category', 'Qty', 'Min', 'Reorder', 'Max', 'Status']);
      styleHeader(header);
      items.forEach((i) => {
        const low = i.quantity <= i.reorder_point;
        const row = ws.addRow([
          i.sku,
          i.name,
          i.category?.name || 'Uncategorized',
          i.quantity,
          i.min_stock,
          i.reorder_point,
          i.max_stock || '-',
          low ? 'LOW STOCK' : 'OK'
        ]);
        if (low) {
          row.eachCell((c) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
            c.font = { color: { argb: '991B1B' }, name: 'Segoe UI', size: 10 };
          });
        }
      });
      ws.columns.forEach((c) => { c.width = 18; });
      return sendXlsx(res, 'SMaRT_Warehouse_Inventory.xlsx', wb);
    }

    if (format === 'pdf') {
      return sendPdf(res, 'SMaRT_Warehouse_Inventory.pdf', (doc) => {
        doc.fontSize(18).fillColor('#0f172a').text('SMaRT Warehouse Inventory Report', { align: 'left' });
        doc.moveDown(0.5).fontSize(10).fillColor('#475569').text(`Generated: ${new Date().toLocaleString('en-GB')}`);
        doc.moveDown();
        items.forEach((i, idx) => {
          const low = i.quantity <= i.reorder_point;
          doc.fontSize(11).fillColor(low ? '#991b1b' : '#0f172a')
            .text(`${idx + 1}. ${i.name} (${i.sku}) - Qty: ${i.quantity} - ${low ? 'LOW STOCK' : 'OK'}`);
          doc.fontSize(9).fillColor('#64748b')
            .text(`Category: ${i.category?.name || 'Uncategorized'} | Reorder: ${i.reorder_point} | Min: ${i.min_stock} | Max: ${i.max_stock || '-'}`);
          doc.moveDown(0.35);
        });
      });
    }

    const rows = [
      new TableRow({
        children: ['SKU', 'Item', 'Category', 'Qty', 'Reorder', 'Status'].map((h) => new TableCell({ children: [new Paragraph({ text: h })] }))
      }),
      ...items.map((i) => {
        const low = i.quantity <= i.reorder_point;
        return new TableRow({
          children: [
            i.sku,
            i.name,
            i.category?.name || 'Uncategorized',
            String(i.quantity),
            String(i.reorder_point),
            low ? 'LOW STOCK' : 'OK'
          ].map((v) => new TableCell({ children: [new Paragraph({ text: v })] }))
        });
      })
    ];

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'SMaRT Warehouse Inventory Report', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Generated: ${new Date().toLocaleString('en-GB')}` }),
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
        ]
      }]
    });

    return sendDocx(res, 'SMaRT_Warehouse_Inventory.docx', doc);
  } catch (err) { next(err); }
});

router.get('/wiki/:id', authenticate, async (req, res, next) => {
  try {
    const format = getFormat(req, 'docx');
    const article = await WikiArticle.findByPk(req.params.id, {
      include: [{ model: User, as: 'author', attributes: ['first_name', 'last_name'] }]
    });

    if (!article) return res.status(404).json({ success: false, message: 'Article not found' });

    const authorName = article.author ? `${article.author.first_name} ${article.author.last_name}` : 'System';
    const safeContent = cleanText(article.content || '');

    if (format === 'pdf') {
      return sendPdf(res, `SMaRT_Wiki_${article.slug}.pdf`, (doc) => {
        doc.fontSize(20).fillColor('#0f172a').text(article.title);
        doc.moveDown(0.4).fontSize(10).fillColor('#64748b').text(`Author: ${authorName} | Published: ${fmtDate(article.published_at)}`);
        doc.moveDown().fontSize(11).fillColor('#111827').text(safeContent, { align: 'left' });
      });
    }

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Wiki Article');
      ws.addRow(['Title', article.title]);
      ws.addRow(['Author', authorName]);
      ws.addRow(['Published', fmtDate(article.published_at)]);
      ws.addRow(['Status', article.status || 'N/A']);
      ws.addRow([]);
      ws.addRow(['Content']);
      ws.addRow([safeContent]);
      ws.getColumn(1).width = 20;
      ws.getColumn(2).width = 120;
      ws.getCell('A1').font = { bold: true };
      return sendXlsx(res, `SMaRT_Wiki_${article.slug}.xlsx`, wb);
    }

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: article.title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: `Author: ${authorName} | Published: ${fmtDate(article.published_at)}`, color: '64748B' })] }),
          new Paragraph({ text: safeContent })
        ]
      }]
    });

    return sendDocx(res, `SMaRT_Wiki_${article.slug}.docx`, doc);
  } catch (err) { next(err); }
});

router.get('/shift-report', authenticate, async (req, res, next) => {
  try {
    const format = getFormat(req, 'docx');
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const shifts = await Shift.findAll({
      where: { date: dateStr },
      include: [
        { model: ShiftType, as: 'shiftType' },
        { model: User, as: 'employee', attributes: ['first_name', 'last_name', 'department'] }
      ],
      order: [['date', 'ASC']]
    });

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Shifts');
      ws.mergeCells('A1:G1');
      ws.getCell('A1').value = `SMaRT Shift Report - ${dateStr}`;
      ws.getCell('A1').font = { color: { argb: 'FFFFFF' }, bold: true, size: 15 };
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      ws.addRow([]);
      styleHeader(ws.addRow(['Employee', 'Department', 'Shift', 'Status', 'Check-in', 'Check-out', 'Notes']));
      shifts.forEach((s) => ws.addRow([
        s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : 'Unassigned',
        s.employee?.department || 'N/A',
        s.shiftType?.code || 'N/A',
        s.status,
        s.check_in ? new Date(s.check_in).toLocaleTimeString('en-GB') : '-',
        s.check_out ? new Date(s.check_out).toLocaleTimeString('en-GB') : '-',
        s.notes || '-'
      ]));
      ws.columns.forEach((c) => { c.width = 20; });
      return sendXlsx(res, `SMaRT_Shift_Report_${dateStr}.xlsx`, wb);
    }

    if (format === 'pdf') {
      return sendPdf(res, `SMaRT_Shift_Report_${dateStr}.pdf`, (doc) => {
        doc.fontSize(18).fillColor('#0f172a').text(`SMaRT Shift Report - ${dateStr}`);
        doc.moveDown();
        if (!shifts.length) {
          doc.fontSize(11).fillColor('#64748b').text('No shifts scheduled for this day.');
          return;
        }
        shifts.forEach((s, idx) => {
          const employee = s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : 'Unassigned';
          doc.fontSize(11).fillColor('#0f172a').text(`${idx + 1}. ${employee} - ${s.shiftType?.code || 'N/A'} - ${s.status}`);
          doc.fontSize(9).fillColor('#64748b').text(`Dept: ${s.employee?.department || 'N/A'} | In: ${s.check_in ? new Date(s.check_in).toLocaleTimeString('en-GB') : '-'} | Out: ${s.check_out ? new Date(s.check_out).toLocaleTimeString('en-GB') : '-'}`);
          if (s.notes) doc.text(`Notes: ${s.notes}`);
          doc.moveDown(0.35);
        });
      });
    }

    const rows = [
      new TableRow({
        children: ['Employee', 'Department', 'Shift', 'Status', 'Check-in', 'Check-out'].map((h) => new TableCell({ children: [new Paragraph({ text: h })] }))
      }),
      ...shifts.map((s) => new TableRow({
        children: [
          s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : 'Unassigned',
          s.employee?.department || 'N/A',
          s.shiftType?.code || 'N/A',
          s.status,
          s.check_in ? new Date(s.check_in).toLocaleTimeString('en-GB') : '-',
          s.check_out ? new Date(s.check_out).toLocaleTimeString('en-GB') : '-'
        ].map((v) => new TableCell({ children: [new Paragraph({ text: v })] }))
      }))
    ];

    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ text: `SMaRT Shift Report - ${dateStr}`, heading: HeadingLevel.HEADING_1 }),
        new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
      ] }]
    });

    return sendDocx(res, `SMaRT_Shift_Report_${dateStr}.docx`, doc);
  } catch (err) { next(err); }
});

router.get('/planned-maintenance-report', authenticate, async (req, res, next) => {
  try {
    const format = getFormat(req, 'xlsx');
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59`) : null;
    const where = {};
    if (from && to) where.operation_date_start = { [Op.between]: [from, to] };

    const tasks = await PlannedMaintenanceTask.findAll({
      where,
      include: [{ model: User, as: 'creator', attributes: ['first_name', 'last_name'] }],
      order: [['operation_date_start', 'ASC']]
    });

    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'DONE').length;
    const todo = total - done;
    const completion = total ? ((done / total) * 100).toFixed(1) : '0.0';
    const byType = tasks.reduce((acc, t) => {
      const k = t.repeat_task_type || 'N/A';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const periodLabel = from && to ? `${fmtDate(from)} - ${fmtDate(to)}` : 'All data';

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const summary = wb.addWorksheet('Summary');
      summary.mergeCells('A1:D1');
      summary.getCell('A1').value = 'SMaRT Planned Maintenance Executive Report';
      summary.getCell('A1').font = { bold: true, size: 17, color: { argb: 'FFFFFF' } };
      summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
      summary.getCell('A1').alignment = { horizontal: 'center' };
      summary.addRow([]);
      summary.addRow(['Reporting Period', periodLabel]);
      summary.addRow(['Generated At', new Date().toLocaleString('en-GB')]);
      summary.addRow(['Total Tasks', total]);
      summary.addRow(['Completed (DONE)', done]);
      summary.addRow(['Open (TODO)', todo]);
      summary.addRow(['Completion Rate', `${completion}%`]);
      summary.addRow([]);
      summary.addRow(['Recurrence Type', 'Count']);
      Object.entries(byType).forEach(([k, v]) => summary.addRow([k, v]));
      summary.columns = [{ width: 28 }, { width: 28 }, { width: 12 }, { width: 12 }];

      const detail = wb.addWorksheet('Task Register');
      styleHeader(detail.addRow([
        'System', 'Subsystem', 'Task', 'Reference', 'Start', 'End',
        'Repeat Type', 'Every N', 'Status', 'Optional', 'Creator'
      ]));
      tasks.forEach((t) => {
        const row = detail.addRow([
          t.system,
          t.subsystem,
          t.task,
          t.reference || '-',
          fmtDateTime(t.operation_date_start),
          fmtDateTime(t.operation_date_end),
          t.repeat_task_type,
          t.repeat_task_number,
          t.status,
          t.optional ? 'Yes' : 'No',
          t.creator ? `${t.creator.first_name} ${t.creator.last_name}` : 'N/A'
        ]);
        if (t.status === 'DONE') {
          row.eachCell((c) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } };
          });
        }
      });
      detail.columns.forEach((c, idx) => { c.width = idx === 2 ? 42 : 20; });

      return sendXlsx(res, 'SMaRT_Planned_Maintenance_Report.xlsx', wb);
    }

    if (format === 'pdf') {
      return sendPdf(res, 'SMaRT_Planned_Maintenance_Report.pdf', (doc) => {
        doc.fontSize(19).fillColor('#0f172a').text('SMaRT Planned Maintenance Executive Report');
        doc.moveDown(0.4).fontSize(10).fillColor('#475569').text(`Period: ${periodLabel}`);
        doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`);
        doc.moveDown(0.8);

        doc.fontSize(12).fillColor('#0f172a').text(`Total tasks: ${total}`);
        doc.text(`Completed: ${done}`);
        doc.text(`Open: ${todo}`);
        doc.text(`Completion rate: ${completion}%`);
        doc.moveDown(0.5);
        doc.fontSize(11).text(`Recurrence mix: DAY ${byType.DAY || 0} | WEEK ${byType.WEEK || 0} | MONTH ${byType.MONTH || 0}`);

        doc.moveDown(0.8).fontSize(12).fillColor('#0f172a').text('Detailed Tasks', { underline: true });
        tasks.forEach((t, idx) => {
          doc.moveDown(0.3).fontSize(10).fillColor(t.status === 'DONE' ? '#166534' : '#7f1d1d')
            .text(`${idx + 1}. [${t.status}] ${t.system} / ${t.subsystem}`);
          doc.fillColor('#111827').text(cleanText(t.task));
          doc.fillColor('#64748b').text(`Start: ${fmtDateTime(t.operation_date_start)} | Repeat: every ${t.repeat_task_number} ${t.repeat_task_type} | Optional: ${t.optional ? 'Yes' : 'No'}`);
          if (t.reference) doc.text(`Reference: ${t.reference}`);
          if (doc.y > 760) doc.addPage();
        });
      });
    }

    const rows = [
      new TableRow({
        children: ['System', 'Subsystem', 'Task', 'Start', 'Repeat', 'Status'].map((h) => new TableCell({ children: [new Paragraph({ text: h })] }))
      }),
      ...tasks.map((t) => new TableRow({
        children: [
          t.system,
          t.subsystem,
          cleanText(t.task),
          fmtDateTime(t.operation_date_start),
          `${t.repeat_task_number} ${t.repeat_task_type}`,
          t.status
        ].map((v) => new TableCell({ children: [new Paragraph({ text: String(v) })] }))
      }))
    ];

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'SMaRT Planned Maintenance Executive Report', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${periodLabel}` }),
          new Paragraph({ text: `Completion: ${done}/${total} (${completion}%)` }),
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
        ]
      }]
    });

    return sendDocx(res, 'SMaRT_Planned_Maintenance_Report.docx', doc);
  } catch (err) { next(err); }
});

module.exports = router;
