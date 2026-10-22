/**
 * Integration test — the export mirrors the app after a reopen + reinspection by a
 * DIFFERENT inspector. Runs under the `test-integration` target against the dedicated
 * test Postgres (docker-compose.test.yml). Real ExportService / workflow / persistence.
 *
 * The app derives "who inspected" from the audit log (last action while IN_INSPECTION,
 * see inspection-reports/last-inspector.ts). The default export must show exactly that,
 * not the inspector as of an older snapshot; an explicitly requested historical
 * revision keeps showing who inspected it back then.
 */
import { InspectionReportStatus, UserRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import { resolveInspector } from '../inspection-reports/last-inspector';
import { LocalAttachmentStorage } from '../storage/local-attachment.storage';
import {
  seedTenant,
  seedCustomer,
  seedRealDrillPipeTemplate,
  seedApprovableSerial,
  resetInspectionDomain,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

const S = InspectionReportStatus;
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('Export mirrors the app inspector after reinspection [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const revisionService = new RevisionService(prisma);
    exportService = new ExportService(
      prisma,
      revisionService,
      new LocalAttachmentStorage(),
    );
    workflow = new InspectionReportWorkflowService(prisma, revisionService);
    reports = new InspectionReportsService(prisma, makeFilesServiceStub());
  });

  afterAll(async () => {
    // Users reference the tenant; leaving them would block other specs' tenant reset.
    await prisma?.user.deleteMany();
    await prisma?.onModuleDestroy();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await resetInspectionDomain(prisma);
  });

  async function cellTexts(buffer: Buffer): Promise<string[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const out: string[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          const v = cell.value;
          if (typeof v === 'string') out.push(v);
          else if (v && typeof v === 'object' && 'richText' in v)
            out.push(v.richText.map((t) => t.text).join(''));
        }),
      ),
    );
    return out;
  }

  it('default export shows the NEW inspector; the old revision still shows the old one', async () => {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedRealDrillPipeTemplate(prisma, tenant.id);

    const mkUser = (name: string) =>
      prisma.user.create({
        data: {
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
          name,
          role: UserRole.INSPECTOR,
          tenantId: tenant.id,
          passwordHash: 'x',
        },
      });
    const alice = await mkUser('Alice Firstinspector');
    const bob = await mkUser('Bob Secondinspector');
    const actor = (u: { id: string }) => ({
      id: u.id,
      tenantId: tenant.id,
      // Policy-wise ADMIN may drive every transition; the inspector identity is what
      // the audit log records, which is what we are testing.
      role: UserRole.ADMIN,
    });
    const work = (userId: string, reportId: string) =>
      prisma.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'SerialNumber',
          entityId: 'sn',
          tenantId: tenant.id,
          userId,
          inspectionReportId: reportId,
        },
      });

    const created = await reports.createReport(tenant.id, alice.id, {
      customerId: customer.id,
      poNumber: 'PO-REINSPECT',
      templateKey: 'DRILL_PIPE_REPORT',
    });
    const reportId = created.id;
    await prisma.inspectionReport.update({
      where: { id: reportId },
      data: { reportNumber: 'RPT-REINSPECT-1' },
    });

    let v = created.version;
    for (const to of [S.RECEIVED, S.READY_FOR_CLEANING, S.READY_FOR_INSPECTION, S.IN_INSPECTION]) {
      v = (await workflow.transition(actor(alice), reportId, to, v)).version;
      await tick();
    }
    await seedApprovableSerial(prisma, tenant.id, reportId, 'SN-001');
    await work(alice.id, reportId);
    await tick();
    v = (await workflow.transition(actor(alice), reportId, S.PENDING_APPROVAL, v)).version;
    v = (await workflow.transition(actor(alice), reportId, S.APPROVED, v)).version;

    const exporter = { tenantId: tenant.id, role: UserRole.ADMIN, customerId: null };
    const first = await exportService.exportInspectionReport(exporter, reportId);
    const firstCells = await cellTexts(first.buffer);
    expect(firstCells.some((c) => c.includes('Alice Firstinspector'))).toBe(true);

    // Reopen, then a DIFFERENT inspector reinspects and the report is approved again.
    await tick();
    v = (
      await workflow.transition(actor(alice), reportId, S.IN_INSPECTION, v, 'rework needed')
    ).version;
    await tick();
    await work(bob.id, reportId);
    await tick();
    v = (await workflow.transition(actor(bob), reportId, S.PENDING_APPROVAL, v)).version;
    await workflow.transition(actor(bob), reportId, S.APPROVED, v);

    // What the app shows.
    const app = await resolveInspector(prisma, tenant.id, reportId);
    expect(app.name).toBe('Bob Secondinspector');

    // Default export == the app.
    const now = await exportService.exportInspectionReport(exporter, reportId);
    const nowCells = await cellTexts(now.buffer);
    expect(nowCells.some((c) => c.includes('Bob Secondinspector'))).toBe(true);
    expect(nowCells.some((c) => c.includes('Alice Firstinspector'))).toBe(false);

    // Revision 1 (taken at first approval) is history: still Alice.
    const rev1 = await exportService.exportInspectionReport(exporter, reportId, 1);
    const rev1Cells = await cellTexts(rev1.buffer);
    expect(rev1Cells.some((c) => c.includes('Alice Firstinspector'))).toBe(true);
    expect(rev1Cells.some((c) => c.includes('Bob Secondinspector'))).toBe(false);
  });
});
