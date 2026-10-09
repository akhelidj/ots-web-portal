/**
 * Integration test — free-entry report statistics round-trip through the report-update
 * path (optimistic concurrency, replace-not-merge, validation, locked-report guard).
 * Runs under `test-integration` against the dedicated test Postgres.
 */
import { RevisionService } from '../revision/revision.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
import {
  seedTenant,
  seedCustomer,
  seedActiveTemplate,
  resetInspectionDomain,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

describe('Report statistics [integration]', () => {
  let prisma: PrismaService;
  let service: InspectionReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new InspectionReportsService(
      prisma,
      makeFilesServiceStub(),
      new RevisionService(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  async function seedReport() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
    const report = await service.createReport(tenant.id, 'user-1', {
      customerId: customer.id,
      poNumber: 'PO-STATS',
      templateKey: 'DRILL_PIPE_REPORT',
    });
    return { tenantId: tenant.id, report };
  }

  it('persists, returns and replaces (not merges) the statistics list', async () => {
    const { tenantId, report } = await seedReport();
    const first = await service.updateReport(
      tenantId,
      report.id,
      'user-1',
      {
        statistics: [
          { id: 'a', label: ' Toto ', value: 15, serials: ['S1', 'S1', 'S2'] },
          { id: 'b', label: 'Other', value: '3' },
        ],
      },
      report.version,
    );
    expect(first.statistics).toEqual([
      { id: 'a', label: 'Toto', value: '15', serials: ['S1', 'S2'] },
      { id: 'b', label: 'Other', value: '3', serials: [] },
    ]);
    expect(first.version).toBe(report.version + 1);

    const second = await service.updateReport(
      tenantId,
      report.id,
      'user-1',
      { statistics: [{ id: 'c', label: 'Only', value: '1' }] },
      first.version,
    );
    expect(second.statistics).toEqual([
      { id: 'c', label: 'Only', value: '1', serials: [] },
    ]);
  });

  it('leaves statistics untouched when a header-only update omits them', async () => {
    const { tenantId, report } = await seedReport();
    const withStats = await service.updateReport(
      tenantId,
      report.id,
      'user-1',
      { statistics: [{ id: 'a', label: 'L', value: '1' }] },
      report.version,
    );
    const afterHeader = await service.updateReport(
      tenantId,
      report.id,
      'user-1',
      { headerData: { inspectorComment: 'ok' } },
      withStats.version,
    );
    expect(afterHeader.statistics).toEqual([
      { id: 'a', label: 'L', value: '1', serials: [] },
    ]);
  });

  it('rejects a malformed list with a 400 and writes nothing', async () => {
    const { tenantId, report } = await seedReport();
    await expect(
      service.updateReport(
        tenantId,
        report.id,
        'user-1',
        { statistics: [{ id: 'a', label: '', value: '1' }] },
        report.version,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const row = await prisma.inspectionReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(row.statistics).toBeNull();
    expect(row.version).toBe(report.version);
  });

  it('keeps optimistic concurrency: a stale version is a 409', async () => {
    const { tenantId, report } = await seedReport();
    await service.updateReport(
      tenantId,
      report.id,
      'user-1',
      { statistics: [] },
      report.version,
    );
    await expect(
      service.updateReport(
        tenantId,
        report.id,
        'user-1',
        { statistics: [{ id: 'a', label: 'L', value: '1' }] },
        report.version,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to edit statistics on an APPROVED report', async () => {
    const { tenantId, report } = await seedReport();
    await prisma.inspectionReport.update({
      where: { id: report.id },
      data: { status: 'APPROVED' },
    });
    await expect(
      service.updateReport(
        tenantId,
        report.id,
        'user-1',
        { statistics: [{ id: 'a', label: 'L', value: '1' }] },
        report.version,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
