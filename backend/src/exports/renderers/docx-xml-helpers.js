// =============================================================================
// exports/renderers/docx-xml-helpers.js
// -----------------------------------------------------------------------------
// Pure OOXML fragment builders strictly faithful to the official CAE Navy Blue
// Word template (`CAE-General-Template_Navy_Blue_Lorem.docx`).
// Preserves exact template style IDs (`Titre-Title`, `SousTitre-Cover`,
// `ProjectNumber`, `ToC-Titre`, `TOC1`, `TOC2`, `Appendix-SousTitre`,
// `SousTitre-01`, `Sous-Titre-02`, `Sous-Titre-03`, `TexteCourant`,
// `Appendix-Noms`), navy `#06103D` / electric blue `#2969F2` accents,
// numbering lists (`numId="4"`, `numId="5"`), and table widths (`9360`/`10188`).
// =============================================================================
'use strict';

const { COLORS, toneStyle, noHash } = require('../core/branding');
const { str, formatCell, computeColumnTotals, resolveBadgeTone } = require('../core/helpers');

const NAVY = '06103D';
const ELECTRIC = '2969F2';
const WHITE = 'FFFFFF';
const ZEBRA = 'F4F6FA';
const BORDER_SUBTLE = 'CBD5E1';
const TEXT_INK = '0F172A';
const TEXT_MUTED = '475569';

