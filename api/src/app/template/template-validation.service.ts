import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import 'multer';

@Injectable()
export class TemplateValidationService {
  private readonly ALLOWED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  private readonly REQUIRED_SHEETS = ['Drill Pipe Inspection Report'];


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

  }
}

