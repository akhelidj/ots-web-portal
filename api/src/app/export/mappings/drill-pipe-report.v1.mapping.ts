import JSZip from 'jszip';

/** Minimal XML character escaping for cell values */
function escapeXml(s: string): string {
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
function shiftRowsInXml(xml: string, afterRow: number, delta: number): string {
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
function parseSharedStrings(xml: string): {
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
    const text = (m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
      .map((t) => t.replace(/<\/?t[^>]*>/g, ''))
      .join('');
    plain.push(text);
  }
  return { blocks, plain };
}

/**
 * Rebuild the sharedStrings.xml given a new ordered list of <si> blocks.
 */
function rebuildSharedStrings(
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
 * Replace tokens inside a single <si> block, returning the updated block.
 * Handles both simple <t>text</t> and rich text <r><t>text</t></r> nodes.
 */
function replaceTokensInSiBlock(
  block: string,
  tokens: Record<string, string>,
): string {
  let result = block;
  for (const [token, value] of Object.entries(tokens)) {
    const escaped = token.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), escapeXml(value));
  }
  return result;
}

/**
 * Given a worksheet XML row string and the sharedStrings plain-text array,
 * collect all sharedString indices referenced by cells in this row.
 * Returns a Set<number> of indices.
 */
function getSharedStringIndicesForRow(rowXml: string): Set<number> {
  const indices = new Set<number>();
  // Cells with type="s" (shared string): <c r="..." t="s"><v>N</v></c>
  const cellRe = /<c\b[^>]*\bt="s"[^>]*>([\s\S]*?)<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml)) !== null) {
    const vMatch = m[1].match(/<v>(\d+)<\/v>/);
    if (vMatch) indices.add(parseInt(vMatch[1], 10));
  }
  return (cellRe.lastIndex, indices);
}

/**
 * Clone a template row XML string for a new row number, updating:
 *   - <row r="N"> attribute
 *   - every <c r="XN"> cell address
 */
