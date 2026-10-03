import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfConverterService } from './pdf-converter.service';

const config = (env: Record<string, string>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('PdfConverterService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is unavailable (503) when no converter URL is configured', async () => {
    const svc = new PdfConverterService(config({}));
    await expect(svc.xlsxToPdf(Buffer.from('x'), 'a.xlsx')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('posts the workbook to Gotenberg and returns the PDF bytes', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new PdfConverterService(
      config({ PDF_CONVERTER_URL: 'http://gotenberg:3000/' }),
    );
    const out = await svc.xlsxToPdf(Buffer.from('xlsx'), 'report.xlsx');

    expect(out.toString()).toBe('%PDF-1.7');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://gotenberg:3000/forms/libreoffice/convert',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('maps an unreachable converter to 503', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const svc = new PdfConverterService(
      config({ PDF_CONVERTER_URL: 'http://localhost:1' }),
    );
    await expect(svc.xlsxToPdf(Buffer.from('x'), 'a.xlsx')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a converter error response to 503', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch;
    const svc = new PdfConverterService(
      config({ PDF_CONVERTER_URL: 'http://localhost:3001' }),
    );
    await expect(svc.xlsxToPdf(Buffer.from('x'), 'a.xlsx')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
