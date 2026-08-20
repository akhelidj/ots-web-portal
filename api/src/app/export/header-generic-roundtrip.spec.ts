/**
 * Phase D step 3 — generic header storage round-trip + bridge-deletion mutation guard
 * (engine + assembler, no DB).
 *
 * Proves the header axis is GENERIC and that the legacy named-column bridge is GONE: a
 * header value reaches `snapshot.header` ONLY through the definition-keyed `headerData`
 * store, and a field absent from `headerData` resolves empty (→ `whenEmpty`) — there is
 * no per-column fallback any more.
 *
 * `certNumber` never had a column; `grade` DID (now dropped). Both are treated
 * identically here: present in `headerData` → they land in the file; absent → `N/A`.
 *
 * RED→GREEN is two arms of the same export:
 *   - RED  (no `headerData`): BOTH cells are empty (`N/A`). Decisive for the deletion —
 *     before step 3, `grade` would have shown a column value here.
 *   - GREEN (`headerData` carries both): both land in their cells.
 *
 * MUTATION GUARD on the bridge deletion: if `assembleSnapshotHeader` re-introduced any
 * named-column base, the RED arm's `grade` cell would stop being `N/A` and the second
 * test (grade omitted from `headerData`) would fail — so a silent column fallback cannot
 * creep back in unnoticed.
 */
import * as ExcelJS from 'exceljs';
import { engineMap, ExportDefinition } from './export-engine';
import { assembleSnapshotHeader, HeaderSourceRow } from '../common/snapshot-header';
import { Snapshot } from '../common/inspection-data.types';
import { canon, frozenSnapshot } from './flat-proof.testutil';
import { InspectionReportStatus } from '@prisma/client';

/** A definition whose header binds two fields, one formerly column-backed (`grade`). */
const HEADER_DEF: ExportDefinition = {
  transforms: {},
  regions: [],
  export: {
    global: [
      { token: '{{cert}}', field: 'certNumber', whenEmpty: 'N/A' },
      { token: '{{grade}}', field: 'grade', whenEmpty: 'N/A' },
    ],
    regions: {},
  },
};

/** A report row carrying ONLY metadata + the generic headerData map (no named columns). */
function rowWith(headerData: Record<string, unknown> | undefined): HeaderSourceRow {
  return {
    id: 'r1',
    poNumber: 'PO',
    reportNumber: 'RN',
    status: 'APPROVED' as InspectionReportStatus,
    customerId: 'c1',
    createdAt: undefined as unknown as string,
    updatedAt: undefined as unknown as string,
    headerData,
  };
}

/** A header-only sheet: {{cert}} at B2, {{grade}} at C3, no marker row. */
async function templateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hdr');
  ws.getCell('A1').value = 'Report'; // static
  ws.getCell('B2').value = '{{cert}}';
  ws.getCell('C3').value = '{{grade}}';
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

async function exportCells(
  headerData: Record<string, unknown> | undefined,
): Promise<Record<string, string>> {
  const header = assembleSnapshotHeader(rowWith(headerData));
  const snapshot: Snapshot = frozenSnapshot(header);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await templateBuffer()) as unknown as ArrayBuffer);
  await engineMap(HEADER_DEF, wb, snapshot, []);
  const out = Buffer.from(
    (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer,
  );
  const sheets = await canon(out);
  return sheets[0]!.cells;
}

describe('Phase D step 3 — generic header storage round-trip (no column bridge)', () => {
  it('RED→GREEN: header fields reach the file ONLY via headerData; absent → whenEmpty', async () => {
    // RED — no generic overlay: neither field has a value (grade no longer has a
    // column to fall back to), so both cells are N/A.
    const red = await exportCells(undefined);
    expect(red['B2']).toBe('N/A');
    expect(red['C3']).toBe('N/A'); // decisive: NO column fallback for grade

    // GREEN — the generic map carries both: they land in their cells.
    const green = await exportCells({
      certNumber: 'CERT-7788',
      grade: 'HEADERDATA-GRADE',
    });
    expect(green['B2']).toBe('CERT-7788');
    expect(green['C3']).toBe('HEADERDATA-GRADE');

    // The two arms genuinely differ (non-vacuity of RED→GREEN).
    expect(green['B2']).not.toBe(red['B2']);
    expect(green['C3']).not.toBe(red['C3']);
  });

  it('MUTATION GUARD: a field omitted from headerData resolves empty, never a column', async () => {
    // headerData present but WITHOUT grade → grade resolves to whenEmpty. Before the
    // step-3 deletion this cell showed the legacy column value; now nothing falls back.
    const cells = await exportCells({ certNumber: 'CERT-1' });
    expect(cells['B2']).toBe('CERT-1');
    expect(cells['C3']).toBe('N/A');
  });
});
