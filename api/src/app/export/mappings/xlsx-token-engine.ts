import JSZip from 'jszip';
import * as ExcelJS from 'exceljs';
import { Snapshot } from '../../common/inspection-data.types';

/**
 * Template-agnostic OOXML row-expansion + token-substitution machinery.
 *
 * This is the low-level mechanism formerly inlined in
 * `drill-pipe-report.v1.mapping.ts`, moved here VERBATIM (Phase B2) so both the
 * legacy drill-pipe mapper and the definition-driven engine mapper drive the
 * exact same code. Nothing here knows about drill pipe: the per-row token keys
 * (which also locate the repeating row), the global token map, and the per-serial
 * token map are all parameters. Behavior is byte-preserving relative to the pre-B2
 * mapper (pinned by export.integration.spec.ts + the B2 equivalence specs).
 */

/**
 * Collapse inner whitespace inside `{{ token }}` placeholders to the canonical
 * no-space form `{{token}}`, so template cells authored with spaces (Excel users
 * naturally type `{{ inspector }}`) match the definition's tokens, which are stored
 * space-free (`{{inspector}}`). Mirrors the whitespace-insensitivity every real
 * template engine (Mustache/Handlebars/Jinja) gives `{{ x }}` vs `{{x}}`.
 *
 * `[^{}]*?` never crosses a brace, so only genuine placeholders are touched. A token
 * that already has no inner spaces is returned unchanged — so a drill-pipe template
 * (space-free tokens) is byte-identical through this pass and the export golden holds.
 */
export function canonicalizeTokens(xml: string): string {
  return xml.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, '{{$1}}');
}

/** Minimal XML character escaping for cell values */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Shift every row ref > afterRow in the worksheet XML by `delta`.
 * Touches only:
 *   - <row r="N"> attributes
 *   - <c r="XN"> cell address attributes
 *   - <mergeCell ref="X1:Y2"> top-left and bottom-right refs
 */
export function shiftRowsInXml(
  xml: string,
  afterRow: number,
  delta: number,
): string {
  // <row r="N">
  xml = xml.replace(/(<row\b[^>]*\br=")(\d+)(")/g, (_m, pre, rStr, post) => {
    const r = parseInt(rStr, 10);
    return r > afterRow ? `${pre}${r + delta}${post}` : _m;
  });

  // <c r="XN" …>
  xml = xml.replace(
    /(<c\b[^>]*\br=")([A-Z]+)(\d+)(")/g,
    (_m, pre, col, rStr, post) => {
      const r = parseInt(rStr, 10);
      return r > afterRow ? `${pre}${col}${r + delta}${post}` : _m;
    },
  );

  // <mergeCell ref="X1:Y2"/>
  xml = xml.replace(
    /<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/g,
    (_m, c1, r1s, c2, r2s) => {
      const r1 = parseInt(r1s, 10);
      const r2 = parseInt(r2s, 10);
      if (r1 > afterRow) {
        return `<mergeCell ref="${c1}${r1 + delta}:${c2}${r2 + delta}"/>`;
      }
      return _m;
    },
  );

  return xml;
}

/**
 * Parse the sharedStrings.xml into an array of raw <si>…</si> blocks.
 * Returns the array of strings as plain text (for token detection) and the
 * raw XML blocks (for reconstruction).
 */
export function parseSharedStrings(xml: string): {
  plain: string[];
  blocks: string[];
} {
  const blocks: string[] = [];
  const plain: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[0]);
    // Extract all text between <t>…</t> for a plain-text representation
    const text = ((m[1] ?? '').match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
      .map((t) => t.replace(/<\/?t[^>]*>/g, ''))
      .join('');
    plain.push(text);
  }
  return { blocks, plain };
}

/**
 * Rebuild the sharedStrings.xml given a new ordered list of <si> blocks.
 */
export function rebuildSharedStrings(
  originalXml: string,
  newBlocks: string[],
): string {
  // Replace everything between the opening <sst…> tag and </sst> with our new entries
  const count = newBlocks.length;
  return originalXml.replace(
    /(<sst[^>]*>)([\s\S]*)(<\/sst>)/,
    (_m, open, _body, close) => {
      // Update count attributes
      const updatedOpen = open
        .replace(/\bcount="[^"]*"/, `count="${count}"`)
        .replace(/\buniqueCount="[^"]*"/, `uniqueCount="${count}"`);
      return `${updatedOpen}${newBlocks.join('')}${close}`;
    },
  );
}

/**
 * Given a worksheet XML row string and the sharedStrings plain-text array,
 * collect all sharedString indices referenced by cells in this row.
 * Returns a Set<number> of indices.
 */
export function getSharedStringIndicesForRow(rowXml: string): Set<number> {
  const indices = new Set<number>();
  // Cells with type="s" (shared string): <c r="..." t="s"><v>N</v></c>
  const cellRe = /<c\b[^>]*\bt="s"[^>]*>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml)) !== null) {
    const vMatch = (m[1] ?? '').match(/<v>(\d+)<\/v>/);
    if (vMatch) indices.add(parseInt(vMatch[1] ?? '', 10));
  }
  return (cellRe.lastIndex, indices);
}

