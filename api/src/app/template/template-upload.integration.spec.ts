/**
 * Integration test — template upload + validation.
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433). Real PrismaService, real
 * persistence; the DB safety guard in api/test/integration-env.ts has already
 * validated DATABASE_URL before this file loads.
 *
 * WHY THIS EXISTS: the create-template-binding spec covers report→template
 * binding, NOT template upload/validation. This pins the current upload/validate
 * behavior. (The template module's file-upload param is untyped; see
 * docs/KNOWN-ISSUES.md #8.)
 *
 * These are BASELINE assertions of intended behavior — not a known bug. They
 * describe what the code does today:
 *   - validateTemplate gate order: extension → MIME → ExcelJS parse → worksheet
 *     count, each throwing BadRequestException with its current message;
 *   - createTemplate writes the workbook bytes through the storage abstraction
 *     (local disk here, keyed tenant/templateKey/version) and records the storage
 *     key on the row, returns metadata with the key stripped, computes a sha256
 *     hash, and versions/deprecates as designed.
 *
 * A VALID workbook requires the real tracked bytes (api/scripts/valid-template.xlsx);
 * ExcelJS throws on a dummy buffer (standing fact), which is exactly the parse-reject
 * branch below.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { TemplateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateService } from './template.service';
import { TemplateValidationService } from './template-validation.service';
import { LocalAttachmentStorage } from '../storage/local-attachment.storage';
import { resetInspectionDomain, seedTenant } from '../../../test/seed-helpers';

const REAL_TEMPLATE_BYTES = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template.xlsx'),
);

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Minimal Express.Multer.File shape the upload path reads: originalname, mimetype,
// buffer. Defaults describe a valid real-bytes upload; override per case.
function makeFile(
  overrides: Partial<{
    originalname: string;
    mimetype: string;
    buffer: Buffer;
  }> = {},
) {
  return {
    originalname: 'valid-template.xlsx',
    mimetype: XLSX_MIME,
    buffer: REAL_TEMPLATE_BYTES,
    ...overrides,
  };
}

describe('Template upload / validation [integration]', () => {
  let prisma: PrismaService;
  let validationService: TemplateValidationService;
  let storage: LocalAttachmentStorage;
  let templateService: TemplateService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    validationService = new TemplateValidationService();
    // createTemplate writes the workbook through the storage abstraction; use the
    // real local backend (writes under api/uploads/templates/<key>) so this proves
    // the actual storage path, matching the default STORAGE_DRIVER=local.
    storage = new LocalAttachmentStorage();
    templateService = new TemplateService(prisma, validationService, storage);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  describe('validateTemplate (pure gate — no DB)', () => {
    it('accepts a valid .xlsx workbook (real template bytes) — resolves without throwing', async () => {
      // BASELINE: the real tracked template passes all four gates.
      await expect(
        validationService.validateTemplate(makeFile()),
      ).resolves.toBeUndefined();
    });

    it('rejects a non-.xlsx extension before anything else (BadRequestException)', async () => {
      // BASELINE: extension is gate 1 — a .xls name is refused even with valid bytes.
      await expect(
        validationService.validateTemplate(
          makeFile({ originalname: 'legacy-template.xls' }),
        ),
      ).rejects.toThrow(/Only \.xlsx Excel templates are supported/);
      await expect(
        validationService.validateTemplate(
          makeFile({ originalname: 'legacy-template.xls' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a disallowed MIME type (gate 2)', async () => {
      // BASELINE: a .xlsx name but an unrecognized MIME is refused. (octet-stream,
      // zip, ms-excel and the canonical xlsx type are the accepted set.)
      await expect(
        validationService.validateTemplate(
          makeFile({ mimetype: 'text/plain' }),
        ),
      ).rejects.toThrow(/Unexpected MIME type "text\/plain"/);
    });

    it('rejects an unparseable buffer with a valid name+MIME (gate 3 — ExcelJS parse)', async () => {
      // BASELINE: bytes that are not a real OOXML workbook fail the parse gate.
      await expect(
        validationService.validateTemplate(
          makeFile({ buffer: Buffer.from('this is not a real xlsx file') }),
        ),
      ).rejects.toThrow(/Failed to parse Excel file/);
    });

    it('rejects an empty buffer via the parse gate', async () => {
      // BASELINE: pins the empty-upload edge — an empty buffer cannot be parsed,
      // so it is refused at gate 3 (not a distinct empty-file branch).
      await expect(
        validationService.validateTemplate(
          makeFile({ buffer: Buffer.alloc(0) }),
        ),
      ).rejects.toThrow(/Failed to parse Excel file/);
    });
  });

  describe('createTemplate (persistence — real DB, real bytes)', () => {
    it('persists a valid upload: stores the workbook through storage, records the key (stripped from metadata), computes the sha256 hash', async () => {
      // BASELINE: the successful-upload shape — bytes written through the storage
      // abstraction, the storage key recorded on the row and excluded from the
      // returned metadata, hash = sha256(bytes), v1 ACTIVE.
      const tenant = await seedTenant(prisma);
      const expectedHash = createHash('sha256')
        .update(REAL_TEMPLATE_BYTES)
        .digest('hex');

      const metadata = await templateService.createTemplate(
        tenant.id,
        'DRILL_PIPE_REPORT',
        makeFile(),
        'initial version',
        'user-1',
      );

      // Returned metadata: identifying fields present, storage key stripped.
      expect(metadata.templateKey).toBe('DRILL_PIPE_REPORT');
      expect(metadata.templateVersion).toBe(1);
      expect(metadata.status).toBe(TemplateStatus.ACTIVE);
      expect(metadata.hash).toBe(expectedHash);
      expect(metadata.changeNote).toBe('initial version');
      expect(metadata.createdById).toBe('user-1');
      expect(metadata).not.toHaveProperty('fileKey');
      expect(metadata).not.toHaveProperty('fileBlob');

      // Persistence: the row records the canonical key, and the workbook bytes
      // fetched back from storage under that key are byte-identical to the upload.
      const row = await prisma.template.findUnique({
        where: { id: metadata.id },
        select: { fileKey: true },
      });
      if (!row) throw new Error('expected the created Template row to exist');
      expect(row.fileKey).toBe(`${tenant.id}/DRILL_PIPE_REPORT/1`);

      const stored = await storage.getTemplate(row.fileKey);
      if (!stored) throw new Error('expected the workbook to be in storage');
      expect(stored.equals(REAL_TEMPLATE_BYTES)).toBe(true);

      await storage.deleteTemplate(row.fileKey);
    });

    it('versions and deprecates: a second upload of the same key becomes version 2 ACTIVE and moves the prior version to DEPRECATED', async () => {
      // BASELINE: the version/deprecation lifecycle on re-upload.
      const tenant = await seedTenant(prisma);

      const v1 = await templateService.createTemplate(
        tenant.id,
        'DRILL_PIPE_REPORT',
        makeFile(),
        'v1',
        'user-1',
      );
      const v2 = await templateService.createTemplate(
        tenant.id,
        'DRILL_PIPE_REPORT',
        makeFile(),
        'v2',
        'user-1',
      );

      expect(v1.templateVersion).toBe(1);
      expect(v2.templateVersion).toBe(2);
      expect(v2.status).toBe(TemplateStatus.ACTIVE);

      const priorRow = await prisma.template.findUnique({
        where: { id: v1.id },
        select: { status: true },
      });
      expect(priorRow?.status).toBe(TemplateStatus.DEPRECATED);
    });

    it('rejects an invalid upload before writing anything (guard runs before persistence)', async () => {
      // BASELINE: validation is step 1 of createTemplate, so an invalid file throws
      // and no Template row is written.
      const tenant = await seedTenant(prisma);

      await expect(
        templateService.createTemplate(
          tenant.id,
          'DRILL_PIPE_REPORT',
          makeFile({ originalname: 'nope.xls' }),
          'should not persist',
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const count = await prisma.template.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(0);
    });
  });
});
