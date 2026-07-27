import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class RevisionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an immutable snapshot for an InspectionReport.
   * Handles atomic revision number increment and row creation.
   *
   * @param tx Prisma Transaction Client (Must be provided to ensure atomicity)
   * @param reportId ID of the InspectionReport
   * @param reason Reason for the revision
   * @param userId ID of the user creating the revision
   * @param tenantId Tenant ID for scoping
   */
  async createInspectionReportSnapshot(
    tx: Prisma.TransactionClient,
    reportId: string,
    reason: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    // 1. Fetch Full Deterministic Dataset
    // We fetch inside the transaction to ensure we capture exactly what is being committed/exists.
    const report = await tx.inspectionReport.findUnique({
      where: { id: reportId },
      include: {
        serialNumbers: {
          orderBy: { serial: 'asc' }, // Deterministic ordering
        },
        childReports: {
          orderBy: { reportNumber: 'asc' }, // Deterministic ordering
          select: {
            id: true,
            reportNumber: true,
            status: true,
            // Minimal linkage info
          },
        },
        transitionLogs: {
          orderBy: { timestamp: 'asc' },
        },
        // We do NOT include full child report data here, only linkage.
        // Child reports have their own revisions.
      },
    });

    if (!report) {
      throw new Error(
        `InspectionReport ${reportId} not found during snapshot creation.`,
      );
    }

    // 2. Validate Binding (Sanity Check)
    if (
      !report.templateKey ||
      !report.templateHash ||
      !report.templateVersion
    ) {
      // Should not happen for valid reports, but critical for snapshot integrity
      throw new Error(
        `InspectionReport ${reportId} is missing template binding info.`,
      );
    }

    // 3. Determine Next Revision Number
    const currentRevision = report.revisionNumber || 0;
    const nextRevision = currentRevision + 1;

    // 4. Construct Snapshot JSON
    // Explicitly selecting fields to ensure deterministic shape.
    // Excluding raw file bytes, large helper columns, etc.
    const snapshotData = {
      header: {
        id: report.id,
        poNumber: report.poNumber,
        reportNumber: report.reportNumber,
        status: report.status,
        customerId: report.customerId,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        // Pipe Specifications
        grade: report.grade,
        range: report.range,
        weight: report.weight,
        nomWT: report.nomWT,
        nomOD: report.nomOD,
        nomID: report.nomID,
        connection: report.connection,
        // Job Info
        inspectionAddress: report.inspectionAddress,
        standardUsed: report.standardUsed,
        inspectorComment: report.inspectorComment,
        equipmentUsed: report.equipmentUsed,
        inspectionMethod: report.inspectionMethod,
      },
      template: {
        key: report.templateKey,
        version: report.templateVersion,
        hash: report.templateHash,
        versionId: report.templateVersionId,
      },
      serialNumbers: report.serialNumbers.map((sn) => ({
        id: sn.id,
        serial: sn.serial,
        inspectionData: sn.inspectionData,
        disposition:
          (sn.inspectionData as any)?.final?.disposition ||
          (sn.inspectionData as any)?.disposition ||
          null,
        updatedAt: sn.updatedAt,
      })),
      childReports: report.childReports, // Already minimal selected above
      transitionLogs: report.transitionLogs,
    };

    // 5. Create Revision Record
    await tx.inspectionReportRevision.create({
      data: {
        tenantId,
        inspectionReportId: reportId,
        revisionNumber: nextRevision,
        revisionReason: reason,
        revisedById: userId,
        revisedAt: new Date(), // Capture exact time of revision
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotJson: snapshotData as any, // Cast to Json (Prisma type)
      },
    });

    // 6. Update Parent Revision Number
    // Logic: We already have the row lock via the transaction from the caller usually,
    // but here we just execute the update.
    await tx.inspectionReport.update({
      where: { id: reportId },
      data: { revisionNumber: nextRevision },
    });
  }

  /**
   * Creates an immutable snapshot for a ChildReport.
   */
  async createChildReportSnapshot(
    tx: Prisma.TransactionClient,
    childReportId: string,
    reason: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const childReport = await tx.childReport.findUnique({
      where: { id: childReportId },
      include: {
        serialNumbers: {
          include: {
            serialNumber: true, // Get the actual serial value
          },
          orderBy: { serialNumber: { serial: 'asc' } }, // Deterministic
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            filename: true,
            url: true, // Only metadata/reference
            createdAt: true,
          },
        },
        inspectionReport: {
          select: {
            id: true,
            reportNumber: true,
          },
        },
      },
    });

    if (!childReport) {
      throw new Error(
        `ChildReport ${childReportId} not found during snapshot creation.`,
      );
    }

    const currentRevision = childReport.revisionNumber || 0;
    const nextRevision = currentRevision + 1;

    const snapshotData = {
      header: {
        id: childReport.id,
        reportNumber: childReport.reportNumber,
        status: childReport.status,
        createdAt: childReport.createdAt,
        updatedAt: childReport.updatedAt,
        parentReportId: childReport.inspectionReportId,
        parentReportNumber: childReport.inspectionReport?.reportNumber,
      },
      serialNumbers: childReport.serialNumbers.map((s) => ({
        linkId: s.id, // Link table ID
        serialId: s.serialNumberId,
        serial: s.serialNumber.serial,
        disposition:
          (s.serialNumber.inspectionData as any)?.final?.disposition ||
          (s.serialNumber.inspectionData as any)?.disposition ||
          null,
        // Child reports might have their own specific data in future,
        // currently they just link. Inclusion of serial value is key.
      })),
      attachments: childReport.attachments,
    };

    await tx.childReportRevision.create({
      data: {
        tenantId,
        childReportId: childReportId,
        revisionNumber: nextRevision,
        revisionReason: reason,
        revisedById: userId,
        revisedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snapshotJson: snapshotData as any,
      },
    });

    await tx.childReport.update({
      where: { id: childReportId },
      data: { revisionNumber: nextRevision },
    });
  }

  /**
   * PLACEHOLDER: For future Admin Mutation endpoints.
   * This method allows creating a revision for an arbitrary manual update.
   * Call this INSIDE a transaction that performs the actual mutation.
   */
  async createMutationRevision(
    tx: Prisma.TransactionClient,
    entityType: 'InspectionReport' | 'ChildReport',
    entityId: string,
    reason: string,
    userId: string,
    tenantId: string,
  ) {
    if (entityType === 'InspectionReport') {
      await this.createInspectionReportSnapshot(
        tx,
        entityId,
        reason,
        userId,
        tenantId,
      );
    } else {
      await this.createChildReportSnapshot(
        tx,
        entityId,
        reason,
        userId,
        tenantId,
      );
    }
  }
}
