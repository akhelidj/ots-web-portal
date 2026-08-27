import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  InspectionData,
  Snapshot,
  ChildSnapshot,
} from '../common/inspection-data.types';
import { assembleSnapshotHeader } from '../common/snapshot-header';

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
      // Phase D step 2 — header assembled generically (definition-keyed `headerData`
      // overlaid on the legacy named-column bridge) via the shared assembler, so
      // this and the export-time live rebuild can never drift. See
      // assembleSnapshotHeader.
      header: assembleSnapshotHeader(report),
      template: {
        key: report.templateKey,
        version: report.templateVersion,
        hash: report.templateHash,
        versionId: report.templateVersionId,
      },
      serialNumbers: report.serialNumbers.map((sn) => {
        const data = sn.inspectionData as InspectionData | null;
        return {
          id: sn.id,
          serial: sn.serial,
          inspectionData: sn.inspectionData as InspectionData,
          disposition: data?.final?.disposition || data?.disposition || null,
          updatedAt: sn.updatedAt,
        };
      }),
      childReports: report.childReports, // Already minimal selected above
      transitionLogs: report.transitionLogs,
    } satisfies Snapshot;

    // 5. Create Revision Record
    await tx.inspectionReportRevision.create({
      data: {
        tenantId,
        inspectionReportId: reportId,
        revisionNumber: nextRevision,
        revisionReason: reason,
        revisedById: userId,
        revisedAt: new Date(), // Capture exact time of revision
        snapshotJson: snapshotData as unknown as Prisma.InputJsonValue,
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
      serialNumbers: childReport.serialNumbers.map((s) => {
        const data = s.serialNumber.inspectionData as InspectionData | null;
        return {
          linkId: s.id, // Link table ID
          serialId: s.serialNumberId,
          serial: s.serialNumber.serial,
          disposition: data?.final?.disposition || data?.disposition || null,
          // Child reports might have their own specific data in future,
          // currently they just link. Inclusion of serial value is key.
        };
      }),
    } satisfies ChildSnapshot;

    await tx.childReportRevision.create({
      data: {
        tenantId,
        childReportId: childReportId,
        revisionNumber: nextRevision,
        revisionReason: reason,
        revisedById: userId,
        revisedAt: new Date(),
        snapshotJson: snapshotData as unknown as Prisma.InputJsonValue,
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
