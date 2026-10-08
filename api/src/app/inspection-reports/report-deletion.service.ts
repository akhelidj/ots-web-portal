import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
  StorageObjectRef,
} from '../storage/attachment-storage.types';
import { deleteReportGraph } from './delete-report-graph';

/**
 * ADMIN-only permanent deletion of one inspection report and everything hanging off it
 * (serials, child reports, approval batches, revisions, transitions, attachments,
 * signatures). Audit-log rows survive with their report link nulled, plus one
 * DELETE_REPORT entry recording what went and why.
 *
 * Optimistic concurrency: the caller's `version` must match, re-checked inside the
 * transaction with a guarded `updateMany`, so a report changed since the admin looked at
 * it is never deleted blind.
 */
@Injectable()
export class ReportDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  /** What a delete would remove, for the confirmation dialog. Read-only. */
  async getDeleteImpact(tenantId: string, reportId: string) {
    const report = await this.findInTenant(tenantId, reportId);
    const inReport = { inspectionReportId: reportId };
    const [serialNumbers, childReports, attachments, signatures] =
      await Promise.all([
        this.prisma.serialNumber.count({ where: inReport }),
        this.prisma.childReport.count({ where: inReport }),
        this.prisma.attachment.count({ where: inReport }),
        this.prisma.reportSignature.count({ where: inReport }),
      ]);
    return {
      reportNumber: report.reportNumber,
      poNumber: report.poNumber,
      status: report.status,
      version: report.version,
      serialNumbers,
      childReports,
      attachments,
      signatures,
    };
  }

  async deleteReport(
    tenantId: string,
    userId: string,
    reportId: string,
    version: number,
    reason: string | undefined,
  ) {
    const why = reason?.trim();
    if (!why) {
      throw new BadRequestException('A reason is required to delete a report.');
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException('A valid version is required.');
    }

    const report = await this.findInTenant(tenantId, reportId);
    if (report.version !== version) {
      throw new ConflictException('Version mismatch');
    }

    const attachmentRefs: StorageObjectRef[] = [];
    let counts = { serials: 0, children: 0, attachments: 0 };

    await this.prisma.$transaction(
      async (tx) => {
        // Guarded write first: claims the row at the expected version (and bumps it so a
        // racing writer conflicts) before anything is removed.
        const { count } = await tx.inspectionReport.updateMany({
          where: { id: reportId, tenantId, version },
          data: { version: { increment: 1 } },
        });
        if (count === 0) {
          throw new ConflictException('Version mismatch');
        }

        const inReport = { inspectionReportId: reportId };
        const [attachments, serials, children] = await Promise.all([
          tx.attachment.findMany({ where: inReport, select: { id: true } }),
          tx.serialNumber.count({ where: inReport }),
          tx.childReport.count({ where: inReport }),
        ]);
        for (const a of attachments) {
          attachmentRefs.push({
            tenantId,
            customerId: report.customerId,
            reportId,
            attachmentId: a.id,
          });
        }
        counts = { serials, children, attachments: attachments.length };

        await deleteReportGraph(tx, [reportId]);

        const label = report.reportNumber || reportId;
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'DELETE_REPORT',
            entity: 'InspectionReport',
            entityId: reportId,
            reason: `Report ${label} (PO ${report.poNumber}, status ${report.status}) deleted with ${serials} serial(s), ${children} child report(s), ${attachments.length} attachment(s). Reason: ${why}`,
          },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    // Rows gone — drop the binaries. Best effort: an orphaned object is harmless, and the
    // delete must not fail after the rows are removed. Signature images are kept: the same
    // objects back users' registered signatures.
    await Promise.all(
      attachmentRefs.map((ref) => this.storage.delete(ref).catch(() => undefined)),
    );

    return { deleted: true, ...counts };
  }

  private async findInTenant(tenantId: string, reportId: string) {
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        tenantId: true,
        customerId: true,
        reportNumber: true,
        poNumber: true,
        status: true,
        version: true,
      },
    });
    if (!report || report.tenantId !== tenantId) {
      throw new NotFoundException('Inspection report not found');
    }
    return report;
  }
}
