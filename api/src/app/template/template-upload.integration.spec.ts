/**
 * Characterization — template upload + validation (the Block 2b tripwire).
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433). Real PrismaService, real
 * persistence; the DB safety guard in api/test/integration-env.ts has already
 * validated DATABASE_URL before this file loads.
 *
 * WHY THIS EXISTS: the create-template-binding spec covers report→template
 * binding, NOT template upload/validation. Before Block 2c purges the template
 * module's `any` (the `file: any` upload param + validation), this pins the
 * current upload/validate behavior so the purge has a tripwire.
 *
 * These are BASELINE assertions of intended behavior — no flip tag, NOT added to
 * docs/internal/sync-risks.md. They describe what the code does today:
 *   - validateTemplate gate order: extension → MIME → ExcelJS parse → worksheet
 *     count, each throwing BadRequestException with its current message;
 *   - createTemplate persists the blob to Template.fileBlob, returns metadata with
 *     the blob stripped, computes a sha256 hash, and versions/deprecates as designed.
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
import { TemplateFileStoreService } from './template-file-store.service';
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
  let templateService: TemplateService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    validationService = new TemplateValidationService();
    // createTemplate never calls fileStore (the store call is commented out —
    // the blob is written inline via the Prisma create), so an inert stub is
    // fine, mirroring the binding spec's stubbed RevisionService.
    templateService = new TemplateService(
      prisma,
      validationService,
      {} as unknown as TemplateFileStoreService,
    );
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
    it('persists a valid upload: stores the blob, returns metadata with the blob stripped, computes the sha256 hash', async () => {
      // BASELINE: the successful-upload shape — blob written to Template.fileBlob,
      // excluded from the returned metadata, hash = sha256(bytes), v1 ACTIVE.
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

      // Returned metadata: identifying fields present, blob stripped.
      expect(metadata.templateKey).toBe('DRILL_PIPE_REPORT');
      expect(metadata.templateVersion).toBe(1);
      expect(metadata.status).toBe(TemplateStatus.ACTIVE);
      expect(metadata.hash).toBe(expectedHash);
      expect(metadata.changeNote).toBe('initial version');
      expect(metadata.createdById).toBe('user-1');
      expect(metadata).not.toHaveProperty('fileBlob');

      // Persistence: the blob really landed in the DB row, byte-identical.
      const row = await prisma.template.findUnique({
        where: { id: metadata.id },
        select: { fileBlob: true },
      });
      if (!row) throw new Error('expected the created Template row to exist');
      expect(Buffer.from(row.fileBlob).equals(REAL_TEMPLATE_BYTES)).toBe(true);
    });

    it('versions and deprecates: a second upload of the same key becomes v2 ACTIVE and flips the prior version to DEPRECATED', async () => {
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
