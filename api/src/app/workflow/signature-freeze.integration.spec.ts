/**
 * Integration test — the inspector signature is frozen at SUBMISSION.
 *
 * Runs under `test-integration` against the dedicated test Postgres. Real workflow +
 * revision services, real persistence. Proves:
 *   - submitting IN_INSPECTION → PENDING_APPROVAL freezes a pointer (key + hash, no copy)
 *     to the submitter's CURRENT signature;
 *   - replacing the account signature afterwards does NOT move the frozen pointer;
 *   - a submitter with no signature freezes nothing and the transition still succeeds
 *     (the gate lives at the HTTP layer, not here);
 *   - the approval snapshot embeds the frozen pointer, and omits `signatures` entirely
 *     when none was frozen (legacy snapshot shape stays byte-identical).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { GateDefinition } from './approval-gate';
import { INSPECTOR_SIGNATURE_SLOT } from '../signatures/freeze-signature';
import { seedTenant, resetInspectionDomain } from '../../../test/seed-helpers';

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition;

const REQUIRED_ITEM_KEYS = DEFINITION.fields
  .filter((f) => f.scope === 'item' && f.required === true)
  .map((f) => f.key);

describe('inspector signature freeze at submission [integration]', () => {
  let prisma: PrismaService;
  let workflow: InspectionReportWorkflowService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    workflow = new InspectionReportWorkflowService(
      prisma,
      new RevisionService(prisma),
    );
  });

  // Users FK-block `resetInspectionDomain`'s tenant delete, and every integration spec
  // shares one database — so clear them on the way in AND out so later suites stay clean.
  const clearAll = async () => {
    await prisma.userSignature.deleteMany();
    await prisma.user.deleteMany();
    await resetInspectionDomain(prisma);
  };

  afterAll(async () => {
    await clearAll();
    await prisma?.onModuleDestroy();
  });

  beforeEach(clearAll);

  function fullData(): Record<string, Record<string, unknown>> {
    const d: Record<string, Record<string, unknown>> = {};
    for (const key of REQUIRED_ITEM_KEYS) {
      const [group, field] = key.split('.');
      d[group] ??= {};
      d[group][field] = 1;
    }
    d.body.emiResult = 'PASS';
    return d;
  }

  /** A tenant with a gate-passing report sitting IN_INSPECTION. */
  async function seedInInspection() {
    const tenant = await seedTenant(prisma);
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        status: 'ACTIVE',
        fileKey: `${tenant.id}/DRILL_PIPE_REPORT/1`,
        hash: 'hash-sig',
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: DEFINITION as never,
      },
    });
    const report = await prisma.inspectionReport.create({
      data: {
        tenantId: tenant.id,
        poNumber: 'PO-SIG',
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        templateHash: 'hash-sig',
        status: InspectionReportStatus.IN_INSPECTION,
      },
    });
    await prisma.serialNumber.create({
      data: {
        tenantId: tenant.id,
        inspectionReportId: report.id,
        serial: 'SN-1',
        inspectionData: fullData() as never,
      },
    });
    return { tenant, report };
  }

  function seedInspector(tenantId: string, withSignature: boolean) {
    return prisma.user.create({
      data: {
        tenantId,
        email: `insp-${Date.now()}@example.test`,
        role: UserRole.INSPECTOR,
        passwordHash: 'x',
        ...(withSignature
          ? {
              signature: {
                create: {
                  tenantId,
                  storageKey: `${tenantId}/insp/obj-1`,
                  hash: 'hash-obj-1',
                },
              },
            }
          : {}),
      },
    });
  }

  const submit = (
    inspector: { id: string; tenantId: string },
    report: { id: string; version: number },
  ) =>
    workflow.transition(
      { id: inspector.id, tenantId: inspector.tenantId, role: UserRole.INSPECTOR },
      report.id,
      InspectionReportStatus.PENDING_APPROVAL,
      report.version,
    );

  it('freezes a pointer to the current signature when the inspector submits', async () => {
    const { tenant, report } = await seedInInspection();
    const inspector = await seedInspector(tenant.id, true);

    await submit(inspector, report);

    const frozen = await prisma.reportSignature.findMany({
      where: { inspectionReportId: report.id },
    });
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({
      slot: INSPECTOR_SIGNATURE_SLOT,
      signedById: inspector.id,
      storageKey: `${tenant.id}/insp/obj-1`,
      hash: 'hash-obj-1',
    });
  });

  it('keeps the frozen pointer when the account signature is replaced later', async () => {
    const { tenant, report } = await seedInInspection();
    const inspector = await seedInspector(tenant.id, true);
    await submit(inspector, report);

    await prisma.userSignature.update({
      where: { userId: inspector.id },
      data: { storageKey: `${tenant.id}/insp/obj-2`, hash: 'hash-obj-2' },
    });

    const frozen = await prisma.reportSignature.findFirstOrThrow({
      where: { inspectionReportId: report.id },
    });
    expect(frozen.storageKey).toBe(`${tenant.id}/insp/obj-1`);
    expect(frozen.hash).toBe('hash-obj-1');
  });

  it('freezes nothing — and still transitions — for a submitter without a signature', async () => {
    const { tenant, report } = await seedInInspection();
    const inspector = await seedInspector(tenant.id, false);

    const result = await submit(inspector, report);

    expect(result.status).toBe(InspectionReportStatus.PENDING_APPROVAL);
    expect(
      await prisma.reportSignature.count({
        where: { inspectionReportId: report.id },
      }),
    ).toBe(0);
  });

  it('embeds the frozen pointer in the approval snapshot', async () => {
    const { tenant, report } = await seedInInspection();
    const inspector = await seedInspector(tenant.id, true);
    const pending = await submit(inspector, report);

    await workflow.transition(
      { id: 'user-admin', tenantId: tenant.id, role: UserRole.ADMIN },
      report.id,
      InspectionReportStatus.APPROVED,
      pending.version,
    );

    const revision = await prisma.inspectionReportRevision.findFirstOrThrow({
      where: { inspectionReportId: report.id },
      orderBy: { revisionNumber: 'desc' },
    });
    const snapshot = revision.snapshotJson as {
      signatures?: Record<string, { storageKey: string; hash: string }>;
    };
    expect(snapshot.signatures?.[INSPECTOR_SIGNATURE_SLOT]).toMatchObject({
      storageKey: `${tenant.id}/insp/obj-1`,
      hash: 'hash-obj-1',
    });
  });

  it('omits `signatures` from the snapshot when nothing was frozen', async () => {
    const { tenant, report } = await seedInInspection();
    const inspector = await seedInspector(tenant.id, false);
    const pending = await submit(inspector, report);

    await workflow.transition(
      { id: 'user-admin', tenantId: tenant.id, role: UserRole.ADMIN },
      report.id,
      InspectionReportStatus.APPROVED,
      pending.version,
    );

    const revision = await prisma.inspectionReportRevision.findFirstOrThrow({
      where: { inspectionReportId: report.id },
    });
    expect(revision.snapshotJson).not.toHaveProperty('signatures');
  });
});
