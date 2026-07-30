/**
 * Characterization — the create / template-binding path (the F2.1 seam).
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
 *    DRILL_PIPE_REPORT is an INTENTIONAL pre-F2.1 constraint (single template
 *    today). F2.1.2 is the planned change point that un-hardcodes it. These tests
 *    are therefore STABLE/UNTAGGED — NOT "known bug", NOT expected to flip, and
 *    are deliberately kept out of docs/internal/sync-risks.md.
 *
 *  - InspectionReportWorkflowService.create (inspection-report-workflow.service.ts:60)
 *    already honors dto.templateKey, but is UNWIRED: the only workflow controller
 *    (InspectionReportWorkflowController) exposes transition / available-transitions
 *    / transitions — no route calls create — and no other controller references it.
 *    So it is currently unreachable from the live app. It is the seam F2.1.2 will
 *    wire; these tests document that it already binds by the requested key.
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

describe('Create / template-binding path (F2.1 seam) [integration]', () => {
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
    it('binds every created report to DRILL_PIPE_REPORT regardless of input (intentional pre-F2.1 constraint — F2.1.2 will change this)', async () => {
      // BASELINE (stable, untagged): the hardcode at inspection-reports.service.ts:125
      // is deliberate — one template today. F2.1.2 is the planned change point. This
      // is NOT a bug and must NOT be tagged to flip.
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

    it('ignores any templateKey supplied on the create input — the value is hardcoded, the DTO has no templateKey field (baseline; F2.1.2 change point)', async () => {
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
    // the hardcoded one above. Documented here as the seam F2.1.2 will wire.

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
