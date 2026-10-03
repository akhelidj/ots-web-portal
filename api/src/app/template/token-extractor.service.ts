import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import {
  parseSharedStrings,
  getSharedStringIndicesForRow,
} from '../export/mappings/xlsx-token-engine';

/**
 * Phase D step 1 — api-side token extractor.
 *
 * The INVERSE of the export token engine: the engine expands `{{token}}` markers
 * into per-row cells; this reads the tokens back OUT of an uploaded workbook so a
 * (future) authoring UI can describe each one. Read-only — parses bytes, returns a
 * list, mutates nothing.
 *
 * It reuses the export engine's shared-string helpers VERBATIM (imported, not
 * forked) so token detection cannot drift from how export actually reads tokens:
 *   - `parseSharedStrings` → the `<si>` plain-text table (token text lives here);
 *   - `getSharedStringIndicesForRow` → which shared-string indices a given row
 *     references. Anchoring on `t="s"` cells is also what keeps this correct in the
 *     presence of self-closing cells (`<c .../>`): a naive `<c>…</c>` scan would
 *     swallow a token cell that follows a self-closing one.
 * Cell-ADDRESS resolution is new (neither helper exposes addresses), and uses the
 * same `t="s"`-anchored cell match to stay swallow-safe.
 *
 * Scope (header vs. item/repeating-region) is DELIBERATELY not inferred here — this
 * step only reports what token sits in which cell. Consistent with the export
 * engine, only the primary worksheet (`xl/worksheets/sheet1.xml`) is scanned.
 */

export interface ExtractedToken {
  /** The full token literal, e.g. `"{{b_od}}"`. */
  token: string;
  /** The A1 cell address the token was found in, e.g. `"C17"`. */
  cell: string;
  /** The 1-based worksheet row the cell sits on, e.g. `17`. */
  row: number;
}

/** `{{token}}` — word-char token names, tolerant of inner whitespace. */
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

@Injectable()
export class TokenExtractorService {
  async extractTokens(xlsxBuffer: Buffer): Promise<ExtractedToken[]> {
    const zip = await JSZip.loadAsync(
      xlsxBuffer as unknown as Parameters<typeof JSZip.loadAsync>[0],
    );

    const sheetXml =
      (await zip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '';
    const ssXml =
      (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';

    // No worksheet or no shared-string table → no tokens to report. (A workbook
    // with only inline strings carries no sharedStrings.xml; the normalizer emits
    // shared strings, and real Excel authors them, so this is a defensive floor.)
    if (!sheetXml || !ssXml) {
      return [];
    }

    const { plain } = parseSharedStrings(ssXml);

    const results: ExtractedToken[] = [];

    const rowRegex = /(<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>)/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
      const rowXml = rowMatch[1] ?? '';
      const rowNum = parseInt(rowMatch[2] ?? '', 10);

      const indices = getSharedStringIndicesForRow(rowXml);
      if (indices.size === 0) {
        continue;
      }

      // Map shared-string index → the cell address(es) referencing it, in this row.
      // Anchored on `t="s"` (same as the reused helper) so self-closing cells cannot
      // desync the scan. A single index may be referenced by more than one cell.
      const addressesByIndex = new Map<number, string[]>();
      const cellRegex = /<c\b([^>]*\bt="s"[^>]*)>([\s\S]*?)<\/c>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
        const attrs = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const addrMatch = attrs.match(/\br="([A-Z]+\d+)"/);
        const idxMatch = body.match(/<v>(\d+)<\/v>/);
        if (!addrMatch || !idxMatch) {
          continue;
        }
        const idx = parseInt(idxMatch[1] ?? '', 10);
        const list = addressesByIndex.get(idx) ?? [];
        list.push(addrMatch[1] ?? '');
        addressesByIndex.set(idx, list);
      }

      for (const idx of indices) {
        const text = plain[idx];
        if (!text) {
          continue;
        }
        const tokens: string[] = [];
        TOKEN_RE.lastIndex = 0;
        let tokMatch: RegExpExecArray | null;
        while ((tokMatch = TOKEN_RE.exec(text)) !== null) {
          tokens.push(`{{${tokMatch[1]}}}`);
        }
        if (tokens.length === 0) {
          continue;
        }
        for (const cell of addressesByIndex.get(idx) ?? []) {
          for (const token of tokens) {
            results.push({ token, cell, row: rowNum });
          }
        }
      }
    }

    // Deterministic order: row, then column, then token — so callers (and the
    // known-answer test) see a stable sequence regardless of XML cell ordering.
    return results.sort(
      (a, b) =>
        a.row - b.row ||
        colIndex(a.cell) - colIndex(b.cell) ||
        (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
    );
  }
}

/** A1 column letters → 0-based column index (`"A"`→0, `"Z"`→25, `"AA"`→26). */
function colIndex(cell: string): number {
  const letters = cell.match(/^[A-Z]+/)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
