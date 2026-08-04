/**
 * Integration test — InspectionReport workflow state machine (transitions).
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433). Real service, real persistence.
 *
 * BASELINE we are locking: the legal-transition matrix
 * (workflow.policy.ts → INSPECTION_REPORT_TRANSITIONS) must stay unchanged. Any
 * refactor that perturbs which transitions are legal should fail these tests.
 * Stable/untagged — not a known bug.
 *
 * SCOPE: the transition state machine only. NOT the revision-snapshot engine (next
 * step) and NOT the PENDING_APPROVAL serial-validation gate. Reopen/first-approval
 * edges call RevisionService, so it is stubbed to a no-op here — we drive
 * transitions and never assert snapshot contents.
 *
 * Reached in the live app via POST :id/transitions
 * (inspection-report-workflow.controller.ts:15).
 *
 * RBAC note: that route has NO @Roles() decorator. Role enforcement lives INSIDE
 * the service — the transition matrix is keyed by user.role
 * (inspection-report-workflow.service.ts:264-265) plus an explicit CUSTOMER
 * ForbiddenException (:259-261). Pinned below; no route-level role infra is built.
 *
 * Version bump: a successful transition does version + 1 via a guarded updateMany
 * (inspection-report-workflow.service.ts:414 / 425-438), the same optimistic-
 * concurrency pattern as the rest of the codebase.
 */
