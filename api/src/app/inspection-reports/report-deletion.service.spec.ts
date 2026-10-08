import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReportDeletionService } from './report-deletion.service';
import { deleteReportGraph } from './delete-report-graph';

jest.mock('./delete-report-graph', () => ({
  deleteReportGraph: jest.fn().mockResolvedValue(undefined),
}));

describe('ReportDeletionService', () => {
  const report = {
    id: 'r1',
    tenantId: 't1',
    customerId: 'c1',
    reportNumber: 'NCO-1',
    poNumber: '002',
    status: 'APPROVED',
    version: 5,
  };

  function setup(opts: { count?: number } = {}) {
    const tx = {
      inspectionReport: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.count ?? 1 }),
      },
      attachment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]),
      },
      serialNumber: { count: jest.fn().mockResolvedValue(3) },
      childReport: { count: jest.fn().mockResolvedValue(1) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      inspectionReport: { findUnique: jest.fn().mockResolvedValue(report) },
      serialNumber: { count: jest.fn().mockResolvedValue(3) },
      childReport: { count: jest.fn().mockResolvedValue(1) },
      attachment: { count: jest.fn().mockResolvedValue(2) },
      reportSignature: { count: jest.fn().mockResolvedValue(2) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = new ReportDeletionService(prisma as never, storage as never);
    return { service, prisma, tx, storage };
  }

  beforeEach(() => jest.mocked(deleteReportGraph).mockClear());

  it('deletes the report graph, audits it, then removes attachment binaries', async () => {
    const { service, tx, storage } = setup();
    await expect(
      service.deleteReport('t1', 'u1', 'r1', 5, '  duplicate entry '),
    ).resolves.toEqual({ deleted: true, serials: 3, children: 1, attachments: 2 });

    expect(tx.inspectionReport.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', tenantId: 't1', version: 5 },
      data: { version: { increment: 1 } },
    });
    expect(deleteReportGraph).toHaveBeenCalledWith(tx, ['r1']);
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'DELETE_REPORT', entityId: 'r1', userId: 'u1' });
    expect(audit.reason).toContain('Reason: duplicate entry');
    expect(storage.delete).toHaveBeenCalledWith({
      tenantId: 't1',
      customerId: 'c1',
      reportId: 'r1',
      attachmentId: 'a1',
    });
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('requires a reason', async () => {
    const { service, prisma } = setup();
    await expect(service.deleteReport('t1', 'u1', 'r1', 5, '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a stale version before touching anything', async () => {
    const { service, prisma } = setup();
    await expect(service.deleteReport('t1', 'u1', 'r1', 4, 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a concurrent write between read and delete conflicts and deletes nothing', async () => {
    const { service, storage } = setup({ count: 0 });
    await expect(service.deleteReport('t1', 'u1', 'r1', 5, 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleteReportGraph).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('never reaches a report in another tenant', async () => {
    const { service } = setup();
    await expect(service.deleteReport('t2', 'u1', 'r1', 5, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getDeleteImpact('t2', 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports the delete impact', async () => {
    const { service } = setup();
    await expect(service.getDeleteImpact('t1', 'r1')).resolves.toEqual({
      reportNumber: 'NCO-1',
      poNumber: '002',
      status: 'APPROVED',
      version: 5,
      serialNumbers: 3,
      childReports: 1,
      attachments: 2,
      signatures: 2,
    });
  });
});
