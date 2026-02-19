
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { 
  InspectionReportStatus, 
  UserRole, 
  InspectionReport, 
  Prisma,
  ChildReportStatus
} from '@prisma/client';
import { 
  INSPECTION_REPORT_TRANSITIONS, 
  isReasonRequiredForInspection 
} from './workflow.policy';

@Injectable()
export class InspectionReportWorkflowService {
  constructor(private prisma: PrismaService) {}

  async getAvailableTransitions(user: { tenantId: string; role: UserRole }, reportId: string): Promise<InspectionReportStatus[]> {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { 
          id: reportId,
          tenantId: user.tenantId 
      },
      select: { status: true },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    if (user.role === UserRole.CUSTOMER) {
      return [];
    }

    const allowedTargetStatuses = INSPECTION_REPORT_TRANSITIONS[user.role]?.[report.status] || [];
    
    // 4) ON_HOLD Resume Visibility
    if (report.status === InspectionReportStatus.ON_HOLD && (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN)) {
        const lastHoldLog = await this.prisma.inspectionReportTransitionLog.findFirst({
            where: {
                inspectionReportId: reportId,
                toStatus: InspectionReportStatus.ON_HOLD,
            },
            orderBy: { timestamp: 'desc' },
        });

        if (lastHoldLog?.previousActiveStatus) {
            return [...allowedTargetStatuses, lastHoldLog.previousActiveStatus];
        }
    }
    
    return allowedTargetStatuses;
  }

