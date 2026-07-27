/**
 * Characterization — the revision-snapshot engine (RevisionService), as driven by
 * the workflow transition path. Runs under the `test-integration` target against
 * the dedicated test Postgres (docker-compose.test.yml → ots_test on 5433). Real
 * RevisionService, real InspectionReportWorkflowService, real persistence.
 *
 * BASELINE we are locking: snapshots fire on FIRST approval and on REOPEN, and NOT
 * on a re-approval after reopen. This is foundation behavior that must stay
 * unchanged through V2, so this is STABLE/UNTAGGED — same convention as the
 * create-path and workflow-transition specs: NOT "known bug", no flip tags, nothing
 * in docs/internal/sync-risks.md.
 *
 * FIRING CONDITION (traced from inspection-report-workflow.service.ts):
 *  - Snapshot writes happen only inside transition()'s transaction, at two sites
 *    that both call revisionService.createInspectionReportSnapshot:
 *      * isFirstApproval (:390-392) = toStatus === APPROVED && report.revisionNumber === 0
 *      * isReopen        (:394-399) = (APPROVED → IN_INSPECTION)
 *                                     || (CLOSED → APPROVED | IN_INSPECTION)
 *  - createInspectionReportSnapshot (revision.service.ts:19) writes one
 *    InspectionReportRevision row (revisionNumber = prev + 1) and bumps the parent
 *    report's revisionNumber. Because the FIRST-approval guard keys off
 *    revisionNumber === 0, once any snapshot exists a later APPROVED no longer fires
 *    isFirstApproval — this is the "first-only" behavior test 2 pins.
 *  - report.create()/createReport() do NOT snapshot.
 *
 * SCOPE: only the snapshot firing conditions + captured shape. We reuse the shared
 * seed helpers and drive real transitions, crossing the PENDING_APPROVAL gate with
 * a fully-populated serial (seedApprovableSerial).
 */
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { RevisionService } from './revision.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import {
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  seedApprovableSerial,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

