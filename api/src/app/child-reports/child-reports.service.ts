import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';
import {
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
  Prisma,
} from '@prisma/client';
import { InspectionData } from '../common/inspection-data.types';

@Injectable()
export class ChildReportsService {
  constructor(
    private prisma: PrismaService,
    private filesService: FilesService,
    private reworkRulesInterpreter: ReworkRulesInterpreter,
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

    // Definition gate (mirrors inspection-report-workflow.service.ts:311-326 and the
    // approval-gate / export cutovers): the template's structured rework rules are the
    // SOLE live path. Location 4 of the drill-pipe hardcode retirement is complete — the
    // imperative body that used to follow was frozen as an independent oracle
    // (api/test/rework-imperative-oracle.ts) and proven equivalent before deletion. Keyed
    // exactly as the approval gate on tenantId_templateKey_templateVersion.
    const template = await this.prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId,
          templateKey: report.templateKey,
          templateVersion: report.templateVersion,
        },
      },
      select: { definitionJson: true },
    });
    const definition =
      (template?.definitionJson as unknown as { rules: unknown } | null) ?? null;

    if (definition) {
      return this.reworkRulesInterpreter.syncFromRules(
        tenantId,
        inspectionReportId,
        definition.rules,
      );
    }

    // NULL arm — defensive precondition, not a user-facing validation error. Every ACTIVE
    // template is backfilled with definitionJson (the rework rules ride Template.definitionJson,
    // populated at cutover), so a report whose pinned template has no definition is a server
    // misconfiguration, not something an inspector can cause or fix. Mirrors the gate/export
    // 412 pattern rather than the VALIDATION_FAILED 400.
    throw new PreconditionFailedException(
      `Template ${report.templateKey}@${report.templateVersion} has no rework rules ` +
        `(definitionJson is null); rework sync requires a definition-bound template.`,
    );
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
            inspectionData: sn.inspectionData as InspectionData | null,
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
      inspectionData?: InspectionData;
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
          ? (payload.inspectionData as Prisma.InputJsonValue)
          : undefined,
    };

    if (payload.inspectionData) {
      const bodySection = payload.inspectionData.body;
      const disp = bodySection?.emiResult;
      if (disp) {
        // Detect the enum value honestly in-service instead of casting an
        // arbitrary string into the column. Invalid values were previously
        // rejected by Prisma at query time; reject them here up front.
        if (
          !Object.values(SerialDisposition).includes(disp as SerialDisposition)
        ) {
          throw new BadRequestException(`Invalid disposition value: ${disp}`);
        }
        // Guard-gap fix (3d-ii): the top-level guard at the method head only
        // inspects payload.disposition, but the value actually persisted comes
        // from inspectionData.body.emiResult. Re-apply the SAME REWORK rejection
        // to the resolved value so REWORK cannot be smuggled in via emiResult.
        if ((disp as SerialDisposition) === SerialDisposition.REWORK) {
          throw new BadRequestException(
            'Child Report disposition cannot be REWORK.',
          );
        }
        dataToUpdate.disposition = disp as SerialDisposition;
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
