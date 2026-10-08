/**
 * Integration test — per-report template signature FIELDS (`type: 'signature'`).
 *
 * Runs under `test-integration` against the dedicated test Postgres, with the real workflow,
 * revision and signatures services. Proves the lifecycle the product rules describe:
 *   - approving applies the approver's ACCOUNT signature to every SUPERVISOR field;
 *   - a required SUPERVISOR field refuses an approval by someone with no account signature
 *     (403 SIGNATURE_REQUIRED) — a non-required one just stays blank;
 *   - a CUSTOMER draws theirs after approval; a second attempt (even by a colleague of the
 *     same customer) is ALREADY_SIGNED, and a user of another customer cannot see the report;
 *   - the "pending" list shrinks as customer fields are signed;
 *   - REOPENING bumps the revision, so every field reads unsigned again (rows are kept as
 *     history), and a re-approval signs the supervisor field afresh.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InspectionReportStatus as S, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { GateDefinition } from '../workflow/approval-gate';
import { SignaturesService, SignatureActor } from './signatures.service';
import { AttachmentStorage } from '../storage/attachment-storage.types';
import {
  seedCustomer,
  seedTenant,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

const BASE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition;

const REQUIRED_ITEM_KEYS = BASE.fields
  .filter((f) => f.scope === 'item' && f.required === true)
  .map((f) => f.key);

function makePng(): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(600, 8);
  ihdr.writeUInt32BE(200, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]),
  ]);
}

/** In-memory signature storage — the service only needs put/get/delete + key building. */
function memoryStorage(): AttachmentStorage {
  const objects = new Map<string, Buffer>();
  return {
    buildSignatureKey: (ref: {
      tenantId: string;
      userId: string;
      objectId: string;
    }) => `${ref.tenantId}/signatures/${ref.userId}/${ref.objectId}`,
    putSignature: (key: string, buf: Buffer) => {
      objects.set(key, buf);
      return Promise.resolve();
    },
    getSignature: (key: string) => Promise.resolve(objects.get(key) ?? null),
    deleteSignature: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
  } as unknown as AttachmentStorage;
}

