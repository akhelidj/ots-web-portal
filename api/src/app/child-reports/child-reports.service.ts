import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import {
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
  Prisma,
} from '@prisma/client';

@Injectable()
export class ChildReportsService {
  constructor(
    private prisma: PrismaService,
    private filesService: FilesService,
  ) {}

  async syncReworkChildReport(tenantId: string, inspectionReportId: string) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { id: inspectionReportId, tenantId },
      include: {
        serialNumbers: true,
        childReports: {
          where: { type: ChildReportType.REWORK },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    const reworkSerials = report.serialNumbers.filter((sn) => {
      const data = (sn.inspectionData as Record<string, unknown>) || {};
      const bodySection = data['body'] as Record<string, unknown> | undefined;
      const disposition = bodySection?.['emiResult'] as string;
      return disposition === SerialDisposition.REWORK;
    });

    const existingChild = report.childReports[0];

    if (reworkSerials.length === 0) {
      if (existingChild) {
        if (existingChild.status === ChildReportStatus.DRAFT) {
          await this.prisma.$transaction([
            this.prisma.childReportSerialNumber.deleteMany({
              where: { childReportId: existingChild.id },
            }),
            this.prisma.childReport.delete({ where: { id: existingChild.id } }),
          ]);
          return null;
        } else {
          const [, updated] = await this.prisma.$transaction([
            this.prisma.childReportSerialNumber.deleteMany({
              where: { childReportId: existingChild.id },
            }),
            this.prisma.childReport.update({
              where: { id: existingChild.id },
              data: { version: { increment: 1 } },
              include: {
                attachments: true,
                serialNumbers: {
                  include: { serialNumber: true },
                },
              },
            }),
          ]);
          return this.mapChildReportResponse(updated);
        }
      }
      return null;
    }

    let crId: string;
    if (existingChild) {
      crId = existingChild.id;
    } else {
      let generatedChildReportNumber: string | undefined = undefined;
      if (report.reportNumber) {
        generatedChildReportNumber = `${report.reportNumber}_rework`;
      }
      const newCr = await this.prisma.childReport.create({
        data: {
          tenantId,
          inspectionReportId,
          reportNumber: generatedChildReportNumber,
          type: ChildReportType.REWORK,
          status: ChildReportStatus.DRAFT,
          version: 1,
        },
      });
      crId = newCr.id;
    }

    await this.prisma.$transaction(async (tx) => {
      // Load existing rows so we can preserve their inspectionData and disposition
      const existingRows = await tx.childReportSerialNumber.findMany({
        where: { childReportId: crId },
      });
      const existingMap = new Map(
        existingRows.map((r) => [r.serialNumberId, r]),
      );

      const reworkSnIds = new Set(reworkSerials.map((sn) => sn.id));

      // Delete rows whose serial is no longer REWORK
      const toDelete = existingRows.filter(
        (r) => !reworkSnIds.has(r.serialNumberId),
      );
      if (toDelete.length > 0) {
        await tx.childReportSerialNumber.deleteMany({
          where: { id: { in: toDelete.map((r) => r.id) } },
        });
      }

      // Create only rows that don't already exist (new additions to REWORK set)
      const toCreate = reworkSerials.filter((sn) => !existingMap.has(sn.id));
      if (toCreate.length > 0) {
        await tx.childReportSerialNumber.createMany({
          data: toCreate.map((sn) => ({
            childReportId: crId,
            serialNumberId: sn.id,
            // inspectionData and disposition intentionally omitted — start blank for new serials
          })),
        });
      }

      if (existingChild) {
        await tx.childReport.update({
          where: { id: crId },
          data: { version: { increment: 1 } },
        });
      }
    });

    const result = await this.prisma.childReport.findUnique({
      where: { id: crId },
      include: {
        attachments: true,
        serialNumbers: {
          include: { serialNumber: true },
        },
      },
    });
    return this.mapChildReportResponse(result);
  }

  private mapChildReportResponse(
    cr: Prisma.ChildReportGetPayload<{
      include: {
        attachments: true;
        serialNumbers: { include: { serialNumber: true } };
      };
    }> | null,
  ) {
    if (!cr) return cr;
    return {
      ...cr,
      attachmentCount: cr.attachments.length,
      serialNumbers: cr.serialNumbers
        ? cr.serialNumbers.map((sn) => ({
            id: sn.serialNumberId,
            serial: sn.serialNumber?.serial || '',
            inspectionData: sn.inspectionData as Record<string, unknown> | null,
            disposition: sn.disposition,
            approvalStatus: sn.approvalStatus,
          }))
        : [],
    };
  }

  async getChildReports(tenantId: string, inspectionReportId: string) {
    const reports = await this.prisma.childReport.findMany({
      where: { tenantId, inspectionReportId },
      include: {
        attachments: true,
        serialNumbers: {
          include: { serialNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reports.map((cr) => this.mapChildReportResponse(cr));
  }

  async getChildReportById(tenantId: string, id: string) {
    const cr = await this.prisma.childReport.findFirst({
      where: { id, tenantId },
      include: {
        attachments: true,
        serialNumbers: {
          include: { serialNumber: true },
        },
      },
    });
    if (!cr) throw new NotFoundException('Child Report not found');
    return this.mapChildReportResponse(cr);
  }

  async updateChildReport(
    tenantId: string,
    id: string,
    userId: string,
    payload: { status?: ChildReportStatus; notes?: string },
    version: number,
  ) {
    if (version === undefined || version === null) {
      throw new BadRequestException('version is required');
    }

    const childToUpdate = await this.prisma.childReport.findFirst({
      where: { id, tenantId },
    });

    if (!childToUpdate) {
      throw new NotFoundException('Child Report not found');
    }

    try {
      const updated = await this.prisma.childReport.update({
        where: { id, tenantId, version },
        data: {
          status: payload.status !== undefined ? payload.status : undefined,
          notes: payload.notes !== undefined ? payload.notes : undefined,
          version: { increment: 1 },
        },
        include: {
          attachments: true,
          serialNumbers: {
            include: { serialNumber: true },
          },
        },
      });
      return this.mapChildReportResponse(updated);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'P2025'
      ) {
        throw new ConflictException(
          'Child Report was updated by another process or does not exist. Please refresh and try again.',
        );
      }
      throw err;
    }
  }

  async updateChildReportSerialNumber(
    tenantId: string,
    childReportId: string,
    serialNumberId: string,
    payload: {
      inspectionData?: Record<string, unknown>;
      disposition?: SerialDisposition;
    },
  ) {
    if (payload.disposition === SerialDisposition.REWORK) {
      throw new BadRequestException(
        'Child Report disposition cannot be REWORK.',
      );
    }

    const crsn = await this.prisma.childReportSerialNumber.findUnique({
      where: {
        childReportId_serialNumberId: { childReportId, serialNumberId },
      },
      include: { childReport: true },
    });

    if (!crsn || crsn.childReport.tenantId !== tenantId) {
      throw new NotFoundException(
        'Child Report Serial Number relation not found.',
      );
    }

    const dataToUpdate: Prisma.ChildReportSerialNumberUpdateInput = {
      inspectionData:
        payload.inspectionData !== undefined
          ? (payload.inspectionData as any)
          : undefined,
    };

    if (payload.inspectionData) {
      const bodySection = payload.inspectionData['body'] as
        | Record<string, unknown>
        | undefined;
      const disp = bodySection?.['emiResult'] as string;
      if (disp) {
        dataToUpdate.disposition = disp as any;
      }
    }

    // Auto-transition to INSPECTED_DRAFT
    if (crsn.approvalStatus === 'NOT_INSPECTED' && payload.inspectionData) {
      dataToUpdate.approvalStatus = 'INSPECTED_DRAFT';
    }

    await this.prisma.childReportSerialNumber.update({
      where: { id: crsn.id },
      data: dataToUpdate,
    });

    const result = await this.prisma.childReport.findUnique({
      where: { id: childReportId },
      include: {
        attachments: true,
        serialNumbers: {
          include: { serialNumber: true },
        },
      },
    });
    return this.mapChildReportResponse(result);
  }

  async addAttachment(
    tenantId: string,
    id: string,
    file: { originalname: string; buffer: Buffer },
  ) {
    const childReport = await this.prisma.childReport.findFirst({
      where: { id, tenantId },
    });

    if (!childReport) {
      throw new NotFoundException('Child Report not found');
    }

    if (
      childReport.status === ChildReportStatus.APPROVED ||
      childReport.status === ChildReportStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Cannot add attachment: Child Report is locked.',
      );
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        filename: file.originalname,
        url: '',
        childReportId: id,
      },
    });

    try {
      await this.filesService.saveAttachmentBinary(attachment.id, file.buffer);
      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          url: this.filesService.buildAttachmentUrl(attachment.id),
        },
      });

      return updated;
    } catch (error) {
      await this.prisma.attachment.delete({ where: { id: attachment.id } });
      await this.filesService.removeAttachmentBinary(attachment.id);
      throw error;
    }
  }
}
