// =============================================================================
// exports/renderers/docx-sections.js — CAE A4 Cover & Composable Widgets (DOCX)
// -----------------------------------------------------------------------------
// Official CAE diagonal-hero A4 Word cover page with Contents Outline +
// composable widgets mirroring the PDF blueprint engine (`brief`, `kpis`,
// `gaugeBand`, `scorecard`, `highlights`, `statMatrix`, `cardList`, `alerts`).
// =============================================================================

const {
  Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel,
  WidthType, AlignmentType, BorderStyle, VerticalAlign, ImageRun
} = require('docx');

const { COLORS, COMPANY, OFFICE_FONTS, toneStyle, noHash, getLogoBuffer } = require('../core/branding');
const { str } = require('../core/helpers');

const F_DISP = OFFICE_FONTS.docx.display;
const F_BODY = OFFICE_FONTS.docx.body;
const F_MONO = OFFICE_FONTS.docx.mono;

const noBorder = () => {
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return { top: none, bottom: none, left: none, right: none };
};

function formatGenDate(meta) {
  return new Date(meta?.generatedAt || Date.now()).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function buildCoverHighlightsTable(highlights, theme) {
  if (!highlights || !highlights.length) return null;
  const shown = highlights.slice(0, 3);
  const pct = 100 / shown.length;
  const side = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      cantSplit: true,
      children: shown.map((h) => new TableCell({
        width: { size: pct, type: WidthType.PERCENTAGE },
        shading: { fill: noHash(COLORS.white) },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 24, color: noHash(theme.accent) },
          bottom: side,
          left: side,
          right: side
        },
        margins: { top: 110, bottom: 110, left: 140, right: 140 },
        children: [
          new Paragraph({
            spacing: { after: 35 },
            children: [new TextRun({
              text: String(h.label || '').toUpperCase(),
              bold: true,
              font: F_DISP,
              size: 14,
              color: noHash(COLORS.subtle)
            })]
          }),
          new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({
              text: str(h.value),
              bold: true,
              font: F_DISP,
              size: 26,
              color: noHash(theme.primary)
            })]
          })
        ]
      }))
    })]
  });
}

function buildCoverOutlineTable(pages, theme) {
  const named = (pages || []).filter((p) => p && p.title).slice(0, 6);
  if (!named.length) return [];

  const rows = [];
  const line = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };

  for (let i = 0; i < named.length; i += 2) {
    const left = { idx: i + 1, title: named[i].title };
    const right = named[i + 1] ? { idx: i + 2, title: named[i + 1].title } : null;
    const cell = (entry) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: { top: none, bottom: line, left: none, right: none },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({
        spacing: { after: 0 },
        children: entry ? [
          new TextRun({ text: `${String(entry.idx).padStart(2, '0')}. `, bold: true, font: F_DISP, size: 17, color: noHash(theme.accent) }),
          new TextRun({ text: entry.title, font: F_BODY, size: 17, color: noHash(COLORS.ink) })
        ] : []
      })]
    });
    rows.push(new TableRow({ cantSplit: true, children: [cell(left), cell(right)] }));
  }

  return [
    new Paragraph({
      spacing: { before: 40, after: 50 },
      children: [new TextRun({ text: 'REPORT CONTENTS & STRUCTURE', bold: true, font: F_DISP, size: 15, color: noHash(theme.cobalt || theme.primary) })]
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    new Paragraph({ spacing: { after: 140 }, text: '' })
  ];
}

function buildCoverControlTable(spec, theme) {
  const meta = spec.meta || {};
  const pairs = [
    ['Document ID', theme.docCode || spec.docCode || 'CAE-RPT'],
    ['Generated', formatGenDate(meta)],
    ...(meta.generatedBy ? [['Prepared By', meta.generatedBy]] : []),
    ...(meta.filters || []).slice(0, 5).map((f) => [f.label, str(f.value)]),
    ['Classification', meta.confidentiality || COMPANY.confidentiality]
  ];

  const line = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  const rows = [];

  for (let i = 0; i < pairs.length; i += 2) {
    const left = pairs[i];
    const right = pairs[i + 1];
    const makeCell = (pair) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: noHash(COLORS.zebra) },
      borders: {
        top: line,
        bottom: line,
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
      },
      margins: { top: 75, bottom: 75, left: 130, right: 130 },
      children: [new Paragraph({
        spacing: { after: 0 },
        children: pair ? [
          new TextRun({ text: `${pair[0]}: `, bold: true, font: F_DISP, size: 16.5, color: noHash(COLORS.subtle) }),
          new TextRun({ text: str(pair[1]), font: F_BODY, size: 16.5, color: noHash(COLORS.ink) })
        ] : []
      })]
    });

    rows.push(new TableRow({ cantSplit: true, children: [makeCell(left), makeCell(right)] }));
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

