// =============================================================================
// exports/renderers/docx.renderer.js — Tailored CAE Navy Blue Word Engine v5
// -----------------------------------------------------------------------------
// Clones the official CAE Navy Blue corporate template (`CAE-General-Template`)
// preserving 100% identical cover, typography, headers, footers & native chart,
// while rendering lean, data-first, module-specific sections (zero repetitive
// audit prose, zero filler — only real metrics, charts & tables with concise
// 1-sentence context per section).
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const { FORMAT_META } = require('../core/helpers');
const { collectSpecData } = require('../core/spec-collector');
const { buildTemplateContent } = require('./docx-content.mapper');
const { updateTemplateChart } = require('./docx-chart.updater');
const {
  escXml,
  pPageBreak,
  pSpacer,
  pAppendixHeading,
  pSectionHeading,
  pCategoryHeading,
  pBody,
  buildCoverSdtXml,
  buildTocSdtXml,
  buildMetaStripXml,
  buildAlertsTable,
  buildTemplateDataTable,
  buildInlineChartParagraph,
  buildMarkdownXmlBlocks
} = require('./docx-xml-helpers');

const TEMPLATE_FILENAME = 'CAE-General-Template_Navy_Blue_Lorem.docx';

let cachedTemplateBuffer = null;

/** Resolve the official CAE Navy Blue .docx template from /docs or bundled /templates. */
function resolveGeneralTemplatePath() {
  const candidates = [
    path.resolve(__dirname, '../../../../docs', TEMPLATE_FILENAME),
    path.resolve(__dirname, '../../../docs', TEMPLATE_FILENAME),
    path.resolve(process.cwd(), 'docs', TEMPLATE_FILENAME),
    path.resolve(process.cwd(), '../docs', TEMPLATE_FILENAME),
    path.resolve(__dirname, '../templates', TEMPLATE_FILENAME)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const err = new Error(`Word template not found: ${TEMPLATE_FILENAME}. Checked: ${candidates.join(' | ')}`);
  err.statusCode = 500;
  throw err;
}

function getTemplateBuffer() {
  if (!cachedTemplateBuffer) {
    cachedTemplateBuffer = fs.readFileSync(resolveGeneralTemplatePath());
  }
  return cachedTemplateBuffer;
}

/** Update publication date & confidentiality text inside footer1.xml / footer2.xml. */
function patchFooterXml(xml, pubDateShort, confidentiality) {
  if (!xml) return xml;
  let out = xml;
  out = out.replace(
    /<w:r\b[^>]*><w:t[^>]*>Publication dat[\s\S]*?<w:t[^>]*>2<\/w:t><\/w:r>/,
    `<w:r><w:t xml:space="preserve">Publication date: ${escXml(pubDateShort)}</w:t></w:r>`
  );
  if (confidentiality) {
    out = out.replace(/>Privileged and Confidential</g, `>${escXml(confidentiality)}<`);
  }
  return out;
}

/** Ensure Microsoft Word refreshes TOC & page fields automatically on open. */
function patchSettingsXml(xml) {
  if (!xml) return xml;
  if (/<w:updateFields\b/.test(xml)) return xml;
  return xml.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>');
}

/** Update OOXML core document properties with live title, author & timestamp. */
function patchCorePropsXml(xml, spec) {
  if (!xml) return xml;
  const isoNow = new Date(spec.meta?.generatedAt || Date.now()).toISOString();
  const author = escXml(spec.meta?.generatedBy || 'SMaRT Operations');
  const title = escXml(spec.title || 'Operational Report');
  const subject = escXml(spec.subtitle || spec.category || 'Operations Report');

  return xml
    .replace(/<dc:title>[\s\S]*?<\/dc:title>/, `<dc:title>${title}</dc:title>`)
    .replace(/<dc:subject>[\s\S]*?<\/dc:subject>/, `<dc:subject>${subject}</dc:subject>`)
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, `<dc:creator>${author}</dc:creator>`)
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, `<cp:lastModifiedBy>${author}</cp:lastModifiedBy>`)
    .replace(/<dcterms:created([^>]*)>[\s\S]*?<\/dcterms:created>/, `<dcterms:created$1>${isoNow}</dcterms:created>`)
    .replace(/<dcterms:modified([^>]*)>[\s\S]*?<\/dcterms:modified>/, `<dcterms:modified$1>${isoNow}</dcterms:modified>`);
}

