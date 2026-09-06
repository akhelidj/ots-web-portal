/**
 * Single-item stacked-layout export (engine, no DB).
 *
 * A region template's per-item tokens normally live on ONE worksheet row, which the
 * engine clones once per item. The old rule rejected ANY template whose row-scope
 * tokens were split across multiple rows — even when the export carried a single item,
 * where there is nothing to repeat. That is too strict: a "header + exactly one serial"
 * report (the author never has to declare it single-item) then failed to export at all.
 *
 * The engine now distinguishes by item count, not by layout:
 *   - ONE item  → each row-scope token resolves once, in place, like a global. Any
 *                 arrangement (vertically stacked, scattered) is valid.
 *   - MANY items → cloning must repeat a single row, so a split layout is still rejected
 *                 with the precise "span multiple worksheet rows" error.
 *
 * Tokens are authored with inner spaces (`{{ sn }}`) to also ride the whitespace-
 * canonicalization path, matching how a real Excel author types them.
 */
import * as ExcelJS from 'exceljs';
import { engineMap, ExportDefinition } from './export-engine';
import { canon, frozenSnapshot, makeSerial } from './flat-proof.testutil';

/** A region definition: one global (header `grade`) + three per-item tokens. */
const STACKED_DEF: ExportDefinition = {
  transforms: {},
  regions: [{ id: 'pipes', chunkSize: null }],
  export: {
    global: [{ token: '{{grade}}', field: 'grade', whenEmpty: 'N/A' }],
    regions: {
      pipes: [
        { token: '{{sn}}', source: 'rowSerial' },
        { token: '{{rwk}}', field: 'rwk', whenEmpty: 'N/A' },
        { token: '{{pascrw}}', field: 'pascrw', whenEmpty: 'N/A' },
      ],
    },
  },
};

/**
 * A VERTICALLY STACKED template: the three per-item tokens sit on three different
 * worksheet rows (9/10/11), each with a label beside it — the layout that used to throw.
 * Tokens carry inner spaces to exercise canonicalization too.
 */
async function stackedTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.getCell('A1').value = 'Inspection Report'; // static
  ws.getCell('B2').value = '{{ grade }}'; // header / global
  ws.getCell('A9').value = 'Serial';
  ws.getCell('B9').value = '{{ sn }}';
  ws.getCell('A10').value = 'Rework';
  ws.getCell('B10').value = '{{ rwk }}';
  ws.getCell('A11').value = 'Pass';
  ws.getCell('B11').value = '{{ pascrw }}';
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

async function runExport(
  serials: ReturnType<typeof makeSerial>[],
): Promise<Record<string, string>> {
  const snapshot = frozenSnapshot(undefined, { serialNumbers: serials });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await stackedTemplate()) as unknown as ArrayBuffer);
  await engineMap(STACKED_DEF, wb, snapshot, serials);
  const out = Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  const sheets = await canon(out);
  return sheets[0]!.cells;
}

describe('single-item stacked-layout export', () => {
  it('ONE item: stacked per-item tokens resolve in place (no clone, no throw)', async () => {
    const cells = await runExport([
      makeSerial('S1', { rwk: 'REWORK', pascrw: 'PASS' }),
    ]);

    // Per-item tokens each filled where they sit — across rows, not a single row.
    expect(cells['B9']).toBe('S1');
    expect(cells['B10']).toBe('REWORK');
    expect(cells['B11']).toBe('PASS');
    // The header/global token still resolves.
    expect(cells['B2']).toBe('G');
    // Labels are untouched static text.
    expect(cells['A9']).toBe('Serial');
    expect(cells['A11']).toBe('Pass');
    // No raw placeholders survive anywhere.
    expect(Object.values(cells).join('|')).not.toContain('{{');
  });

  it('ONE item: a falsy per-item field falls back to whenEmpty', async () => {
    const cells = await runExport([makeSerial('S1', { rwk: '', pascrw: 'PASS' })]);
    expect(cells['B9']).toBe('S1');
    expect(cells['B10']).toBe('N/A'); // whenEmpty for the empty rwk
    expect(cells['B11']).toBe('PASS');
  });

  it('MANY items: a stacked layout is still rejected (cloning cannot span rows)', async () => {
    await expect(
      runExport([
        makeSerial('S1', { rwk: 'REWORK', pascrw: 'PASS' }),
        makeSerial('S2', { rwk: 'SCRAP', pascrw: 'FAIL' }),
      ]),
    ).rejects.toThrow(/span multiple worksheet rows/);
  });
});
