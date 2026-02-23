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

    const serials = await this.prisma.serialNumber.findMany({
      where: { tenantId, inspectionReportId: reportId },
      orderBy: { serial: 'asc' },
    });

    return serials.map(s => {
      // Exclude inspectionData, add inspectionJson
      const { inspectionData, ...rest } = s;
      return {
        ...rest,
        inspectionJson: inspectionData
      };
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

  async updateSerialNumber(tenantId: string, id: string, userId: string, payload: { serialNumber?: string, inspectionJson?: any }, version: number) {
    const serialToUpdate = await this.prisma.serialNumber.findUnique({
      where: { id },
      include: { inspectionReport: true }
    });

    if (!serialToUpdate || serialToUpdate.tenantId !== tenantId) {
      throw new NotFoundException(`SerialNumber not found`);
    }

    if (serialToUpdate.version !== version) {
      throw new ConflictException(`Version mismatch`);
    }

    const reportStatus = serialToUpdate.inspectionReport.status;
    if (reportStatus === 'APPROVED' || reportStatus === 'CLOSED') {
      throw new BadRequestException('Inspection data is locked.');
    }

    const dataToUpdate: any = {
      version: serialToUpdate.version + 1,
    };
    
    let reason = '';

    if (payload.serialNumber !== undefined) {
      const serialNumString = payload.serialNumber.trim();
      if (!serialNumString) {
        throw new BadRequestException('Serial number cannot be empty');
      }
      
      if (serialNumString !== serialToUpdate.serial) {
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
        dataToUpdate.serial = serialNumString;
        reason = `Renamed from ${serialToUpdate.serial} to ${serialNumString}`;
      }
    }

    if (payload.inspectionJson !== undefined) {
      dataToUpdate.inspectionData = payload.inspectionJson;
      const detail = reason ? ' and updated inspection data' : 'Updated inspection data';
      reason = reason + detail;
      if (!reason) reason = 'Updated inspection data';
    }

    // If nothing changed, just return it
    if (Object.keys(dataToUpdate).length === 1) {
      const { inspectionData, ...rest } = serialToUpdate;
      return {
          id: rest.id,
          serialNumber: rest.serial,
          version: rest.version,
          inspectionJson: inspectionData,
          updatedAt: rest.updatedAt
      };
    }

    return await this.prisma.$transaction(async (tx) => {
      // Use update instead of updateMany since id is unique. We manually queried the version above,
      // but to be absolutely safe from race conditions, we can use updateMany or we can just use
      // the id. Actually, Prisma's update doesn't allow { version } in where unless it's unique.
      // But we can use update with { id } and verify the version inside the transaction or use updateMany.
      // The user requested: "Use update with { id, tenantId, version } for atomic optimistic concurrency."
      // Since Prisma 5 allows non-unique fields in update where, we can use update. 
      // If Prisma version does not support it, it will fail conceptually, but wait, Prisma update where can take id, and other fields together.
      
      let updated;
      try {
        updated = await tx.serialNumber.update({
          where: { 
              id,
              tenantId,
              version: serialToUpdate.version
          },
          data: dataToUpdate,
        });
      } catch (err: any) {
        if (err.code === 'P2025') {
          throw new ConflictException(`Version mismatch or entity not found on final commit`);
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'SerialNumber',
          entityId: id,
          tenantId,
          userId,
          reason: reason.trim(),
          inspectionReportId: serialToUpdate.inspectionReportId,
        },
      });

      const { inspectionData, ...rest } = updated;
      return {
          id: rest.id,
          serialNumber: rest.serial,
          version: rest.version,
          inspectionJson: inspectionData,
          updatedAt: rest.updatedAt
      };
    });
  }
}
