import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChildReportStatus, ChildReportType } from '@prisma/client';

@Injectable()
export class ChildReportsService {
  constructor(private prisma: PrismaService) {}

  async createChildReport(tenantId: string, userId: string, payload: { id: string, inspectionReportId: string, serialNumberId: string, type: ChildReportType, notes?: string }) {
    // Deterministic Idempotency
    const existing = await this.prisma.childReport.findUnique({
      where: { id: payload.id, tenantId }
    });
    if (existing) {
      return existing; // 200 OK idempotent return
    }

    // Tenant Scope + Parent Lock Check + Serial Ownership validation
    const report = await this.prisma.inspectionReport.findFirst({
      where: { id: payload.inspectionReportId, tenantId },
      include: {
        serialNumbers: {
           where: { id: payload.serialNumberId, tenantId }
        }
      }
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    if (report.status === 'APPROVED' || report.status === 'CLOSED') {
      throw new BadRequestException('Cannot create Child Report: Inspection Report is locked.');
    }

    if (report.serialNumbers.length === 0) {
      throw new BadRequestException('Serial Number not found or does not belong to this Inspection Report.');
    }

    const serialNumber = report.serialNumbers[0];
    const data = (serialNumber.inspectionData as Record<string, unknown>) || {};
    const disposition = data.disposition;

    if (!disposition || disposition === 'PASS') {
      throw new BadRequestException('Child Reports can only be created for Serial Numbers with a REWORK, SCRAP, or HOLD disposition.');
    }

    if (disposition !== payload.type) {
      throw new BadRequestException(`Disposition mismatch: Cannot create a ${payload.type} Child Report for a Serial Number marked as ${disposition}.`);
    }

    // Atomic Create
    const childReport = await this.prisma.childReport.create({
      data: {
        id: payload.id,
        tenantId,
        inspectionReportId: payload.inspectionReportId,
        serialNumberId: payload.serialNumberId,
        type: payload.type,
        notes: payload.notes,
        status: ChildReportStatus.DRAFT,
        version: 1
      }
    });

    return childReport;
  }

  async getChildReports(tenantId: string, inspectionReportId: string) {
    return this.prisma.childReport.findMany({
      where: { tenantId, inspectionReportId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateChildReport(tenantId: string, id: string, userId: string, payload: { status?: ChildReportStatus, notes?: string }, version: number) {
    if (version === undefined || version === null) {
      throw new BadRequestException('version is required');
    }

    // Tenant-scoped parent lock check
    const childToUpdate = await this.prisma.childReport.findFirst({
        where: { id, tenantId },
        include: { inspectionReport: true }
    });

    if (!childToUpdate) {
        throw new NotFoundException('Child Report not found');
    }

    const reportStatus = childToUpdate.inspectionReport.status;
    if (reportStatus === 'APPROVED' || reportStatus === 'CLOSED') {
        throw new BadRequestException('Cannot update Child Report: Parent Inspection Report is locked.');
    }

    // Atomic Optimistic Concurrency Update
    try {
      const updated = await this.prisma.childReport.update({
        where: {
          id,
          tenantId,
          version
        },
        data: {
          status: payload.status !== undefined ? payload.status : undefined,
          notes: payload.notes !== undefined ? payload.notes : undefined,
          version: { increment: 1 }
        }
      });
      return updated;
    } catch (err: unknown) {
      const error = err as any;
      if (error.code === 'P2025') {
        throw new ConflictException('Child Report was updated by another process or does not exist. Please refresh and try again.');
      }
      throw error;
    }
  }
}