/** Build official CAE Navy/Blue `diagonal-hero` A4 Portrait Cover Page. */
function buildCoverPage(spec, theme) {
  const lightLogo = getLogoBuffer('light');
  const out = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { fill: noHash(theme.primary) },
          borders: {
            ...noBorder(),
            bottom: { style: BorderStyle.SINGLE, size: 36, color: noHash(theme.accent) }
          },
          margins: { top: 340, bottom: 380, left: 260, right: 260 },
          children: [
            new Paragraph({
              spacing: { after: 200 },
              children: [
                ...(lightLogo ? [new ImageRun({ data: lightLogo, transformation: { width: 120, height: 45 } })] : []),
                new TextRun({
                  text: `    ${theme.docCode}`,
                  bold: true,
                  font: F_MONO,
                  size: 18,
                  color: noHash(theme.secondary || COLORS.cyan)
                })
              ]
            }),
            new Paragraph({
              spacing: { after: 90 },
              children: [new TextRun({
                text: String(spec.category || '').toUpperCase(),
                bold: true,
                font: F_DISP,
                size: 18,
                color: noHash(theme.secondary || COLORS.cyan)
              })]
            }),
            new Paragraph({
              spacing: { after: 140, line: 276 },
              children: [new TextRun({
                text: spec.title,
                bold: true,
                font: F_DISP,
                size: 50,
                color: noHash(COLORS.white)
              })]
            }),
            ...(spec.subtitle ? [new Paragraph({
              spacing: { after: 100 },
              children: [new TextRun({
                text: spec.subtitle,
                font: F_DISP,
                size: 22,
                color: 'CBD5E1'
              })]
            })] : []),
            new Paragraph({
              spacing: { before: 100, after: 0 },
              children: [new TextRun({
                text: theme.coverTagline || COMPANY.tagline,
                italics: true,
                font: F_BODY,
                size: 17,
                color: '94A3B8'
              })]
            })
          ]
        })]
      })]
    }),
    new Paragraph({ spacing: { after: 200 }, text: '' })
  ];

  const hiTable = buildCoverHighlightsTable(spec.coverHighlights, theme);
  if (hiTable) {
    out.push(hiTable);
    out.push(new Paragraph({ spacing: { after: 140 }, text: '' }));
  }

  out.push(...buildCoverOutlineTable(spec.pages, theme));
  out.push(buildCoverControlTable(spec, theme));
  out.push(new Paragraph({
    spacing: { before: 180, after: 0 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `${COMPANY.name}  ·  ${COMPANY.tagline}`, font: F_BODY, size: 15, color: noHash(COLORS.subtle) })]
  }));

  return out;
}

