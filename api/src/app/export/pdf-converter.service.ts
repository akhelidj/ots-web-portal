import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Converts a finished workbook to PDF by calling a Gotenberg server (headless LibreOffice
 * behind HTTP — see docker-compose.yml). The workbook is the single source of layout, so the
 * PDF is the same filled template the Excel export produces.
 *
 *   PDF_CONVERTER_URL         base URL of Gotenberg, e.g. http://localhost:3001 (unset = PDF off)
 *   PDF_CONVERTER_TIMEOUT_MS  per-conversion timeout (default 60000)
 *
 * An unreachable or failing converter surfaces as a 503 — the Excel export is unaffected.
 */
@Injectable()
export class PdfConverterService {
  private readonly logger = new Logger(PdfConverterService.name);

  constructor(private readonly config: ConfigService) {}

  public async xlsxToPdf(xlsx: Buffer, filename: string): Promise<Buffer> {
    const base = this.config.get<string>('PDF_CONVERTER_URL')?.trim();
    if (!base) {
      throw new ServiceUnavailableException(
        'PDF export is not configured on this server. Use the Excel export instead.',
      );
    }
    const timeout =
      Number(this.config.get('PDF_CONVERTER_TIMEOUT_MS')) || 60_000;

    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(xlsx)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    );

    let response: Response;
    try {
      response = await fetch(
        `${base.replace(/\/+$/, '')}/forms/libreoffice/convert`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(timeout) },
      );
    } catch (err) {
      this.logger.error(
        `PDF converter unreachable at ${base}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'PDF export is temporarily unavailable. Use the Excel export instead.',
      );
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      this.logger.error(
        `PDF conversion failed (${response.status}): ${detail}`,
      );
      throw new ServiceUnavailableException(
        'PDF export failed. Use the Excel export instead.',
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
