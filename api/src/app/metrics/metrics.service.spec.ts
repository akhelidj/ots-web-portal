import { MetricsService } from './metrics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MetricsService', () => {
  it('scopes to the tenant and flattens each report into a timeline', async () => {
    const at1 = new Date('2026-10-01T01:00:00Z');
    const at2 = new Date('2026-10-01T03:00:00Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        reportNumber: 'NCO-1',
        poNumber: 'PO-1',
        status: 'APPROVED',
        templateKey: 'DP',
        createdAt: at1,
        customer: { name: 'Noble' },
        _count: { serialNumbers: 4 },
        transitionLogs: [
          { toStatus: 'RECEIVED', timestamp: at1 },
          { toStatus: 'APPROVED', timestamp: at2 },
        ],
      },
      {
        id: 'r2',
        reportNumber: null,
        poNumber: 'PO-2',
        status: 'DRAFT',
        templateKey: 'DP',
        createdAt: at2,
        customer: null,
        _count: { serialNumbers: 0 },
        transitionLogs: [],
      },
    ]);
    const service = new MetricsService({
      inspectionReport: { findMany },
    } as unknown as PrismaService);

    const result = await service.listReportTimelines('t1');

    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    expect(result[0]).toEqual({
      id: 'r1',
      reportNumber: 'NCO-1',
      poNumber: 'PO-1',
      status: 'APPROVED',
      templateKey: 'DP',
      customerName: 'Noble',
      serialCount: 4,
      createdAt: at1,
      events: [
        { status: 'RECEIVED', at: at1 },
        { status: 'APPROVED', at: at2 },
      ],
    });
    expect(result[1].customerName).toBeNull();
    expect(result[1].events).toEqual([]);
  });
});
