import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import 'multer';

// Browsers on Windows can send .xlsx files with different MIME types
// (e.g. application/octet-stream). We rely on the file extension and
// successful ExcelJS parsing as the source of truth instead.
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'application/zip', // .xlsx is a zip internally
]);

@Injectable()
export class TemplateValidationService {
  async validateTemplate(file: Express.Multer.File): Promise<void> {
    // 1. Extension check
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException(
        'Only .xlsx Excel templates are supported. Convert legacy .xls files before uploading.',
      );
    }

    // 2. MIME type – accept known variants (browsers are inconsistent on Windows)
    if (!XLSX_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unexpected MIME type "${file.mimetype}". Only .xlsx Excel templates are supported.`,
      );
    }

    // 3. Parse Excel – verify it is a valid, readable workbook
    const workbook = new ExcelJS.Workbook();
    try {
      const stream = new Readable();
      stream.push(file.buffer);
      stream.push(null);
      await workbook.xlsx.read(stream);
    } catch {
      throw new BadRequestException(
        'Failed to parse Excel file. Ensure it is a valid .xlsx file.',
      );
    }

    // 4. Ensure at least one sheet exists
    if (workbook.worksheets.length === 0) {
      throw new BadRequestException(
        'The uploaded Excel file contains no worksheets.',
      );
    }
  }
}