describe('Revision-snapshot engine (foundation baseline) [integration]', () => {
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

    // REAL RevisionService this time — its output is exactly what we characterize.
    const revisionService = new RevisionService(prisma);
    workflow = new InspectionReportWorkflowService(prisma, revisionService);
    reports = new InspectionReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  /** Create a real DRAFT report (live create path) bound to DRILL_PIPE_REPORT. */
  async function newDraftReport() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    const template = await seedActiveTemplate(
      prisma,
      tenant.id,
      'DRILL_PIPE_REPORT',
    );
    const report = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-REV',
    });
    return { tenant, customer, template, report };
  }

  /**
   * Drive DRAFT → IN_INSPECTION as ADMIN and seed a gate-passing serial, leaving
   * the report one legal step (→ PENDING_APPROVAL) from the approval path.
   * Returns the tenant, the report id, and its current version.
   */
  async function driveToInInspectionWithSerial() {
    const { tenant, report } = await newDraftReport();
    const a = admin(tenant.id);
    let r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.RECEIVED,
      report.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.READY_FOR_CLEANING,
      r.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.READY_FOR_INSPECTION,
      r.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.IN_INSPECTION,
      r.version,
    );
    await seedApprovableSerial(prisma, tenant.id, report.id);
    return { tenant, reportId: report.id, version: r.version };
  }

  /** IN_INSPECTION → PENDING_APPROVAL → APPROVED. Returns the version at APPROVED. */
  async function requestAndApprove(
    tenantId: string,
    reportId: string,
    version: number,
    approvalReason?: string,
  ) {
    const a = admin(tenantId);
    const pending = await workflow.transition(
      a,
      reportId,
      InspectionReportStatus.PENDING_APPROVAL,
      version,
    );
    const approved = await workflow.transition(
      a,
      reportId,
      InspectionReportStatus.APPROVED,
      pending.version,
      approvalReason,
    );
    return approved.version;
  }

  it('fires exactly one snapshot on first approval and captures the report state', async () => {
    const { tenant, reportId, version } = await driveToInInspectionWithSerial();

    // Approve WITHOUT a reason — reason is not required into APPROVED, so the engine
    // falls back to its default 'Initial approval' (service.ts:466). Pinned below.
    await requestAndApprove(tenant.id, reportId, version);

    const revisions = await prisma.inspectionReportRevision.findMany({
      where: { inspectionReportId: reportId },
      orderBy: { revisionNumber: 'asc' },
    });
    expect(revisions).toHaveLength(1);

    const rev = revisions[0];
    expect(rev.revisionNumber).toBe(1);
    expect(rev.revisionReason).toBe('Initial approval');
    expect(rev.revisedById).toBe('user-admin');
    expect(rev.tenantId).toBe(tenant.id);

    // The parent report's revisionNumber is bumped to match (note: this bump
    // happens inside the snapshot AFTER transition() fetched its return value, so
    // we re-read from the DB rather than trusting the returned object).
    const parent = await prisma.inspectionReport.findUnique({
      where: { id: reportId },
    });
    expect(parent?.revisionNumber).toBe(1);

    // Snapshot contents: header reflects the NEW (APPROVED) status, template binding
    // is captured, the seeded serial is present with its extracted disposition, and
    // the triggering transition is in the log (the log is written before the snapshot).
    const snap = rev.snapshotJson as any;
    expect(snap.header.id).toBe(reportId);
    expect(snap.header.poNumber).toBe('PO-REV');
    expect(snap.header.status).toBe(InspectionReportStatus.APPROVED);
    expect(snap.template.key).toBe('DRILL_PIPE_REPORT');
    expect(snap.template.version).toBe(1);
    expect(snap.template.hash).toBe('hash-DRILL_PIPE_REPORT');
    expect(snap.serialNumbers).toHaveLength(1);
    expect(snap.serialNumbers[0].serial).toBe('SN-001');
    expect(snap.serialNumbers[0].disposition).toBe('ACCEPT');
    expect(
      snap.transitionLogs.some(
        (l: any) => l.toStatus === InspectionReportStatus.APPROVED,
      ),
    ).toBe(true);
  });

  it('does NOT fire a new snapshot on a re-approval after reopen (the "first-only" guard keys off revisionNumber === 0)', async () => {
    const { tenant, reportId, version } = await driveToInInspectionWithSerial();

    // 1st approval → snapshot rev 1 (revisionNumber 0 → 1).
    const vApproved = await requestAndApprove(tenant.id, reportId, version);

    // Reopen APPROVED → IN_INSPECTION (reason required) → snapshot rev 2.
    const reopened = await workflow.transition(
      admin(tenant.id),
      reportId,
      InspectionReportStatus.IN_INSPECTION,
      vApproved,
      'reopening for rework',
    );

    // Re-approve: the report is now at revisionNumber 2, so isFirstApproval is
    // FALSE and this APPROVED transition writes NO snapshot. The serial still
    // satisfies the gate, so the path itself is legal.
    await requestAndApprove(tenant.id, reportId, reopened.version);

    const revisions = await prisma.inspectionReportRevision.findMany({
      where: { inspectionReportId: reportId },
      orderBy: { revisionNumber: 'asc' },
    });

    // Two snapshots total: rev 1 (first approval) + rev 2 (reopen). The second
    // approval added nothing — this is the subtle behavior a refactor is most
    // likely to perturb, so it is pinned explicitly.
    expect(revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(revisions[1].revisionReason).toBe('reopening for rework');

    const parent = await prisma.inspectionReport.findUnique({
      where: { id: reportId },
    });
    expect(parent?.revisionNumber).toBe(2);
    expect(parent?.status).toBe(InspectionReportStatus.APPROVED);
  });

  it('fires a snapshot on reopen (APPROVED → IN_INSPECTION) capturing the reopened state and reason', async () => {
    const { tenant, reportId, version } = await driveToInInspectionWithSerial();
    const vApproved = await requestAndApprove(tenant.id, reportId, version);

    // Reopen writes a second snapshot per isReopen (service.ts:394-399, 470-478).
    await workflow.transition(
      admin(tenant.id),
      reportId,
      InspectionReportStatus.IN_INSPECTION,
      vApproved,
      'customer disputed result',
    );

    const revisions = await prisma.inspectionReportRevision.findMany({
      where: { inspectionReportId: reportId },
      orderBy: { revisionNumber: 'asc' },
    });
    expect(revisions).toHaveLength(2);

    const reopenRev = revisions[1];
    expect(reopenRev.revisionNumber).toBe(2);
    expect(reopenRev.revisionReason).toBe('customer disputed result');
    // Header status is the post-transition status: IN_INSPECTION.
    expect((reopenRev.snapshotJson as any).header.status).toBe(
      InspectionReportStatus.IN_INSPECTION,
    );
  });
});
