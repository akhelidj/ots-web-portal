/**
 * Integration test — the export gate for template signature FIELDS.
 *
 * Real ExportService (real template workbook) + workflow + signatures services against the
 * test Postgres. Proves:
 *   - a customer `signature` field (its presence in the template is the opt-in — a customer
 *     signature is always required) that is still unsigned blocks the export of the report's
 *     CURRENT revision with a structured 409 `SIGNATURE_PENDING` naming who has to sign;
 *   - once it is signed the same export succeeds;
 *   - an OLDER revision is never blocked, even though the current one is.
 */
import { ConflictException } from '@nestjs/common';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InspectionReportStatus as S, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import { SignaturesService } from '../signatures/signatures.service';
import { AttachmentStorage } from '../storage/attachment-storage.types';
import { LocalAttachmentStorage } from '../storage/local-attachment.storage';
import {
  seedTenant,
  seedCustomer,
  seedRealDrillPipeTemplate,
  seedApprovableSerial,
  resetInspectionDomain,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

function makePng(): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(600, 8);
  ihdr.writeUInt32BE(200, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);
}

/**
 * The real local storage (the export reads the template workbook through it), with the
 * signature objects redirected to memory so the test leaves nothing on disk.
 */
function memoryStorage(): AttachmentStorage {
  const objects = new Map<string, Buffer>();
  return Object.assign(Object.create(new LocalAttachmentStorage()), {
    buildSignatureKey: (ref: { tenantId: string; userId: string; objectId: string }) =>
      `${ref.tenantId}/signatures/${ref.userId}/${ref.objectId}`,
    putSignature: (key: string, buf: Buffer) => {
      objects.set(key, buf);
      return Promise.resolve();
    },
    getSignature: (key: string) => Promise.resolve(objects.get(key) ?? null),
    deleteSignature: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
  }) as AttachmentStorage;
}

