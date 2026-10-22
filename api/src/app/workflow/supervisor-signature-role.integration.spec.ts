/**
 * Integration test — the `supervisorSignature` SYSTEM role is applied at APPROVAL.
 *
 * Runs under `test-integration` against the dedicated test Postgres. Real workflow +
 * revision services, real persistence. Proves, for a template whose definition binds the
 * `supervisorSignature` role (like `inspectorSignature`, a mandatory system role):
 *   - approving freezes a pointer to the APPROVER's current account signature;
 *   - an approver with no registered signature is refused with 403 SIGNATURE_REQUIRED and
 *     the report stays PENDING_APPROVAL (the portal shows the "register your signature" gate);
 *   - a re-approval after a reopen freezes the NEW approver's signature (latest wins);
 *   - a template that does not bind the role never blocks on, nor freezes, a signature.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { GateDefinition } from './approval-gate';
import { SUPERVISOR_SIGNATURE_SLOT } from '../signatures/signature-slots';
import { seedTenant, resetInspectionDomain } from '../../../test/seed-helpers';

const BASE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition & { export: { global: Record<string, unknown>[] } };

const withRole = (): unknown => ({
  ...BASE,
  export: {
    ...BASE.export,
    global: [
      ...BASE.export.global,
      { token: '{{supSig}}', computed: SUPERVISOR_SIGNATURE_SLOT },
    ],
  },
});

const REQUIRED_ITEM_KEYS = BASE.fields
  .filter((f) => f.scope === 'item' && f.required === true)
  .map((f) => f.key);

describe('supervisorSignature system role at approval [integration]', () => {
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

  // Users FK-block the tenant reset and every integration spec shares one database.
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

  async function seedPending(definitionJson: unknown) {
    const tenant = await seedTenant(prisma);
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        status: 'ACTIVE',
        fileKey: `${tenant.id}/DRILL_PIPE_REPORT/1`,
        hash: 'hash-sup',
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: definitionJson as never,
      },
    });
    const report = await prisma.inspectionReport.create({
      data: {
        tenantId: tenant.id,
        poNumber: 'PO-SUP',
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        templateHash: 'hash-sup',
        status: InspectionReportStatus.PENDING_APPROVAL,
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

  let n = 0;
  function seedUser(tenantId: string, role: UserRole, signatureKey?: string) {
    n += 1;
    return prisma.user.create({
      data: {
        tenantId,
        email: `u${n}-${Date.now()}@example.test`,
        role,
        passwordHash: 'x',
        ...(signatureKey
          ? {
              signature: {
                create: { tenantId, storageKey: signatureKey, hash: `h-${signatureKey}` },
              },
            }
          : {}),
      },
    });
  }

  const actor = (u: { id: string; tenantId: string }, role: UserRole) => ({
    id: u.id,
    tenantId: u.tenantId,
    role,
  });

  it('freezes the approver’s current account signature on approval', async () => {
    const { tenant, report } = await seedPending(withRole());
    const sup = await seedUser(tenant.id, UserRole.SUPERVISOR, `${tenant.id}/sup/1`);

    await workflow.transition(
      actor(sup, UserRole.SUPERVISOR),
      report.id,
      InspectionReportStatus.APPROVED,
      report.version,
    );

    const rows = await prisma.reportSignature.findMany({
      where: { inspectionReportId: report.id, slot: SUPERVISOR_SIGNATURE_SLOT },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      signedById: sup.id,
      storageKey: `${tenant.id}/sup/1`,
      hash: `h-${tenant.id}/sup/1`,
    });
  });

  it('refuses approval with SIGNATURE_REQUIRED when the approver has no signature', async () => {
    const { tenant, report } = await seedPending(withRole());
    const sup = await seedUser(tenant.id, UserRole.SUPERVISOR);

    const err = await workflow
      .transition(
        actor(sup, UserRole.SUPERVISOR),
        report.id,
        InspectionReportStatus.APPROVED,
        report.version,
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'SIGNATURE_REQUIRED',
    });
    const after = await prisma.inspectionReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(after.status).toBe(InspectionReportStatus.PENDING_APPROVAL);
    expect(await prisma.reportSignature.count()).toBe(0);
  });

  it('a re-approval after a reopen freezes the NEW approver’s signature', async () => {
    const { tenant, report } = await seedPending(withRole());
    const supA = await seedUser(tenant.id, UserRole.SUPERVISOR, `${tenant.id}/a/1`);
    const supB = await seedUser(tenant.id, UserRole.SUPERVISOR, `${tenant.id}/b/1`);
    const insp = await seedUser(tenant.id, UserRole.INSPECTOR, `${tenant.id}/i/1`);

    let r = await workflow.transition(
      actor(supA, UserRole.SUPERVISOR),
      report.id,
      InspectionReportStatus.APPROVED,
      report.version,
    );
    r = await workflow.transition(
      actor(supA, UserRole.SUPERVISOR),
      report.id,
      InspectionReportStatus.IN_INSPECTION,
      r.version,
      'rework needed',
    );
    r = await workflow.transition(
      actor(insp, UserRole.INSPECTOR),
      report.id,
      InspectionReportStatus.PENDING_APPROVAL,
      r.version,
    );
    await workflow.transition(
      actor(supB, UserRole.SUPERVISOR),
      report.id,
      InspectionReportStatus.APPROVED,
      r.version,
    );

    const latest = await prisma.reportSignature.findFirstOrThrow({
      where: { inspectionReportId: report.id, slot: SUPERVISOR_SIGNATURE_SLOT },
      orderBy: { signedAt: 'desc' },
    });
    expect(latest.signedById).toBe(supB.id);
    expect(latest.storageKey).toBe(`${tenant.id}/b/1`);
  });

  it('never blocks on, nor freezes, a signature when the template does not bind the role', async () => {
    const { tenant, report } = await seedPending(BASE);
    const sup = await seedUser(tenant.id, UserRole.SUPERVISOR);

    const res = await workflow.transition(
      actor(sup, UserRole.SUPERVISOR),
      report.id,
      InspectionReportStatus.APPROVED,
      report.version,
    );

    expect(res.status).toBe(InspectionReportStatus.APPROVED);
    expect(
      await prisma.reportSignature.count({
        where: { inspectionReportId: report.id, slot: SUPERVISOR_SIGNATURE_SLOT },
      }),
    ).toBe(0);
  });
});
