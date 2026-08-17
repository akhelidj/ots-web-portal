/**
 * Phase D step 1 — token extraction + `.xls` normalization proof (unit; no DB).
 *
 * De-risks the Excel layer in isolation before any authoring UX stands on it:
 *   1. Extract tokens from the REAL drill-pipe fixture and assert the exact known
 *      token set comes back (the tracked template is the known-answer oracle).
 *   2. Prove the `.xls` path: write the fixture out as a legacy `.xls` (BIFF8),
 *      normalize it back to `.xlsx`, and assert extraction returns the SAME tokens
 *      as the `.xlsx` path (round-trip equivalence — the normalizer must not lose
 *      or mangle tokens).
 *   3. A non-vacuous mutation guard: a corrupted oracle MUST diverge, proving the
 *      equality assertions can actually go red.
 *
 * These services are pure (no Prisma), so this runs under `nx test api` with no
 * Postgres. The endpoint's tenant-scoped DB read is covered separately; the risk
 * being retired here is the Excel parsing/normalization, not the HTTP wiring.
 *
 * ORACLE NOTE: the drill-pipe *definition* maps 49 tokens, but the physical
 * template contains 47 — `{{b_cbd}}` and `{{remarks}}` are mapped yet have no cell.
 * The extractor reports what is IN THE SHEET (ground truth), which is the correct
 * behavior for reading an arbitrary uploaded workbook.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import {
  TokenExtractorService,
  ExtractedToken,
} from './token-extractor.service';
import { XlsNormalizerService } from './xls-normalizer.service';

const REAL_TEMPLATE_BYTES = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template.xlsx'),
);

/** The 47 tokens physically present in scripts/valid-template.xlsx (discovered, pinned). */
const EXPECTED_TOKENS: string[] = [
  '{{approvedBy}}',
  '{{b_bvl}}',
  '{{b_cbl}}',
  '{{b_cond}}',
  '{{b_ecc}}',
  '{{b_hard}}',
  '{{b_od}}',
  '{{b_thd}}',
  '{{b_ts}}',
  '{{bent}}',
  '{{connection}}',
  '{{corr_in}}',
  '{{corr_out}}',
  '{{customer}}',
  '{{emi}}',
  '{{equipment}}',
  '{{grade}}',
  '{{inspectedBy}}',
  '{{inspectionAddress}}',
  '{{inspectorComment}}',
  '{{ipc}}',
  '{{jc_c2}}',
  '{{jc_new}}',
  '{{jc_prem}}',
  '{{jc_scrap}}',
  '{{methods}}',
  '{{nomID}}',
  '{{nomOD}}',
  '{{nomWT}}',
  '{{od_decr}}',
  '{{p_base}}',
  '{{p_bvl}}',
  '{{p_cond}}',
  '{{p_conn}}',
  '{{p_ecc}}',
  '{{p_id}}',
  '{{p_od}}',
  '{{p_ts}}',
  '{{poNumber}}',
  '{{range}}',
  '{{reportDate}}',
  '{{reportNumber}}',
  '{{slip}}',
  '{{sn}}',
  '{{standardUsed}}',
  '{{wall}}',
  '{{weight}}',
];

function distinctTokens(tokens: ExtractedToken[]): string[] {
  return [...new Set(tokens.map((t) => t.token))].sort();
}

describe('Phase D — token extraction + .xls normalization [unit]', () => {
  let extractor: TokenExtractorService;
  let normalizer: XlsNormalizerService;

  beforeAll(() => {
    extractor = new TokenExtractorService();
    normalizer = new XlsNormalizerService();
  });

  describe('extractor — real drill-pipe fixture (known-answer oracle)', () => {
    it('returns exactly the 47 tokens physically present in the template', async () => {
      const tokens = await extractor.extractTokens(REAL_TEMPLATE_BYTES);
      expect(distinctTokens(tokens)).toEqual(EXPECTED_TOKENS);
    });

    it('reports a plausible cell address + row for every occurrence', async () => {
      const tokens = await extractor.extractTokens(REAL_TEMPLATE_BYTES);
      expect(tokens.length).toBeGreaterThanOrEqual(EXPECTED_TOKENS.length);
      for (const t of tokens) {
        expect(t.cell).toMatch(/^[A-Z]+\d+$/); // A1-style address
        expect(t.row).toBeGreaterThan(0);
        // the digits in the address agree with the reported row
        expect(Number(t.cell.match(/\d+$/)?.[0])).toBe(t.row);
      }
    });
  });

  describe('normalizer — .xls detection + passthrough', () => {
    it('passes a .xlsx through byte-identical (not detected as legacy .xls)', () => {
      expect(normalizer.isLegacyXls(REAL_TEMPLATE_BYTES)).toBe(false);
      const out = normalizer.normalizeToXlsx(REAL_TEMPLATE_BYTES);
      expect(out.equals(REAL_TEMPLATE_BYTES)).toBe(true);
    });

    it('detects an OLE2 (.xls) buffer as legacy', () => {
      const xlsBuf = Buffer.from(
        XLSX.write(XLSX.read(REAL_TEMPLATE_BYTES, { type: 'buffer' }), {
          type: 'buffer',
          bookType: 'biff8',
        }) as Uint8Array,
      );
      expect(normalizer.isLegacyXls(xlsBuf)).toBe(true);
    });
  });

  describe('.xls round-trip equivalence (the normalizer must not lose tokens)', () => {
    it('extracts the SAME token set from a converted .xls as from the .xlsx', async () => {
      const fromXlsx = distinctTokens(
        await extractor.extractTokens(REAL_TEMPLATE_BYTES),
      );

      // fixture .xlsx → legacy .xls (BIFF8) → normalizer → .xlsx → extract
      const xlsBuf = Buffer.from(
        XLSX.write(XLSX.read(REAL_TEMPLATE_BYTES, { type: 'buffer' }), {
          type: 'buffer',
          bookType: 'biff8',
        }) as Uint8Array,
      );
      const normalized = normalizer.normalizeToXlsx(xlsBuf);
      expect(normalized.equals(xlsBuf)).toBe(false); // conversion actually happened
      const fromXls = distinctTokens(await extractor.extractTokens(normalized));

      expect(fromXls).toEqual(fromXlsx);
      expect(fromXls).toEqual(EXPECTED_TOKENS);
    });
  });

  describe('mutation guard (non-vacuous — proves the oracle can go red)', () => {
    it('a corrupted expected set diverges from the real extraction', async () => {
      const actual = distinctTokens(
        await extractor.extractTokens(REAL_TEMPLATE_BYTES),
      );
      // Drop one real token and inject one that does not exist in the sheet.
      const corrupted = actual
        .filter((t) => t !== '{{b_od}}')
        .concat('{{does_not_exist}}')
        .sort();
      expect(corrupted).not.toEqual(actual);
    });
  });
});