/**
 * Clone a template row XML string for a new row number, updating:
 *   - <row r="N"> attribute
 *   - every <c r="XN"> cell address
 */
export function cloneRowForNumber(
  templateRowXml: string,
  newRowNum: number,
): string {
  let xml = templateRowXml;
  // Update row number
  xml = xml.replace(/(<row\b[^>]*\br=")(\d+)(")/, `$1${newRowNum}$3`);
  // Update all cell addresses to new row number
  xml = xml.replace(
    /(<c\b[^>]*\br=")([A-Z]+)(\d+)(")/g,
    (_m, pre, col, _rStr, post) => {
      return `${pre}${col}${newRowNum}${post}`;
    },
  );
  return xml;
}

/** Options describing which token vocabulary drives one region + the globals. */
export interface RegionSubstitution {
  /**
   * The full set of per-row token keys. Doubles as the repeating-row locator: the
   * clone-template row is the single worksheet row whose cells reference any of these
   * tokens. There is no separate "marker" designation — the row is inferred from the
   * row-scope token vocabulary itself (the serial's own `rowSerial` token is one of
   * these, so a well-formed region template always has exactly one such row).
   */
  rowTokenKeys: string[];
  /** Resolved global (header) token → value map, applied once workbook-wide. */
  globalTokens: Record<string, string>;
  /** Resolve the per-row token → value map for one repeated item. */
  rowTokensFor: (serial: Snapshot['serialNumbers'][number]) => Record<
    string,
    string
  >;
}

/**
 * Expand the repeating row once per item and substitute both per-row and global
 * tokens, in place, on `workbook`. The repeating row is inferred from `rowTokenKeys`
 * (step 4). This is steps 2–8 of the original `mapDrillPipeReportV1`, verbatim except
 * for that inference, parameterized by `opts`.
 */