function cloneRowForNumber(templateRowXml: string, newRowNum: number): string {
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

import * as ExcelJS from 'exceljs';

export async function mapDrillPipeReportV1(
  workbook: ExcelJS.Workbook,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialNumbersChunk: any[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (snapshot.header || snapshot) as any;

  // 1. Build global token map
  const reportDate = h.updatedAt
    ? new Date(h.updatedAt).toLocaleDateString()
    : h.createdAt
      ? new Date(h.createdAt).toLocaleDateString()
      : 'N/A';

  const eqNames =
    (((h.equipmentUsed || snapshot.equipmentUsed) as any[]) || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => `${e.name}${e.number ? ' #' + e.number : ''}`)
      .join(', ') || 'None specified';
  const mNames =
    (((h.inspectionMethod || snapshot.inspectionMethod) as any[]) || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => m.name || m)
      .join(', ') || 'None specified';

  let inspectedByName = h.inspectedByName || 'N/A';
  let approvedByName = h.approvedByName || 'N/A';
  const transitionLogs = snapshot.transitionLogs || [];
  if (Array.isArray(transitionLogs) && transitionLogs.length > 0) {
    const asc = [...transitionLogs].sort(
      (a: any, b: any) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const inspectLog = asc.find(
      (l: any) =>
        l.toStatus === 'IN_INSPECTION' || l.toStatus === 'PENDING_APPROVAL',
    );
    if (inspectLog?.userId) {
      const u = (snapshot.users || []).find(
        (u: any) => u.id === inspectLog.userId,
      );
      if (u) inspectedByName = u.name || u.email;
    }
    const approveLog = [...asc]
      .reverse()
      .find((l: any) => l.toStatus === 'APPROVED' || l.toStatus === 'CLOSED');
    if (approveLog?.userId) {
      const u = (snapshot.users || []).find(
        (u: any) => u.id === approveLog.userId,
      );
      if (u) approvedByName = u.name || u.email;
    }
  }

  const globalTokens: Record<string, string> = {
    '{{customer}}': h.customerName || 'N/A',
    '{{reportNumber}}': h.reportNumber || 'N/A',
    '{{reportDate}}': reportDate,
    '{{poNumber}}': h.poNumber || 'N/A',
    '{{standardUsed}}': h.standardUsed || 'N/A',
    '{{inspectionAddress}}': h.inspectionAddress || 'N/A',
    '{{grade}}': h.grade || 'N/A',
    '{{range}}': h.range || 'N/A',
    '{{weight}}': h.weight || 'N/A',
    '{{nomWT}}': h.nomWT || 'N/A',
    '{{nomOD}}': h.nomOD || 'N/A',
    '{{nomID}}': h.nomID || 'N/A',
    '{{connection}}': h.connection || 'N/A',
    '{{equipment}}': eqNames,
    '{{methods}}': mNames,
    '{{inspectorComment}}':
      h.inspectorComment ||
      snapshot.inspectorComment ||
      'No comments provided.',
    '{{inspectedBy}}': inspectedByName,
    '{{approvedBy}}': approvedByName,
  };

  // 2. Serialize the workbook to raw bytes, then open with JSZip
  const rawBuffer = await workbook.xlsx.writeBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zip = await JSZip.loadAsync(rawBuffer as any);

  const sheetPath = 'xl/worksheets/sheet1.xml';
  const ssPath = 'xl/sharedStrings.xml';

  let sheetXml = (await zip.file(sheetPath)?.async('string')) ?? '';
  let ssXml = (await zip.file(ssPath)?.async('string')) ?? '';

  if (!sheetXml) throw new Error('Could not read worksheet XML from template');

  // 3. Parse shared strings — this is where the actual token text lives
  const { blocks: ssBlocks, plain: ssPlain } = parseSharedStrings(ssXml);

  // 4. Find the template row that contains {{sn}} by checking shared string values
  //    A row references shared strings as <c t="s"><v>INDEX</v></c>
  const rowRegex = /(<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>)/g;
  let templateRowXml = '';
  let templateRowNumber = -1;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowXml = rowMatch[1];
    const indices = getSharedStringIndicesForRow(rowXml);
    for (const idx of indices) {
      if (ssPlain[idx] && ssPlain[idx].includes('{{sn}}')) {
        templateRowNumber = parseInt(rowMatch[2], 10);
        templateRowXml = rowXml;
        break;
      }
    }
    if (templateRowNumber !== -1) break;
  }

  // 5. Handle serial number row expansion (if {{sn}} template row found)
  if (templateRowNumber !== -1 && serialNumbersChunk.length > 0) {
    const yesNo = (val: unknown) =>
      val === undefined || val === null ? '' : val ? '1' : '';
    const N = serialNumbersChunk.length;
    const delta = N - 1; // net rows added (we replace 1 template row with N data rows)

    // Shift all rows AFTER the template row down by delta
    if (delta > 0) {
      sheetXml = shiftRowsInXml(sheetXml, templateRowNumber, delta);
    }

    // For each serial number, we need the per-row shared string indices
    // We will ADD new <si> entries to the shared strings table for per-row data,
    // and update the cell <v> references in the cloned row XMLs.
    //
    // Strategy: find which shared string indices are used in the template row,
    // build a token->value map for each SN, add new si entries, replace cell refs.
    const templateIndices = getSharedStringIndicesForRow(templateRowXml);

    // Build an index map: siIndex -> token string (for template row cells)
    const indexToToken: Map<number, string> = new Map();
    for (const idx of templateIndices) {
      const text = ssPlain[idx];
      if (text) {
        // Check if this shared string contains any per-row token
        const allRowTokenKeys = [
          '{{sn}}',
          '{{b_ts}}',
          '{{b_od}}',
          '{{b_thd}}',
          '{{b_ecc}}',
          '{{b_cbd}}',
          '{{b_cbl}}',
          '{{b_bvl}}',
          '{{b_cond}}',
          '{{b_hard}}',
          '{{p_ts}}',
          '{{p_od}}',
          '{{p_id}}',
          '{{p_ecc}}',
          '{{p_conn}}',
          '{{p_base}}',
          '{{p_bvl}}',
          '{{p_cond}}',
          '{{wall}}',
          '{{od_decr}}',
          '{{emi}}',
          '{{slip}}',
          '{{corr_in}}',
          '{{corr_out}}',
          '{{ipc}}',
          '{{bent}}',
          '{{jc_new}}',
          '{{jc_prem}}',
          '{{jc_c2}}',
          '{{jc_scrap}}',
          '{{remarks}}',
        ];
        for (const tok of allRowTokenKeys) {
          if (text.includes(tok)) {
            indexToToken.set(idx, text);
            break;
          }
        }
      }
    }

    // For each SN, build cloned row XMLs with new shared string indices
    const newRowsXml: string[] = [];

    for (let i = 0; i < N; i++) {
      const sn = serialNumbersChunk[i];
      const rowNum = templateRowNumber + i;

      const d = sn.inspectionData || sn.inspectionJson || {};
      const box = d.box || {};
      const pin = d.pin || {};
      const body = d.body || {};
      const final = d.final || {};
      const boxBvl = box.bevelDiameterMin
        ? `${box.bevelDiameterMin}-${box.bevelDiameterMax || ''}`
        : '';
      const pinConn = pin.lengthPinConnMin
        ? `${pin.lengthPinConnMin}-${pin.lengthPinConnMax || ''}`
        : '';
      const pinBvl = pin.bevelDiameterMin
        ? `${pin.bevelDiameterMin}-${pin.bevelDiameterMax || ''}`
        : '';

      const rowTokens: Record<string, string> = {
        '{{sn}}': sn.serial || sn.serialNumber || sn.value || '',
        '{{b_ts}}': box.minTongSpace || '',
        '{{b_od}}': box.minOD || '',
        '{{b_thd}}': box.minBoxThreads || '',
        '{{b_ecc}}': box.minEccShoulder || '',
        '{{b_cbd}}': box.maxCounterBoreDiameter || '',
        '{{b_cbl}}': box.maxCounterBoreLength || '',
        '{{b_bvl}}': boxBvl,
        '{{b_cond}}': box.condition || '',
        '{{b_hard}}': box.hardBanding || '',
        '{{p_ts}}': pin.minTongSpace || '',
        '{{p_od}}': pin.minOD || '',
        '{{p_id}}': pin.maxID || '',
        '{{p_ecc}}': pin.minEccShoulder || '',
        '{{p_conn}}': pinConn,
        '{{p_base}}': pin.maxLengthPinBase || '',
        '{{p_bvl}}': pinBvl,
        '{{p_cond}}': pin.condition || '',
        '{{wall}}': body.wallRemaining || '',
        '{{od_decr}}': body.odDecrease || '',
        '{{emi}}': body.emiResult || '',
        '{{slip}}': body.slipArea || '',
        '{{corr_in}}': yesNo(body.corrosionIn),
        '{{corr_out}}': yesNo(body.corrosionOut),
        '{{ipc}}': yesNo(body.ipc),
        '{{bent}}': yesNo(body.bentJoints),
        '{{jc_new}}': final.isNew ? 'X' : '',
        '{{jc_prem}}': final.isPremium ? 'X' : '',
        '{{jc_c2}}': final.isC2 ? 'X' : '',
        '{{jc_scrap}}': final.isScrap ? 'X' : '',
        '{{remarks}}':
          final.condition_notes || final.remarks || d.remarks || '',
      };

      // For each template cell that has a token, add a new shared string entry
      // and build a remapping: old index -> new index
      const indexRemap: Map<number, number> = new Map();
      for (const [idx, templateText] of indexToToken.entries()) {
        // Build the resolved value by applying row tokens to the template text
        let resolved = templateText;
        for (const [tok, val] of Object.entries(rowTokens)) {
          resolved = resolved.split(tok).join(val);
        }
        // Add as a new simple <si><t>value</t></si> block (preserve-space for safety)
        const newBlock = `<si><t xml:space="preserve">${escapeXml(resolved)}</t></si>`;
        const newIdx = ssBlocks.length;
        ssBlocks.push(newBlock);
        ssPlain.push(resolved);
        indexRemap.set(idx, newIdx);
      }

      // Clone the template row and remap shared string indices
      let clonedRow = cloneRowForNumber(templateRowXml, rowNum);
      // Replace <v>OLD_IDX</v> in cells that had tokens with new indices
      for (const [oldIdx, newIdx] of indexRemap.entries()) {
        // Match cells with t="s" that reference oldIdx
        // We match the specific pattern: <c ... t="s" ...><v>oldIdx</v></c>
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
  //    (global tokens can't be per-row so we just do a global replace on all si blocks)
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
  while (workbook.worksheets.length > 0) {
    workbook.removeWorksheet(workbook.worksheets[0].id);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(finalBuffer as any);
}
