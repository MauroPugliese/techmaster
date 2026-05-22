// =============================================================================
// routes/export.routes.js — Advanced Document Exporters (ExcelJS & Docx)
// =============================================================================
const router = require('express').Router();
const ExcelJS = require('exceljs');
const docx = require('docx');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, HeadingLevel, AlignmentType } = docx;
const { InventoryItem, ItemCategory, WikiArticle, User, Shift, ShiftType } = require('../models');
const { authenticate } = require('../middleware/auth.middleware');
const { Op } = require('sequelize');

// GET /api/export/warehouse — Export inventory to formatted Excel sheet
router.get('/warehouse', authenticate, async (req, res, next) => {
  try {
    const items = await InventoryItem.findAll({
      where: { is_active: true },
      include: [{ model: ItemCategory, as: 'category' }]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Warehouse Inventory');

    // Title Row
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'SMaRT Platform - Warehouse Inventory Status';
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E293B' } // Dark slate background
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 40;

    // Header Row
    const headers = ['SKU', 'Item Name', 'Category', 'Quantity', 'Min Stock', 'Max Stock', 'Status'];
    worksheet.addRow([]); // Blank spacer
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 25;
    
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '475569' } // Slate gray
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: '000000' } }
      };
    });

    // Populate data
    items.forEach(item => {
      const isUnderStock = item.quantity <= item.reorder_point;
      const statusText = isUnderStock ? 'LOW STOCK' : 'OK';

      const row = worksheet.addRow([
        item.sku,
        item.name,
        item.category ? item.category.name : 'Uncategorized',
        item.quantity,
        item.min_stock,
        item.max_stock || 'N/A',
        statusText
      ]);

      row.height = 20;
      
      // Formatting values
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).alignment = { horizontal: 'right' };

      // Soft red formatting for low stock rows
      if (isUnderStock) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FEE2E2' } // Soft pastel red
          };
          cell.font = { name: 'Segoe UI', size: 10, color: { argb: '991B1B' } };
        });
      } else {
        row.eachCell((cell) => {
          cell.font = { name: 'Segoe UI', size: 10 };
        });
      }
    });

    // Adjust column widths
    worksheet.columns.forEach(col => {
      let maxLen = 0;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = val.length;
      });
      col.width = Math.max(maxLen + 4, 12);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="SMaRT_Warehouse_Inventory.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET /api/export/wiki/:id — Export wiki article to Word (docx) format
router.get('/wiki/:id', authenticate, async (req, res, next) => {
  try {
    const article = await WikiArticle.findByPk(req.params.id, {
      include: [{ model: User, as: 'author', attributes: ['first_name', 'last_name'] }]
    });

    if (!article) return res.status(404).json({ success: false, message: 'Article not found' });

    // HTML-to-Text simple helper to strip HTML tags for clean Word documents
    const cleanContent = article.content ? article.content.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() : '';

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: article.title,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 120 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Author: ${article.author ? article.author.first_name + ' ' + article.author.last_name : 'System'}`, bold: true, color: '64748B' }),
              new TextRun({ text: `   |   Published: ${article.published_at ? new Date(article.published_at).toLocaleDateString() : 'N/A'}`, color: '64748B' }),
            ],
            spacing: { after: 360 }
          }),
          new Paragraph({
            text: "Article Content:",
            heading: HeadingLevel.HEADING_3,
            spacing: { after: 120 }
          }),
          new Paragraph({
            text: cleanContent,
            spacing: { line: 360, after: 200 }
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="SMaRT_Wiki_${article.slug}.docx"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// GET /api/export/shift-report — Export formatted shift summaries to Word
router.get('/shift-report', authenticate, async (req, res, next) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const shifts = await Shift.findAll({
      where: { date: dateStr },
      include: [
        { model: ShiftType, as: 'shiftType' },
        { model: User, as: 'employee', attributes: ['first_name', 'last_name', 'department'] }
      ]
    });

    const docChildren = [
      new Paragraph({
        text: `SMaRT - Shift Summary Report`,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: `Date: ${new Date(dateStr).toLocaleDateString('it-IT', { dateStyle: 'full' })}`,
        bold: true,
        spacing: { after: 240 }
      })
    ];

    if (shifts.length === 0) {
      docChildren.push(new Paragraph({
        text: 'No shifts scheduled or worked on this date.',
        spacing: { after: 200 }
      }));
    } else {
      const rows = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: 'Employee', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Department', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Shift Code', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Status', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Check-in', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Check-out', bold: true })] })
          ]
        })
      ];

      shifts.forEach(s => {
        rows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : 'Unassigned')] }),
            new TableCell({ children: [new Paragraph(s.employee?.department || 'N/A')] }),
            new TableCell({ children: [new Paragraph(s.shiftType ? s.shiftType.code : 'N/A')] }),
            new TableCell({ children: [new Paragraph(s.status)] }),
            new TableCell({ children: [new Paragraph(s.check_in ? new Date(s.check_in).toLocaleTimeString() : '-')] }),
            new TableCell({ children: [new Paragraph(s.check_out ? new Date(s.check_out).toLocaleTimeString() : '-')] })
          ]
        }));
      });

      const table = new Table({
        rows: rows,
        spacing: { before: 120, after: 120 }
      });
      docChildren.push(table);
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: docChildren
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="SMaRT_Shift_Report_${dateStr}.docx"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

module.exports = router;