describe('template signature fields [integration]', () => {
  let prisma: PrismaService;
  let workflow: InspectionReportWorkflowService;
  let signatures: SignaturesService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    workflow = new InspectionReportWorkflowService(
      prisma,
      new RevisionService(prisma),
    );
    signatures = new SignaturesService(prisma, memoryStorage());
  });

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

  const sigField = (
    key: string,
    signer: 'CUSTOMER' | 'SUPERVISOR',
    required: boolean,
  ) => ({
    key,
    label: key,
    type: 'signature',
    scope: 'header',
    required,
    signer,
  });

  /** A tenant, a customer and an IN_INSPECTION report whose template carries signature fields. */
  async function seed(opts: { supervisorFieldRequired: boolean }) {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    const definition = {
      ...BASE,
      fields: [
        ...BASE.fields,
        sigField('custSig', 'CUSTOMER', true),
        sigField('supSig', 'SUPERVISOR', opts.supervisorFieldRequired),
      ],
    };
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        status: 'ACTIVE',
        fileKey: `${tenant.id}/DRILL_PIPE_REPORT/1`,
        hash: 'hash-fsig',
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: definition as never,
      },
    });
    const report = await prisma.inspectionReport.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        poNumber: 'PO-FSIG',
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        templateHash: 'hash-fsig',
        status: S.IN_INSPECTION,
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
    return { tenant, customer, report };
  }

  let seq = 0;
  function seedUser(
    tenantId: string,
    role: UserRole,
    opts: { signature?: boolean; customerId?: string } = {},
  ) {
    seq += 1;
    return prisma.user.create({
      data: {
        tenantId,
        email: `u${seq}-${Date.now()}@example.test`,
        role,
        passwordHash: 'x',
        customerId: opts.customerId ?? null,
        ...(opts.signature
          ? {
              signature: {
                create: {
                  tenantId,
                  storageKey: `${tenantId}/acct/${seq}`,
                  hash: `hash-acct-${seq}`,
                },
              },
            }
          : {}),
      },
    });
  }

  const actor = (u: {
    id: string;
    tenantId: string;
    role: UserRole;
    customerId: string | null;
  }): SignatureActor => ({
    id: u.id,
    tenantId: u.tenantId,
    role: u.role,
    customerId: u.customerId,
  });

  const move = async (
    u: { id: string; tenantId: string; role: UserRole },
    reportId: string,
    to: S,
    reason?: string,
  ) => {
    const current = await prisma.inspectionReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    return workflow.transition(
      { id: u.id, tenantId: u.tenantId, role: u.role },
      reportId,
      to,
      current.version,
      reason,
    );
  };

  const stateOf = async (
    u: Parameters<typeof actor>[0],
    reportId: string,
    key: string,
  ) =>
    (await signatures.getFieldStates(actor(u), reportId)).fields.find(
      (f) => f.key === key,
    )!;

  /** Inspector submits, supervisor approves. */
  async function approve(
    tenantId: string,
    reportId: string,
    supervisor: { id: string; tenantId: string; role: UserRole },
  ) {
    const inspector = await seedUser(tenantId, UserRole.INSPECTOR, {
      signature: true,
    });
    await move(inspector, reportId, S.PENDING_APPROVAL);
    await move(supervisor, reportId, S.APPROVED);
  }

  it("applies the approver's account signature to SUPERVISOR fields at approval", async () => {
    const { tenant, customer, report } = await seed({
      supervisorFieldRequired: true,
    });
    const supervisor = await seedUser(tenant.id, UserRole.SUPERVISOR, {
      signature: true,
    });
    const cust = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: customer.id,
    });

    await approve(tenant.id, report.id, supervisor);

    const states = await signatures.getFieldStates(actor(cust), report.id);
    expect(states.signable).toBe(true);
    expect(states.revisionNumber).toBe(1);
    const sup = states.fields.find((f) => f.key === 'supSig')!;
    expect(sup.signed).toBe(true);
    expect(sup.signedByName).toBe(supervisor.email);
    // The customer's own field is NOT touched by the approval.
    expect(states.fields.find((f) => f.key === 'custSig')!.signed).toBe(false);

    const row = await prisma.reportSignature.findFirstOrThrow({
      where: { inspectionReportId: report.id, slot: 'field:supSig' },
    });
    expect(row).toMatchObject({ signedById: supervisor.id, revisionNumber: 1 });
  });

  it('refuses an approval without an account signature when a SUPERVISOR field is required', async () => {
    const { tenant, report } = await seed({ supervisorFieldRequired: true });
    const bare = await seedUser(tenant.id, UserRole.SUPERVISOR);
    const inspector = await seedUser(tenant.id, UserRole.INSPECTOR, {
      signature: true,
    });
    await move(inspector, report.id, S.PENDING_APPROVAL);

    await expect(move(bare, report.id, S.APPROVED)).rejects.toMatchObject({
      response: { code: 'SIGNATURE_REQUIRED' },
    });
    const after = await prisma.inspectionReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(after.status).toBe(S.PENDING_APPROVAL);
  });

  it('lets an unsigned approver approve when the SUPERVISOR field is not required (cell stays blank)', async () => {
    const { tenant, customer, report } = await seed({
      supervisorFieldRequired: false,
    });
    const bare = await seedUser(tenant.id, UserRole.SUPERVISOR);
    const cust = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: customer.id,
    });

    await approve(tenant.id, report.id, bare);

    expect((await stateOf(cust, report.id, 'supSig')).signed).toBe(false);
  });

  it('lets the customer sign once approved — once per revision, by any user of that customer', async () => {
    const { tenant, customer, report } = await seed({
      supervisorFieldRequired: true,
    });
    const supervisor = await seedUser(tenant.id, UserRole.SUPERVISOR, {
      signature: true,
    });
    const alice = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: customer.id,
    });
    const bob = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: customer.id,
    });

    // Not signable before approval.
    await expect(
      signatures.signCustomerField(
        actor(alice),
        report.id,
        'custSig',
        makePng(),
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_SIGNABLE' } });

    await approve(tenant.id, report.id, supervisor);
    expect(await signatures.listPendingForCustomer(actor(bob))).toMatchObject([
      { reportId: report.id, fields: [{ key: 'custSig', required: true }] },
    ]);

    const after = await signatures.signCustomerField(
      actor(alice),
      report.id,
      'custSig',
      makePng(),
    );
    expect(after.fields.find((f) => f.key === 'custSig')).toMatchObject({
      signed: true,
      signedByName: alice.email,
    });

    // A colleague cannot sign it again, and nothing is left pending.
    await expect(
      signatures.signCustomerField(actor(bob), report.id, 'custSig', makePng()),
    ).rejects.toMatchObject({ response: { code: 'ALREADY_SIGNED' } });
    expect(await signatures.listPendingForCustomer(actor(bob))).toEqual([]);

    // A SUPERVISOR-declared field is not the customer's to sign.
    await expect(
      signatures.signCustomerField(actor(bob), report.id, 'supSig', makePng()),
    ).rejects.toThrow(/No such customer signature field/);
  });

  it('hides the report from a user of another customer', async () => {
    const { tenant, report } = await seed({ supervisorFieldRequired: false });
    const other = await prisma.customer.create({
      data: { tenantId: tenant.id, name: 'Other Co', code: 'OTHER' },
    });
    const stranger = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: other.id,
    });

    await expect(
      signatures.getFieldStates(actor(stranger), report.id),
    ).rejects.toThrow();
    expect(await signatures.listPendingForCustomer(actor(stranger))).toEqual(
      [],
    );
  });

  it('clears every field on reopen (history kept) and re-signs the supervisor on re-approval', async () => {
    const { tenant, customer, report } = await seed({
      supervisorFieldRequired: true,
    });
    const supervisor = await seedUser(tenant.id, UserRole.SUPERVISOR, {
      signature: true,
    });
    const cust = await seedUser(tenant.id, UserRole.CUSTOMER, {
      customerId: customer.id,
    });
    await approve(tenant.id, report.id, supervisor);
    await signatures.signCustomerField(
      actor(cust),
      report.id,
      'custSig',
      makePng(),
    );

    // Reopen → revision bumps; both fields read unsigned, nothing is deleted.
    const admin = await seedUser(tenant.id, UserRole.ADMIN);
    await move(admin, report.id, S.IN_INSPECTION, 'Correction needed');
    const reopened = await signatures.getFieldStates(actor(cust), report.id);
    expect(reopened.revisionNumber).toBe(2);
    expect(reopened.signable).toBe(false);
    expect(reopened.fields.every((f) => !f.signed)).toBe(true);
    expect(
      await prisma.reportSignature.count({
        where: {
          inspectionReportId: report.id,
          slot: { in: ['field:custSig', 'field:supSig'] },
        },
      }),
    ).toBe(2);

    // Back through approval: the supervisor is applied afresh at the NEW revision; the
    // customer must sign again.
    const inspector = await seedUser(tenant.id, UserRole.INSPECTOR, {
      signature: true,
    });
    await move(inspector, report.id, S.PENDING_APPROVAL);
    await move(supervisor, report.id, S.APPROVED);

    const again = await signatures.getFieldStates(actor(cust), report.id);
    expect(again.signable).toBe(true);
    expect(again.fields.find((f) => f.key === 'supSig')!.signed).toBe(true);
    expect(again.fields.find((f) => f.key === 'custSig')!.signed).toBe(false);
    expect(await signatures.listPendingForCustomer(actor(cust))).toHaveLength(
      1,
    );

    await signatures.signCustomerField(
      actor(cust),
      report.id,
      'custSig',
      makePng(),
    );
    expect(await signatures.listPendingForCustomer(actor(cust))).toEqual([]);
  });
});
