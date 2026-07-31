import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChildReportStatus, UserRole, ChildReport } from '@prisma/client';
import {
  CHILD_REPORT_TRANSITIONS,
  isReasonRequiredForChild,
} from './workflow.policy';
import { RevisionService } from '../revision/revision.service';

@Injectable()
export class ChildReportWorkflowService {
  constructor(
    private prisma: PrismaService,
    private revisionService: RevisionService,
  ) {}

  async getAvailableTransitions(
    user: { tenantId: string; role: UserRole },
    reportId: string,
  ): Promise<ChildReportStatus[]> {
    // Child Report tenant check is derived from Parent
    const report = await this.prisma.childReport.findFirst({
      where: {
        id: reportId,
        inspectionReport: {
          tenantId: user.tenantId,
        },
      },
      select: { status: true },
    });

    if (!report) {
      throw new NotFoundException('Child Report not found');
    }

    if (user.role === UserRole.CUSTOMER) {
      return [];
    }

    const currentStatus = report.status;
    const allowedTransitions =
      CHILD_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];
    return allowedTransitions;
  }

  async transition(
    user: { id: string; tenantId: string; role: UserRole },
    reportId: string,
    toStatus: ChildReportStatus,
    reason?: string,
  ): Promise<ChildReport> {
    // 1. Validate Tenant & Existence via Parent - 9) Tenant Query Hygiene
    const report = await this.prisma.childReport.findFirst({
      where: {
        id: reportId,
        inspectionReport: {
          tenantId: user.tenantId,
        },
      },
      include: {
        inspectionReport: {
          select: { tenantId: true },
        },
        attachments: true,
        serialNumbers: {
          include: {
            serialNumber: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Child Report not found');
    }

    // 2. Validate Role & Matrix
    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers cannot perform transitions');
    }

    const currentStatus = report.status;
    const allowedTransitions =
      CHILD_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];

    if (!allowedTransitions.includes(toStatus)) {
      // 2) HTTP Error Semantics - 403 for unauthorized
      throw new ForbiddenException(
        `Transition from ${currentStatus} to ${toStatus} is not allowed for role ${user.role}`,
      );
    }

    // 3. Validate Reason
    if (isReasonRequiredForChild(currentStatus, toStatus) && !reason) {
      throw new BadRequestException('Reason is required for this transition');
    }

    // 4. Preconditions

    // 4.1 PENDING_APPROVAL -> APPROVED: Must have attachments
    // 7) ChildReport Attachment Rule Must Be Scoped Correctly
    if (
      currentStatus === ChildReportStatus.PENDING_APPROVAL &&
      toStatus === ChildReportStatus.APPROVED
    ) {
      if (report.attachments.length === 0) {
        throw new BadRequestException(
          'Cannot approve Child Report: At least one attachment is required',
        );
      }
    }

    // 5. Governance / Logic

    const isFirstApproval = toStatus === ChildReportStatus.APPROVED; // We check count inside transaction
    const isReopen =
      currentStatus === ChildReportStatus.APPROVED &&
      toStatus === ChildReportStatus.IN_INSPECTION;

    // 6. Execute Transaction
    return await this.prisma.$transaction(async (tx) => {
      // Snapshot preparation removed. Logic in Service.

      // removed inline logic

      // Update Entity
      const updatedReport = await tx.childReport.update({
        where: { id: reportId },
        data: {
          status: toStatus,
        },
      });

      // Create Snapshot if needed
      // Create Snapshot if needed (Rev 1 or Reopen Rev n+1)
      if (isFirstApproval) {
        // Check handled by RevisionService internally? No, we need to call it if condition met.
        // RevisionService handles the "if exists" check if we want, OR we check here.
        // The service method `createChildReportSnapshot` increments.
        // If we are approving for the first time, revisionNumber should be 0 -> 1.
        // If we are Reopening, it's a mutation of an approved report?
        // Reopen = APPROVED -> IN_INSPECTION.
        // Requirement: "Admin post-approval mutation requires reason and creates Revision n+1"
        // Like parent report, we will treat Reopen as a mutation.

        await this.revisionService.createChildReportSnapshot(
          tx,
          reportId,
          reason || 'Initial approval',
          user.id,
          user.tenantId,
        );
      } else if (isReopen) {
        // Reopen (APPROVED -> IN_INSPECTION) always requires a reason — the
        // transition-guard above throws when it is absent — so this narrows
        // `reason` to non-null for the compiler without altering behavior.
        if (!reason) {
          throw new BadRequestException(
            'Reason is required for this transition',
          );
        }
        await this.revisionService.createChildReportSnapshot(
          tx,
          reportId,
          reason,
          user.id,
          user.tenantId,
        );
      }

      // Create Transition Log
      await tx.childReportTransitionLog.create({
        data: {
          childReportId: reportId,
          fromStatus: currentStatus,
          toStatus: toStatus,
          userId: user.id,
        },
      });

      // Create Audit Log
      await tx.auditLog.create({
        data: {
          action: 'TRANSITION',
          entity: 'ChildReport',
          entityId: reportId,
          tenantId: user.tenantId, // 11) AuditLog Consistency
          userId: user.id,
          reason: reason,
          inspectionReportId: report.inspectionReportId,
        },
      });

      return updatedReport;
    });
  }
}