/** Assemble the clean, data-first `word/document.xml` body inside the official CAE template. */
function buildDocumentBodyXml(templateDocXml, content) {
  const coverLogoMatch = templateDocXml.match(/<w:drawing>[\s\S]*?r:embed="rId11"[\s\S]*?<\/w:drawing>/);
  const logoDrawingXml = coverLogoMatch ? coverLogoMatch[0] : '';

  const sectPrMatch = templateDocXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  const sectPrXml = sectPrMatch ? sectPrMatch[0] : '';

  let bmCounter = 100;
  const nextBookmarkId = () => {
    bmCounter += 1;
    return bmCounter;
  };

  // Build exact live Table of Contents from ONLY the module's populated sections
  let estPage = 2;
  const tocEntries = content.sections.map((sec) => {
    if (sec.startOnNewPage) estPage += 1;
    const entry = {
      level: 1,
      title: sec.title,
      bookmark: sec.bookmark,
      pageNum: estPage
    };
    if (sec.id === 'charts' || sec.id === 'tables') estPage += 1;
    return entry;
  });

  const parts = [];

  // ── PAGE 1: OFFICIAL CAE NAVY BLUE COVER PAGE SDT ──────────────────────────
  parts.push(buildCoverSdtXml({
    logoDrawingXml,
    title: content.cover.title,
    subtitle: content.cover.subtitle,
    periodBanner: content.cover.periodBanner,
    teamLine: content.cover.teamLine,
    dateLine: content.cover.dateLine
  }));

  // ── PAGE 2: LIVE TABLE OF CONTENTS SDT ─────────────────────────────────────
  parts.push(buildTocSdtXml(tocEntries));

  // ── COMPACT REPORT CONTEXT STRIP (Period / Active Filters / Prepared By) ───
  if (content.metaPairs.length) {
    parts.push(buildMetaStripXml(content.metaPairs));
  }

  // ── MODULE-SPECIFIC DATA-FIRST SECTIONS ────────────────────────────────────
  content.sections.forEach((sec, idx) => {
    if (sec.startOnNewPage && idx > 0) {
      parts.push(pPageBreak());
    }

    const headingXml = idx === 0
      ? pAppendixHeading(sec.title, nextBookmarkId(), sec.bookmark)
      : pSectionHeading(sec.title, nextBookmarkId(), sec.bookmark);
    parts.push(headingXml);

    if (sec.description) {
      parts.push(pBody(sec.description, { color: '334155', spacingAfter: 90 }));
    }

    sec.blocks.forEach((blk) => {
      if (blk.kind === 'table' && blk.table) {
        if (blk.subTitle) {
          parts.push(pCategoryHeading(blk.subTitle));
        }
        if (blk.note) {
          parts.push(pBody(blk.note, { italic: true, color: '475569', spacingAfter: 60 }));
        }
        parts.push(buildTemplateDataTable(blk.table));
        parts.push(pSpacer(110));
      } else if (blk.kind === 'alerts' && blk.items?.length) {
        parts.push(buildAlertsTable(blk.items, blk.columns));
        parts.push(pSpacer(110));
      } else if (blk.kind === 'chart') {
        parts.push(buildInlineChartParagraph(blk.relId || 'rId13'));
        parts.push(pSpacer(90));
      } else if (blk.kind === 'markdown' && blk.blocks?.length) {
        parts.push(buildMarkdownXmlBlocks(blk.blocks));
        parts.push(pSpacer(90));
      } else if (blk.kind === 'note' && blk.text) {
        parts.push(pBody(blk.text, { italic: true, color: '475569', spacingAfter: 90 }));
      }
    });
  });

  const bodyStartIdx = templateDocXml.indexOf('<w:body>');
  const docHeader = bodyStartIdx !== -1
    ? templateDocXml.slice(0, bodyStartIdx + '<w:body>'.length)
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';

  return `${docHeader}${parts.join('')}${sectPrXml}</w:body></w:document>`;
}

/**
 * Generate a complete Word (.docx) Buffer cloned from the official CAE Navy Blue
 * Template and populated with lean, module-specific operational data.
 */
async function buildDocxBuffer(spec) {
  const zip = new PizZip(getTemplateBuffer());
  const collected = collectSpecData(spec);

  // 1. Update native embedded chart (`chart1.xml` + `Microsoft_Excel_Worksheet.xlsx`)
  const chartData = await updateTemplateChart(zip, collected, spec);

  // 2. Build module-tailored data-first sections
  const content = buildTemplateContent(spec, { hasRealChart: Boolean(chartData?.hasRealChart) });

  // 3. Rebuild `word/document.xml` keeping exact namespaces, cover logo drawing & sectPr
  const origDocXml = zip.file('word/document.xml').asText();
  const nextDocXml = buildDocumentBodyXml(origDocXml, content);
  zip.file('word/document.xml', nextDocXml);

  // 4. Patch footers (`footer1.xml` interior + `footer2.xml` cover) with real publication date
  for (const fPath of ['word/footer1.xml', 'word/footer2.xml']) {
    if (zip.file(fPath)) {
      zip.file(fPath, patchFooterXml(zip.file(fPath).asText(), content.cover.pubDateShort, content.cover.confidentiality));
    }
  }

  // 5. Enable auto field refresh (TOC & Page X of Y) in `word/settings.xml`
  if (zip.file('word/settings.xml')) {
    zip.file('word/settings.xml', patchSettingsXml(zip.file('word/settings.xml').asText()));
  }

  // 6. Update `docProps/core.xml` metadata
  if (zip.file('docProps/core.xml')) {
    zip.file('docProps/core.xml', patchCorePropsXml(zip.file('docProps/core.xml').asText(), spec));
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Stream a generated official CAE Navy Blue Word document to the Express response. */
async function streamDocx(spec, res, filename) {
  const buffer = await buildDocxBuffer(spec);
  res.setHeader('Content-Type', FORMAT_META.docx.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(buffer);
}

module.exports = {
  buildDocxBuffer,
  streamDocx,
  resolveGeneralTemplatePath
};
