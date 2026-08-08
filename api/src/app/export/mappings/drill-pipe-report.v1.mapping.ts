import * as ExcelJS from 'exceljs';
import { InspectionData, Snapshot } from '../../common/inspection-data.types';
import { expandRegionAndSubstitute } from './xlsx-token-engine';
import { deriveReportDate, deriveActors } from './computed-token-helpers';

/**
 * DRILL_PIPE_REPORT v1 export mapper.
 *
 * Phase B2 refactor: the low-level OOXML row-expansion/substitution machinery
 * moved to `xlsx-token-engine.ts` (verbatim), and the token computation was
 * extracted into the two pure functions below (`legacyGlobalTokens` /
 * `legacyRowTokens`) — the B1 `legacyGate` pattern. Behavior is byte-preserving:
 * `mapDrillPipeReportV1` still produces identical output, now by delegating to the
 * shared machinery. These pure functions are the equivalence baseline the engine
 * mapper is proven against (approval-gate-style equivalence, but for export tokens).
 */

/**
 * The full per-row token vocabulary. ORDER/SET must match the region token list
 * in drill-pipe-v1.definition.json; used to detect which template-row cells carry
 * a per-row token.
 */
export const LEGACY_ROW_TOKEN_KEYS = [
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

/** Resolve the 18 global (header) tokens for one snapshot. Extracted verbatim. */
export function legacyGlobalTokens(snapshot: Snapshot): Record<string, string> {
  const h = snapshot.header;

  const reportDate = deriveReportDate(h);

  const eqNames =
    (h.equipmentUsed || [])
      .map((e) => `${e.name}${e.number ? ' #' + e.number : ''}`)
      .join(', ') || 'None specified';
  const mNames =
    (h.inspectionMethod || [])
      .map((m) => (typeof m === 'string' ? m : m.name || m))
      .join(', ') || 'None specified';

  const { inspectedBy, approvedBy } = deriveActors(snapshot);

  return {
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
    '{{inspectorComment}}': h.inspectorComment || 'No comments provided.',
    '{{inspectedBy}}': inspectedBy,
    '{{approvedBy}}': approvedBy,
  };
}

/** Resolve the 31 per-row tokens for one serial. Extracted verbatim. */
export function legacyRowTokens(
  sn: Snapshot['serialNumbers'][number],
): Record<string, string> {
  const yesNo = (val: unknown) =>
    val === undefined || val === null ? '' : val ? '1' : '';

  const d: InspectionData = sn.inspectionData || {};
  const box: NonNullable<InspectionData['box']> = d.box || {};
  const pin: NonNullable<InspectionData['pin']> = d.pin || {};
  const body: NonNullable<InspectionData['body']> = d.body || {};
  const final: NonNullable<InspectionData['final']> = d.final || {};
  const boxBvl = box.bevelDiameterMin
    ? `${box.bevelDiameterMin}-${box.bevelDiameterMax || ''}`
    : '';
  const pinConn = pin.lengthPinConnMin
    ? `${pin.lengthPinConnMin}-${pin.lengthPinConnMax || ''}`
    : '';
  const pinBvl = pin.bevelDiameterMin
    ? `${pin.bevelDiameterMin}-${pin.bevelDiameterMax || ''}`
    : '';

  return {
    '{{sn}}': sn.serial || '',
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
}

/**
 * Legacy drill-pipe mapper — now a thin adapter over the shared machinery.
 * Output is byte-identical to the pre-B2 implementation.
 */
export async function mapDrillPipeReportV1(
  workbook: ExcelJS.Workbook,
  snapshot: Snapshot,
  serialNumbersChunk: Snapshot['serialNumbers'],
): Promise<void> {
  await expandRegionAndSubstitute(workbook, serialNumbersChunk, {
    marker: '{{sn}}',
    rowTokenKeys: LEGACY_ROW_TOKEN_KEYS,
    globalTokens: legacyGlobalTokens(snapshot),
    rowTokensFor: legacyRowTokens,
  });
}
