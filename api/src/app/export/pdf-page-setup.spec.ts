import * as ExcelJS from 'exceljs';
import { applyPdfPageSetup, prepareWorkbookForPdf } from './pdf-page-setup';

function sheet(): ExcelJS.Worksheet {
  return new ExcelJS.Workbook().addWorksheet('Report');
}

describe('applyPdfPageSetup', () => {
  it('fits to one page wide and as many tall as needed', () => {
    const ws = sheet();
    ws.getCell('A1').value = 'x';
    applyPdfPageSetup(ws);
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(0);
  });

  it('extends the template print area to the rows actually used, keeping its columns', () => {
    const ws = sheet();
    ws.pageSetup.printArea = 'A1:H40';
    ws.getCell('A1').value = 'top';
    ws.getCell('B90').value = 'bottom';
    applyPdfPageSetup(ws);
    expect(ws.pageSetup.printArea).toBe('A1:H90');
  });

  it('derives a print area when the template has none', () => {
    const ws = sheet();
    ws.getCell('A1').value = 'a';
    ws.getCell('D12').value = 'd';
    applyPdfPageSetup(ws);
    expect(ws.pageSetup.printArea).toBe('A1:D12');
  });

  it('goes landscape only when wider than tall', () => {
    const wide = sheet();
    for (let c = 1; c <= 15; c++) wide.getColumn(c).width = 14;
    wide.getCell('A1').value = 'a';
    wide.getCell('O5').value = 'b';
    applyPdfPageSetup(wide);
    expect(wide.pageSetup.orientation).toBe('landscape');

    const tall = sheet();
    for (let r = 1; r <= 80; r++) tall.getCell(`A${r}`).value = r;
    applyPdfPageSetup(tall);
    expect(tall.pageSetup.orientation).toBe('portrait');
  });

  it('gives wrapped-text rows a height, and leaves explicit heights alone', () => {
    const ws = sheet();
    ws.getColumn(1).width = 12;
    ws.getCell('A1').value =
      'a long sentence that has to wrap over several lines';
    ws.getCell('A1').alignment = { wrapText: true };
    ws.getCell('A2').value = 'also long text that would wrap around';
    ws.getCell('A2').alignment = { wrapText: true };
    ws.getRow(2).height = 18;
    applyPdfPageSetup(ws);
    expect(ws.getRow(1).height).toBeGreaterThan(30);
    expect(ws.getRow(2).height).toBe(18);
  });

  it('does not size rows whose text is not wrapped', () => {
    const ws = sheet();
    ws.getCell('A1').value = 'a long sentence that does not wrap';
    applyPdfPageSetup(ws);
    expect(ws.getRow(1).height).toBeUndefined();
  });

  it('drops manual page breaks', () => {
    const ws = sheet();
    ws.getCell('A1').value = 'x';
    (ws as unknown as { rowBreaks: unknown[] }).rowBreaks = [
      { id: 20, max: 16383, man: 1 },
    ];
    applyPdfPageSetup(ws);
    expect((ws as unknown as { rowBreaks: unknown[] }).rowBreaks).toEqual([]);
  });
});

describe('prepareWorkbookForPdf', () => {
  it('round-trips a workbook with the PDF page setup applied and skips empty sheets', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Report').getCell('A1').value = 'hello';
    wb.addWorksheet('Empty');
    const out = await prepareWorkbookForPdf(
      Buffer.from(await wb.xlsx.writeBuffer()),
    );

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(
      out as unknown as Parameters<typeof back.xlsx.load>[0],
    );
    expect(back.getWorksheet('Report')?.pageSetup.fitToPage).toBe(true);
    expect(back.getWorksheet('Report')?.pageSetup.fitToHeight).toBe(0);
    expect(back.getWorksheet('Empty')?.pageSetup.fitToPage).toBeFalsy();
  });
});
