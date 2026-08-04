/**
 * Integration test — the create / template-binding path (the multi-template seam).
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433). Real PrismaService, real
 * persistence; the DB safety guard in api/test/integration-env.ts has already
 * validated DATABASE_URL before this file loads.
 *
 * These are a documented BASELINE, not a bug hunt. The two create paths diverge:
 *
 *  - InspectionReportsService.createReport (the LIVE, controller-reachable path)
 *    hardcodes templateKey = 'DRILL_PIPE_REPORT' (inspection-reports.service.ts:125)
 *    and its DTO has no templateKey field at all. Binding every report to
 *    DRILL_PIPE_REPORT is an INTENTIONAL constraint (single template today);
 *    multi-template is planned future work. See
 *    docs/adr/0009-single-template-hardcode-seam.md. These tests are therefore
 *    stable/untagged — not a known bug, not expected to change.
 *
 *  - InspectionReportWorkflowService.create (inspection-report-workflow.service.ts:60)
 *    already honors dto.templateKey, but is UNWIRED: the only workflow controller
 *    (InspectionReportWorkflowController) exposes transition / available-transitions
 *    / transitions — no route calls create — and no other controller references it.
 *    So it is currently unreachable from the live app. It is the multi-template seam
 *    (ADR-0009); these tests document that it already binds by the requested key.
 */
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import {
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

describe('Create / template-binding path (multi-template seam) [integration]', () => {
  let prisma: PrismaService;
  let reportsService: InspectionReportsService;
  let workflowService: InspectionReportWorkflowService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    reportsService = new InspectionReportsService(prisma);
    // workflow.create does not use RevisionService, so an inert stub is fine.
    workflowService = new InspectionReportWorkflowService(
      prisma,
      {} as unknown as RevisionService,
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  describe('InspectionReportsService.createReport (live, hardcoded path)', () => {
    it('binds every created report to DRILL_PIPE_REPORT regardless of input (intentional constraint — multi-template is planned future work)', async () => {
      // BASELINE (stable, untagged): the hardcode at inspection-reports.service.ts:125
      // is deliberate — one template today; multi-template is planned future work.
      // This is NOT a bug.
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      const template = await seedActiveTemplate(
        prisma,
        tenant.id,
        'DRILL_PIPE_REPORT',
      );

      const report = await reportsService.createReport(tenant.id, 'user-1', {
        customerId: customer.id,
        poNumber: 'PO-0001',
      });

      expect(report.templateKey).toBe('DRILL_PIPE_REPORT');
      expect(report.templateVersion).toBe(template.templateVersion);
      expect(report.templateHash).toBe(template.hash);
    });

    it('ignores any templateKey supplied on the create input — the value is hardcoded, the DTO has no templateKey field (baseline; multi-template change point)', async () => {
      // BASELINE (stable, untagged): CreateInspectionReportDto exposes only
      // customerId + poNumber, and createReport never reads an incoming templateKey.
      // We seed ONLY a DRILL_PIPE_REPORT template. If the service honored the input
      // key it would look up 'SOME_OTHER_KEY', find no active template, and throw.
      // Instead it succeeds bound to DRILL_PIPE_REPORT — proving the input is ignored.
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');

      const input = {
        customerId: customer.id,
        poNumber: 'PO-0002',
        // Not part of CreateInspectionReportDto — present only to show it is ignored.
        templateKey: 'SOME_OTHER_KEY',
      } as CreateInspectionReportDto & { templateKey: string };

      const report = await reportsService.createReport(
        tenant.id,
        'user-1',
        input,
      );

      expect(report.templateKey).toBe('DRILL_PIPE_REPORT');
      expect(report.templateKey).not.toBe('SOME_OTHER_KEY');
    });
  });

  describe('InspectionReportWorkflowService.create (unwired seam)', () => {
    // NOTE: this path is currently unreachable from any route — the workflow
    // controller exposes no create endpoint — which is why the live create path is
    // the hardcoded one above. Documented here as the multi-template seam (ADR-0009).

    it('honors dto.templateKey — a passed key binds the report to that template', async () => {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      const template = await seedActiveTemplate(
        prisma,
        tenant.id,
        'CUSTOM_TEMPLATE',
      );

      const report = await workflowService.create(
        { id: 'user-1', tenantId: tenant.id, role: UserRole.ADMIN },
        {
          templateKey: 'CUSTOM_TEMPLATE',
          poNumber: 'PO-0003',
          customerId: customer.id,
        },
      );

      expect(report.templateKey).toBe('CUSTOM_TEMPLATE');
      expect(report.templateVersion).toBe(template.templateVersion);
      expect(report.templateHash).toBe(template.hash);
    });

    it('resolves strictly by dto.templateKey — rejects a key with no ACTIVE template', async () => {
      // Further proof it keys off the passed value: with only a DRILL_PIPE_REPORT
      // template seeded, requesting a different key finds no active template and is
      // rejected (createReport, by contrast, would ignore the key entirely).
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');

      await expect(
        workflowService.create(
          { id: 'user-1', tenantId: tenant.id, role: UserRole.ADMIN },
          {
            templateKey: 'NON_EXISTENT_TEMPLATE',
            poNumber: 'PO-0004',
            customerId: customer.id,
          },
        ),
      ).rejects.toThrow(
        /No ACTIVE template found for key: NON_EXISTENT_TEMPLATE/,
      );
    });

    it('wraps any in-transaction failure in BadRequestException("Failed to create report: …") — the :109 catch', async () => {
      // BASELINE (stable, untagged): pins the current catch behavior at
      // inspection-report-workflow.service.ts:109 ahead of the 3h-ii any->unknown
      // rewrite. The pre-try guard passes (ACTIVE template exists), then the
      // $transaction fails inside — here a non-existent customerId trips the
      // Customer FK — so the caught error is transformed into a 400 with the
      // "Failed to create report:" prefix (it does NOT rethrow the raw Prisma error).
      const tenant = await seedTenant(prisma);
      await seedActiveTemplate(prisma, tenant.id, 'CUSTOM_TEMPLATE');

      const attempt = workflowService.create(
        { id: 'user-1', tenantId: tenant.id, role: UserRole.ADMIN },
        {
          templateKey: 'CUSTOM_TEMPLATE',
          poNumber: 'PO-0005',
          customerId: '00000000-0000-0000-0000-000000000000', // no such Customer -> FK violation
        },
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(/Failed to create report:/);
    });
  });
});
