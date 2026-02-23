import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
      where: { tenantId, inspectionReportId: reportId },
      orderBy: { serial: 'asc' },
    });
  }

  async createSerialNumber(tenantId: string, reportId: string, userId: string, payload: { items: { clientRef: string, serialNumber: string }[] }) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id: reportId },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport not found in this tenant`);
    }

    const { items } = payload;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Items array must be provided and not empty');
    }

    // Process items: trim, reject empty
    const processedItems: { clientRef: string, serial: string }[] = [];
    const duplicatesInPayload = new Set<string>();
    const seenValues = new Set<string>();

    for (const item of items) {
       const trimmed = (item.serialNumber || '').trim();
       if (!trimmed) {
         throw new BadRequestException('Serial number cannot be empty');
       }
       if (seenValues.has(trimmed)) {
          duplicatesInPayload.add(trimmed);
       } else {
          seenValues.add(trimmed);
          processedItems.push({ clientRef: item.clientRef, serial: trimmed });
       }
    }

    if (duplicatesInPayload.size > 0) {
        throw new ConflictException({
           message: 'Payload contains duplicate serial numbers',
           duplicatesInPayload: Array.from(duplicatesInPayload),
           alreadyExists: []
        });
    }

    // Check DB for existing SNs in this report
    const existingSns = await this.prisma.serialNumber.findMany({
       where: {
         tenantId,
         inspectionReportId: reportId,
         serial: { in: Array.from(seenValues) }
       },
       select: { serial: true }
    });

    if (existingSns.length > 0) {
        throw new ConflictException({
            message: 'Serial numbers already exist in database',
            duplicatesInPayload: [],
            alreadyExists: existingSns.map(sn => sn.serial)
        });
    }

    return await this.prisma.$transaction(async (tx) => {
        const createdRecords = [];
        for (const item of processedItems) {
            const created = await tx.serialNumber.create({
                data: {
                    tenantId,
                    inspectionReportId: reportId,
                    serial: item.serial,
                    version: 1,
                }
            });
            createdRecords.push({ clientRef: item.clientRef, ...created });
        }

        await tx.auditLog.create({
            data: {
               action: 'CREATE_BULK',
               entity: 'SerialNumber',
               entityId: reportId,
               tenantId,
               userId,
               inspectionReportId: reportId,
               reason: `Bulk created ${createdRecords.length} serial numbers`
            }
        });

        return { items: createdRecords.map(r => ({
            clientRef: r.clientRef,
            id: r.id,
            serialNumber: r.serial,
            version: r.version
        })) };
    });
  }

  async updateSerialNumber(tenantId: string, id: string, userId: string, payload: { serialNumber: string }, version: number) {
    const serialNumString = (payload.serialNumber || '').trim();
    if (!serialNumString) {
      throw new BadRequestException('Serial number cannot be empty');
    }

    const serialToUpdate = await this.prisma.serialNumber.findUnique({
      where: { id },
    });

    if (!serialToUpdate || serialToUpdate.tenantId !== tenantId) {
      throw new NotFoundException(`SerialNumber not found`);
    }

    if (serialToUpdate.version !== version) {
      throw new ConflictException(`Version mismatch`);
    }

    // Check uniqueness collision early
    const collisionCheck = await this.prisma.serialNumber.findFirst({
      where: {
         tenantId,
         inspectionReportId: serialToUpdate.inspectionReportId,
         serial: serialNumString,
         id: { not: id } // Exclude self
      }
    });

    if (collisionCheck) {
        throw new ConflictException(`Serial number ${serialNumString} already exists`);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.serialNumber.updateMany({
        where: { 
            id,
            tenantId,
            version: serialToUpdate.version
        },
        data: {
          serial: serialNumString,
          version: serialToUpdate.version + 1,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException(`Version mismatch or entity not found on final commit`);
      }

      const updated = await tx.serialNumber.findUniqueOrThrow({
        where: { id }
      });

      await tx.auditLog.create({
        data: {
          action: 'RENAME',
          entity: 'SerialNumber',
          entityId: id,
          tenantId,
          userId,
          reason: `Renamed from ${serialToUpdate.serial} to ${updated.serial}`,
          inspectionReportId: serialToUpdate.inspectionReportId,
        },
      });

      return {
          id: updated.id,
          serialNumber: updated.serial,
          version: updated.version,
          updatedAt: updated.updatedAt
      };
    });
  }
}