/** Custom numbered section banner supporting arbitrary blueprint eyebrows & titles. */
function buildPageBanner(pageNum, eyebrow, title, subtitle, theme, pageBreakBefore = true) {
  const eye = eyebrow || `SECTION ${String(pageNum).padStart(2, '0')}`;
  const out = [
    new Paragraph({
      pageBreakBefore,
      spacing: { before: pageBreakBefore ? 0 : 120, after: 30 },
      children: [new TextRun({
        text: String(eye).toUpperCase(),
        bold: true,
        font: F_DISP,
        size: 16,
        color: noHash(theme.accent)
      })]
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: noHash(theme.accent) } },
      spacing: { before: 0, after: subtitle ? 45 : 110 },
      children: [new TextRun({
        text: title,
        bold: true,
        font: F_DISP,
        size: 30,
        color: noHash(theme.primary)
      })]
    })
  ];

  if (subtitle) {
    out.push(new Paragraph({
      spacing: { after: 110 },
      children: [new TextRun({
        text: subtitle,
        italics: true,
        font: F_BODY,
        size: 16.5,
        color: noHash(COLORS.subtle)
      })]
    }));
  }
  return out;
}

function buildExecutiveBrief(title, text, theme) {
  if (!text) return [];
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { fill: noHash(theme.tint || COLORS.zebra) },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) },
            right: { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) },
            left: { style: BorderStyle.SINGLE, size: 24, color: noHash(theme.accent) }
          },
          margins: { top: 100, bottom: 100, left: 150, right: 150 },
          children: [
            new Paragraph({
              spacing: { after: 35 },
              children: [new TextRun({ text: String(title || 'EXECUTIVE BRIEF').toUpperCase(), bold: true, font: F_DISP, size: 14.5, color: noHash(theme.primary) })]
            }),
            new Paragraph({
              spacing: { after: 0, line: 260 },
              children: [new TextRun({ text, font: F_BODY, size: 17.5, color: noHash(COLORS.body) })]
            })
          ]
        })]
      })]
    }),
    new Paragraph({ spacing: { after: 120 }, text: '' })
  ];
}

function buildThemedKpis(kpis, variant, theme) {
  if (!kpis || !kpis.length) return [];
  const style = variant || 'grid-2col';
  const out = [];
  const cols = style === 'compact-row' ? Math.min(4, kpis.length) : 2;
  const step = cols;

  for (let i = 0; i < kpis.length; i += step) {
    const chunk = kpis.slice(i, i + step);
    const pctW = 100 / chunk.length;

    const cells = chunk.map((k, idx) => {
      const tone = toneStyle(k.tone);
      const accentColor = noHash(tone ? tone.accent : theme.accent);
      const valColor = tone && (k.tone === 'danger' || k.tone === 'warning') ? noHash(tone.fg) : noHash(theme.primary);
      const isHeroFirst = style === 'hero-split' && i === 0 && idx === 0;
      const borderSide = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };

      const children = [
        new Paragraph({
          spacing: { after: 35 },
          children: [new TextRun({
            text: String(k.label || '').toUpperCase(),
            bold: true,
            font: F_DISP,
            size: style === 'compact-row' ? 13 : 14,
            color: isHeroFirst ? noHash(theme.secondary || COLORS.cyan) : noHash(COLORS.subtle)
          })]
        }),
        new Paragraph({
          spacing: { after: k.sublabel ? 30 : 0 },
          children: [new TextRun({
            text: str(k.value),
            bold: true,
            font: F_DISP,
            size: isHeroFirst ? 34 : (style === 'compact-row' ? 24 : 28),
            color: isHeroFirst ? noHash(COLORS.white) : valColor
          })]
        })
      ];

      if (style === 'gauges') {
        const pctVal = k.percent !== undefined
          ? Math.max(0, Math.min(100, Number(k.percent)))
          : (String(k.numFmt || '').includes('%') ? Math.max(0, Math.min(100, Number(k.rawValue) || 0)) : 65);
        const filled = Math.max(1, Math.round((pctVal / 100) * 16));
        children.push(new Paragraph({
          spacing: { after: 25 },
          children: [
            new TextRun({ text: '█'.repeat(filled), font: F_MONO, size: 11, color: accentColor }),
            ...(16 - filled > 0 ? [new TextRun({ text: '░'.repeat(16 - filled), font: F_MONO, size: 11, color: noHash(COLORS.border) })] : [])
          ]
        }));
      }

      if (k.sublabel) {
        children.push(new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({
            text: str(k.sublabel),
            font: F_BODY,
            size: 14.5,
            color: isHeroFirst ? 'CBD5E1' : noHash(COLORS.subtle)
          })]
        }));
      }

      const borders = style === 'strips'
        ? { top: borderSide, bottom: borderSide, right: borderSide, left: { style: BorderStyle.SINGLE, size: 24, color: accentColor } }
        : { top: { style: BorderStyle.SINGLE, size: 24, color: accentColor }, bottom: borderSide, left: borderSide, right: borderSide };

      return new TableCell({
        width: { size: pctW, type: WidthType.PERCENTAGE },
        shading: { fill: isHeroFirst ? noHash(theme.primary) : noHash(COLORS.zebra) },
        borders,
        margins: { top: 90, bottom: 90, left: 130, right: 130 },
        children
      });
    });

    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ cantSplit: true, children: cells })]
    }));
    out.push(new Paragraph({ spacing: { after: 90 }, text: '' }));
  }

  return out;
}

