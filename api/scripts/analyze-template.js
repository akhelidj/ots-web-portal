
const ExcelJS = require('exceljs');
const path = require('path');

async function analyze() {
    const workbook = new ExcelJS.Workbook();
    const filePath = path.join(__dirname, 'Drill pipe.xlsx');
    console.log(`Analyzing ${filePath}...`);
    
    await workbook.xlsx.readFile(filePath);
    
    const sheet = workbook.getWorksheet('ok');
    if (sheet) {
        console.log(`\nSheet: "${sheet.name}"`);
        let lastRow = 0;
        sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
             // Check if it has borders
             let hasBorder = false;
             row.eachCell({ includeEmpty: true }, (cell) => {
                 // partial check
                 if (cell.style && cell.style.border && (cell.style.border.bottom || cell.style.border.left)) {
                     hasBorder = true;
                 }
             });
             if (hasBorder) lastRow = rowNumber;
        });
        console.log(`Last row with borders: ${lastRow}`);
    }
}

analyze().catch(console.error);
