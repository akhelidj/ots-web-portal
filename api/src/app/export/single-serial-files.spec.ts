/**
 * One-file-per-serial export (`region.singleSerial`), engine path without a DB.
 *
 * A template whose sheet holds ONE serial exports a file per serial, suffixed
 * `_<SERIAL>` — but only for multi-serial reports. Default regions are unchanged.
 */
import * as ExcelJS from 'exceljs';
import { ExportService } from './export.service';
import { ExportDefinition } from './export-engine';
import { canon, frozenSnapshot, makeSerial } from './flat-proof.testutil';

const def = (singleSerial: boolean): ExportDefinition => ({
  transforms: {},
  regions: [{ id: 'pipes', chunkSize: null, ...(singleSerial ? { singleSerial } : {}) }],
  export: {
    global: [{ token: '{{grade}}', field: 'grade', whenEmpty: 'N/A' }],
    regions: {
      pipes: [
        { token: '{{sn}}', source: 'rowSerial' },
        { token: '{{rwk}}', field: 'rwk', whenEmpty: 'N/A' },
      ],
    },
  },
});

async function template(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.getCell('B2').value = '{{grade}}';
  ws.getCell('B9').value = '{{sn}}';
  ws.getCell('C9').value = '{{rwk}}';
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

async function generate(singleSerial: boolean, serialNames: string[]) {
  const serials = serialNames.map((s) => makeSerial(s, { rwk: `R-${s}` }));
  const snapshot = frozenSnapshot(undefined, { serialNumbers: serials });
  const svc = new ExportService(null as never, null as never, null as never);
  return (
    svc as unknown as {
      generateExcelFiles: (...a: unknown[]) => Promise<{ buffer: Buffer; filename: string }[]>;
    }
  ).generateExcelFiles(await template(), snapshot, serials, 'OTS_PO_R1', def(singleSerial));
}

describe('singleSerial export', () => {
  it('N serials → N files, each suffixed _<SERIAL> and holding only that serial', async () => {
    const files = await generate(true, ['A1', 'B2', 'C3']);
    expect(files.map((f) => f.filename)).toEqual([
      'OTS_PO_R1_A1.xlsx',
      'OTS_PO_R1_B2.xlsx',
      'OTS_PO_R1_C3.xlsx',
    ]);
    const cells = (await canon(files[1]!.buffer))[0]!.cells;
    expect(cells['B9']).toBe('B2');
    expect(cells['C9']).toBe('R-B2');
    expect(cells['B2']).toBe('G');
  });

  it('a lone serial keeps the plain base name', async () => {
    const files = await generate(true, ['A1']);
    expect(files.map((f) => f.filename)).toEqual(['OTS_PO_R1.xlsx']);
  });

  it('sanitises serials and de-duplicates collisions', async () => {
    const files = await generate(true, ['A/1', 'A 1', 'A:1']);
    expect(files.map((f) => f.filename)).toEqual([
      'OTS_PO_R1_A_1.xlsx',
      'OTS_PO_R1_A_1_2.xlsx',
      'OTS_PO_R1_A_1_3.xlsx',
    ]);
  });

  it('zero serials → no files', async () => {
    expect(await generate(true, [])).toEqual([]);
  });

  it('flag off → unchanged single multi-row file', async () => {
    const files = await generate(false, ['A1', 'B2']);
    expect(files.map((f) => f.filename)).toEqual(['OTS_PO_R1.xlsx']);
  });
});