function buildGaugeBand(items, theme) {
  if (!items || !items.length) return [];
  const shown = items.slice(0, 3);
  const pctW = 100 / shown.length;
  const side = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };

  const cells = shown.map((item) => {
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));
    const tone = toneStyle(item.tone);
    const barCol = noHash(tone ? tone.accent : theme.accent);
    const filled = pctVal > 0 ? Math.max(1, Math.round((pctVal / 100) * 14)) : 0;

    return new TableCell({
      width: { size: pctW, type: WidthType.PERCENTAGE },
      shading: { fill: noHash(COLORS.white) },
      borders: { top: { style: BorderStyle.SINGLE, size: 24, color: barCol }, bottom: side, left: side, right: side },
      margins: { top: 100, bottom: 100, left: 110, right: 110 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 30 },
          children: [new TextRun({ text: str(item.valueLabel || `${pctVal.toFixed(0)}%`), bold: true, font: F_DISP, size: 28, color: noHash(tone ? tone.fg : theme.primary) })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 30 },
          children: [
            new TextRun({ text: '█'.repeat(filled), font: F_MONO, size: 11, color: barCol }),
            ...(14 - filled > 0 ? [new TextRun({ text: '░'.repeat(14 - filled), font: F_MONO, size: 11, color: noHash(COLORS.border) })] : [])
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 20 },
          children: [new TextRun({ text: str(item.label), bold: true, font: F_DISP, size: 15.5, color: noHash(COLORS.ink) })]
        }),
        ...(item.sublabel ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
          children: [new TextRun({ text: str(item.sublabel), font: F_BODY, size: 14, color: noHash(COLORS.subtle) })]
        })] : [])
      ]
    });
  });

  return [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ cantSplit: true, children: cells })] }),
    new Paragraph({ spacing: { after: 110 }, text: '' })
  ];
}

