import { Injectable, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { RevisionService } from '../revision/revision.service';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mapDrillPipeReportV1 } from './mappings/drill-pipe-report.v1.mapping';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisionService: RevisionService,
  ) {}

  async exportInspectionReport(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: any,
    reportId: string,
    requestedRevision?: number,
  ): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    // 1. Fetch Report & Validate Approval
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
      include: { customer: { select: { name: true } } },
    });

    if (!report) {
      throw new NotFoundException('Inspection report not found');
    }
    if (report.tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied');
    }
    if (user.role === 'CUSTOMER' && report.customerId !== user.customerId) {
      throw new ForbiddenException('Access denied: report does not belong to customer');
    }
    if (report.status !== 'APPROVED' && report.status !== 'CLOSED') {
      throw new ForbiddenException('Export is only allowed for APPROVED or CLOSED reports');
    }

    // 2. Resolve Revision
    let revisionNumber = requestedRevision;
    if (revisionNumber === undefined) {
      revisionNumber = report.revisionNumber;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let snapshot: any;

    if (revisionNumber === 0) {
      // No snapshot was ever created (report approved before snapshot feature was active).
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
          // Pipe Specifications
          grade: liveReport.grade,
          range: liveReport.range,
          weight: liveReport.weight,
          nomWT: liveReport.nomWT,
          nomOD: liveReport.nomOD,
          nomID: liveReport.nomID,
          connection: liveReport.connection,
          // Job Info
          inspectionAddress: liveReport.inspectionAddress,
          standardUsed: liveReport.standardUsed,
          inspectorComment: liveReport.inspectorComment,
          equipmentUsed: liveReport.equipmentUsed,
          inspectionMethod: liveReport.inspectionMethod,
        },
        template: {
          key: liveReport.templateKey,
          version: liveReport.templateVersion,
          hash: liveReport.templateHash,
          versionId: liveReport.templateVersionId,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialNumbers: liveReport.serialNumbers.map((sn: any) => ({
          id: sn.id,
          serial: sn.serial,
          inspectionData: sn.inspectionData,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          disposition: (sn.inspectionData as any)?.final?.disposition || (sn.inspectionData as any)?.disposition || null,
          updatedAt: sn.updatedAt,
        })),
        childReports: liveReport.childReports,
        transitionLogs: liveReport.transitionLogs,
      };
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

      snapshot = revision.snapshotJson as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!snapshot) {
        throw new InternalServerErrorException('Snapshot data is missing');
      }
    }

    // Inject User Data into Snapshot for the export mappers to compute "Inspected By" and "Approved By"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitionUserIds = (snapshot.transitionLogs || []).map((l: any) => l.userId).filter(Boolean);
    if (transitionUserIds.length > 0) {
        const users = await this.prisma.user.findMany({
            where: { id: { in: transitionUserIds } },
            select: { id: true, name: true, email: true }
        });
        snapshot.users = users;
    }

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
      throw new InternalServerErrorException('Template file could not be loaded');
    }

    if (template.hash !== report.templateHash) {
      throw new InternalServerErrorException('Template hash verification failed');
    }

    const templateBuffer = template.fileBlob;

    const allSerialNumbers = snapshot.serialNumbers || [];
    const N = allSerialNumbers.length;

    // 5. Generate Output
    if (N <= 10) {
      // Return Single XLSX
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(templateBuffer as any);
      
      try {
        await this.applyMapping(report.templateKey, workbook, snapshot, allSerialNumbers);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        throw new BadRequestException(err.message || 'Error applying template mapping');
      }

      const outBuffer = await workbook.xlsx.writeBuffer();
      // Filename should be identical to the requested format
      const poStr = report.poNumber && report.poNumber.trim().length > 0 
        ? report.poNumber.trim().replace(/\s+/g, '_').toUpperCase() 
        : 'NOPO';
      const reportNum = report.reportNumber || 'UNKNOWN';
      const finalFilename = `OTS_${poStr}_${reportNum}_${revisionNumber}.xlsx`;

      return {
        buffer: Buffer.from(outBuffer), // Ensure it's a Buffer native object
        filename: finalFilename,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    } else {
      // Return ZIP with multiple XLSX files (Chunks of 10)
      const zip = new JSZip();
      const chunks = Math.ceil(N / 10);

      for (let k = 1; k <= chunks; k++) {
        const startIndex = (k - 1) * 10;
        const endIndex = startIndex + 10;
        const chunkSerials = allSerialNumbers.slice(startIndex, endIndex);

        const workbook = new ExcelJS.Workbook();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await workbook.xlsx.load(templateBuffer as any); // Always load from original blank template bytes
        
        try {
          await this.applyMapping(report.templateKey, workbook, snapshot, chunkSerials);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          throw new BadRequestException(`Error in part ${k}: ${err.message || 'Error applying template mapping'}`);
        }

        const partBuffer = await workbook.xlsx.writeBuffer();
        
        const poStr = report.poNumber && report.poNumber.trim().length > 0 
          ? report.poNumber.trim().replace(/\s+/g, '_').toUpperCase() 
          : 'NOPO';
        const reportNum = report.reportNumber || 'UNKNOWN';
        const partFilename = `OTS_${poStr}_${reportNum}_${revisionNumber}_part${k}of${chunks}.xlsx`;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zip.file(partFilename, partBuffer as any);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const poStrZip = report.poNumber && report.poNumber.trim().length > 0 
        ? report.poNumber.trim().replace(/\s+/g, '_').toUpperCase() 
        : 'NOPO';
      const reportNumZip = report.reportNumber || 'UNKNOWN';
      return {
        buffer: zipBuffer as unknown as Buffer,
        filename: `OTS_${poStrZip}_${reportNumZip}_${revisionNumber}.zip`,
        mimetype: 'application/zip',
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async applyMapping(templateKey: string, workbook: ExcelJS.Workbook, snapshot: any, chunk: any[]): Promise<void> {
    // Currently only supporting DRILL_PIPE_REPORT v1 exactly as specified.
    if (templateKey === 'DRILL_PIPE_REPORT') {
       await mapDrillPipeReportV1(workbook, snapshot, chunk);
       return;
    }

    throw new BadRequestException(`Mapping not defined for template key: ${templateKey}`);
  }
}
