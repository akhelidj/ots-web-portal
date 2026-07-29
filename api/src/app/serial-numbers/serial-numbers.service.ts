import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole, InspectionReportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SerialNumbersService {
  constructor(private prisma: PrismaService) {}

  async getSerialNumbers(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    reportId: string,
  ) {
    const where: Prisma.InspectionReportWhereInput = {
      tenantId: user.tenantId,
      id: reportId,
    };
    if (user.role === UserRole.CUSTOMER) {
      where.customerId = user.customerId;
    }
    const report = await this.prisma.inspectionReport.findFirst({
      where,
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${reportId} not found`);
    }

    const serials = await this.prisma.serialNumber.findMany({
      where: { tenantId: user.tenantId, inspectionReportId: reportId },
      orderBy: { serial: 'asc' },
    });

    return serials.map((s) => {
      return {
        id: s.id,
        serialNumber: s.serial,
        version: s.version,
        inspectionData: s.inspectionData,
        disposition: s.disposition,
        approvalStatus: s.approvalStatus,
        updatedAt: s.updatedAt,
      };
    });
  }

  async createSerialNumber(
    tenantId: string,
    reportId: string,
    userId: string,
    payload: { items: { clientRef: string; serialNumber: string }[] },
  ) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id: reportId },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport not found in this tenant`);
    }

    const { items } = payload;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException(
        'Items array must be provided and not empty',
      );
    }

    if (
      report.status === InspectionReportStatus.APPROVED ||
      report.status === InspectionReportStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Cannot add serial numbers to an Approved or Closed report.',
      );
    }

    // Process items: trim, reject empty
    const processedItems: { clientRef: string; serial: string }[] = [];
    const duplicatesInPayload = new Set<string>();
    const seenValuesLower = new Set<string>();

    for (const item of items) {
      const trimmed = (item.serialNumber || '').trim();
      if (!trimmed) {
        throw new BadRequestException('Serial number cannot be empty');
      }
      const normalized = trimmed.toLowerCase();
      if (seenValuesLower.has(normalized)) {
        duplicatesInPayload.add(trimmed);
      } else {
        seenValuesLower.add(normalized);
        processedItems.push({ clientRef: item.clientRef, serial: trimmed });
      }
    }

    if (duplicatesInPayload.size > 0) {
      throw new ConflictException({
        message: 'Payload contains duplicate serial numbers',
        duplicatesInPayload: Array.from(duplicatesInPayload),
        alreadyExists: [],
      });
    }

    // Check DB for existing SNs in this report
    const existingSns = await this.prisma.serialNumber.findMany({
      where: {
        tenantId,
        inspectionReportId: reportId,
        OR: processedItems.map((item) => ({
          serial: {
            equals: item.serial,
            mode: 'insensitive',
          },
        })),
      },
      select: { serial: true },
    });

    if (existingSns.length > 0) {
      throw new ConflictException({
        message: 'Serial numbers already exist in database',
        duplicatesInPayload: [],
        alreadyExists: existingSns.map((sn) => sn.serial),
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
          },
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
          reason: `Bulk created ${createdRecords.length} serial numbers`,
        },
      });

      return {
        items: createdRecords.map((r) => ({
          clientRef: r.clientRef,
          id: r.id,
          serialNumber: r.serial,
          version: r.version,
          approvalStatus: 'NOT_INSPECTED',
        })),
      };
    });
  }

  async updateSerialNumber(
    tenantId: string,
    id: string,
    userId: string,
    payload: { serialNumber?: string; inspectionData?: any },
    version: number,
  ) {
    if (version === undefined || version === null) {
      throw new BadRequestException('version is required');
    }

    // 1. Tenant-scoped lock check on parent InspectionReport
    const serialToUpdate = (await this.prisma.serialNumber.findFirst({
      where: { id, tenantId },
      include: { inspectionReport: true },
    })) as Prisma.SerialNumberGetPayload<{
      include: { inspectionReport: true };
    }> | null;

    if (!serialToUpdate) {
      throw new NotFoundException(`SerialNumber not found`);
    }

    const reportStatus = serialToUpdate.inspectionReport.status;
    if (
      reportStatus === InspectionReportStatus.APPROVED ||
      reportStatus === InspectionReportStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Inspection data is locked by report status.',
      );
    }

    // 2. Serial Number Approval Status lock check
    if (
      serialToUpdate.approvalStatus === 'SUBMITTED_FOR_APPROVAL' ||
      serialToUpdate.approvalStatus === 'APPROVED'
    ) {
      throw new BadRequestException(
        `Cannot edit serial numbers that are ${serialToUpdate.approvalStatus}`,
      );
    }

    const dataToUpdate: Prisma.SerialNumberUpdateInput = {
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
            serial: {
              equals: serialNumString,
              mode: 'insensitive',
            },
            id: { not: id }, // Exclude self
          },
        });

        if (collisionCheck) {
          throw new ConflictException(
            `Serial number ${serialNumString} already exists`,
          );
        }
        dataToUpdate.serial = serialNumString;
        reason = `Renamed from ${serialToUpdate.serial} to ${serialNumString}`;
      }
    }

    if (payload.inspectionData !== undefined) {
      // Merge inspection data instead of overriding completely, if we want.
      // E.g. { ...serialToUpdate.inspectionData as object, ...payload.inspectionData }
      // But usually PATCH payload is the complete merged state from client for offline first.
      // So replacing it is correct for our outbox implementation.
      dataToUpdate.inspectionData = payload.inspectionData;

      // Sync top-level disposition column
      if (payload.inspectionData) {
        const bodySection = payload.inspectionData['body'] as
          | Record<string, unknown>
          | undefined;
        const disp = bodySection?.['emiResult'] as string;
        if (disp) {
          dataToUpdate.disposition = disp as any;
        }
      }

      // Auto-transition to INSPECTED_DRAFT if meaningful data provided and not currently submitted/approved
      // (Lock check above ensures we aren't submitted or approved)
      // Actually we should safely check if we were previously NOT_INSPECTED
      if (serialToUpdate.approvalStatus === 'NOT_INSPECTED') {
        dataToUpdate.approvalStatus = 'INSPECTED_DRAFT';
      }

      const detail = reason
        ? ' and updated inspection data'
        : 'Updated inspection data';
      reason = reason + detail;
      if (!reason) reason = 'Updated inspection data';
    }

    // If nothing changed, just return it
    if (Object.keys(dataToUpdate).length === 1) {
      // only version present
      return {
        id: serialToUpdate.id,
        serialNumber: serialToUpdate.serial,
        version: serialToUpdate.version,
        inspectionData: serialToUpdate.inspectionData,
        approvalStatus: serialToUpdate.approvalStatus,
        updatedAt: serialToUpdate.updatedAt,
      };
    }

    return await this.prisma.$transaction(async (tx) => {
      let updated;
      try {
        updated = await tx.serialNumber.update({
          where: {
            id,
            tenantId,
            version, // Optimistic locking
          },
          data: dataToUpdate,
        });
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          err.code === 'P2025'
        ) {
          throw new ConflictException(
            `Version mismatch or entity not found on final commit`,
          );
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

      return {
        id: updated.id,
        serialNumber: updated.serial,
        version: updated.version,
        inspectionData: updated.inspectionData,
        disposition: updated.disposition,
        approvalStatus: updated.approvalStatus,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async deleteSerialNumber(tenantId: string, id: string, userId: string) {
    const serialToDelete = await this.prisma.serialNumber.findFirst({
      where: { id, tenantId },
      include: { inspectionReport: true },
    });

    if (!serialToDelete) {
      throw new NotFoundException(`SerialNumber not found`);
    }

    const reportStatus = serialToDelete.inspectionReport.status;
    const allowedStatuses: string[] = [
      InspectionReportStatus.DRAFT,
      InspectionReportStatus.RECEIVED,
      InspectionReportStatus.READY_FOR_CLEANING,
    ];

    if (!allowedStatuses.includes(reportStatus)) {
      throw new BadRequestException(
        'Serial numbers can only be removed before the inspection stage (DRAFT, RECEIVED, READY_FOR_CLEANING).',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.serialNumber.delete({
        where: { id },
      });

      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entity: 'SerialNumber',
          entityId: id,
          tenantId,
          userId,
          inspectionReportId: serialToDelete.inspectionReportId,
          reason: `Deleted serial number ${serialToDelete.serial}`,
        },
      });

      return { ok: true };
    });
  }
}