/** Runs the shipped data migration (the same SQL `prisma migrate deploy` applies). */
const SUPERVISOR_ROLE_MIGRATION_SQL = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20261014120000_supervisor_signature_role/migration.sql',
  ),
  'utf8',
);
describe('export gate for signature fields [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;
  let signatures: SignaturesService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const storage = memoryStorage();
    const revisionService = new RevisionService(prisma);
    exportService = new ExportService(prisma, revisionService, storage);
    workflow = new InspectionReportWorkflowService(prisma, revisionService);
    reports = new InspectionReportsService(prisma, makeFilesServiceStub());
    signatures = new SignaturesService(prisma, storage);
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

  const runSupervisorRoleMigration = () =>
    prisma.$executeRawUnsafe(SUPERVISOR_ROLE_MIGRATION_SQL);

  /** An APPROVED report whose template also declares a CUSTOMER signature field. */
  async function approvedWithCustomerField() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    const template = await seedRealDrillPipeTemplate(prisma, tenant.id);
    const created = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-SIGX',
      templateKey: 'DRILL_PIPE_REPORT',
    });
    const admin = { id: 'user-admin', tenantId: tenant.id, role: UserRole.ADMIN };

    let r = await workflow.transition(admin, created.id, S.RECEIVED, created.version);
    r = await workflow.transition(admin, created.id, S.READY_FOR_CLEANING, r.version);
    r = await workflow.transition(admin, created.id, S.READY_FOR_INSPECTION, r.version);
    r = await workflow.transition(admin, created.id, S.IN_INSPECTION, r.version);
    await seedApprovableSerial(prisma, tenant.id, created.id, 'SN-001');
    const pending = await workflow.transition(admin, created.id, S.PENDING_APPROVAL, r.version);
    await workflow.transition(admin, created.id, S.APPROVED, pending.version);

    // Declare the signature field on the (already pinned) template after approval — the
    // export reads the definition live, which is what is under test here.
    const def = template.definitionJson as unknown as {
      fields: unknown[];
      export?: { global?: unknown[] };
    };
    await prisma.template.update({
      where: { id: template.id },
      data: {
        definitionJson: {
          ...def,
          fields: [
            ...def.fields,
            {
              key: 'custSig',
              label: 'Customer approval',
              type: 'signature',
              scope: 'header',
              required: true,
              signer: 'CUSTOMER',
            },
          ],
          export: {
            ...def.export,
            global: [
              ...(def.export?.global ?? []),
              { token: '{{custSig}}', signature: 'field:custSig' },
            ],
          },
        } as never,
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `cust-${Date.now()}@example.test`,
        role: UserRole.CUSTOMER,
        passwordHash: 'x',
        customerId: customer.id,
      },
    });
    return { tenant, customer, reportId: created.id, admin, user };
  }

  const exporter = (tenantId: string) => ({
    tenantId,
    role: UserRole.ADMIN,
    customerId: null,
  });

  it('blocks the current revision with SIGNATURE_PENDING until the customer field is signed', async () => {
    const { tenant, reportId, user } = await approvedWithCustomerField();

    const err = await exportService
      .exportInspectionReport(exporter(tenant.id), reportId)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'SIGNATURE_PENDING',
      pending: [{ key: 'custSig', label: 'Customer approval', signer: 'CUSTOMER' }],
    });

    await signatures.signCustomerField(
      {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        customerId: user.customerId,
      },
      reportId,
      'custSig',
      makePng(),
    );
    const res = await exportService.exportInspectionReport(exporter(tenant.id), reportId);
    expect(Buffer.isBuffer(res.buffer)).toBe(true);
  });

  it('does not block an older revision while the current one is still unsigned', async () => {
    const { tenant, reportId, admin, user } = await approvedWithCustomerField();
    await signatures.signCustomerField(
      {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        customerId: user.customerId,
      },
      reportId,
      'custSig',
      makePng(),
    );

    // Reopen (revision 1 → 2): the customer's signature no longer counts for revision 2.
    const current = await prisma.inspectionReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    const reopened = await workflow.transition(
      admin,
      reportId,
      S.IN_INSPECTION,
      current.version,
      'Correction needed',
    );
    const pending = await workflow.transition(
      admin,
      reportId,
      S.PENDING_APPROVAL,
      reopened.version,
    );
    await workflow.transition(admin, reportId, S.APPROVED, pending.version);

    // Revision 1 was signed and stays exportable; revision 2 (current) waits for a re-sign.
    const old = await exportService.exportInspectionReport(
      exporter(tenant.id),
      reportId,
      1,
    );
    expect(Buffer.isBuffer(old.buffer)).toBe(true);
    await expect(
      exportService.exportInspectionReport(exporter(tenant.id), reportId),
    ).rejects.toMatchObject({ response: { code: 'SIGNATURE_PENDING' } });
  });

  describe('supervisor signature', () => {
    /** APPROVED by a real supervisor who had NO account signature; optional SUPERVISOR field. */
    async function approvedByUnsignedSupervisor() {
      const tenant = await seedTenant(prisma);
      const customer = await seedCustomer(prisma, tenant.id);
      const template = await seedRealDrillPipeTemplate(prisma, tenant.id);
      const created = await reports.createReport(tenant.id, 'user-admin', {
        customerId: customer.id,
        poNumber: 'PO-SUP',
        templateKey: 'DRILL_PIPE_REPORT',
      });
      const admin = { id: 'user-admin', tenantId: tenant.id, role: UserRole.ADMIN };
      const supervisor = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `sup-${Date.now()}@example.test`,
          role: UserRole.SUPERVISOR,
          passwordHash: 'x',
        },
      });

      let r = await workflow.transition(admin, created.id, S.RECEIVED, created.version);
      r = await workflow.transition(admin, created.id, S.READY_FOR_CLEANING, r.version);
      r = await workflow.transition(admin, created.id, S.READY_FOR_INSPECTION, r.version);
      r = await workflow.transition(admin, created.id, S.IN_INSPECTION, r.version);
      await seedApprovableSerial(prisma, tenant.id, created.id, 'SN-001');
      const pending = await workflow.transition(admin, created.id, S.PENDING_APPROVAL, r.version);
      await workflow.transition(
        { id: supervisor.id, tenantId: tenant.id, role: UserRole.SUPERVISOR },
        created.id,
        S.APPROVED,
        pending.version,
      );

      const def = template.definitionJson as unknown as {
        fields: unknown[];
        export?: { global?: unknown[] };
      };
      await prisma.template.update({
        where: { id: template.id },
        data: {
          definitionJson: {
            ...def,
            fields: [
              ...def.fields,
              {
                key: 'supSig',
                label: 'Supervisor',
                type: 'signature',
                scope: 'header',
                required: false,
                signer: 'SUPERVISOR',
              },
            ],
            export: {
              ...def.export,
              global: [
                ...(def.export?.global ?? []),
                { token: '{{supSig}}', signature: 'field:supSig' },
              ],
            },
          } as never,
        },
      });
      return { tenant, reportId: created.id, supervisor };
    }

    it('adopts the approver signature when they registered it after approving, and keeps it', async () => {
      const { tenant, reportId, supervisor } = await approvedByUnsignedSupervisor();

      // No signature yet: exports fine, nothing frozen.
      await exportService.exportInspectionReport(exporter(tenant.id), reportId);
      expect(
        await prisma.reportSignature.count({
          where: { inspectionReportId: reportId, slot: 'field:supSig' },
        }),
      ).toBe(0);

      await signatures.saveForUser(
        { id: supervisor.id, tenantId: tenant.id },
        makePng(),
      );
      const res = await exportService.exportInspectionReport(exporter(tenant.id), reportId);
      const zip = await JSZip.loadAsync(res.buffer);
      expect(Object.keys(zip.files).some((n) => n.startsWith('xl/media/'))).toBe(true);

      const frozen = await prisma.reportSignature.findFirstOrThrow({
        where: { inspectionReportId: reportId, slot: 'field:supSig' },
      });
      expect(frozen.signedById).toBe(supervisor.id);

      // A later replacement does not change what this revision exports.
      await signatures.saveForUser(
        { id: supervisor.id, tenantId: tenant.id },
        makePng(),
      );
      await exportService.exportInspectionReport(exporter(tenant.id), reportId);
      expect(
        await prisma.reportSignature.count({
          where: { inspectionReportId: reportId, slot: 'field:supSig' },
        }),
      ).toBe(1);
    });

    it('migrating the legacy field to the supervisorSignature role keeps past exports intact', async () => {
      const { tenant, reportId, supervisor } = await approvedByUnsignedSupervisor();
      await signatures.saveForUser({ id: supervisor.id, tenantId: tenant.id }, makePng());
      await exportService.exportInspectionReport(exporter(tenant.id), reportId);
      const legacy = await prisma.reportSignature.findFirstOrThrow({
        where: { inspectionReportId: reportId, slot: 'field:supSig' },
      });

      await runSupervisorRoleMigration();

      // Definition: the field is now the system role; history captured.
      const tpl = await prisma.template.findFirstOrThrow({
        where: { tenantId: tenant.id },
        include: { definitionRevisions: true },
      });
      const def = tpl.definitionJson as unknown as {
        fields: { key: string; role?: string; signer?: string }[];
        export: { global: { token: string; computed?: string; signature?: string }[] };
      };
      expect(def.fields.find((f) => f.key === 'supSig')).toMatchObject({
        role: 'supervisorSignature',
      });
      expect(def.fields.find((f) => f.key === 'supSig')?.signer).toBeUndefined();
      expect(def.export.global).toContainEqual({
        token: '{{supSig}}',
        computed: 'supervisorSignature',
      });
      expect(tpl.definitionRevisions.length).toBeGreaterThanOrEqual(1);

      // Signature: copied to the role slot, original kept.
      const copied = await prisma.reportSignature.findFirstOrThrow({
        where: { inspectionReportId: reportId, slot: 'supervisorSignature' },
      });
      expect(copied.storageKey).toBe(legacy.storageKey);
      expect(copied.revisionNumber).toBe(legacy.revisionNumber);
      expect(
        await prisma.reportSignature.count({
          where: { inspectionReportId: reportId, slot: 'field:supSig' },
        }),
      ).toBe(1);

      // The export still carries the picture.
      const res = await exportService.exportInspectionReport(exporter(tenant.id), reportId);
      const zip = await JSZip.loadAsync(res.buffer);
      expect(Object.keys(zip.files).some((n) => n.startsWith('xl/media/'))).toBe(true);

      // Idempotent.
      await runSupervisorRoleMigration();
      const again = await prisma.template.findFirstOrThrow({
        where: { tenantId: tenant.id },
        include: { definitionRevisions: true },
      });
      expect(again.definitionRevisions).toHaveLength(tpl.definitionRevisions.length);
      expect(
        await prisma.reportSignature.count({
          where: { inspectionReportId: reportId, slot: 'supervisorSignature' },
        }),
      ).toBe(1);
    });

    /** A bare template row (no reports) carrying `definitionJson`, to exercise the shapes. */
    async function templateWith(definitionJson: unknown) {
      const tenant = await seedTenant(prisma);
      const admin = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `mig-${Date.now()}-${Math.random()}@example.test`,
          role: UserRole.ADMIN,
          passwordHash: 'x',
        },
      });
      return prisma.template.create({
        data: {
          tenantId: tenant.id,
          templateKey: 'MIG_TEST',
          templateVersion: 1,
          status: 'ACTIVE',
          fileKey: 'k',
          hash: 'h',
          changeNote: 'n',
          createdById: admin.id,
          definitionJson: definitionJson as never,
        },
      });
    }
    const roleOf = (def: { fields: { key: string; role?: string }[] }) =>
      def.fields.filter((f) => f.role === 'supervisorSignature');

    it('migration: extra legacy fields are re-pointed at the role picture and dropped', async () => {
      const t = await templateWith({
        fields: [
          { key: 'a', type: 'signature', signer: 'SUPERVISOR', scope: 'header', label: 'A' },
          { key: 'b', type: 'signature', signer: 'SUPERVISOR', scope: 'header', label: 'B' },
          { key: 'c', type: 'signature', signer: 'CUSTOMER', scope: 'header', required: true },
        ],
        export: {
          global: [
            { token: '{{a}}', signature: 'field:a' },
            { token: '{{b}}', signature: 'field:b' },
            { token: '{{c}}', signature: 'field:c' },
          ],
          regions: {},
        },
      });
      await runSupervisorRoleMigration();
      const def = (
        await prisma.template.findUniqueOrThrow({ where: { id: t.id } })
      ).definitionJson as unknown as {
        fields: { key: string; role?: string; signer?: string; type: string }[];
        export: { global: Record<string, string>[] };
      };
      expect(def.fields.map((f) => f.key)).toEqual(['a', 'c']);
      expect(def.fields[0]).toMatchObject({ type: 'text', role: 'supervisorSignature' });
      expect(def.fields[0].signer).toBeUndefined();
      expect(def.fields[1]).toMatchObject({ type: 'signature', signer: 'CUSTOMER' });
      expect(def.export.global).toEqual([
        { token: '{{a}}', computed: 'supervisorSignature' },
        { token: '{{b}}', signature: 'supervisorSignature' },
        { token: '{{c}}', signature: 'field:c' },
      ]);
      expect(roleOf(def)).toHaveLength(1);
    });

    it('migration: when the role is already bound, only the legacy field is re-pointed', async () => {
      const t = await templateWith({
        fields: [
          { key: 'sup', type: 'text', role: 'supervisorSignature', scope: 'header' },
          { key: 'a', type: 'signature', signer: 'SUPERVISOR', scope: 'header' },
        ],
        export: {
          global: [
            { token: '{{sup}}', computed: 'supervisorSignature' },
            { token: '{{a}}', signature: 'field:a' },
          ],
          regions: {},
        },
      });
      await runSupervisorRoleMigration();
      const def = (
        await prisma.template.findUniqueOrThrow({ where: { id: t.id } })
      ).definitionJson as unknown as {
        fields: { key: string; role?: string }[];
        export: { global: Record<string, string>[] };
      };
      expect(def.fields.map((f) => f.key)).toEqual(['sup']);
      expect(def.export.global).toEqual([
        { token: '{{sup}}', computed: 'supervisorSignature' },
        { token: '{{a}}', signature: 'supervisorSignature' },
      ]);
    });
  });
});
