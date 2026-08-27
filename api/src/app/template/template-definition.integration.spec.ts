/**
 * Phase D step 2a — definition write path + atomicity [integration].
 *
 * Runs under `test-integration` against the dedicated test Postgres (:5433). Proves:
 *   - happy path: a valid ops description of the REAL fixture's tokens writes a
 *     definitionJson, and that written definition round-trips the real engine readers;
 *   - atomicity: each input-reachable rejection (bad type, unknown computed, select
 *     without options, token not in sheet, non-boolean required) refuses the write and
 *     leaves definitionJson UNCHANGED (still null);
 *   - tenant scoping: another tenant's row is Forbidden, nothing written;
 *   - the createReport "undefined = not usable" guard (both arms).
 *
 * The two structural checks (single-region, engine-dry-run) are not reachable from
 * the ops DTO — buildDefinition always emits one region and no transforms — so they
 * are proven in definition-validator.spec.ts (unit), as defense-in-depth.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateDefinitionService } from './template-definition.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import {
  engineGlobalTokens,
  engineRowTokens,
  engineRowTokenKeys,
  ExportDefinition,
} from '../export/export-engine';
import { DefineTemplateDto } from './definition-authoring.types';
import {
  resetInspectionDomain,
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

const REAL_TEMPLATE_BYTES = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template.xlsx'),
);

/** A valid ops description over tokens that really exist in the fixture. */
function baseDto(): DefineTemplateDto {
  return {
    displayName: 'Fixture Report',
    region: { id: 'serials', marker: '{{sn}}' },
    disposition: { field: 'emi', requiredForApproval: true },
    fields: [
      {
        token: '{{poNumber}}',
        label: 'PO Number',
        type: 'text',
        required: false,
        scope: 'header',
      },
      {
        token: '{{b_od}}',
        label: 'Box Min OD',
        type: 'text',
        required: true,
        scope: 'item',
        section: 'Box',
      },
      {
        token: '{{emi}}',
        label: 'EMI Result',
        type: 'select',
        required: true,
        scope: 'item',
        section: 'Body',
        options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'],
      },
    ],
    computed: [
      { token: '{{customer}}', computed: 'customerName' },
      { token: '{{reportNumber}}', computed: 'reportNumber' },
    ],
  };
}

describe('Template definition write path [integration]', () => {
  let prisma: PrismaService;
  let service: TemplateDefinitionService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new TemplateDefinitionService(
      prisma,
      new XlsNormalizerService(),
      new TokenExtractorService(),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  describe('PUT /templates/:id/definition (service)', () => {
    let tenantId: string;
    let templateId: string;

    beforeEach(async () => {
      await resetInspectionDomain(prisma);
      const tenant = await seedTenant(prisma);
      tenantId = tenant.id;
      // Seed a template with the REAL fixture bytes and NO definition yet.
      const row = await prisma.template.create({
        data: {
          tenantId,
          templateKey: 'FIXTURE_REPORT',
          templateVersion: 1,
          status: 'ACTIVE',
          fileBlob: REAL_TEMPLATE_BYTES,
          hash: 'hash-fixture',
          changeNote: 'seed',
          createdById: 'seed-user',
          definitionJson: undefined, // column stays NULL
        },
        select: { id: true },
      });
      templateId = row.id;
    });

    const readDefinition = async () =>
      (
        await prisma.template.findUnique({
          where: { id: templateId },
          select: { definitionJson: true },
        })
      )?.definitionJson ?? null;

    it('happy path: writes a definitionJson that round-trips the real engine readers', async () => {
      expect(await readDefinition()).toBeNull();

      const result = await service.defineTemplate(
        tenantId,
        templateId,
        baseDto(),
        'seed-user',
      );
      expect(result.definitionJson).not.toBeNull();

      const written = await readDefinition();
      expect(written).not.toBeNull();

      // Engine-valid: the written definition drives the real readers without throwing.
      const def = written as unknown as ExportDefinition;
      expect(() => {
        engineGlobalTokens(def, {
          header: {},
          serialNumbers: [],
          transitionLogs: [],
          users: [],
        } as never);
        engineRowTokenKeys(def);
        engineRowTokens(
          def,
          { header: {}, transitionLogs: [], users: [] } as never,
          { serial: 'S1', inspectionData: {} } as never,
        );
      }).not.toThrow();
    });

    // Each rejection: refuse the write AND leave definitionJson unchanged (still null).
    const expectRejectedAndUnchanged = async (dto: DefineTemplateDto) => {
      await expect(
        service.defineTemplate(tenantId, templateId, dto, 'seed-user'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await readDefinition()).toBeNull();
    };

    it('rejects a bad type — atomically', async () => {
      const dto = baseDto();
      (dto.fields[1] as { type: string }).type = 'list';
      await expectRejectedAndUnchanged(dto);
    });

    it('rejects an unknown computed name — atomically', async () => {
      const dto = baseDto();
      dto.computed![0]!.computed = 'notARealComputed';
      await expectRejectedAndUnchanged(dto);
    });

    it('rejects a select without options — atomically', async () => {
      const dto = baseDto();
      delete (dto.fields[2] as { options?: string[] }).options;
      await expectRejectedAndUnchanged(dto);
    });

    it('rejects a token not present in the sheet — atomically', async () => {
      const dto = baseDto();
      dto.fields.push({
        token: '{{ghost_token}}',
        label: 'Ghost',
        type: 'text',
        required: false,
        scope: 'header',
      });
      await expectRejectedAndUnchanged(dto);
    });

    it('rejects a non-boolean required — atomically', async () => {
      const dto = baseDto();
      (dto.fields[0] as { required: unknown }).required = 'yes';
      await expectRejectedAndUnchanged(dto);
    });

    it('forbids writing another tenant’s template — nothing written', async () => {
      const other = await seedTenant(prisma, 'other tenant');
      await expect(
        service.defineTemplate(other.id, templateId, baseDto(), 'seed-user'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await readDefinition()).toBeNull();
    });
  });

  describe('createReport guard — a NULL-definition template is not usable', () => {
    let reportsService: InspectionReportsService;

    beforeAll(() => {
      reportsService = new InspectionReportsService(prisma, makeFilesServiceStub());
    });

    beforeEach(async () => {
      await resetInspectionDomain(prisma);
    });

    it('refuses to create a report against a DRILL_PIPE template with definitionJson = NULL', async () => {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT', {
        definitionJson: null,
      });

      await expect(
        reportsService.createReport(tenant.id, 'user-1', {
          customerId: customer.id,
          poNumber: 'PO-NULLDEF',
          templateKey: 'DRILL_PIPE_REPORT',
        }),
      ).rejects.toThrow(/has no definition yet/);

      const count = await prisma.inspectionReport.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(0);
    });

    it('allows report creation once the template carries a definition', async () => {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      // default seed → DRILL_PIPE_REPORT gets the real (non-null) definition
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');

      const report = await reportsService.createReport(tenant.id, 'user-1', {
        customerId: customer.id,
        poNumber: 'PO-HASDEF',
        templateKey: 'DRILL_PIPE_REPORT',
      });
      expect(report.templateKey).toBe('DRILL_PIPE_REPORT');
    });
  });
});
