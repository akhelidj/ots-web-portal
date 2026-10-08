import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { signatureMarker } from './export-engine';
import { embedSignatures } from './signature-embed';

/** Structurally-PNG bytes (magic + IHDR + IEND) — ExcelJS stores the buffer verbatim. */
function makePng(width = 600, height = 200): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    iend,
  ]);
}

const MARKER = signatureMarker('inspectorSignature');

function workbookWithMarker(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.getCell('A1').value = 'Inspector';
  ws.getCell('B7').value = MARKER;
  ws.mergeCells('B7:D8');
  ws.getColumn(2).width = 20;
  return wb;
}

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buf as unknown as Parameters<typeof out.xlsx.load>[0]);
  return out;
}

describe('embedSignatures', () => {
  it('replaces the marker with a picture anchored on that cell', async () => {
    const wb = workbookWithMarker();

    const found = embedSignatures(wb, {
      inspectorSignature: { bytes: makePng() },
    });
    expect(found).toBe(1);

    const out = await roundTrip(wb);
    const ws = out.getWorksheet('Report')!;
    expect(ws.getCell('B7').text).toBe('');
    const images = ws.getImages();
    expect(images).toHaveLength(1);
    expect(images[0]?.range.tl.nativeCol).toBe(1); // column B (0-based)
    expect(images[0]?.range.tl.nativeRow).toBe(6); // row 7 (0-based)

    const zip = await JSZip.loadAsync(
      (await out.xlsx.writeBuffer()) as unknown as Parameters<
        typeof JSZip.loadAsync
      >[0],
    );
    expect(Object.keys(zip.files).some((n) => n.startsWith('xl/media/'))).toBe(
      true,
    );
  });

  it('keeps the picture inside the cell room and preserves the 3:1 aspect', () => {
    const wb = workbookWithMarker();
    embedSignatures(wb, { inspectorSignature: { bytes: makePng() } });

    const ext = (
      wb.getWorksheet('Report')!.getImages()[0]!.range as unknown as {
        ext: unknown;
      }
    ).ext as {
      width: number;
      height: number;
    };
    expect(ext.width).toBeLessThanOrEqual(240);
    expect(ext.height).toBeLessThanOrEqual(80);
    expect(ext.width / ext.height).toBeCloseTo(3, 1);
  });

  it('clears the marker without adding a picture when no image is available', async () => {
    const wb = workbookWithMarker();

    const found = embedSignatures(wb, {});
    expect(found).toBe(1);

    const out = await roundTrip(wb);
    const ws = out.getWorksheet('Report')!;
    expect(ws.getCell('B7').text).toBe('');
    expect(ws.getImages()).toHaveLength(0);
  });

  it('embeds each template signature field and blanks the unsigned one', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ws.getCell('B2').value = signatureMarker('field:customerSig');
    ws.getCell('B4').value = signatureMarker('field:supervisorSig');
    ws.getCell('B6').value = signatureMarker('field:customerSig'); // same slot twice

    const found = embedSignatures(wb, {
      'field:customerSig': { bytes: makePng() },
    });
    expect(found).toBe(3);

    const out = await roundTrip(wb);
    const sheet = out.getWorksheet('Report')!;
    expect(sheet.getCell('B2').text).toBe('');
    expect(sheet.getCell('B4').text).toBe(''); // unsigned: no stray marker text
    expect(sheet.getCell('B6').text).toBe('');
    expect(sheet.getImages()).toHaveLength(2); // customer at B2 and B6, none for B4
  });

  it('is a no-op for a workbook without the marker (legacy templates)', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Report').getCell('A1').value = 'plain';

    expect(
      embedSignatures(wb, { inspectorSignature: { bytes: makePng() } }),
    ).toBe(0);
    expect(wb.getWorksheet('Report')!.getImages()).toHaveLength(0);
  });
});
