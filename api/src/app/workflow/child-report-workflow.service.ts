
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { 
  ChildReportStatus, 
  UserRole, 
  ChildReport,
  Prisma
} from '@prisma/client';
import { 
  CHILD_REPORT_TRANSITIONS, 
  isReasonRequiredForChild 
} from './workflow.policy';

@Injectable()
export class ChildReportWorkflowService {
  constructor(private prisma: PrismaService) {}

  async getAvailableTransitions(user: { tenantId: string; role: UserRole }, reportId: string): Promise<ChildReportStatus[]> {
    // Child Report tenant check is derived from Parent
    const report = await this.prisma.childReport.findFirst({
      where: { 
          id: reportId,
          inspectionReport: {
              tenantId: user.tenantId
          }
      },
      select: { status: true }
    });

    if (!report) {
      throw new NotFoundException('Child Report not found');
    }

    if (user.role === UserRole.CUSTOMER) {
      return [];
    }

    const currentStatus = report.status;
    const allowedTransitions = CHILD_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];
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
              tenantId: user.tenantId
          }
      },
      include: {
        inspectionReport: {
          select: { tenantId: true }
        },
        attachments: true,
        serialNumbers: {
            include: {
                serialNumber: true
            }
        }
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
    const allowedTransitions = CHILD_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];

    if (!allowedTransitions.includes(toStatus)) {
       // 2) HTTP Error Semantics - 403 for unauthorized
       throw new ForbiddenException(`Transition from ${currentStatus} to ${toStatus} is not allowed for role ${user.role}`);
    }

    // 3. Validate Reason
    if (isReasonRequiredForChild(currentStatus, toStatus) && !reason) {
      throw new BadRequestException('Reason is required for this transition');
    }

    // 4. Preconditions
    
    // 4.1 PENDING_APPROVAL -> APPROVED: Must have attachments
    // 7) ChildReport Attachment Rule Must Be Scoped Correctly
    if (currentStatus === ChildReportStatus.PENDING_APPROVAL && toStatus === ChildReportStatus.APPROVED) {
        if (report.attachments.length === 0) {
            throw new BadRequestException('Cannot approve Child Report: At least one attachment is required');
        }
    }

    // 5. Governance / Logic
    
    const isFirstApproval = toStatus === ChildReportStatus.APPROVED; // We check count inside transaction
    const isReopen = currentStatus === ChildReportStatus.APPROVED && toStatus === ChildReportStatus.IN_INSPECTION;

    // 6. Execute Transaction
    return await this.prisma.$transaction(async (tx) => {
        let nextRev = 1;
        let shouldSnapshot = false;
        let snapshotReason = reason;
        let snapshotStatus = toStatus;

        if (isFirstApproval) {
            // 8) Revision Number Computation Must Be Inside Transaction
            const count = await tx.childReportRevision.count({ where: { childReportId: reportId } });
            if (count === 0) {
                shouldSnapshot = true;
                nextRev = 1;
                snapshotStatus = toStatus; // APPROVED
                snapshotReason = reason || 'Initial approval'; // 6) Reason Deterministic
            }
        } else if (isReopen) {
            shouldSnapshot = true;
            const lastRev = await tx.childReportRevision.findFirst({
                where: { childReportId: reportId },
                orderBy: { revisionNumber: 'desc' }
            });
            nextRev = (lastRev?.revisionNumber || 0) + 1;
            snapshotStatus = currentStatus; // 5) Snapshot Boundary: APPROVED
            snapshotReason = reason!; 
        }

        // Update Entity
        const updatedReport = await tx.childReport.update({
            where: { id: reportId },
            data: {
                status: toStatus,
            },
        });

        // Create Snapshot if needed
        if (shouldSnapshot) {
            const snapshotData = {
                id: report.id,
                reportNumber: report.reportNumber,
                status: snapshotStatus,
                inspectionReportId: report.inspectionReportId,
                serialNumbers: report.serialNumbers.map(s => ({
                    serialNumberId: s.serialNumberId,
                    serial: s.serialNumber.serial
                })),
                attachments: report.attachments.map(a => ({
                    id: a.id,
                    filename: a.filename,
                    url: a.url,
                    createdAt: a.createdAt
                }))
            };

            await tx.childReportRevision.create({
                data: {
                    childReportId: reportId,
                    revisionNumber: nextRev,
                    reason: snapshotReason!,
                    snapshotJson: snapshotData as any,
                }
            });
        }

        // Create Transition Log
        await tx.childReportTransitionLog.create({
            data: {
                childReportId: reportId,
                fromStatus: currentStatus,
                toStatus: toStatus,
                userId: user.id,
            }
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
            }
        });

        return updatedReport;
    });
  }
}
