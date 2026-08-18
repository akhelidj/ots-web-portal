/**
 * Integration test — the create / template-binding path (the multi-template seam).
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433). Real PrismaService, real
 * persistence; the DB safety guard in api/test/integration-env.ts has already
 * validated DATABASE_URL before this file loads.
 *
 * The two create paths:
 *
 *  - InspectionReportsService.createReport (the LIVE, controller-reachable path) NOW
 *    honors the caller's templateKey (Phase D flat step 5 — the consumption picker).
 *    CreateInspectionReportDto carries templateKey; createReport resolves the newest
 *    ACTIVE version of THAT key and binds the report to it, with the definitionJson
 *    guard as backstop. This retires the former DRILL_PIPE_REPORT hardcode. These tests
 *    prove the live path is multi-template: drill pipe still works, a non-drill-pipe
 *    defined template binds, and unknown / undefined keys are rejected.
 *
 *  - InspectionReportWorkflowService.create (inspection-report-workflow.service.ts:60)
 *    also honors dto.templateKey, but is UNWIRED: the only workflow controller exposes
 *    transition / available-transitions / transitions — no route calls create. So it is
 *    currently unreachable from the live app. The live picker path above is the wired
 *    multi-template path; this seam (ADR-0009) is documented here as still honoring the
 *    requested key.
 */
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
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

  describe('InspectionReportsService.createReport (live picker path)', () => {
    it('drill-pipe UNCHANGED: creating a DRILL_PIPE_REPORT still binds to that template', async () => {
      // The existing drill-pipe flow must behave exactly as before now that the key is
      // chosen rather than hardcoded — the picker sends 'DRILL_PIPE_REPORT'.
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
        templateKey: 'DRILL_PIPE_REPORT',
      });

      expect(report.templateKey).toBe('DRILL_PIPE_REPORT');
      expect(report.templateVersion).toBe(template.templateVersion);
      expect(report.templateHash).toBe(template.hash);
    });

    it('DECISIVE (finish line): a report is created against a NON-drill-pipe DEFINED template', async () => {
      // The proof this whole engagement builds to: report creation is no longer
      // drill-pipe-locked. Seed BOTH a drill-pipe template AND a defined non-drill-pipe
      // one; request the non-drill-pipe key; the report must bind to THAT template — not
      // fall back to drill pipe.
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
      const flat = await seedActiveTemplate(prisma, tenant.id, 'CASING_FLAT', {
        definitionJson: {
          formatVersion: 1,
          templateKey: 'CASING_FLAT',
          templateVersion: 1,
          regions: [],
          fields: [],
          export: { global: [], regions: {} },
        },
      });

      const report = await reportsService.createReport(tenant.id, 'user-1', {
        customerId: customer.id,
        poNumber: 'PO-FLAT-1',
        templateKey: 'CASING_FLAT',
      });

      expect(report.templateKey).toBe('CASING_FLAT'); // bound to the CHOSEN template
      expect(report.templateKey).not.toBe('DRILL_PIPE_REPORT'); // not a drill-pipe fallback
      expect(report.templateVersion).toBe(flat.templateVersion);
      expect(report.templateHash).toBe(flat.hash);
    });

    it('rejects an unknown templateKey — clear 400, nothing created', async () => {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');

      await expect(
        reportsService.createReport(tenant.id, 'user-1', {
          customerId: customer.id,
          poNumber: 'PO-UNKNOWN',
          templateKey: 'NO_SUCH_TEMPLATE',
        }),
      ).rejects.toThrow(/No active template found for NO_SUCH_TEMPLATE/);

      const count = await prisma.inspectionReport.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(0); // nothing persisted
    });

    it('GUARD BACKSTOP: rejects a key whose ACTIVE template has no definition', async () => {
      // The picker only offers defined templates, but a caller can name an undefined key
      // directly — the definitionJson guard is the defense-in-depth backstop.
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'UNDEFINED_TEMPLATE', {
        definitionJson: null, // ACTIVE but no definition
      });

      await expect(
        reportsService.createReport(tenant.id, 'user-1', {
          customerId: customer.id,
          poNumber: 'PO-UNDEF',
          templateKey: 'UNDEFINED_TEMPLATE',
        }),
      ).rejects.toThrow(/has no definition yet and cannot be used/);
    });

    it('rejects a missing/empty templateKey with a clear 400', async () => {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');

      await expect(
        reportsService.createReport(tenant.id, 'user-1', {
          customerId: customer.id,
          poNumber: 'PO-NOKEY',
          templateKey: '   ',
        }),
      ).rejects.toThrow(/templateKey is required/);
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
