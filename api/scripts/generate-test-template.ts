
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

async function generateTemplate() {
  const workbook = new ExcelJS.Workbook();
  
  // Sheet 1: ok
  const okSheet = workbook.addWorksheet('ok');
  
  // Set required markers
  okSheet.getCell('A4').value = 'DMMT Work Ordre N°:';
  okSheet.getCell('K4').value = 'Désignation : DRILL PIPE';
  okSheet.getCell('U4').value = 'Date of Inspection:';
  okSheet.getCell('A5').value = 'Customer:';
  okSheet.getCell('U5').value = 'Inspection Report N°:';
  okSheet.getCell('U6').value = 'Customer W.O. N°:';
  okSheet.getCell('A7').value = 'Inspection method:';

  // Sheet 2: Drill Pipe summary
  workbook.addWorksheet('Drill Pipe summary');

  const outputPath = path.join(__dirname, 'valid-template.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Generated valid template at: ${outputPath}`);
}

generateTemplate().catch(console.error);
