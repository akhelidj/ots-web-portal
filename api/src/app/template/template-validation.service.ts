import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import 'multer';

@Injectable()
export class TemplateValidationService {
  private readonly ALLOWED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  private readonly REQUIRED_SHEETS = ['ok', 'Drill Pipe summary'];

  // Sheet 'ok' markers: Cell address -> Expected text (trimmed, case-insensitive)
  private readonly REQUIRED_MARKERS: Record<string, string> = {
    'A4': 'DMMT Work Ordre N°:',
    'K4': 'Désignation : DRILL PIPE',
    'U4': 'Date of Inspection:',
    'A5': 'Customer:',
    'U5': 'Inspection Report N°:',
    'U6': 'Customer W.O. N°:',
    'A7': 'Inspection method:',
  };

  async validateTemplate(file: any): Promise<void> {
    // 1. Validation: Extension and MIME
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException(
        'Only .xlsx Excel templates are supported. Convert legacy .xls files before uploading.',
      );
    }

    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only .xlsx Excel templates are supported. Convert legacy .xls files before uploading.',
      );
    }

    // 2. Parse Excel
    const workbook = new ExcelJS.Workbook();
    try {
      const stream = new Readable();
      stream.push(file.buffer);
      stream.push(null);
      await workbook.xlsx.read(stream);
    } catch (error) {
      throw new BadRequestException(
        'Failed to parse Excel file. Ensure it is a valid .xlsx file.',
      );
    }

    // 3. Validate Required Sheets
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    const missingSheets = this.REQUIRED_SHEETS.filter(
      (required) => !sheetNames.includes(required),
    );

    if (missingSheets.length > 0) {
      throw new BadRequestException(
        `Missing required Key sheets: ${missingSheets.join(', ')}`,
      );
    }

    // 4. Validate Cell Markers in 'ok' sheet
    const okSheet = workbook.getWorksheet('ok');
    if (!okSheet) {
      // Should be caught by step 3, but double check
      throw new BadRequestException(`Missing required sheet: ok`);
    }

    const errors: string[] = [];

    for (const [cellAddress, expectedText] of Object.entries(
      this.REQUIRED_MARKERS,
    )) {
      const cell = okSheet.getCell(cellAddress);
      // Use .text to get safe string representation, trim, case-insensitve
      // ExcelJS .text handles rich text by properly concatenating
      const actualText = (cell.text || '').trim().toLowerCase();
      const expectedNormal = expectedText.trim().toLowerCase();

      if (actualText !== expectedNormal) {
        errors.push(
          `Cell ${cellAddress}: Expected "${expectedText}", found "${cell.text}"`,
        );
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(
        `Template validation failed:\n${errors.join('\n')}`,
      );
    }
  }
}