function buildScorecards(group, theme) {
  if (!group || !group.items?.length) return [];
  const out = [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };

  if (group.title) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 35 },
      children: [new TextRun({ text: group.title, bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    }));
  }
  if (group.subtitle) {
    out.push(new Paragraph({
      spacing: { after: 55 },
      children: [new TextRun({ text: group.subtitle, italics: true, font: F_BODY, size: 15.5, color: noHash(COLORS.subtle) })]
    }));
  }

  const rows = group.items.map((item, idx) => {
    const pctVal = Math.max(0, Math.min(100, Number(item.percent) || 0));
    const tone = toneStyle(item.tone);
    const barCol = noHash(tone ? tone.accent : theme.accent);
    const filled = pctVal > 0 ? Math.max(1, Math.round((pctVal / 100) * 18)) : 0;
    const zebra = idx % 2 === 1 ? noHash(COLORS.zebra) : undefined;

    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 44, type: WidthType.PERCENTAGE },
          shading: zebra ? { fill: zebra } : undefined,
          borders: { top: border, bottom: border, left: none, right: none },
          margins: { top: 60, bottom: 60, left: 90, right: 70 },
          children: [
            new Paragraph({ spacing: { after: item.detail ? 15 : 0 }, children: [new TextRun({ text: str(item.label), bold: true, font: F_BODY, size: 16.5, color: noHash(COLORS.ink) })] }),
            ...(item.detail ? [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: str(item.detail), font: F_BODY, size: 14, color: noHash(COLORS.subtle) })] })] : [])
          ]
        }),
        new TableCell({
          width: { size: 36, type: WidthType.PERCENTAGE },
          shading: zebra ? { fill: zebra } : undefined,
          borders: { top: border, bottom: border, left: none, right: none },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 70, right: 70 },
          children: [new Paragraph({
            spacing: { after: 0 },
            children: [
              new TextRun({ text: '█'.repeat(filled), font: F_MONO, size: 12.5, color: barCol }),
              ...(18 - filled > 0 ? [new TextRun({ text: '░'.repeat(18 - filled), font: F_MONO, size: 12.5, color: noHash(COLORS.border) })] : [])
            ]
          })]
        }),
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: zebra ? { fill: zebra } : undefined,
          borders: { top: border, bottom: border, left: none, right: none },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 70, right: 90 },
          children: [new Paragraph({
            spacing: { after: 0 },
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: str(item.valueLabel || `${pctVal.toFixed(1)}%`), bold: true, font: F_DISP, size: 16.5, color: tone ? noHash(tone.fg) : noHash(theme.primary) })]
          })]
        })
      ]
    });
  });

  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  out.push(new Paragraph({ spacing: { after: 100 }, text: '' }));
  return out;
}

function buildHighlights(title, items, theme) {
  if (!items || !items.length) return [];
  const out = [];
  if (title) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 50 },
      children: [new TextRun({ text: title, bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    }));
  }
  const side = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };

  for (let i = 0; i < items.length; i += 2) {
    const chunk = items.slice(i, i + 2);
    const pct = 100 / chunk.length;
    const cells = chunk.map((h) => {
      const tone = toneStyle(h.tone || 'info') || toneStyle('info');
      return new TableCell({
        width: { size: pct, type: WidthType.PERCENTAGE },
        shading: { fill: noHash(COLORS.white) },
        borders: { top: side, bottom: side, right: side, left: { style: BorderStyle.SINGLE, size: 24, color: noHash(tone.accent) } },
        margins: { top: 85, bottom: 85, left: 120, right: 120 },
        children: [
          new Paragraph({
            spacing: { after: 25 },
            children: [
              new TextRun({ text: `${String(h.eyebrow || 'HIGHLIGHT').toUpperCase()}  `, bold: true, font: F_DISP, size: 14, color: noHash(tone.fg) }),
              ...(h.metric ? [new TextRun({ text: `· ${str(h.metric)}`, bold: true, font: F_DISP, size: 15.5, color: noHash(theme.primary) })] : [])
            ]
          }),
          new Paragraph({
            spacing: { after: 25 },
            children: [new TextRun({ text: str(h.title), bold: true, font: F_DISP, size: 17.5, color: noHash(COLORS.ink) })]
          }),
          ...(h.detail ? [new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({ text: str(h.detail), font: F_BODY, size: 15.5, color: noHash(COLORS.body) })]
          })] : [])
        ]
      });
    });

    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ cantSplit: true, children: cells })] }));
    out.push(new Paragraph({ spacing: { after: 80 }, text: '' }));
  }

  return out;
}

function buildStatMatrix(title, pairs, theme) {
  if (!pairs || !pairs.length) return [];
  const out = [];
  if (title) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 45 },
      children: [new TextRun({ text: title, bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    }));
  }
  const line = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const left = pairs[i];
    const right = pairs[i + 1];
    const cell = (pair) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: noHash(COLORS.zebra) },
      borders: { top: line, bottom: line, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
      margins: { top: 75, bottom: 75, left: 120, right: 120 },
      children: [new Paragraph({
        spacing: { after: 0 },
        children: pair ? [
          new TextRun({ text: `${str(pair[0])}: `, bold: true, font: F_DISP, size: 16, color: noHash(COLORS.subtle) }),
          new TextRun({ text: str(pair[1]), font: F_BODY, size: 16.5, color: noHash(COLORS.ink) })
        ] : []
      })]
    });
    rows.push(new TableRow({ cantSplit: true, children: [cell(left), cell(right)] }));
  }
  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  out.push(new Paragraph({ spacing: { after: 100 }, text: '' }));
  return out;
}

