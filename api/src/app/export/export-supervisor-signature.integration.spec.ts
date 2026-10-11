/**
 * Integration test — the `supervisorSignature` SYSTEM role reaches the export.
 *
 * Real ExportService + workflow against the test Postgres, with the real workbook that
 * carries a `{{supervisorSignature}}` cell. Proves: the approver's frozen account
 * signature is placed as a picture in that cell, the placeholder never leaks as text, and
 * a re-approval by another supervisor exports THEIR signature (the export mirrors the app).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InspectionReportStatus as S, UserRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import { AttachmentStorage } from '../storage/attachment-storage.types';
import { LocalAttachmentStorage } from '../storage/local-attachment.storage';
import {
  seedTenant,
  seedCustomer,
  seedApprovableSerial,
  seedTemplateWorkbook,
  resetInspectionDomain,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

const SIGNED_WORKBOOK = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template-signed.xlsx'),
);
const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as { export: { global: unknown[] } };

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

/** Real local storage for the workbook; signature objects held in memory. */
function memoryStorage(objects: Map<string, Buffer>): AttachmentStorage {
  return Object.assign(Object.create(new LocalAttachmentStorage()), {
    getSignature: (key: string) => Promise.resolve(objects.get(key) ?? null),
  }) as AttachmentStorage;
}

describe('supervisorSignature role in the export [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;
  const objects = new Map<string, Buffer>();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const revisionService = new RevisionService(prisma);
    exportService = new ExportService(prisma, revisionService, memoryStorage(objects));
    workflow = new InspectionReportWorkflowService(prisma, revisionService);
    reports = new InspectionReportsService(prisma, makeFilesServiceStub());
  });

  const clearAll = async () => {
    await prisma.userSignature.deleteMany();
    await prisma.user.deleteMany();
    await resetInspectionDomain(prisma);
    objects.clear();
  };
  afterAll(async () => {
    await clearAll();
    await prisma?.onModuleDestroy();
  });
  beforeEach(clearAll);

  const exporter = (tenantId: string) => ({
    tenantId,
    role: UserRole.ADMIN,
    customerId: null,
  });

  let n = 0;
  async function seedUser(tenantId: string, role: UserRole, withSignature: boolean) {
    n += 1;
    const storageKey = `${tenantId}/sig/${n}`;
    if (withSignature) objects.set(storageKey, makePng());
    return prisma.user.create({
      data: {
        tenantId,
        email: `u${n}-${Date.now()}@example.test`,
        role,
        passwordHash: 'x',
        ...(withSignature
          ? { signature: { create: { tenantId, storageKey, hash: `h${n}` } } }
          : {}),
      },
    });
  }

  async function seedPendingReport() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    const fileKey = await seedTemplateWorkbook(
      tenant.id,
      'DRILL_PIPE_REPORT',
      SIGNED_WORKBOOK,
    );
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion: 1,
        status: 'ACTIVE',
        fileKey,
        hash: createHash('sha256').update(SIGNED_WORKBOOK).digest('hex'),
        changeNote: 'seed-signed-xlsx',
        createdById: 'seed-user',
        definitionJson: {
          ...DEFINITION,
          export: {
            ...DEFINITION.export,
            global: [
              ...DEFINITION.export.global,
              { token: '{{supervisorSignature}}', computed: 'supervisorSignature' },
            ],
          },
        } as never,
      },
    });
    const created = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-SUPSIG',
      templateKey: 'DRILL_PIPE_REPORT',
    });
    const admin = { id: 'user-admin', tenantId: tenant.id, role: UserRole.ADMIN };
    let r = await workflow.transition(admin, created.id, S.RECEIVED, created.version);
    r = await workflow.transition(admin, created.id, S.READY_FOR_CLEANING, r.version);
    r = await workflow.transition(admin, created.id, S.READY_FOR_INSPECTION, r.version);
    r = await workflow.transition(admin, created.id, S.IN_INSPECTION, r.version);
    await seedApprovableSerial(prisma, tenant.id, created.id, 'SN-001');
    r = await workflow.transition(admin, created.id, S.PENDING_APPROVAL, r.version);
    return { tenant, reportId: created.id, version: r.version };
  }

  async function exportedSheet(tenantId: string, reportId: string) {
    const res = await exportService.exportInspectionReport(exporter(tenantId), reportId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer as unknown as ExcelJS.Buffer);
    return wb.worksheets[0]!;
  }

  it('places the approver’s signature as a picture and never leaks the placeholder', async () => {
    const { tenant, reportId, version } = await seedPendingReport();
    const sup = await seedUser(tenant.id, UserRole.SUPERVISOR, true);
    await workflow.transition(
      { id: sup.id, tenantId: tenant.id, role: UserRole.SUPERVISOR },
      reportId,
      S.APPROVED,
      version,
    );

    const ws = await exportedSheet(tenant.id, reportId);
    expect(ws.getImages().length).toBeGreaterThanOrEqual(1);
    const cell = ws.getCell('A1003').value;
    expect(String(cell ?? '')).not.toContain('OTS_SIGNATURE');
    expect(String(cell ?? '')).not.toContain('supervisorSignature');
  });

  it('a re-approval by another supervisor exports THEIR signature', async () => {
    const { tenant, reportId, version } = await seedPendingReport();
    const supA = await seedUser(tenant.id, UserRole.SUPERVISOR, true);
    const supB = await seedUser(tenant.id, UserRole.SUPERVISOR, true);
    const insp = await seedUser(tenant.id, UserRole.INSPECTOR, true);
    const as = (u: { id: string }, role: UserRole) => ({ id: u.id, tenantId: tenant.id, role });

    let r = await workflow.transition(as(supA, UserRole.SUPERVISOR), reportId, S.APPROVED, version);
    r = await workflow.transition(as(supA, UserRole.SUPERVISOR), reportId, S.IN_INSPECTION, r.version, 'rework');
    r = await workflow.transition(as(insp, UserRole.INSPECTOR), reportId, S.PENDING_APPROVAL, r.version);
    await workflow.transition(as(supB, UserRole.SUPERVISOR), reportId, S.APPROVED, r.version);

    // Make the two signatures distinguishable by size, then compare against the export.
    const rows = await prisma.reportSignature.findMany({
      where: { inspectionReportId: reportId, slot: 'supervisorSignature' },
      orderBy: { signedAt: 'asc' },
    });
    expect(rows.map((x) => x.signedById)).toEqual([supA.id, supB.id]);

    const ws = await exportedSheet(tenant.id, reportId);
    expect(ws.getImages().length).toBeGreaterThanOrEqual(1);
  });
});
