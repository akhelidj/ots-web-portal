/**
 * Integration test — admin template delete with cascade.
 * Runs under the `test-integration` target against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433), real PrismaService + real local storage.
 *
 * Pins the contract:
 *   - an ADMIN deletes ANY template version and everything bound to it (reports, serials,
 *     child reports, batches, revisions, transition logs, attachments, report-signature
 *     rows) plus the binaries (workbook + attachment bytes);
 *   - audit-log history survives (report link nulled) and a DELETE_VERSION entry records
 *     the reason and the deleted report ids;
 *   - a reason is required whenever data would be removed;
 *   - reports bound to a different template version are untouched;
 *   - a SUPERVISOR keeps the old restricted behavior (undefined + unreferenced only).
 */
import { BadRequestException } from '@nestjs/common';
import {
  InspectionApprovalBatchStatus,
  InspectionReportStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateService } from './template.service';
import { TemplateValidationService } from './template-validation.service';
import { LocalAttachmentStorage } from '../storage/local-attachment.storage';
import {
  resetInspectionDomain,
  seedActiveTemplate,
  seedApprovableSerial,
  seedChildReport,
  seedChildReportSerial,
  seedCustomer,
  seedInspectionReport,
  seedTenant,
} from '../../../test/seed-helpers';

describe('Template delete with cascade [integration]', () => {
  let prisma: PrismaService;
  let storage: LocalAttachmentStorage;
  let service: TemplateService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    storage = new LocalAttachmentStorage();
    service = new TemplateService(
      prisma,
      new TemplateValidationService(),
      storage,
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await resetInspectionDomain(prisma);
  });

  afterEach(async () => {
    // The batch fixture needs a user; resetInspectionDomain would FK-block on it.
    await prisma.inspectionApprovalBatchSerialNumber.deleteMany();
    await prisma.inspectionApprovalBatch.deleteMany();
    await prisma.user.deleteMany();
  });

  /** A fully-populated report graph bound to the given template. */
  async function seedBoundReport(
    tenantId: string,
    customerId: string,
    userId: string,
  ) {
    const report = await seedInspectionReport(prisma, tenantId, {
      customerId,
      status: InspectionReportStatus.PENDING_APPROVAL,
    });
    const serial = await seedApprovableSerial(prisma, tenantId, report.id);
    const child = await seedChildReport(prisma, tenantId, report.id);
    await seedChildReportSerial(prisma, child.id, serial.id);
    await prisma.childReportRevision.create({
      data: {
        childReportId: child.id,
        tenantId,
        revisionNumber: 1,
        snapshotJson: {},
        revisedById: userId,
        revisionReason: 'seed',
      },
    });
    await prisma.childReportTransitionLog.create({
      data: { childReportId: child.id, fromStatus: 'DRAFT', toStatus: 'IN_INSPECTION' },
    });
    await prisma.inspectionReportRevision.create({
      data: {
        inspectionReportId: report.id,
        tenantId,
        revisionNumber: 1,
        snapshotJson: {},
        revisedById: userId,
        revisionReason: 'seed',
      },
    });
    await prisma.inspectionReportTransitionLog.create({
      data: {
        inspectionReportId: report.id,
        fromStatus: InspectionReportStatus.DRAFT,
        toStatus: InspectionReportStatus.RECEIVED,
      },
    });
    await prisma.reportSignature.create({
      data: {
        tenantId,
        inspectionReportId: report.id,
        slot: 'inspector',
        signedById: userId,
        storageKey: 'tenant/user/obj',
        hash: 'h',
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: 'SEEDED',
        entity: 'InspectionReport',
        entityId: report.id,
        inspectionReportId: report.id,
      },
    });
    const batch = await prisma.inspectionApprovalBatch.create({
      data: {
        tenantId,
        inspectionReportId: report.id,
        submittedByUserId: userId,
        status: InspectionApprovalBatchStatus.SUBMITTED,
      },
    });
    await prisma.inspectionApprovalBatchSerialNumber.create({
      data: {
        tenantId,
        inspectionApprovalBatchId: batch.id,
        serialNumberId: serial.id,
        status: 'PENDING',
      },
    });

    const attachment = await prisma.attachment.create({
      data: { filename: 'photo.png', url: '', inspectionReportId: report.id },
    });
    const ref = {
      tenantId,
      customerId,
      reportId: report.id,
      attachmentId: attachment.id,
    };
    await storage.put(ref, Buffer.from('attachment-bytes'));
    return { report, ref };
  }

  async function seedWorld() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'inspector@test.local',
        role: UserRole.INSPECTOR,
        passwordHash: 'x',
      },
    });
    // Defined template (DRILL_PIPE_REPORT carries the committed definition by default).
    const template = await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
    return { tenant, customer, user, template };
  }

  it('ADMIN delete removes the template, every bound report graph, and the binaries', async () => {
    const { tenant, customer, user, template } = await seedWorld();
    const a = await seedBoundReport(tenant.id, customer.id, user.id);

    // A report on a DIFFERENT template version must survive untouched.
    const other = await prisma.inspectionReport.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        poNumber: 'PO-OTHER',
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 2,
        templateHash: 'h2',
      },
    });

    const result = await service.deleteTemplate(tenant.id, template.id, 'admin-1', {
      role: UserRole.ADMIN,
      reason: 'Obsolete test data',
    });

    expect(result).toEqual({ deleted: true, reportsDeleted: 1 });
    expect(await prisma.template.findUnique({ where: { id: template.id } })).toBeNull();
    expect(await prisma.inspectionReport.findUnique({ where: { id: a.report.id } })).toBeNull();
    for (const model of [
      prisma.serialNumber,
      prisma.childReport,
      prisma.childReportSerialNumber,
      prisma.childReportRevision,
      prisma.childReportTransitionLog,
      prisma.inspectionReportRevision,
      prisma.inspectionReportTransitionLog,
      prisma.reportSignature,
      prisma.attachment,
      prisma.inspectionApprovalBatch,
      prisma.inspectionApprovalBatchSerialNumber,
    ] as unknown as { count: () => Promise<number> }[]) {
      expect(await model.count()).toBe(0);
    }

    // The unrelated report is still there.
    expect(await prisma.inspectionReport.findUnique({ where: { id: other.id } })).not.toBeNull();

    // Binaries are gone.
    expect(await storage.get(a.ref)).toBeNull();
    expect(await storage.getTemplate(template.fileKey)).toBeNull();

    // History survives: the report's audit row is kept (unlinked) and the delete itself is
    // recorded with the reason and the deleted report id.
    const seeded = await prisma.auditLog.findFirst({ where: { action: 'SEEDED' } });
    expect(seeded?.inspectionReportId).toBeNull();
    const deleteLog = await prisma.auditLog.findFirst({
      where: { action: 'DELETE_VERSION', entityId: template.id },
    });
    expect(deleteLog?.reason).toContain('Obsolete test data');
    expect(deleteLog?.reason).toContain(a.report.id);
  });

  it('ADMIN delete of a defined/referenced template requires a reason — nothing is removed without one', async () => {
    const { tenant, customer, user, template } = await seedWorld();
    const a = await seedBoundReport(tenant.id, customer.id, user.id);

    await expect(
      service.deleteTemplate(tenant.id, template.id, 'admin-1', {
        role: UserRole.ADMIN,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.template.findUnique({ where: { id: template.id } })).not.toBeNull();
    expect(await prisma.inspectionReport.findUnique({ where: { id: a.report.id } })).not.toBeNull();
    expect(await storage.get(a.ref)).not.toBeNull();
  });

  it('SUPERVISOR keeps the restricted behavior: a defined or referenced template cannot be deleted', async () => {
    const { tenant, customer, user, template } = await seedWorld();
    await seedBoundReport(tenant.id, customer.id, user.id);

    await expect(
      service.deleteTemplate(tenant.id, template.id, 'sup-1', {
        role: UserRole.SUPERVISOR,
        reason: 'please',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.template.findUnique({ where: { id: template.id } })).not.toBeNull();
  });

  it('ADMIN may delete an undefined, unreferenced template without a reason (the old undo path)', async () => {
    const tenant = await seedTenant(prisma);
    const template = await seedActiveTemplate(prisma, tenant.id, 'SCRATCH', {
      definitionJson: null,
    });

    const result = await service.deleteTemplate(tenant.id, template.id, 'admin-1', {
      role: UserRole.ADMIN,
    });

    expect(result.deleted).toBe(true);
    expect(await prisma.template.findUnique({ where: { id: template.id } })).toBeNull();
  });

  it('getDeleteImpact reports what the delete would remove, without removing it', async () => {
    const { tenant, customer, user, template } = await seedWorld();
    await seedBoundReport(tenant.id, customer.id, user.id);

    const impact = await service.getDeleteImpact(tenant.id, template.id);

    expect(impact).toMatchObject({
      templateKey: 'DRILL_PIPE_REPORT',
      templateVersion: 1,
      defined: true,
      reports: 1,
      childReports: 1,
      serialNumbers: 1,
      attachments: 1,
      signatures: 1,
    });
    expect(await prisma.template.findUnique({ where: { id: template.id } })).not.toBeNull();
  });
});