function buildCardList(title, items, theme) {
  if (!items || !items.length) return [];
  const out = [];
  if (title) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 45 },
      children: [new TextRun({ text: title, bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    }));
  }
  const edge = { style: BorderStyle.SINGLE, size: 4, color: noHash(COLORS.border) };

  items.forEach((item) => {
    const tone = toneStyle(item.badgeTone || 'info') || toneStyle('info');
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { fill: noHash(COLORS.white) },
          borders: { top: edge, bottom: edge, right: edge, left: { style: BorderStyle.SINGLE, size: 24, color: noHash(tone.accent) } },
          margins: { top: 80, bottom: 80, left: 140, right: 140 },
          children: [
            new Paragraph({
              spacing: { after: 25 },
              children: [
                ...(item.badge ? [new TextRun({ text: `[${String(item.badge).toUpperCase()}]  `, bold: true, font: F_DISP, size: 15, color: noHash(tone.fg) })] : []),
                new TextRun({ text: str(item.title), bold: true, font: F_DISP, size: 18, color: noHash(COLORS.ink) }),
                ...(item.metric ? [new TextRun({ text: `   ·   ${str(item.metric)}`, bold: true, font: F_DISP, size: 17, color: noHash(theme.primary) })] : [])
              ]
            }),
            ...(item.meta ? [new Paragraph({
              spacing: { after: 20 },
              children: [new TextRun({ text: str(item.meta), bold: true, font: F_BODY, size: 15, color: noHash(COLORS.subtle) })]
            })] : []),
            ...(item.detail ? [new Paragraph({
              spacing: { after: 0 },
              children: [new TextRun({ text: str(item.detail), font: F_BODY, size: 16, color: noHash(COLORS.body) })]
            })] : [])
          ]
        })]
      })]
    }));
    out.push(new Paragraph({ spacing: { after: 65 }, text: '' }));
  });

  return out;
}

function buildAlerts(title, items, theme) {
  if (!items || !items.length) return [];
  const out = [];
  if (title) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 100, after: 45 },
      children: [new TextRun({ text: title, bold: true, font: F_DISP, size: 20, color: noHash(theme.primary) })]
    }));
  }

  items.forEach((ins) => {
    const tone = toneStyle(ins.severity || 'info') || toneStyle('info');
    const edge = { style: BorderStyle.SINGLE, size: 4, color: noHash(tone.border) };
    const paras = [
      new Paragraph({
        spacing: { after: ins.detail ? 25 : 0 },
        children: [new TextRun({ text: str(ins.title), bold: true, font: F_DISP, size: 18, color: noHash(tone.fg) })]
      })
    ];
    if (ins.detail) {
      paras.push(new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({ text: str(ins.detail), font: F_BODY, size: 16.5, color: noHash(COLORS.body) })]
      }));
    }

    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { fill: noHash(tone.bg) },
          borders: { top: edge, bottom: edge, right: edge, left: { style: BorderStyle.SINGLE, size: 24, color: noHash(tone.accent) } },
          margins: { top: 85, bottom: 85, left: 140, right: 140 },
          children: paras
        })]
      })]
    }));
    out.push(new Paragraph({ spacing: { after: 70 }, text: '' }));
  });

  return out;
}

module.exports = {
  buildCoverPage,
  buildPageBanner,
  buildExecutiveBrief,
  buildThemedKpis,
  buildGaugeBand,
  buildScorecards,
  buildHighlights,
  buildStatMatrix,
  buildCardList,
  buildAlerts
};