export async function expandRegionAndSubstitute(
  workbook: ExcelJS.Workbook,
  chunk: Snapshot['serialNumbers'],
  opts: RegionSubstitution,
): Promise<void> {
  const { rowTokenKeys, globalTokens, rowTokensFor } = opts;

  // 2. Serialize the workbook to raw bytes, then open with JSZip
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(
    rawBuffer as unknown as Parameters<typeof JSZip.loadAsync>[0],
  );

  const sheetPath = 'xl/worksheets/sheet1.xml';
  const ssPath = 'xl/sharedStrings.xml';

  let sheetXml = (await zip.file(sheetPath)?.async('string')) ?? '';
  let ssXml = (await zip.file(ssPath)?.async('string')) ?? '';

  if (!sheetXml) throw new Error('Could not read worksheet XML from template');

  // Normalize `{{ token }}` → `{{token}}` up front so every downstream match — row
  // detection (step 4, `text.includes(tok)`), row substitution (step 5), and the global
  // replace (step 6) — compares against the definition's space-free tokens. Templates
  // whose tokens already have no inner spaces (e.g. drill pipe) are unchanged by this,
  // keeping the export golden byte-identical.
  sheetXml = canonicalizeTokens(sheetXml);
  ssXml = canonicalizeTokens(ssXml);

  // 3. Parse shared strings — this is where the actual token text lives
  const { blocks: ssBlocks, plain: ssPlain } = parseSharedStrings(ssXml);

  // 4. Find the clone-template row by inferring it from the row-scope tokens: it is the
  // worksheet row whose cells reference any `rowTokenKeys` member. A template that
  // repeats per item keeps every row token on one physical row, so exactly one row
  // matches and it is cloned once per item. If the row tokens are split across multiple
  // rows we must NOT silently clone the wrong one — so we collect each matching row with
  // the tokens found on it and decide below: reject only when there is more than one
  // item to place (cloning cannot span rows), else treat the tokens as single-item
  // in-place substitutions. (Upload-time validation may catch the multi-item case
  // earlier; this stays the engine's own guard against emitting a broken sheet.)
  const rowRegex = /(<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>)/g;
  let templateRowXml = '';
  let templateRowNumber = -1;
  const rowsWithTokens = new Map<number, { xml: string; tokens: Set<string> }>();

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowXml = rowMatch[1] ?? '';
    const rowNum = parseInt(rowMatch[2] ?? '', 10);
    const indices = getSharedStringIndicesForRow(rowXml);
    const found = new Set<string>();
    for (const idx of indices) {
      const text = ssPlain[idx];
      if (!text) continue;
      for (const tok of rowTokenKeys) {
        if (tok && text.includes(tok)) found.add(tok);
      }
    }
    if (found.size > 0) {
      rowsWithTokens.set(rowNum, { xml: rowXml, tokens: found });
    }
  }

  // A stacked layout — row-scope tokens split across MULTIPLE worksheet rows — only
  // defeats cloning when there is more than one item to place. Cloning repeats a
  // SINGLE row per item, so N>1 items over a multi-row block is genuinely unsupported
  // and still rejected here. But with exactly one item there is nothing to repeat:
  // each row-scope token occurs once and resolves in place, precisely like a
  // header/global token. A "header + one serial" template — which need not, and often
  // does not, declare itself single-item — is therefore valid and must export, however
  // its per-item fields are arranged. (Zero items: nothing to place.)
  if (rowsWithTokens.size > 1 && chunk.length > 1) {
    const detail = [...rowsWithTokens.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, { tokens }]) => `row ${r} (${[...tokens].sort().join(', ')})`)
      .join('; ');
    throw new Error(
      `Repeating-row tokens span multiple worksheet rows: ${detail}. ` +
        `A template that repeats per item must keep all row-scope tokens on one row. ` +
        `(A template carrying a single item may stack them across rows freely.)`,
    );
  }

  if (rowsWithTokens.size > 1) {
    // Single-item stacked layout: no cloning. Resolve each row-scope token in place
    // for the one item, exactly as globals are resolved in step 6 below. We never set
    // `templateRowNumber`, so the clone path (step 5) is skipped entirely. An empty
    // chunk leaves the tokens untouched — mirroring the single-row path, whose own
    // clone step is gated behind `chunk.length > 0`.
    const only = chunk[0];
    if (only) {
      const rowTokens = rowTokensFor(only);
      for (const [token, value] of Object.entries(rowTokens)) {
        const escaped = token.replace(/[{}]/g, '\\$&');
        ssXml = ssXml.replace(new RegExp(escaped, 'g'), escapeXml(value));
      }
    }
  } else {
    // Exactly one token row (or none): infer the clone-template row — the original,
    // byte-preserving path. size === 1 → one iteration; size === 0 → none, leaving the
    // -1 sentinel so step 5 is skipped.
    for (const [rowNum, { xml }] of rowsWithTokens) {
      templateRowNumber = rowNum;
      templateRowXml = xml;
      break;
    }
  }

  // 5. Handle repeated-row expansion (if the inferred template row was found)
  if (templateRowNumber !== -1 && chunk.length > 0) {
    const N = chunk.length;
    const delta = N - 1; // net rows added (we replace 1 template row with N data rows)

    // Shift all rows AFTER the template row down by delta
    if (delta > 0) {
      sheetXml = shiftRowsInXml(sheetXml, templateRowNumber, delta);
    }

    const templateIndices = getSharedStringIndicesForRow(templateRowXml);

    // Build an index map: siIndex -> token string (for template row cells)
    const indexToToken: Map<number, string> = new Map();
    for (const idx of templateIndices) {
      const text = ssPlain[idx];
      if (text) {
        for (const tok of rowTokenKeys) {
          if (text.includes(tok)) {
            indexToToken.set(idx, text);
            break;
          }
        }
      }
    }

    const newRowsXml: string[] = [];

    for (const [i, sn] of chunk.entries()) {
      const rowNum = templateRowNumber + i;
      const rowTokens = rowTokensFor(sn);

      // For each template cell that has a token, add a new shared string entry
      // and build a remapping: old index -> new index
      const indexRemap: Map<number, number> = new Map();
      for (const [idx, templateText] of indexToToken.entries()) {
        let resolved = templateText;
        for (const [tok, val] of Object.entries(rowTokens)) {
          resolved = resolved.split(tok).join(val);
        }
        const newBlock = `<si><t xml:space="preserve">${escapeXml(resolved)}</t></si>`;
        const newIdx = ssBlocks.length;
        ssBlocks.push(newBlock);
        ssPlain.push(resolved);
        indexRemap.set(idx, newIdx);
      }

      // Clone the template row and remap shared string indices
      let clonedRow = cloneRowForNumber(templateRowXml, rowNum);
      for (const [oldIdx, newIdx] of indexRemap.entries()) {
        const cellPattern = new RegExp(
          `(<c\\b[^>]*\\bt="s"[^>]*>(?:<[^v/][^>]*>)*<v>)${oldIdx}(<\\/v>)`,
          'g',
        );
        clonedRow = clonedRow.replace(cellPattern, `$1${newIdx}$2`);
      }

      newRowsXml.push(clonedRow);
    }

    // Replace the template row with the N cloned rows
    sheetXml = sheetXml.replace(templateRowXml, newRowsXml.join(''));

    // Rebuild shared strings XML with the new entries
    ssXml = rebuildSharedStrings(ssXml, ssBlocks);
  }

  // 6. Apply global token replacement directly in the shared strings XML
  for (const [token, value] of Object.entries(globalTokens)) {
    const escaped = token.replace(/[{}]/g, '\\$&');
    ssXml = ssXml.replace(new RegExp(escaped, 'g'), escapeXml(value));
  }

  // 7. Write modified XMLs back and generate final buffer
  zip.file(sheetPath, sheetXml);
  if (ssXml) zip.file(ssPath, ssXml);

  const finalBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  // 8. Reload into the ExcelJS workbook so ExportService can call writeBuffer() on it
  for (const ws of [...workbook.worksheets]) {
    workbook.removeWorksheet(ws.id);
  }
  await workbook.xlsx.load(
    finalBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
}
