/**
 * Phase D step 2 — generic header storage round-trip (engine + assembler, no DB).
 *
 * Proves the header axis is GENERIC end-to-end: a header value written to the
 * report's definition-keyed `headerData` store is assembled into `snapshot.header`
 * by `assembleSnapshotHeader` and read by the export engine's `field` branch, so
 * the typed value lands in the file — WITHOUT any named column for it.
 *
 * The decisive field is `certNumber`: there is NO `certNumber` column on
 * `InspectionReport`, so it can ONLY reach the export through the generic
 * `headerData` overlay. `grade` (which DOES have a legacy column) additionally
 * proves the overlay WINS over the column bridge.
 *
 * RED→GREEN is expressed as two arms of the same export:
 *   - RED  (row has no `headerData`): the generic field is absent (→ `whenEmpty`),
 *     and `grade` shows the legacy column value.
 *   - GREEN (row carries `headerData`): the generic field lands in its cell and
 *     `grade` shows the overlaid value.
 *
 * This doubles as the production-write MUTATION GUARD: if `assembleSnapshotHeader`
 * dropped its `...generic` overlay, the GREEN arm would collapse onto the RED arm
 * and both value assertions below would fail.
 */
import * as ExcelJS from 'exceljs';
import { engineMap, ExportDefinition } from './export-engine';
import { assembleSnapshotHeader, HeaderSourceRow } from '../common/snapshot-header';
import { Snapshot } from '../common/inspection-data.types';
import { canon, frozenSnapshot } from './flat-proof.testutil';
import { InspectionReportStatus } from '@prisma/client';

/** A definition whose header binds a NON-column field (`certNumber`) + a column-backed one (`grade`). */
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

/** A report row with the legacy `grade` column populated; `headerData` varies per arm. */
function rowWith(headerData: Record<string, unknown> | undefined): HeaderSourceRow {
  return {
    id: 'r1',
    poNumber: 'PO',
    reportNumber: 'RN',
    status: 'APPROVED' as InspectionReportStatus,
    customerId: 'c1',
    createdAt: undefined as unknown as string,
    updatedAt: undefined as unknown as string,
    grade: 'COLUMN-GRADE',
    range: null,
    weight: null,
    nomWT: null,
    nomOD: null,
    nomID: null,
    connection: null,
    inspectionAddress: null,
    standardUsed: null,
    inspectorComment: null,
    equipmentUsed: null,
    inspectionMethod: null,
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

describe('Phase D step 2 — generic header storage round-trip', () => {
  it('RED→GREEN: a generic (non-column) header field written to headerData lands in the exported file', async () => {
    // RED — no generic overlay: certNumber has no column, so its cell is empty
    // (→ whenEmpty); grade shows the legacy column value.
    const red = await exportCells(undefined);
    expect(red['B2']).toBe('N/A');
    expect(red['C3']).toBe('COLUMN-GRADE');

    // GREEN — the generic map carries both: certNumber (no column) now lands in the
    // file, and grade is OVERLAID over its column. Both assertions are load-bearing —
    // dropping the assembler's `...generic` overlay collapses GREEN back onto RED.
    const green = await exportCells({
      certNumber: 'CERT-7788',
      grade: 'OVERLAID-GRADE',
    });
    expect(green['B2']).toBe('CERT-7788'); // generic, column-less field exported
    expect(green['C3']).toBe('OVERLAID-GRADE'); // overlay wins over the column bridge

    // And the two arms genuinely differ (non-vacuity of RED→GREEN).
    expect(green['B2']).not.toBe(red['B2']);
    expect(green['C3']).not.toBe(red['C3']);
  });

  it('legacy column bridge still feeds the header when headerData omits a key', async () => {
    // headerData present but WITHOUT grade → grade falls back to the column bridge,
    // while certNumber (generic) resolves. Proves the overlay is a merge, not a replace.
    const cells = await exportCells({ certNumber: 'CERT-1' });
    expect(cells['B2']).toBe('CERT-1');
    expect(cells['C3']).toBe('COLUMN-GRADE');
  });
});
