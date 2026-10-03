import * as ExcelJS from 'exceljs';

/**
 * PDF-only page preparation for a finished workbook.
 *
 * An Excel sheet is an endless canvas; a PDF is fixed pages, so the converter (LibreOffice)
 * needs a sane page setup. Templates are authored for their BLANK shape, and filling them
 * adds rows and writes row heights Excel would otherwise auto-compute — so before conversion
 * we normalise, per visible sheet:
 *
 *   - fit to ONE page wide, as many tall as needed (no columns spilling onto extra pages);
 *   - print area covering every row actually used (ExcelJS does not move the template's
 *     print area when rows are inserted); the template's own columns are kept;
 *   - manual page breaks dropped (they were placed for the blank template);
 *   - landscape only when the sheet is wider than it is tall (a tall form stays portrait);
 *   - an explicit height on wrapped-text rows so text is not clipped.
 *
 * Only ever applied on the PDF path: the Excel download is untouched.
 */

const PX_PER_CHAR = 7;
const DEFAULT_ROW_PX = 20;
const DEFAULT_ROW_PT = 15;
const DEFAULT_FONT_PT = 11;
const A4 = 9;

export async function prepareWorkbookForPdf(xlsx: Buffer): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  for (const ws of workbook.worksheets) {
    if (ws.state !== 'visible') continue;
    applyPdfPageSetup(ws);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function applyPdfPageSetup(ws: ExcelJS.Worksheet): void {
  const extent = usedExtent(ws);
  if (!extent) return;

  ensureRowHeights(ws, extent.lastRow);

  // Print area: keep the template's columns, extend rows to what is actually used.
  const existing = parseSingleRange(ws.pageSetup.printArea);
  const area = existing
    ? {
        firstCol: existing.firstCol,
        firstRow: existing.firstRow,
        lastCol: Math.max(existing.lastCol, extent.lastCol),
        lastRow: Math.max(existing.lastRow, extent.lastRow),
      }
    : { firstCol: 1, firstRow: 1, lastCol: extent.lastCol, lastRow: extent.lastRow };
  ws.pageSetup.printArea = `${address(area.firstCol, area.firstRow)}:${address(area.lastCol, area.lastRow)}`;

  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0; // 0 = as many pages tall as needed
  ws.pageSetup.paperSize ??= A4;

  let widthPx = 0;
  for (let c = area.firstCol; c <= area.lastCol; c++) {
    widthPx += (ws.getColumn(c).width ?? 8.43) * PX_PER_CHAR;
  }
  let heightPx = 0;
  for (let r = area.firstRow; r <= area.lastRow; r++) {
    const pts = ws.getRow(r).height;
    heightPx += pts ? (pts * 4) / 3 : DEFAULT_ROW_PX;
  }
  ws.pageSetup.orientation = widthPx > heightPx ? 'landscape' : 'portrait';

  // `rowBreaks` is real on the worksheet (and serialised) but missing from ExcelJS's typings.
  (ws as unknown as { rowBreaks: unknown[] }).rowBreaks = [];
}

/** Last row/column that carries a value or a merge; null for an empty sheet. */
function usedExtent(ws: ExcelJS.Worksheet): { lastRow: number; lastCol: number } | null {
  let lastRow = 0;
  let lastCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.value === null || cell.value === undefined || cell.value === '') return;
      lastRow = Math.max(lastRow, rowNumber);
      lastCol = Math.max(lastCol, colNumber);
    });
  });
  for (const m of ws.model.merges ?? []) {
    const r = parseSingleRange(m);
    if (!r) continue;
    // A merge only counts when its master holds content (a styled empty merge is padding).
    const master = ws.getCell(r.firstRow, r.firstCol);
    if (master.value === null || master.value === undefined || master.value === '') continue;
    lastRow = Math.max(lastRow, r.lastRow);
    lastCol = Math.max(lastCol, r.lastCol);
  }
  return lastRow > 0 ? { lastRow, lastCol } : null;
}

/**
 * Give wrapped-text rows without an explicit height one sized to their text. Excel computes
 * this at open time; LibreOffice does too for rows with no stored height, but rows written
 * by ExcelJS often end up too short once text wraps over several lines.
 */
function ensureRowHeights(ws: ExcelJS.Worksheet, lastRow: number): void {
  const merges = new Map<string, { lastCol: number; firstRow: number; lastRow: number }>();
  for (const m of ws.model.merges ?? []) {
    const r = parseSingleRange(m);
    if (r) merges.set(address(r.firstCol, r.firstRow), r);
  }

  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (row.height) continue; // an explicit height is authoritative
    let neededPt = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!cell.alignment?.wrapText) return;
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const text = cellText(cell);
      if (!text) return;

      const merge = merges.get(cell.address);
      // A merge spanning several rows has its own rows' heights; only size within one row.
      if (merge && merge.lastRow !== merge.firstRow) return;
      const lastCol = merge ? merge.lastCol : colNumber;

      let widthChars = 0;
      for (let c = colNumber; c <= lastCol; c++) widthChars += ws.getColumn(c).width ?? 8.43;

      const fontPt = cell.font?.size ?? DEFAULT_FONT_PT;
      // Characters that fit on one line: column width is in default-font chars.
      const perLine = Math.max(1, Math.floor((widthChars * DEFAULT_FONT_PT) / fontPt / (cell.font?.bold ? 1.1 : 1)));
      const lines = text
        .split(/\r?\n/)
        .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
      neededPt = Math.max(neededPt, lines * fontPt * 1.3);
    });

    if (neededPt > DEFAULT_ROW_PT) row.height = Math.ceil(neededPt);
  }
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in v) {
    return v.richText.map((t) => t.text).join('');
  }
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '');
  return cell.text ?? String(v);
}

interface Range {
  firstCol: number;
  firstRow: number;
  lastCol: number;
  lastRow: number;
}

/** `A1:H40` (optionally `$`-anchored). Multi-range print areas (`&&`) are not handled. */
function parseSingleRange(input: string | undefined): Range | null {
  if (!input || input.includes('&&')) return null;
  const m = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(input.trim());
  if (!m) return null;
  return {
    firstCol: colNumber(m[1] as string),
    firstRow: Number(m[2]),
    lastCol: colNumber(m[3] as string),
    lastRow: Number(m[4]),
  };
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function address(col: number, row: number): string {
  return `${colLetters(col)}${row}`;
}
