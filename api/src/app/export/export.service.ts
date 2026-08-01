import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RevisionService } from '../revision/revision.service';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mapDrillPipeReportV1 } from './mappings/drill-pipe-report.v1.mapping';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserRole,
  InspectionReportStatus,
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
} from '@prisma/client';
import { InspectionData, Snapshot } from '../common/inspection-data.types';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisionService: RevisionService,
  ) {}

  async exportInspectionReport(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    reportId: string,
    requestedRevision?: number,
  ): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    // 1. Fetch Report & Validate Approval
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
      include: {
        customer: { select: { name: true } },
        childReports: {
          include: {
            serialNumbers: {
              include: { serialNumber: true },
              orderBy: { serialNumber: { serial: 'asc' } },
            },
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection report not found');
    }
    if (report.tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied');
    }
    if (
      user.role === UserRole.CUSTOMER &&
      report.customerId !== user.customerId
    ) {
      throw new ForbiddenException(
        'Access denied: report does not belong to customer',
      );
    }

    const isParentApproved =
      report.status === InspectionReportStatus.APPROVED ||
      report.status === InspectionReportStatus.CLOSED;

    const childReport = report.childReports.find(
      (cr) => cr.type === ChildReportType.REWORK,
    );
    const isChildApproved =
      childReport &&
      (childReport.status === ChildReportStatus.APPROVED ||
        childReport.status === ChildReportStatus.CLOSED);

    if (!isParentApproved && !isChildApproved) {
      throw new ForbiddenException(
        `Export is only allowed when either the Parent or Child report is ${InspectionReportStatus.APPROVED} or ${InspectionReportStatus.CLOSED}`,
      );
    }

    // 2. Resolve Revision
    let revisionNumber = requestedRevision;
    if (revisionNumber === undefined) {
      revisionNumber = report.revisionNumber;
    }

    let snapshot: Snapshot;

    if (revisionNumber === 0) {
      // Build an equivalent snapshot on-the-fly from live data so export still works.
      const liveReport = await this.prisma.inspectionReport.findUnique({
        where: { id: reportId },
        include: {
          serialNumbers: { orderBy: { serial: 'asc' } },
          childReports: {
            orderBy: { reportNumber: 'asc' },
            select: { id: true, reportNumber: true, status: true },
          },
          transitionLogs: { orderBy: { timestamp: 'asc' } },
        },
      });
      if (!liveReport) {
        throw new NotFoundException('Inspection report not found');
      }
      snapshot = {
        header: {
          id: liveReport.id,
          poNumber: liveReport.poNumber,
          reportNumber: liveReport.reportNumber,
          status: liveReport.status,
          customerId: liveReport.customerId,
          createdAt: liveReport.createdAt,
          updatedAt: liveReport.updatedAt,
          grade: liveReport.grade,
          range: liveReport.range,
          weight: liveReport.weight,
          nomWT: liveReport.nomWT,
          nomOD: liveReport.nomOD,
          nomID: liveReport.nomID,
          connection: liveReport.connection,
          inspectionAddress: liveReport.inspectionAddress,
          standardUsed: liveReport.standardUsed,
          inspectorComment: liveReport.inspectorComment,
          equipmentUsed:
            liveReport.equipmentUsed as Snapshot['header']['equipmentUsed'],
          inspectionMethod:
            liveReport.inspectionMethod as Snapshot['header']['inspectionMethod'],
        },
        template: {
          key: liveReport.templateKey,
          version: liveReport.templateVersion,
          hash: liveReport.templateHash,
          versionId: liveReport.templateVersionId,
        },
        serialNumbers: liveReport.serialNumbers.map((sn) => {
          const data = sn.inspectionData as InspectionData | null;
          return {
            id: sn.id,
            serial: sn.serial,
            inspectionData: sn.inspectionData as InspectionData,
            disposition: data?.final?.disposition || data?.disposition || null,
            updatedAt: sn.updatedAt,
          };
        }),
        childReports: liveReport.childReports,
        transitionLogs: liveReport.transitionLogs,
      } satisfies Snapshot;
    } else {
      const revision = await this.prisma.inspectionReportRevision.findUnique({
        where: {
          inspectionReportId_revisionNumber: {
            inspectionReportId: reportId,
            revisionNumber: revisionNumber,
          },
        },
      });

      if (!revision) {
        throw new NotFoundException(`Revision ${revisionNumber} not found`);
      }

      snapshot = revision.snapshotJson as unknown as Snapshot;
      if (!snapshot) {
        throw new InternalServerErrorException('Snapshot data is missing');
      }
    }

    // Inject User Data into Snapshot for the export mappers to compute "Inspected By" and "Approved By"
    const transitionUserIds = (snapshot.transitionLogs || [])
      .map((l) => l.userId)
      .filter((id): id is string => Boolean(id));
    if (transitionUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: transitionUserIds } },
        select: { id: true, name: true, email: true },
      });
      snapshot.users = users;
    }

    const liveTransitionLogs =
      await this.prisma.inspectionReportTransitionLog.findMany({
        where: { inspectionReportId: reportId },
        orderBy: { timestamp: 'asc' },
        select: { userId: true, toStatus: true, timestamp: true },
      });

    const latestApprovedBatch =
      await this.prisma.inspectionApprovalBatch.findFirst({
        where: {
          inspectionReportId: reportId,
          status: 'APPROVED',
          reviewedByUserId: { not: null },
        },
        orderBy: { reviewedAt: 'desc' },
        select: { reviewedByUserId: true },
      });

    const userIds = new Set<string>();
    for (const log of liveTransitionLogs) {
      if (log.userId) {
        userIds.add(log.userId);
      }
    }
    if (latestApprovedBatch?.reviewedByUserId) {
      userIds.add(latestApprovedBatch.reviewedByUserId);
    }

    let usersById = new Map<string, { name: string | null; email: string }>();
    if (userIds.size > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, name: true, email: true },
      });
      usersById = new Map(
        users.map((u) => [u.id, { name: u.name, email: u.email }]),
      );
    }

    const latestInspectorLog = [...liveTransitionLogs]
      .reverse()
      .find((log) => log.toStatus === 'IN_INSPECTION');
    const latestApproveLog = [...liveTransitionLogs]
      .reverse()
      .find((log) => log.toStatus === 'APPROVED' || log.toStatus === 'CLOSED');

    const inspectedByName = latestInspectorLog?.userId
      ? usersById.get(latestInspectorLog.userId)?.name ||
        usersById.get(latestInspectorLog.userId)?.email ||
        'N/A'
      : 'N/A';

    let approvedByName = 'N/A';
    if (latestApproveLog?.userId) {
      approvedByName =
        usersById.get(latestApproveLog.userId)?.name ||
        usersById.get(latestApproveLog.userId)?.email ||
        'N/A';
    } else if (latestApprovedBatch?.reviewedByUserId) {
      approvedByName =
        usersById.get(latestApprovedBatch.reviewedByUserId)?.name ||
        usersById.get(latestApprovedBatch.reviewedByUserId)?.email ||
        'N/A';
    }

    snapshot.header = snapshot.header || ({} as Snapshot['header']);
    snapshot.header.inspectedByName = inspectedByName;
    snapshot.header.approvedByName = approvedByName;

    // Inject Customer Data
    if (!snapshot.header.customerName) {
      snapshot.header.customerName = report.customer?.name || 'N/A';
    }

    // 4. Fetch Template Bytes and verify
    const template = await this.prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId: user.tenantId,
          templateKey: report.templateKey,
          templateVersion: report.templateVersion,
        },
      },
    });

    if (!template) {
      throw new InternalServerErrorException(
        'Template file could not be loaded',
      );
    }

    if (template.hash !== report.templateHash) {
      throw new InternalServerErrorException(
        'Template hash verification failed',
      );
    }

    const templateBuffer = template.fileBlob;

    const allFiles: { buffer: Buffer; filename: string }[] = [];
    const poStr =
      report.poNumber && report.poNumber.trim().length > 0
        ? report.poNumber.trim().replace(/\s+/g, '_').toUpperCase()
        : 'NOPO';
    const reportNum = report.reportNumber || 'UNKNOWN';
    const baseParentFilename = `OTS_${poStr}_${reportNum}_${revisionNumber}`;
    const baseChildFilename = `OTS_${poStr}_${reportNum}_rework_${revisionNumber}`; // Child naming: _rework

    if (isParentApproved) {
      const parentSerials = [...(snapshot.serialNumbers || [])];

      // Order Parent export deterministic: non-REWORK first, REWORK last, original ID/Sequence order preserved
      parentSerials.sort((a, b) => {
        const aDisp = (a.disposition || '').toUpperCase();
        const bDisp = (b.disposition || '').toUpperCase();
        const aIsRework = aDisp === SerialDisposition.REWORK ? 1 : 0;
        const bIsRework = bDisp === SerialDisposition.REWORK ? 1 : 0;

        if (aIsRework !== bIsRework) {
          return aIsRework - bIsRework;
        }

        return (a.serial || '').localeCompare(b.serial || '');
      });

      const parentFiles = await this.generateExcelFiles(
        templateBuffer,
        report.templateKey,
        snapshot,
        parentSerials,
        baseParentFilename,
      );
      allFiles.push(...parentFiles);
    }

    if (isChildApproved && childReport) {
      // Map child serials to the structure expected by applyMapping
      const childSerials = childReport.serialNumbers.map((crsn) => {
        const sn = crsn.serialNumber;
        return {
          id: sn.id,
          serial: sn.serial,
          inspectionData: crsn.inspectionData as InspectionData,
          disposition: crsn.disposition,
          updatedAt: sn.updatedAt,
        };
      });

      const childFiles = await this.generateExcelFiles(
        templateBuffer,
        report.templateKey,
        snapshot,
        childSerials,
        baseChildFilename,
      );
      allFiles.push(...childFiles);
    }

    if (allFiles.length === 0) {
      throw new InternalServerErrorException('No files generated for export');
    }

    const single = allFiles[0];
    if (allFiles.length === 1 && single) {
      return {
        buffer: single.buffer,
        filename: single.filename,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    // Zip multiple files (either chunks or parent+child combo)
    const zip = new JSZip();
    for (const f of allFiles) {
      zip.file(
        f.filename,
        f.buffer as unknown as Parameters<typeof zip.file>[1],
      );
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    return {
      buffer: zipBuffer as unknown as Buffer,
      filename: `OTS_${poStr}_${reportNum}_${revisionNumber}.zip`,
      mimetype: 'application/zip',
    };
  }

  private async generateExcelFiles(
    templateBuffer: Buffer,
    templateKey: string,
    snapshot: Snapshot,
    serialNumbers: Snapshot['serialNumbers'],
    baseFilename: string,
  ): Promise<{ buffer: Buffer; filename: string }[]> {
    const files: { buffer: Buffer; filename: string }[] = [];
    const N = serialNumbers.length;

    if (N === 0) {
      return files;
    }

    if (N <= 10) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );

      try {
        await this.applyMapping(templateKey, workbook, snapshot, serialNumbers);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined;
        throw new BadRequestException(
          message || 'Error applying template mapping',
        );
      }

      const outBuffer = await workbook.xlsx.writeBuffer();
      files.push({
        buffer: Buffer.from(outBuffer),
        filename: `${baseFilename}.xlsx`,
      });
    } else {
      const chunks = Math.ceil(N / 10);
      for (let k = 1; k <= chunks; k++) {
        const startIndex = (k - 1) * 10;
        const endIndex = startIndex + 10;
        const chunkSerials = serialNumbers.slice(startIndex, endIndex);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
        );

        try {
          await this.applyMapping(
            templateKey,
            workbook,
            snapshot,
            chunkSerials,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : undefined;
          throw new BadRequestException(
            `Error in part ${k}: ${message || 'Error applying template mapping'}`,
          );
        }

        const partBuffer = await workbook.xlsx.writeBuffer();
        files.push({
          buffer: Buffer.from(partBuffer),
          filename: `${baseFilename}_part${k}of${chunks}.xlsx`,
        });
      }
    }
    return files;
  }

  private async applyMapping(
    templateKey: string,
    workbook: ExcelJS.Workbook,
    snapshot: Snapshot,
    chunk: Snapshot['serialNumbers'],
  ): Promise<void> {
    if (templateKey === 'DRILL_PIPE_REPORT') {
      await mapDrillPipeReportV1(workbook, snapshot, chunk);
      return;
    }

    throw new BadRequestException(
      `Mapping not defined for template key: ${templateKey}`,
    );
  }
}