  async transition(
    user: { id: string; tenantId: string; role: UserRole },
    reportId: string,
    toStatus: InspectionReportStatus,
    reason?: string,
  ): Promise<InspectionReport> {
    // 1. Validate Tenant & Existence
    // 1. Validate Tenant & Existence - 9) Tenant Query Hygiene
    const report = await this.prisma.inspectionReport.findFirst({
      where: { 
          id: reportId,
          tenantId: user.tenantId
      },
      include: {
        childReports: true,
        serialNumbers: true,
        templateVersion: true,
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    // 2. Validate Role & Matrix
    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers cannot perform transitions');
    }

    const currentStatus = report.status;
    const allowedTransitions = INSPECTION_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];
    
    // Explicit check for ON_HOLD restoration which might not be in the static map if dynamic
    // The policy map says ON_HOLD -> [CLOSED], but we need to allow restoring to previous.
    // However, the prompt says "Must store the current active status as previousActiveStatus".
    // And "When leaving ON_HOLD... Restore to previousActiveStatus".
    // So the 'toStatus' for ON_HOLD -> Restore is dynamic.
    // The map in Policy should probably allow the variable target, but for now we enforce the logic here.
    
    const isRestoringFromHold = currentStatus === InspectionReportStatus.ON_HOLD && toStatus !== InspectionReportStatus.CLOSED;

    if (!allowedTransitions.includes(toStatus) && !isRestoringFromHold) {
       // 2) HTTP Error Semantics - 403 for unauthorized
       throw new ForbiddenException(`Transition from ${currentStatus} to ${toStatus} is not allowed for role ${user.role}`);
    }

    // 2b. If restoring from hold, valid that toStatus == previousActiveStatus
    if (isRestoringFromHold) {
        // 3) ON_HOLD Restore Authorization
        if (user.role !== UserRole.SUPERVISOR && user.role !== UserRole.ADMIN) {
            throw new ForbiddenException('Only Supervisor or Admin can restore from ON_HOLD');
        }
        // We need to fetch the last transition log to find previousActiveStatus, 
        // OR we should have stored it on the entity?
        // The prompt says "Must store the current active status as previousActiveStatus".
        // It implies storing it somewhere. The schema has `InspectionReportTransitionLog.previousActiveStatus`.
        // But to restore, we need to know what it was. 
        // Let's check the schema again. 
        // `InspectionReportTransitionLog` has `previousActiveStatus`.
        // The `InspectionReport` model DOES NOT have `previousActiveStatus`.
        // So we must look up the last transition to ON_HOLD to find it.
        
        const lastHoldLog = await this.prisma.inspectionReportTransitionLog.findFirst({
            where: {
                inspectionReportId: reportId,
                toStatus: InspectionReportStatus.ON_HOLD,
            },
            orderBy: { timestamp: 'desc' },
        });

        if (!lastHoldLog || !lastHoldLog.previousActiveStatus) {
            throw new BadRequestException('Cannot restore from ON_HOLD: Previous status not found');
        }

        if (toStatus !== lastHoldLog.previousActiveStatus) {
            throw new BadRequestException(`From ON_HOLD, you must return to ${lastHoldLog.previousActiveStatus}, not ${toStatus}`);
        }
    }

    // 3. Validate Reason
    if (isReasonRequiredForInspection(currentStatus, toStatus) && !reason) {
      throw new BadRequestException('Reason is required for this transition');
    }

    // 4. Preconditions
    
    // 4.1 IN_INSPECTION -> PENDING_APPROVAL
    if (toStatus === InspectionReportStatus.PENDING_APPROVAL) {
      if (report.serialNumbers.length === 0) {
        throw new BadRequestException('Cannot request approval: No serial numbers added');
      }
      // Add more validations here as needed (e.g. Disposition check if we had rules for it)
    }

    // 4.2 Parent CLOSED validation
    if (toStatus === InspectionReportStatus.CLOSED) {
      const openChildren = report.childReports.filter(c => c.status !== ChildReportStatus.CLOSED);
      if (openChildren.length > 0) {
        throw new BadRequestException('Cannot close Inspection Report: All child reports must be closed first');
      }
    }

    // 5. Governance / Logic Calculation
    
    let revisionNumber = report.revisionNumber;
    let shouldSnapshot = false;

    // A) On Hold Logic
    // If going TO hold, we need to record currentStatus as previousActiveStatus in the LOG. 
    // We don't store it on the main entity based on schema.
    
    // C) Approval & Revision Creation
    if (toStatus === InspectionReportStatus.APPROVED && report.revisionNumber === null) {
        revisionNumber = 1;
        shouldSnapshot = true;
    }

    // D) Reopen Behavior
    // APPROVED -> IN_INSPECTION (Admin)
    // CLOSED -> APPROVED or IN_INSPECTION (Admin)
    const isReopen = 
        (currentStatus === InspectionReportStatus.APPROVED && toStatus === InspectionReportStatus.IN_INSPECTION) ||
        (currentStatus === InspectionReportStatus.CLOSED && (toStatus === InspectionReportStatus.APPROVED || toStatus === InspectionReportStatus.IN_INSPECTION));

    // 8) Revision Number Computation Must Be Inside Transaction
    // Moving revisionNumber and shouldSnapshot logic to inside transaction or preparing flags here.
    // actually we can keep flags here but calculation inside.
    const isFirstApproval = toStatus === InspectionReportStatus.APPROVED && report.revisionNumber === null;

    // 6. Execute Transaction
    return await this.prisma.$transaction(async (tx) => {
        let nextRevisionNumber = report.revisionNumber;
        let snapshotReason = reason;

        // 8) Revision Number Computation Inside Transaction
        if (isFirstApproval) {
            nextRevisionNumber = 1;
        } 
        // For Reopen, we use atomic increment in the update below

        // 6) Revision Reason Deterministic
        if (isFirstApproval) {
            snapshotReason = reason || 'Initial approval';
        }

        // Update Entity
        const updateData: Prisma.InspectionReportUpdateInput = {
            status: toStatus,
        };

        if (isFirstApproval) {
            updateData.revisionNumber = 1;
        } else if (isReopen) {
            updateData.revisionNumber = { increment: 1 };
        } else {
             updateData.revisionNumber = nextRevisionNumber; // Maintain existing if not changing (though this path shouldn't be hit for these cases)
        }

        const updatedReport = await tx.inspectionReport.update({
            where: { id: reportId },
            data: updateData,
        });
        
        // Capture the actual new revision number from the DB (crucial for atomic increment result)
        nextRevisionNumber = updatedReport.revisionNumber;

        // Create Snapshot if needed
        if (isFirstApproval || isReopen) {
            // 5) Reopen Snapshot Boundary Is Incorrect
            // Snapshot must represent the boundary being left.
            // For reopen from APPROVED to IN_INSPECTION -> Snapshot status should be APPROVED (currentStatus).
            // For first approval -> Snapshot status is APPROVED (toStatus).
            
            const snapshotStatus = isReopen ? currentStatus : toStatus;

            const snapshotData = {
                id: report.id,
                poNumber: report.poNumber,
                reportNumber: report.reportNumber,
                revisionNumber: nextRevisionNumber,
                status: snapshotStatus,
                templateVersionId: report.templateVersionId,
                customerId: report.customerId,
                serialNumbers: report.serialNumbers.map(s => ({
                    id: s.id,
                    serial: s.serial,
                    inspectionData: s.inspectionData,
                    disposition: s.disposition
                })),
                childReports: report.childReports.map(c => ({
                    id: c.id,
                    status: c.status,
                    reportNumber: c.reportNumber
                })),
            };

            await tx.inspectionReportRevision.create({
                data: {
                    inspectionReportId: reportId,
                    revisionNumber: nextRevisionNumber!,
                    reason: snapshotReason!, // 6) No fallback, assured by logic
                    snapshotJson: snapshotData as any, 
                }
            });
        }

        // Create Transition Log
        await tx.inspectionReportTransitionLog.create({
            data: {
                inspectionReportId: reportId,
                fromStatus: currentStatus,
                toStatus: toStatus,
                userId: user.id,
                previousActiveStatus: toStatus === InspectionReportStatus.ON_HOLD ? currentStatus : null,
            }
        });

        // Create Audit Log
        await tx.auditLog.create({
            data: {
                action: 'TRANSITION',
                entity: 'InspectionReport',
                entityId: reportId,
                tenantId: user.tenantId,
                userId: user.id,
                reason: reason,
                inspectionReportId: reportId,
            }
        });

        return updatedReport;
    });
  }
}
