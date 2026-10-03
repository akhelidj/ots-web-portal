import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

/**
 * Phase D step 1 — `.xls` → `.xlsx` "at the door" normalizer.
 *
 * A once-at-the-door, bytes→bytes transform: detect a legacy BIFF (`.xls`) binary
 * and re-emit it as OOXML (`.xlsx`); pass a `.xlsx` (or anything that is not a
 * legacy `.xls`) through UNTOUCHED. This exists because ExcelJS — used everywhere
 * downstream (validation, export, token extraction) — reads `.xlsx`/CSV only and
 * cannot parse the legacy `.xls` compound-file format. SheetJS (`xlsx`) is the sole
 * package that reads BIFF; it is used HERE and nowhere else (disjoint from ExcelJS,
 * which never sees a legacy `.xls`).
 *
 * NOT wired into the upload path in this step — standalone and independently
 * provable (see token-extraction.spec.ts). Nothing writes, versions, or hashes here.
 */
@Injectable()
export class XlsNormalizerService {
  /**
   * OLE2 / Compound File Binary signature — the first 8 bytes of every legacy
   * `.xls` (BIFF8) workbook. This is the ground-truth "is this a legacy binary"
   * test, more reliable than extension or the browser-supplied MIME type.
   */
  private static readonly OLE2_MAGIC = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]);

  /** True iff the buffer begins with the OLE2 compound-file signature (legacy .xls). */
  isLegacyXls(buffer: Buffer): boolean {
    return (
      buffer.length >= XlsNormalizerService.OLE2_MAGIC.length &&
      buffer
        .subarray(0, XlsNormalizerService.OLE2_MAGIC.length)
        .equals(XlsNormalizerService.OLE2_MAGIC)
    );
  }

  /**
   * Return a `.xlsx` buffer for `buffer`. Legacy `.xls` → converted via SheetJS;
   * everything else (already `.xlsx`, or non-Excel bytes we leave for the caller
   * to reject) → returned byte-identical.
   *
   * `bookSST: true` is REQUIRED, not cosmetic: SheetJS defaults to inline strings
   * (`<is><t>` in the sheet, no `sharedStrings.xml`), but the whole downstream
   * pipeline — the token extractor here AND the export engine's OOXML machinery —
   * reads token text out of `sharedStrings.xml`. Forcing the shared-string table
   * makes the normalizer's output shape identical to a real Excel-authored `.xlsx`.
   */
  normalizeToXlsx(buffer: Buffer): Buffer {
    if (!this.isLegacyXls(buffer)) {
      return buffer;
    }
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const out = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      bookSST: true,
    }) as Buffer | Uint8Array;
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  }
}
