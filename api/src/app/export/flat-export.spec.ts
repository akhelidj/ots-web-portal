/**
 * Flat (region-less) export — correct by construction (engine, no DB).
 *
 * There is no legacy flat template to diff against, so the oracle is
 * specification-by-construction (design doc §2c): a synthetic header-only workbook
 * with tokens at KNOWN addresses and NO marker row. We assert:
 *   1. each header token resolves to the right cell (hand-authored expected map);
 *   2. maxRow === templateMaxRow — the no-rows-cloned signature that proves the
 *      fragile row-clone path never ran (a region export of N serials grows maxRow);
 *   3. non-token cells are untouched;
 *   4. DIFFERENTIAL: a flat and a region export given the same global token value
 *      render it identically — flat inherits the already-proven global substitution
 *      because both drive the same `expandRegionAndSubstitute` step-6 machinery.
 * Plus non-vacuity guards (mapping mutation diverges; a forced clone grows maxRow, so
 * assertion (2) is load-bearing).
 */
import * as ExcelJS from 'exceljs';
import { engineMap, ExportDefinition } from './export-engine';
import { Snapshot } from '../common/inspection-data.types';
import { canon, frozenHeader, frozenSnapshot, makeSerial, maxRowOf } from './flat-proof.testutil';

// ---- synthetic fixtures (built in-memory; tokens at known addresses) -------------

/** Header-only sheet: two tokens at B2 / D4, static text elsewhere, NO marker row. */
async function flatTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Flat');
  ws.getCell('A1').value = 'Casing Report'; // static
  ws.getCell('B2').value = '{{poNumber}}'; // header token
  ws.getCell('D4').value = '{{casingWeight}}'; // header token
  ws.getCell('A6').value = 'End of report'; // static
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

/** A one-region sheet sharing the {{poNumber}} global cell, plus a {{sn}} marker row. */
async function regionTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Region');
  ws.getCell('A1').value = 'Casing Report'; // static
  ws.getCell('B2').value = '{{poNumber}}'; // header token (shared with flat)
  ws.getCell('A10').value = '{{sn}}'; // marker row (per-serial)
  ws.getCell('A20').value = 'Footer'; // static, below the marker
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

const FLAT_DEF: ExportDefinition = {
  transforms: {},
  regions: [], // ← flat: no repeating region
  export: {
    global: [
      { token: '{{poNumber}}', field: 'poNumber' },
      { token: '{{casingWeight}}', field: 'casingWeight' },
    ],
    regions: {},
  },
};

const REGION_DEF: ExportDefinition = {
  transforms: {},
  regions: [{ id: 'serials', marker: '{{sn}}', chunkSize: null }],
  export: {
    global: [{ token: '{{poNumber}}', field: 'poNumber' }],
    regions: { serials: [{ token: '{{sn}}', source: 'rowSerial' }] },
  },
};

/** Header carrying the two flat fields (casingWeight is not a typed column). */
function flatSnapshot(poNumber: string, casingWeight: string): Snapshot {
  const header = frozenHeader({ poNumber });
  (header as unknown as Record<string, unknown>).casingWeight = casingWeight;
  return frozenSnapshot(header);
}

async function runEngine(
  buffer: Buffer,
  def: ExportDefinition,
  snapshot: Snapshot,
  chunk: Snapshot['serialNumbers'],
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  await engineMap(def, wb, snapshot, chunk);
  const out = Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return canon(out);
}

describe('Flat (region-less) export — correct by construction', () => {
  it('resolves header tokens to their exact cells and leaves static cells intact', async () => {
    const buffer = await flatTemplateBuffer();
    const snapshot = flatSnapshot('PO-42', '23.5');
    // one serial's worth of data — the flat path ignores it for row expansion.
    const sheets = await runEngine(buffer, FLAT_DEF, snapshot, [makeSerial('REC-1')]);
    const s = sheets[0];

    expect(s.cells['B2']).toBe('PO-42'); // {{poNumber}} resolved in place
    expect(s.cells['D4']).toBe('23.5'); // {{casingWeight}} resolved in place
    expect(s.cells['A1']).toBe('Casing Report'); // static untouched
    expect(s.cells['A6']).toBe('End of report'); // static untouched
    // no leftover unresolved tokens anywhere
    expect(Object.values(s.cells).join('|')).not.toContain('{{');
  });

  it('maxRow === templateMaxRow — no rows cloned (the flat signature)', async () => {
    const buffer = await flatTemplateBuffer();
    const before = maxRowOf(await canon(buffer)); // template's own maxRow
    const after = maxRowOf(
      await runEngine(buffer, FLAT_DEF, flatSnapshot('PO-42', '23.5'), [
        makeSerial('REC-1'),
      ]),
    );
    expect(after).toBe(before); // clone path never ran
  });

  it('DIFFERENTIAL: flat and region render the same global token identically', async () => {
    const flat = await runEngine(
      await flatTemplateBuffer(),
      FLAT_DEF,
      flatSnapshot('SHARED-9', 'x'),
      [makeSerial('REC-1')],
    );
    const region = await runEngine(
      await regionTemplateBuffer(),
      REGION_DEF,
      frozenSnapshot(frozenHeader({ poNumber: 'SHARED-9' })),
      [makeSerial('SN-1')],
    );
    // Same {{poNumber}} cell (B2) in both; flat's substitution is the region's
    // already-proven step-6 machinery, so the rendered value must match.
    expect(flat[0].cells['B2']).toBe('SHARED-9');
    expect(region[0].cells['B2']).toBe('SHARED-9');
    expect(flat[0].cells['B2']).toBe(region[0].cells['B2']);
  });

  // ---- non-vacuity guards -------------------------------------------------------

  it('GUARD mapping mutation diverges (non-vacuous cell assertion)', async () => {
    const buffer = await flatTemplateBuffer();
    const mutant: ExportDefinition = JSON.parse(JSON.stringify(FLAT_DEF));
    mutant.export.global.find((e) => e.token === '{{poNumber}}')!.field =
      'doesNotExist'; // resolves '' instead of PO-42
    const sheets = await runEngine(buffer, mutant, flatSnapshot('PO-42', '23.5'), [
      makeSerial('REC-1'),
    ]);
    // {{poNumber}} now resolves empty → B2 is blank (dropped from canon), not 'PO-42'.
    expect(sheets[0].cells['B2']).toBeUndefined();
  });

  it('GUARD maxRow IS load-bearing: a real clone (region, N serials) grows maxRow', async () => {
    const buffer = await regionTemplateBuffer();
    const before = maxRowOf(await canon(buffer));
    const snapshot = frozenSnapshot(frozenHeader());
    const three = [makeSerial('SN-1'), makeSerial('SN-2'), makeSerial('SN-3')];
    const after = maxRowOf(await runEngine(buffer, REGION_DEF, snapshot, three));
    // 3 serials clone the marker row → +2 rows; proves maxRow WOULD catch a stray
    // clone on the flat path (where it must stay equal).
    expect(after).toBe(before + 2);
  });
});
