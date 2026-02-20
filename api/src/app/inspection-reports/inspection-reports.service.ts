import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InspectionReportsService {
  constructor(private prisma: PrismaService) {}

  async getReports(tenantId: string) {
    return this.prisma.inspectionReport.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getReportById(tenantId: string, id: string) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }
    return report;
  }

  async updateReport(
    tenantId: string,
    id: string,
    userId: string,
    data: any,
    version: number,
  ) {
    const existing = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id },
    });

    if (!existing) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }

    if (existing.version !== version) {
      throw new ConflictException(`Version mismatch. Expected ${existing.version}, got ${version}`);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.inspectionReport.updateMany({
        where: { 
            id,
            tenantId,
            version: existing.version
        },
        data: {
          ...data,
          version: existing.version + 1,
        },
      });

      if (updateResult.count === 0) {
          throw new ConflictException(`Version mismatch or entity not found. Expected version: ${existing.version}`);
      }
      
      const updated = await tx.inspectionReport.findUniqueOrThrow({
          where: { id }
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'InspectionReport',
          entityId: id,
          tenantId,
          userId,
          reason: 'Manual update',
          inspectionReportId: id,
        },
      });

      return updated;
    });
  }
}
