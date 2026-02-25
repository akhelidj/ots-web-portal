import * as ExcelJS from 'exceljs';

export async function mapDrillPipeReportV1(
  workbook: ExcelJS.Workbook,
  snapshot: any,
  serialNumbersChunk: any[],
): Promise<void> {
  const sheet = workbook.getWorksheet(1);
  if (!sheet) {
    throw new Error('Template does not contain a worksheet');
  }

  // Header Mappings
  sheet.getCell('B5').value = snapshot.customer || '';
  sheet.getCell('V5').value = snapshot.reportNumber || '';
  sheet.getCell('V4').value = snapshot.date ? new Date(snapshot.date) : '';
  sheet.getCell('V6').value = snapshot.workOrder || '';
  sheet.getCell('B7').value = '100% Visual / Dimensional / MPI'; // Default or from snapshot if exists

  // Serial Table Configuration
  const startRow = 15;
  const maxRowsInChunk = 10;
  
  if (serialNumbersChunk.length > maxRowsInChunk) {
    throw new Error(`Critical Error: Mapping function received ${serialNumbersChunk.length} items, but maximum allowed is ${maxRowsInChunk}.`);
  }

  // Clear pre-existing data in the table range (optional depending on template, but safe)
  for (let i = 0; i < maxRowsInChunk; i++) {
    const row = sheet.getRow(startRow + i);
    row.getCell('A').value = '';
    row.getCell('AD').value = '';
    row.getCell('AE').value = '';
    row.getCell('AF').value = '';
  }

  // Fill chunk data
  for (let i = 0; i < serialNumbersChunk.length; i++) {
    const serial = serialNumbersChunk[i];
    const row = sheet.getRow(startRow + i);
    
    // Serial Number
    row.getCell('A').value = serial.serialNumber || '';

    // Disposition Mapping
    const serialData: any = serial.inspectionData || {};
    const disposition = serialData?.final?.disposition || serialData?.disposition || serial.disposition;
    if (disposition === 'PASS') {
      row.getCell('AD').value = 'X';
    } else if (disposition === 'REWORK') {
      row.getCell('AE').value = 'X';
    } else if (disposition === 'SCRAP') {
      row.getCell('AF').value = 'X';
    } else if (disposition === 'HOLD') {
      // User specified HOLD must explicitly fail if not supported by the template.
      // Based on provided template structure (AD=Premium/Pass, AE=Class2/Rework, AF=Scrap), HOLD is NOT supported.
      throw new Error('Template does not support HOLD disposition');
    }
  }
}