import { ForbiddenException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import {
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

describe('InspectionReport workflow state transitions (foundation baseline) [integration]', () => {
  let prisma: PrismaService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;

  const admin = (tenantId: string) => ({
    id: 'user-admin',
    tenantId,
    role: UserRole.ADMIN,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    // No-op RevisionService: reopen/first-approval edges invoke it, but the
    // snapshot engine is covered in a separate spec. We only drive the state
    // machine, so a no-op keeps this test strictly about legal/illegal transitions.
    const revisionStub = {
      createInspectionReportSnapshot: async () => undefined,
    } as unknown as RevisionService;

    workflow = new InspectionReportWorkflowService(prisma, revisionStub);
    reports = new InspectionReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  /** Create a real DRAFT report (via the live create path) at version 1. */
  async function newDraftReport() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
    const report = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-WF',
    });
    return { tenant, report };
  }

  describe('legal transitions succeed', () => {
    it('drives the representative ADMIN lifecycle DRAFT → RECEIVED → READY_FOR_CLEANING → READY_FOR_INSPECTION → IN_INSPECTION, incrementing version each step', async () => {
      // These are the "receiving / prep" legal edges that carry no extra
      // precondition and require no reason. We stop at IN_INSPECTION on purpose:
      // IN_INSPECTION → PENDING_APPROVAL is gated by the serial-validation gate, and
      // PENDING_APPROVAL → APPROVED triggers the revision snapshot — both are
      // separate focused steps, out of scope here.
      const { tenant, report } = await newDraftReport();
      const a = admin(tenant.id);
      expect(report.status).toBe(InspectionReportStatus.DRAFT);
      expect(report.version).toBe(1);

      const r1 = await workflow.transition(
        a,
        report.id,
        InspectionReportStatus.RECEIVED,
        1,
      );
      expect(r1.status).toBe(InspectionReportStatus.RECEIVED);
      expect(r1.version).toBe(2);

      const r2 = await workflow.transition(
        a,
        report.id,
        InspectionReportStatus.READY_FOR_CLEANING,
        2,
      );
      expect(r2.status).toBe(InspectionReportStatus.READY_FOR_CLEANING);
      expect(r2.version).toBe(3);

      const r3 = await workflow.transition(
        a,
        report.id,
        InspectionReportStatus.READY_FOR_INSPECTION,
        3,
      );
      expect(r3.status).toBe(InspectionReportStatus.READY_FOR_INSPECTION);
      expect(r3.version).toBe(4);

      const r4 = await workflow.transition(
        a,
        report.id,
        InspectionReportStatus.IN_INSPECTION,
        4,
      );
      expect(r4.status).toBe(InspectionReportStatus.IN_INSPECTION);
      expect(r4.version).toBe(5);
    });

    it('allows the reopen edge APPROVED → IN_INSPECTION when a reason is given', async () => {
      const { tenant, report } = await newDraftReport();
      // Seed the APPROVED state directly to isolate the reopen edge from the
      // serial-validation gate that guards the normal path into APPROVED. This edge
      // requires a reason (workflow.policy.ts:isReasonRequiredForInspection).
      const approved = await prisma.inspectionReport.update({
        where: { id: report.id },
        data: { status: InspectionReportStatus.APPROVED, revisionNumber: 1 },
      });

      const reopened = await workflow.transition(
        admin(tenant.id),
        report.id,
        InspectionReportStatus.IN_INSPECTION,
        approved.version,
        'reopening for rework',
      );

      expect(reopened.status).toBe(InspectionReportStatus.IN_INSPECTION);
      expect(reopened.version).toBe(approved.version + 1);
    });
  });

  describe('illegal transitions are rejected', () => {
    it('rejects an edge not in the matrix (DRAFT → APPROVED for ADMIN) with ForbiddenException', async () => {
      const { tenant, report } = await newDraftReport();

      let error: unknown;
      try {
        await workflow.transition(
          admin(tenant.id),
          report.id,
          InspectionReportStatus.APPROVED,
          1,
        );
      } catch (e) {
        error = e;
      }

      // Pin the ACTUAL current behavior: type + message.
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toMatch(
        /Transition from DRAFT to APPROVED is not allowed for role ADMIN/,
      );

      // And the report was not mutated (rejected before the write).
      const unchanged = await prisma.inspectionReport.findUnique({
        where: { id: report.id },
      });
      expect(unchanged?.status).toBe(InspectionReportStatus.DRAFT);
      expect(unchanged?.version).toBe(1);
    });
  });

  describe('version bump on transition', () => {
    it('increments the entity version by exactly 1 on a successful transition (optimistic concurrency)', async () => {
      const { tenant, report } = await newDraftReport();
      expect(report.version).toBe(1);

      const moved = await workflow.transition(
        admin(tenant.id),
        report.id,
        InspectionReportStatus.RECEIVED,
        1,
      );

      expect(moved.version).toBe(2);
      const persisted = await prisma.inspectionReport.findUnique({
        where: { id: report.id },
      });
      expect(persisted?.version).toBe(2);
    });

    it('rejects a stale version with ConflictException (guarded updateMany)', async () => {
      const { tenant, report } = await newDraftReport();

      let error: unknown;
      try {
        // Pass version 99 while the row is at version 1.
        await workflow.transition(
          admin(tenant.id),
          report.id,
          InspectionReportStatus.RECEIVED,
          99,
        );
      } catch (e) {
        error = e;
      }
      expect((error as Error)?.constructor?.name).toBe('ConflictException');
    });
  });

  describe('RBAC (service-level; no @Roles on the transition route)', () => {
    it('rejects the CUSTOMER role with ForbiddenException', async () => {
      const { tenant, report } = await newDraftReport();

      let error: unknown;
      try {
        await workflow.transition(
          { id: 'user-cust', tenantId: tenant.id, role: UserRole.CUSTOMER },
          report.id,
          InspectionReportStatus.RECEIVED,
          1,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toMatch(
        /Customers cannot perform transitions/,
      );
    });

    it('gates by role: RECEIVER cannot take a DRAFT edge that only ADMIN has (DRAFT → READY_FOR_CLEANING)', async () => {
      const { tenant, report } = await newDraftReport();

      let error: unknown;
      try {
        await workflow.transition(
          { id: 'user-recv', tenantId: tenant.id, role: UserRole.RECEIVER },
          report.id,
          InspectionReportStatus.READY_FOR_CLEANING,
          1,
        );
      } catch (e) {
        error = e;
      }
      // RECEIVER's DRAFT row only allows RECEIVED, so this edge is role-gated.
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toMatch(/not allowed for role RECEIVER/);
    });
  });
});
