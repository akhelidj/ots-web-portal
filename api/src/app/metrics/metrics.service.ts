import { Injectable } from '@nestjs/common';
import { InspectionReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** One report's identity plus its status timeline, oldest event first. */
export interface ReportTimeline {
  id: string;
  reportNumber: string | null;
  poNumber: string;
  status: InspectionReportStatus;
  templateKey: string;
  customerName: string | null;
  serialCount: number;
  createdAt: Date;
  events: { status: InspectionReportStatus; at: Date }[];
}

/**
 * Read-only source for the admin Metrics screen. Returns raw timelines only — every
 * duration (turnaround, time in stage, step time) is derived client-side from these
 * events, so the server stays a plain, tenant-scoped read with no metric semantics.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async listReportTimelines(tenantId: string): Promise<ReportTimeline[]> {
    const reports = await this.prisma.inspectionReport.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reportNumber: true,
        poNumber: true,
        status: true,
        templateKey: true,
        createdAt: true,
        customer: { select: { name: true } },
        _count: { select: { serialNumbers: true } },
        transitionLogs: {
          select: { toStatus: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    return reports.map((r) => ({
      id: r.id,
      reportNumber: r.reportNumber,
      poNumber: r.poNumber,
      status: r.status,
      templateKey: r.templateKey,
      customerName: r.customer?.name ?? null,
      serialCount: r._count.serialNumbers,
      createdAt: r.createdAt,
      events: r.transitionLogs.map((l) => ({
        status: l.toStatus,
        at: l.timestamp,
      })),
    }));
  }
}
