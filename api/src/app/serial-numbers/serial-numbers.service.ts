import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SerialNumbersService {
  constructor(private prisma: PrismaService) {}

  async getSerialNumbers(tenantId: string, reportId: string) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id: reportId },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${reportId} not found`);
    }

    return this.prisma.serialNumber.findMany({
      where: { inspectionReportId: reportId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSerialNumber(tenantId: string, reportId: string, userId: string, payload: any) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id: reportId },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${reportId} not found`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.serialNumber.create({
          data: {
            ...payload,
            inspectionReportId: reportId,
            version: 1,
          },
        });

        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entity: 'SerialNumber',
            entityId: created.id,
            tenantId,
            userId,
            reason: 'Added serial number',
            inspectionReportId: reportId,
          },
        });

        return created;
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Serial number ${payload.serial} already exists in this report.`);
      }
      throw new BadRequestException('Failed to create serial number: ' + e.message);
    }
  }

  async updateSerialNumber(tenantId: string, id: string, userId: string, payload: any, version: number) {
    const serial = await this.prisma.serialNumber.findUnique({
      where: { id },
      include: { inspectionReport: true },
    });

    if (!serial || serial.inspectionReport.tenantId !== tenantId) {
      throw new NotFoundException(`SerialNumber ${id} not found`);
    }

    if (serial.version !== version) {
      throw new ConflictException(`Version mismatch. Expected ${serial.version}, got ${version}`);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.serialNumber.updateMany({
        where: { 
            id,
            version: serial.version
        },
        data: {
          ...payload,
          version: serial.version + 1,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException(`Version mismatch or entity not found. Expected version: ${serial.version}`);
      }

      const updated = await tx.serialNumber.findUniqueOrThrow({
        where: { id }
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'SerialNumber',
          entityId: id,
          tenantId,
          userId,
          reason: 'Manual update',
          inspectionReportId: serial.inspectionReportId,
        },
      });

      return updated;
    });
  }
}
