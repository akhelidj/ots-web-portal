import * as ExcelJS from 'exceljs';

/**
 * Post-substitution pass that turns the engine's signature placeholders into pictures.
 *
 * The token engine emits text only, so an image-bearing token resolves to a marker
 * (`signatureMarker(slot)`). Running AFTER the engine has expanded rows and substituted
 * tokens means the cell address is final even when the repeating region pushed the
 * signature block down. Every marker is cleared whether or not an image is available, so
 * the placeholder can never leak into a delivered workbook.
 */

/** Longest edge the picture may take when the cell gives it more room than this. */
const MAX_WIDTH_PX = 240;
const MAX_HEIGHT_PX = 80;
/** Excel column width unit → pixels (default font), and the default row height. */
const PX_PER_CHAR = 7;
const DEFAULT_ROW_PX = 20;

export interface SignatureImage {
  /** PNG bytes. */
  bytes: Buffer;
}

/**
 * Any signature marker, whatever the slot (`inspectorSignature`, `field:<key>`). Sweeping by
 * pattern — not by the slots we have images for — is what guarantees an unsigned field's
 * placeholder is cleared too and can never leak into a delivered workbook.
 */
const ANY_MARKER = /\[\[OTS_SIGNATURE:([^\]]+)\]\]/g;
const MARKER_PREFIX = '[[OTS_SIGNATURE:';

/** Replace every signature marker in the workbook; returns how many cells carried one. */
export function embedSignatures(
  workbook: ExcelJS.Workbook,
  images: Readonly<Record<string, SignatureImage | undefined>>,
): number {
  let found = 0;
  // One media entry per slot, reused across cells and sheets.
  const imageIds = new Map<string, number>();

  for (const ws of workbook.worksheets) {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        // A merged range repeats the master's value on every member; act once.
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const text = cell.text;
        if (!text || !text.includes(MARKER_PREFIX)) return;

        const slots = [...text.matchAll(ANY_MARKER)].map((m) => m[1] as string);
        if (slots.length === 0) return;

        found += 1;
        cell.value = text.replace(ANY_MARKER, '').trim() || null;

        for (const slot of new Set(slots)) {
          const image = images[slot];
          if (!image) continue;

          let imageId = imageIds.get(slot);
          if (imageId === undefined) {
            imageId = workbook.addImage({
              buffer: image.bytes as unknown as ExcelJS.Buffer,
              extension: 'png',
            });
            imageIds.set(slot, imageId);
          }
          const box = cellBox(ws, cell);
          const size = fit(image.bytes, box);
          ws.addImage(imageId, {
            tl: { col: Number(cell.col) - 1, row: Number(cell.row) - 1 },
            ext: size,
            editAs: 'oneCell',
          });
        }
      });
    });
  }
  return found;
}

/** Pixel room offered by the cell, or its whole merged range. */
function cellBox(
  ws: ExcelJS.Worksheet,
  cell: ExcelJS.Cell,
): { width: number; height: number } {
  let lastCol = Number(cell.col);
  let lastRow = Number(cell.row);
  const range = (ws.model.merges ?? []).find((m) =>
    m.startsWith(`${cell.address}:`),
  );
  if (range) {
    const end = ws.getCell(range.split(':')[1] ?? cell.address);
    lastCol = Number(end.col);
    lastRow = Number(end.row);
  }
  let width = 0;
  for (let c = Number(cell.col); c <= lastCol; c++) {
    width += (ws.getColumn(c).width ?? 8.43) * PX_PER_CHAR;
  }
  let height = 0;
  for (let r = Number(cell.row); r <= lastRow; r++) {
    const pts = ws.getRow(r).height;
    height += pts ? (pts * 4) / 3 : DEFAULT_ROW_PX;
  }
  return { width, height };
}

/**
 * Scale the PNG to fit the cell room (and the caps) without distorting it. The source
 * dimensions come from the IHDR; an unreadable header falls back to the portal's 3:1.
 */
function fit(
  png: Buffer,
  box: { width: number; height: number },
): { width: number; height: number } {
  const w = png.length >= 24 ? png.readUInt32BE(16) : 600;
  const h = png.length >= 24 ? png.readUInt32BE(20) : 200;
  const ratio = w > 0 && h > 0 ? w / h : 3;
  const maxW = Math.max(40, Math.min(box.width - 4, MAX_WIDTH_PX));
  const maxH = Math.max(20, Math.min(box.height - 2, MAX_HEIGHT_PX));
  const width = Math.min(maxW, maxH * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}