/** Escape XML special characters and strip illegal XML 1.0 control bytes. */
function escXml(val) {
  return String(val ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function riskColorHex(level) {
  const norm = String(level || '').toLowerCase();
  if (norm === 'high' || norm === 'critical') return 'B91C1C';
  if (norm === 'medium' || norm === 'moderate') return 'B45309';
  return '15803D';
}

function riskFillHex(level) {
  const norm = String(level || '').toLowerCase();
  if (norm === 'high' || norm === 'critical') return 'FEE2E2';
  if (norm === 'medium' || norm === 'moderate') return 'FEF3C7';
  return 'DCFCE7';
}

/** Build a clean page break paragraph matching template conventions. */
function pPageBreak() {
  return '<w:p><w:pPr><w:rPr><w:rFonts w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:br w:type="page"/></w:r></w:p>';
}

/** Build the Cover Page SDT identical to Node [00] of the CAE Navy Blue template. */
function buildCoverSdtXml({ logoDrawingXml, title, subtitle, teamLine, dateLine, periodBanner }) {
  const cleanTitle = str(title || 'Operational Report').trim();
  const cleanSub = str(subtitle || '').trim();
  const titleSz = cleanTitle.length > 52 ? 52 : (cleanTitle.length > 34 ? 60 : 72);
  const subSz = cleanSub.length > 72 ? 28 : 36;

  const titleLines = cleanTitle.split('\n').filter(Boolean);
  const titleRuns = titleLines.map((line, i) => (
    `<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text2"/><w:sz w:val="${titleSz}"/><w:szCs w:val="${titleSz}"/><w:lang w:val="en-US"/></w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`
  )).join('');

  const subtitlePara = cleanSub
    ? `<w:p><w:pPr><w:pStyle w:val="SousTitre-Cover"/><w:jc w:val="right"/><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/><w:sz w:val="${subSz}"/><w:szCs w:val="${subSz}"/><w:lang w:val="en-US"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/><w:sz w:val="${subSz}"/><w:szCs w:val="${subSz}"/><w:lang w:val="en-US"/></w:rPr><w:t xml:space="preserve">${escXml(cleanSub)}</w:t></w:r></w:p>`
    : '';

  const periodPara = periodBanner
    ? `<w:p><w:pPr><w:pStyle w:val="ProjectNumber"/><w:jc w:val="right"/><w:spacing w:before="120" w:after="60"/><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:color w:val="${ELECTRIC}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:color w:val="${ELECTRIC}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${escXml(periodBanner)}</w:t></w:r></w:p>`
    : '';

  const teamPara = `<w:p><w:pPr><w:pStyle w:val="ProjectNumber"/><w:jc w:val="right"/><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr><w:t xml:space="preserve">${escXml(teamLine || 'Operations & Engineering Team')}</w:t></w:r></w:p>`;

  const datePara = `<w:p><w:pPr><w:pStyle w:val="ProjectNumber"/><w:jc w:val="right"/><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr><w:t xml:space="preserve">${escXml(dateLine || '')}</w:t></w:r></w:p>`;

  const logoRun = logoDrawingXml
    ? `<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:noProof/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr>${logoDrawingXml}</w:r>`
    : '';

  return `<w:sdt><w:sdtPr><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:color w:val="auto"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:id w:val="-1988923881"/><w:docPartObj><w:docPartGallery w:val="Cover Pages"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Titre-Title"/><w:jc w:val="right"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr>${logoRun}<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:br/></w:r><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:br/></w:r><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:color w:val="${NAVY}" w:themeColor="text2"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:br/></w:r>${titleRuns}</w:p>${subtitlePara}${periodPara}${teamPara}${datePara}<w:p><w:pPr><w:rPr><w:rFonts w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:br w:type="page"/></w:r></w:p></w:sdtContent></w:sdt>`;
}

/** Build the Table of Contents SDT identical to Node [01] with live bookmarks & PAGEREF fields. */
function buildTocSdtXml(entries = []) {
  const headerP = `<w:p><w:pPr><w:pStyle w:val="ToC-Titre"/><w:tabs><w:tab w:val="left" w:pos="3030"/></w:tabs><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text2"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text2"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr><w:t>Table of Contents</w:t></w:r></w:p>`;

  const entryParas = entries.map((e, idx) => {
    const isLevel1 = e.level === 1;
    const style = isLevel1 ? 'TOC1' : 'TOC2';
    const openField = idx === 0
      ? '<w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:instrText xml:space="preserve"> TOC \\o "1-3" \\t "SousTitre - 01,1,Sous-Titre - 02,2,Appendix - SousTitre,1" </w:instrText></w:r><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>'
      : '';
    const titleRunPr = isLevel1
      ? `<w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr>`
      : '<w:rPr><w:rFonts w:cs="Arial"/></w:rPr>';
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:bCs w:val="0"/>${isLevel1 ? '<w:caps w:val="0"/>' : ''}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:pPr>${openField}<w:r>${titleRunPr}<w:t xml:space="preserve">${escXml(e.title)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF ${escXml(e.bookmark)} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${escXml(e.pageNum)}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  }).join('');

  const closeFieldP = '<w:p><w:pPr><w:pStyle w:val="TOC2"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p>';

  return `<w:sdt><w:sdtPr><w:rPr><w:rFonts w:eastAsiaTheme="minorHAnsi" w:cs="Arial"/><w:bCs/><w:noProof/><w:color w:val="${NAVY}" w:themeColor="text2"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:id w:val="1422060959"/><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${headerP}${entryParas}${closeFieldP}</w:sdtContent></w:sdt>${pPageBreak()}`;
}

function wrapBookmark(id, name, innerXml) {
  if (!name) return innerXml;
  return `<w:bookmarkStart w:id="${id}" w:name="${escXml(name)}"/>${innerXml}<w:bookmarkEnd w:id="${id}"/>`;
}

/** Appendix-SousTitre heading (used for Executive Summary and Appendix 1 in template). */
function pAppendixHeading(text, bookmarkId, bookmarkName) {
  const run = `<w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:pStyle w:val="Appendix-SousTitre"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr>${wrapBookmark(bookmarkId, bookmarkName, run)}</w:p>`;
}

/** SousTitre-01 heading (major section heading in Navy #06103D). */
function pSectionHeading(text, bookmarkId, bookmarkName) {
  const run = `<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:pStyle w:val="SousTitre-01"/><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr></w:pPr>${wrapBookmark(bookmarkId, bookmarkName, run)}</w:p>`;
}

/** Sous-Titre-02 subheading (included at TOC level 2). */
function pSubHeading(text, bookmarkId, bookmarkName) {
  const run = `<w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:pStyle w:val="Sous-Titre-02"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr>${wrapBookmark(bookmarkId, bookmarkName, run)}</w:p>`;
}

/** Sous-Titre-03 category heading (Navy #06103D). */
function pCategoryHeading(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Sous-Titre-03"/><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${NAVY}" w:themeColor="text1"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

/** TexteCourant body paragraph. */
function pBody(text, { bold = false, italic = false, color = null, spacingAfter = null } = {}) {
  const sp = spacingAfter !== null ? `<w:spacing w:after="${spacingAfter}"/>` : '';
  const rPr = `<w:rPr><w:rFonts w:cs="Arial"/>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr>`;
  return `<w:p><w:pPr><w:pStyle w:val="TexteCourant"/>${sp}${rPr}</w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

/** Bold navy label + regular body text (matches Node [20] root cause entries). */
function pLabeledBody(label, text) {
  const cleanLabel = String(label || '').replace(/:?\s*$/, '');
  return `<w:p><w:pPr><w:pStyle w:val="TexteCourant"/><w:jc w:val="left"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="${NAVY}"/></w:rPr><w:t xml:space="preserve">${escXml(cleanLabel)}: </w:t></w:r><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

/** Appendix-Noms line item (matches Nodes [43..60]). */
function pAppendixName(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Appendix-Noms"/><w:rPr><w:rFonts w:cs="Arial"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

function pSpacer(after = 80) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="60" w:lineRule="exact"/><w:rPr><w:sz w:val="4"/><w:szCs w:val="4"/></w:rPr></w:pPr></w:p>`;
}

function singleBordersXml(color = 'auto', sz = 4) {
  return `<w:top w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/><w:left w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/><w:bottom w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/><w:right w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
}

/** Compact single-line context strip for Period, Active Filters, and Prepared By. */
function buildMetaStripXml(pairs = []) {
  if (!pairs.length) return '';
  const runs = [];
  pairs.forEach(([label, value], idx) => {
    if (idx > 0) {
      runs.push(`<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${BORDER_SUBTLE}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">   |   </w:t></w:r>`);
    }
    runs.push(`<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="${NAVY}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">${escXml(label)}: </w:t></w:r>`);
    runs.push(`<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:color w:val="${TEXT_MUTED}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">${escXml(value)}</w:t></w:r>`);
  });

  return `<w:tbl><w:tblPr><w:tblW w:w="9810" w:type="dxa"/><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tblCellMar><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9810"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9810" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${ZEBRA}"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:left w:val="single" w:sz="24" w:space="0" w:color="${ELECTRIC}"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/></w:pPr>${runs.join('')}</w:p></w:tc></w:tr></w:tbl>${pSpacer(90)}`;
}

/**
 * Clean 3-column CAE Navy Blue Alerts / Advisories Table:
 *   Alert Title | Severity | Concise Detail
 */
function buildAlertsTable(items = [], columns = ['Notice', 'Severity', 'Details'], { totalWidthDxa = 9810 } = {}) {
  if (!items.length) return '';
  const colW = [3100, 1160, totalWidthDxa - 4260];
  const tblPr = `<w:tblPr><w:tblW w:w="${totalWidthDxa}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="${NAVY}"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:left w:w="95" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="95" w:type="dxa"/></w:tblCellMar><w:tblLayout w:type="fixed"/></w:tblPr>`;
  const tblGrid = `<w:tblGrid>${colW.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

  const hdrCell = (txt, w, align = 'left') => (
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="12" w:space="0" w:color="${ELECTRIC}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${NAVY}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="30" w:after="30"/>${align !== 'left' ? `<w:jc w:val="${align}"/>` : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="${WHITE}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t>${escXml(txt)}</w:t></w:r></w:p></w:tc>`
  );

  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${hdrCell(columns[0], colW[0])}${hdrCell(columns[1], colW[1], 'center')}${hdrCell(columns[2], colW[2])}</w:tr>`;

  const bodyRows = items.map((it, idx) => {
    const sevTone = it.severity === 'High' ? 'danger' : (it.severity === 'Medium' ? 'warning' : 'info');
    const st = toneStyle(sevTone) || toneStyle('info');
    const fill = idx % 2 === 1 ? ZEBRA : null;
    const rowShd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';

    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
      `<w:tc><w:tcPr><w:tcW w:w="${colW[0]}" w:type="dxa"/>${rowShd}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="25" w:after="25" w:line="220" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="${NAVY}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">${escXml(it.title)}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${colW[1]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${noHash(st.bg)}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="25" w:after="25"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="${noHash(st.fg)}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t>${escXml(it.severity)}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${colW[2]}" w:type="dxa"/>${rowShd}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="25" w:after="25" w:line="220" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="${TEXT_INK}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">${escXml(it.detail)}</w:t></w:r></w:p></w:tc>` +
      `</w:tr>`;
  }).join('');

  return `<w:tbl>${tblPr}${tblGrid}${headerRow}${bodyRows}</w:tbl>`;
}

/**
 * Clean CAE Navy-Blue styled data table (used for KPI summaries, statMatrix,
 * chart breakdowns, and supporting operational ledgers). Filters `printHidden`.
 */
function buildTemplateDataTable(table, { totalWidthDxa = 9810 } = {}) {
  const columns = (table?.columns || []).filter((c) => !c.printHidden);
  const rows = table?.rows || [];
  if (!columns.length) return '';

  const weights = columns.map((c) => c.docxWidth || c.width || 14);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const minColW = Math.max(200, Math.min(600, Math.floor(totalWidthDxa / columns.length)));
  let colWidths = weights.map((w) => Math.max(minColW, Math.round((w / weightSum) * totalWidthDxa)));
  let sumFix = colWidths.reduce((a, b) => a + b, 0);
  if (sumFix > totalWidthDxa) {
    const scale = totalWidthDxa / sumFix;
    colWidths = colWidths.map((w) => Math.max(200, Math.floor(w * scale)));
    sumFix = colWidths.reduce((a, b) => a + b, 0);
  }
  const diff = totalWidthDxa - sumFix;
  if (diff >= 0) {
    colWidths[colWidths.length - 1] += diff;
  } else {
    let excess = -diff;
    for (let i = colWidths.length - 1; i >= 0 && excess > 0; i--) {
      const reducible = Math.max(0, colWidths[i] - 200);
      const take = Math.min(reducible, excess);
      colWidths[i] -= take;
      excess -= take;
    }
  }

  const tblPr = `<w:tblPr><w:tblW w:w="${totalWidthDxa}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="${NAVY}"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${BORDER_SUBTLE}"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar><w:tblLayout w:type="fixed"/></w:tblPr>`;
  const tblGrid = `<w:tblGrid>${colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

  const makeCell = (text, width, { header = false, align = 'left', fill = null, color = null, bold = false, mono = false, topBorder = null, bottomBorder = null } = {}) => {
    const jc = align === 'right' ? '<w:jc w:val="right"/>' : (align === 'center' ? '<w:jc w:val="center"/>' : '');
    const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
    const customBorders = (topBorder || bottomBorder)
      ? `<w:tcBorders>${topBorder ? `<w:top w:val="single" w:sz="${topBorder.sz}" w:space="0" w:color="${topBorder.color}"/>` : ''}${bottomBorder ? `<w:bottom w:val="single" w:sz="${bottomBorder.sz}" w:space="0" w:color="${bottomBorder.color}"/>` : ''}</w:tcBorders>`
      : '';
    const sz = header ? 17 : (mono ? 15 : 17);
    const font = mono ? 'Consolas' : 'Arial';
    const txtColor = color || (header ? WHITE : TEXT_INK);
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${customBorders}${shd}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="220" w:lineRule="auto"/>${jc}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="Arial"/>${header || bold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${txtColor}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${escXml(str(text))}</w:t></w:r></w:p></w:tc>`;
  };

  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${columns.map((col, i) => {
    const align = col.align || ((col.type === 'number' || col.type === 'currency' || col.type === 'percent') ? 'right' : 'left');
    return makeCell(col.header, colWidths[i], {
      header: true,
      align,
      fill: NAVY,
      bottomBorder: { sz: 12, color: ELECTRIC }
    });
  }).join('')}</w:tr>`;

  const bodyRows = rows.length
    ? rows.map((row, idx) => {
        const rowTone = toneStyle(row._flag);
        const zebra = idx % 2 === 1 ? ZEBRA : null;
        return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${columns.map((col, i) => {
          const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
          const isBadge = col.type === 'badge';
          const badgeTone = isBadge ? (toneStyle(resolveBadgeTone(row, col)) || toneStyle('neutral')) : null;
          const fill = isBadge
            ? noHash(badgeTone.bg)
            : (rowTone && (row._flag === 'danger' || row._flag === 'warning') ? noHash(rowTone.bg) : zebra);
          const color = isBadge
            ? noHash(badgeTone.fg)
            : (rowTone && isNum ? noHash(rowTone.fg) : TEXT_INK);
          return makeCell(formatCell(row, col), colWidths[i], {
            align: col.align || (isBadge ? 'center' : (isNum ? 'right' : 'left')),
            fill,
            color,
            bold: isBadge || (rowTone && isNum),
            mono: col.type === 'mono'
          });
        }).join('')}</w:tr>`;
      }).join('')
    : `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${totalWidthDxa}" w:type="dxa"/><w:gridSpan w:val="${columns.length}"/></w:tcPr><w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:i/><w:color w:val="${TEXT_MUTED}"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>No records match the selected reporting scope.</w:t></w:r></w:p></w:tc></w:tr>`;

  const totalsRow = computeColumnTotals({ ...table, columns });
  const totalsXml = totalsRow
    ? `<w:tr><w:trPr><w:cantSplit/></w:trPr>${columns.map((col, i) => {
        const isNum = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
        return makeCell(totalsRow[col.key] || '', colWidths[i], {
          align: col.align || (isNum ? 'right' : 'left'),
          fill: 'E8EEF8',
          color: NAVY,
          bold: true,
          topBorder: { sz: 10, color: NAVY }
        });
      }).join('')}</w:tr>`
    : '';

  return `<w:tbl>${tblPr}${tblGrid}${headerRow}${bodyRows}${totalsXml}</w:tbl>`;
}

/** Inline DrawingML paragraph embedding the template's native chart (`r:id="rId13"`). */
function buildInlineChartParagraph(relId = 'rId13') {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="160"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="6000000" cy="2900000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="6" name="Overview Chart"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${escXml(relId)}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** Render parsed Markdown blocks using exact CAE template styles. */
function buildMarkdownXmlBlocks(blocks = []) {
  if (!Array.isArray(blocks) || !blocks.length) return '';

  const renderRuns = (runs = [], sz = 20) => runs.map((r) => {
    const font = r.code ? 'Consolas' : 'Arial';
    const col = r.code ? ELECTRIC : TEXT_INK;
    const s = r.code ? 18 : sz;
    return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="Arial"/>${r.bold ? '<w:b/><w:bCs/>' : ''}${r.italic ? '<w:i/>' : ''}<w:color w:val="${col}"/><w:sz w:val="${s}"/><w:szCs w:val="${s}"/></w:rPr><w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');

  return blocks.map((b) => {
    switch (b.type) {
      case 'h1':
        return pSubHeading(b.text);
      case 'h2':
      case 'h3':
        return pCategoryHeading(b.text);
      case 'paragraph':
        return `<w:p><w:pPr><w:pStyle w:val="TexteCourant"/></w:pPr>${b.runs?.length ? renderRuns(b.runs) : `<w:r><w:t xml:space="preserve">${escXml(b.text)}</w:t></w:r>`}</w:p>`;
      case 'bullets':
        return (b.items || []).map((it) => (
          `<w:p><w:pPr><w:pStyle w:val="TexteCourant"/><w:ind w:left="420" w:hanging="200"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="${ELECTRIC}"/></w:rPr><w:t xml:space="preserve">•  </w:t></w:r>${it.runs?.length ? renderRuns(it.runs) : `<w:r><w:t xml:space="preserve">${escXml(it.text)}</w:t></w:r>`}</w:p>`
        )).join('');
      case 'ordered':
        return (b.items || []).map((it, idx) => (
          `<w:p><w:pPr><w:pStyle w:val="TexteCourant"/><w:ind w:left="420" w:hanging="240"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="${NAVY}"/></w:rPr><w:t xml:space="preserve">${idx + 1}. </w:t></w:r>${it.runs?.length ? renderRuns(it.runs) : `<w:r><w:t xml:space="preserve">${escXml(it.text)}</w:t></w:r>`}</w:p>`
        )).join('');
      case 'quote':
        return `<w:tbl><w:tblPr><w:tblW w:w="9810" w:type="dxa"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9810"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9810" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${ZEBRA}"/><w:tcBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="24" w:space="0" w:color="${ELECTRIC}"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:cs="Arial"/><w:i/><w:color w:val="${NAVY}"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t xml:space="preserve">${escXml(b.text)}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${pSpacer(80)}`;
      case 'code': {
        const lines = String(b.content || '').split('\n').map((ln) => (
          `<w:p><w:pPr><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="${TEXT_INK}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escXml(ln || ' ')}</w:t></w:r></w:p>`
        )).join('');
        return `<w:tbl><w:tblPr><w:tblW w:w="9810" w:type="dxa"/><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9810"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9810" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${ZEBRA}"/><w:tcBorders>${singleBordersXml(BORDER_SUBTLE, 4)}</w:tcBorders></w:tcPr>${lines}</w:tc></w:tr></w:tbl>${pSpacer(80)}`;
      }
      case 'table':
        return buildTemplateDataTable({
          columns: (b.headers || []).map((h, idx) => ({ header: h, key: `c${idx}`, width: 15 })),
          rows: (b.rows || []).map((r) => {
            const obj = {};
            r.forEach((cell, idx) => { obj[`c${idx}`] = cell; });
            return obj;
          })
        }) + pSpacer(80);
      case 'divider':
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${BORDER_SUBTLE}"/></w:pBdr><w:spacing w:before="60" w:after="100"/></w:pPr></w:p>`;
      default:
        return '';
    }
  }).join('');
}

module.exports = {
  NAVY,
  ELECTRIC,
  escXml,
  pPageBreak,
  pSpacer,
  pAppendixHeading,
  pSectionHeading,
  pSubHeading,
  pCategoryHeading,
  pBody,
  pLabeledBody,
  pAppendixName,
  buildCoverSdtXml,
  buildTocSdtXml,
  buildMetaStripXml,
  buildAlertsTable,
  buildTemplateDataTable,
  buildInlineChartParagraph,
  buildMarkdownXmlBlocks
};
