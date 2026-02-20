import { Injectable, NotFoundException, ForbiddenException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { RevisionService } from '../revision/revision.service';
import { TemplateService } from '../template/template.service';
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
    user: any,
    reportId: string,
    requestedRevision?: number,
  ): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    // 1. Fetch Report & Validate Approval
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Inspection report not found');
    }
    if (report.tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied');
    }
    if (report.status !== 'APPROVED') {
      throw new ForbiddenException('Export is only allowed for APPROVED reports');
    }

    // 2. Resolve Revision
    let revisionNumber = requestedRevision;
    if (revisionNumber === undefined) {
      revisionNumber = report.revisionNumber;
    }

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

    // 3. Fetch Snapshot
    const snapshot = revision.snapshotJson as any;
    if (!snapshot) {
      throw new InternalServerErrorException('Snapshot data is missing');
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
      await workbook.xlsx.load(templateBuffer as any);
      
      try {
        await this.applyMapping(report.templateKey, workbook, snapshot, allSerialNumbers);
      } catch (err: any) {
        throw new BadRequestException(err.message || 'Error applying template mapping');
      }

      const outBuffer = await workbook.xlsx.writeBuffer();
      return {
        buffer: Buffer.from(outBuffer), // Ensure it's a Buffer native object
        filename: `InspectionReport_${report.reportNumber || reportId}_rev${revisionNumber}.xlsx`,
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
        await workbook.xlsx.load(templateBuffer as any); // Always load from original blank template bytes
        
        try {
          await this.applyMapping(report.templateKey, workbook, snapshot, chunkSerials);
        } catch (err: any) {
          throw new BadRequestException(`Error in part ${k}: ${err.message || 'Error applying template mapping'}`);
        }

        const partBuffer = await workbook.xlsx.writeBuffer();
        const partFilename = `InspectionReport_${report.reportNumber || reportId}_rev${revisionNumber}_part${k}of${chunks}.xlsx`;
        
        zip.file(partFilename, partBuffer as any);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      return {
        buffer: zipBuffer as unknown as Buffer,
        filename: `InspectionReport_${report.reportNumber || reportId}_rev${revisionNumber}.zip`,
        mimetype: 'application/zip',
      };
    }
  }

  private async applyMapping(templateKey: string, workbook: ExcelJS.Workbook, snapshot: any, chunk: any[]): Promise<void> {
    // Currently only supporting DRILL_PIPE_REPORT v1 exactly as specified.
    if (templateKey === 'DRILL_PIPE_REPORT') {
       await mapDrillPipeReportV1(workbook, snapshot, chunk);
       return;
    }

    throw new BadRequestException(`Mapping not defined for template key: ${templateKey}`);
  }
}
