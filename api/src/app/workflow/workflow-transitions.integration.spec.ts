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
import { findLastInspectorUserId } from '../inspection-reports/last-inspector';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import {
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  resetInspectionDomain,
  makeFilesServiceStub,
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
    reports = new InspectionReportsService(prisma, makeFilesServiceStub());
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
      templateKey: 'DRILL_PIPE_REPORT',
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

    it('reopening to IN_INSPECTION returns APPROVED serials to INSPECTED_DRAFT so they can be inspected again', async () => {
      const { tenant, report } = await newDraftReport();
      const approved = await prisma.inspectionReport.update({
        where: { id: report.id },
        data: { status: InspectionReportStatus.APPROVED, revisionNumber: 1 },
      });
      const mk = (
        serial: string,
        approvalStatus: 'APPROVED' | 'NOT_INSPECTED',
      ) =>
        prisma.serialNumber.create({
          data: {
            serial,
            tenantId: tenant.id,
            inspectionReportId: report.id,
            approvalStatus,
          },
        });
      const done = await mk('SN-DONE', 'APPROVED');
      const untouched = await mk('SN-NEW', 'NOT_INSPECTED');

      await workflow.transition(
        admin(tenant.id),
        report.id,
        InspectionReportStatus.IN_INSPECTION,
        approved.version,
        'revision needed',
      );

      const after = await prisma.serialNumber.findMany({
        where: { inspectionReportId: report.id },
        orderBy: { serial: 'asc' },
      });
      const byId = new Map(after.map((s) => [s.id, s]));
      expect(byId.get(done.id)?.approvalStatus).toBe('INSPECTED_DRAFT');
      expect(byId.get(done.id)?.version).toBe(done.version + 1);
      expect(byId.get(untouched.id)?.approvalStatus).toBe('NOT_INSPECTED');
      expect(byId.get(untouched.id)?.version).toBe(untouched.version);
    });

    it('the inspector is the last person who acted on the report during IN_INSPECTION; a reopen alone does not change it', async () => {
      const { tenant, report } = await newDraftReport();
      const at = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00Z`);
      const act = (
        userId: string,
        when: string,
        entity: string,
        action: string,
      ) =>
        prisma.auditLog.create({
          data: {
            action,
            entity,
            entityId: 'x',
            tenantId: tenant.id,
            userId,
            inspectionReportId: report.id,
            reason: 'r',
            timestamp: at(when),
          },
        });
      const move = (
        from: InspectionReportStatus,
        to: InspectionReportStatus,
        when: string,
      ) =>
        prisma.inspectionReportTransitionLog.create({
          data: {
            inspectionReportId: report.id,
            fromStatus: from,
            toStatus: to,
            userId: 'mover',
            timestamp: at(when),
          },
        });
      const S = InspectionReportStatus;

      // Actions with no IN_INSPECTION phase yet count for nothing.
      await act('before-phase', '09:00', 'SerialNumber', 'UPDATE');
      expect(
        await findLastInspectorUserId(prisma, tenant.id, report.id),
      ).toBeNull();

      await move(S.RECEIVED, S.IN_INSPECTION, '10:00');
      await act('serial-worker', '10:30', 'SerialNumber', 'UPDATE');
      await act('header-worker', '11:00', 'InspectionReport', 'UPDATE'); // report level
      await act('attachment-worker', '11:30', 'Attachment', 'CREATE'); // report level
      await move(S.IN_INSPECTION, S.PENDING_APPROVAL, '12:00');
      await act('approver-edit', '12:30', 'InspectionReport', 'UPDATE'); // outside the phase
      await move(S.PENDING_APPROVAL, S.APPROVED, '13:00');
      expect(await findLastInspectorUserId(prisma, tenant.id, report.id)).toBe(
        'attachment-worker',
      );

      // Reopened with nothing new done: still the inspector from before the revision.
      await move(S.APPROVED, S.IN_INSPECTION, '14:00');
      expect(await findLastInspectorUserId(prisma, tenant.id, report.id)).toBe(
        'attachment-worker',
      );

      // New work in the revision takes over.
      await act('revision-worker', '15:00', 'SerialNumber', 'UPDATE');
      expect(await findLastInspectorUserId(prisma, tenant.id, report.id)).toBe(
        'revision-worker',
      );

      // A revision exported "as of" its own time sees the inspector as it stood then.
      expect(
        await findLastInspectorUserId(
          prisma,
          tenant.id,
          report.id,
          at('10:45'),
        ),
      ).toBe('serial-worker');
      expect(
        await findLastInspectorUserId(
          prisma,
          tenant.id,
          report.id,
          at('14:30'),
        ),
      ).toBe('attachment-worker');
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
