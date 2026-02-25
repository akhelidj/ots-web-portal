
import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { 
  InspectionReportStatus, 
  UserRole, 
  InspectionReport, 
  Prisma,
  ChildReportStatus,
  TemplateStatus
} from '@prisma/client';
import { 
  INSPECTION_REPORT_TRANSITIONS, 
  isReasonRequiredForInspection 
} from './workflow.policy';
import { RevisionService } from '../revision/revision.service';

const DRILL_PIPE_REQUIRED_KEYS = [
  'box.minTongSpace', 'box.minOD', 'box.minBoxThreads', 'box.minEccShoulder',
  'box.maxCounterBoreDiameter', 'box.maxCounterBoreLength', 'box.bevelDiameterMin',
  'box.bevelDiameterMax', 'box.condition',
  'pin.minTongSpace', 'pin.minOD', 'pin.maxID', 'pin.minEccShoulder',
  'pin.lengthPinConnMin', 'pin.lengthPinConnMax', 'pin.maxLengthPinBase',
  'pin.bevelDiameterMin', 'pin.bevelDiameterMax', 'pin.condition',
  'box.hardBanding', 'body.wallRemaining', 'body.odDecrease', 'body.emiResult',
  'body.slipArea', 'body.corrosionIn', 'body.corrosionOut', 'body.ipc', 'body.bentJoints',
  'final.isNew', 'final.isPremium', 'final.isC2', 'final.isScrap'
];

@Injectable()
export class InspectionReportWorkflowService {
  async create(
    user: { id: string; tenantId: string; role: UserRole },
    dto: { templateKey: string; poNumber: string; customerId?: string }
  ): Promise<InspectionReport> {
    const { templateKey, poNumber, customerId } = dto;
    const { tenantId, id: userId } = user;

    const template = await this.prisma.template.findFirst({
        where: {
            tenantId,
            templateKey,
            status: TemplateStatus.ACTIVE,
        },
    });

    if (!template) {
        throw new BadRequestException(`No ACTIVE template found for key: ${templateKey}`);
    }

    try {
        return await this.prisma.$transaction(async (tx) => {
            const report = await tx.inspectionReport.create({
                data: {
                    tenantId,
                    poNumber,
                    customerId,
                    templateKey: template.templateKey,
                    templateVersion: template.templateVersion,
                    templateHash: template.hash,
                    status: InspectionReportStatus.DRAFT,
                },
            });

            await tx.auditLog.create({
                data: {
                    action: 'CREATE',
                    entity: 'InspectionReport',
                    entityId: report.id,
                    tenantId,
                    userId,
                    reason: `Created with template ${templateKey} v${template.templateVersion}`,
                    inspectionReportId: report.id,
                }
            });

            return report;
        });
    } catch (error: any) {
        console.error('Error creating InspectionReport:', error);
        throw new BadRequestException(`Failed to create report: ${error.message}`);
    }
  }

  constructor(
    private prisma: PrismaService,
    private revisionService: RevisionService,
  ) {}

  async getAvailableTransitions(
    user: { tenantId: string; role: UserRole }, 
    reportId: string
  ): Promise<{ fromStatus: InspectionReportStatus; transitions: { toStatus: InspectionReportStatus; requiresReason: boolean }[] }> {
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
      return { fromStatus: report.status, transitions: [] };
    }

    let allowedTargetStatuses = INSPECTION_REPORT_TRANSITIONS[user.role]?.[report.status] || [];
    
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
            allowedTargetStatuses = [...allowedTargetStatuses, lastHoldLog.previousActiveStatus];
        }
    }
    
    const transitions = allowedTargetStatuses.map(toStatus => ({
        toStatus,
        requiresReason: isReasonRequiredForInspection(report.status, toStatus)
    }));

    return {
        fromStatus: report.status,
        transitions
    };
  }

  async getTransitions(user: { tenantId: string }, reportId: string) {
    // Escalate tenant validation
    const report = await this.prisma.inspectionReport.findFirst({
        where: { id: reportId, tenantId: user.tenantId }
    });
    
    if (!report) {
         throw new NotFoundException('Inspection Report not found');
    }

    // Fetch the safely scoped logs
    const transitionLogs = await this.prisma.inspectionReportTransitionLog.findMany({
        where: { inspectionReportId: reportId },
        orderBy: { timestamp: 'desc' }
    });

    const auditLogs = await this.prisma.auditLog.findMany({
        where: { inspectionReportId: reportId, action: 'TRANSITION' },
        orderBy: { timestamp: 'desc' }
    });

    return transitionLogs.map(log => {
      let closestAudit = null;
      let minDiff = Infinity;
      for (const a of auditLogs) {
        if (a.userId === log.userId) {
          const diff = Math.abs(a.timestamp.getTime() - log.timestamp.getTime());
          if (diff < minDiff) {
            minDiff = diff;
            closestAudit = a;
          }
        }
      }
      return {
        ...log,
        reason: (minDiff < 10000 && closestAudit) ? closestAudit.reason : null
      };
    });
  }

  async transition(
    user: { id: string; tenantId: string; role: UserRole },
    reportId: string,
    toStatus: InspectionReportStatus,
    version: number,
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
        legacyTemplateVersion: true,
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    if (report.version !== version) {
      throw new ConflictException(`Version mismatch. Expected ${report.version}, got ${version}`);
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
      const serials = await this.prisma.serialNumber.findMany({
          where: { tenantId: user.tenantId, inspectionReportId: reportId },
      });

      if (serials.length === 0) {
        throw new BadRequestException({
           code: 'VALIDATION_FAILED',
           message: 'Cannot request approval: No serial numbers added',
           missingDispositionSerials: [],
           missingRequiredFields: {}
        });
      }

      const missingDispositionSerials: string[] = [];
      const missingRequiredFields: Record<string, string[]> = {};
      const missingChildReportsSerials: string[] = [];

      for (const sn of serials) {
          const data: any = sn.inspectionData || {};
          const disposition = data.final?.disposition || data.disposition;
          
          if (!disposition) {
              missingDispositionSerials.push(sn.serial);
          } else if (disposition === 'REWORK') {
              // Check if a ChildReport exists for this serial number
              const hasChildReport = report.childReports.some(cr => cr.serialNumberId === sn.id);
              if (!hasChildReport) {
                  missingChildReportsSerials.push(sn.serial);
              }
          }

          if (report.templateKey === 'DRILL_PIPE_REPORT') {
              const missingKeys = DRILL_PIPE_REQUIRED_KEYS.filter(rk => {
                  const val = rk.split('.').reduce((acc, part) => acc && acc[part], data);
                  return val === undefined || val === null || val === '';
              });
              if (missingKeys.length > 0) {
                  missingRequiredFields[sn.serial] = missingKeys;
              }
          }
      }

      const hasValidationFailures = missingDispositionSerials.length > 0 || Object.keys(missingRequiredFields).length > 0 || missingChildReportsSerials.length > 0;
      if (hasValidationFailures) {
          throw new BadRequestException({
             code: 'VALIDATION_FAILED',
             message: 'Validation failed for one or more serial numbers.',
             missingDispositionSerials,
             missingRequiredFields,
             missingChildReportsSerials
          });
      }
    }

    // 4.2 Parent CLOSED validation
    if (toStatus === InspectionReportStatus.CLOSED) {
      const openChildren = report.childReports.filter(c => c.status !== ChildReportStatus.CLOSED);
      if (openChildren.length > 0) {
        throw new BadRequestException('Cannot close Inspection Report: All child reports must be closed first');
      }
    }

    // 5. Governance / Logic Calculation
    
    // 8) Revision Number Computation Must Be Inside Transaction
    // Moving revisionNumber and shouldSnapshot logic to inside transaction or preparing flags here.
    // actually we can keep flags here but calculation inside.
    // Moving revisionNumber and shouldSnapshot logic to inside transaction or preparing flags here.
    // actually we can keep flags here but calculation inside.
    const isFirstApproval = toStatus === InspectionReportStatus.APPROVED && report.revisionNumber === null;

    const isReopen = 
        (currentStatus === InspectionReportStatus.APPROVED && toStatus === InspectionReportStatus.IN_INSPECTION) ||
        (currentStatus === InspectionReportStatus.CLOSED && (toStatus === InspectionReportStatus.APPROVED || toStatus === InspectionReportStatus.IN_INSPECTION));

    // 6. Execute Transaction
    return await this.prisma.$transaction(async (tx) => {
        // 8) Revision Number Computation Inside Transaction
        // Revision Logic handed off to Service
 
        // For Reopen, we use atomic increment in the update below

        // 6) Revision Reason Deterministic
        // Reason handling in service path


        // Update Entity Atomically
        const updateData: Prisma.InspectionReportUpdateManyMutationInput = {
            status: toStatus,
            version: report.version + 1,
        };

        if (isFirstApproval) {
            // RevisionService handles the update of revisionNumber to 1
        } else if (isReopen) {
            // RevisionService handles the increment
        } else {
             // No change to revision number
        }

        const updateResult = await tx.inspectionReport.updateMany({
            where: { 
                id: reportId,
                tenantId: user.tenantId,
                version: report.version
            },
            data: updateData,
        });
        
        if (updateResult.count === 0) {
            throw new ConflictException(`Version mismatch or entity not found. Expected version: ${report.version}`);
        }
        
        // Fetch the updated report to return it
        const updatedReport = await tx.inspectionReport.findUniqueOrThrow({
            where: { id: reportId },
            include: { childReports: true, serialNumbers: true }
        });
        
        // Capture the actual new revision number from the DB (crucial for atomic increment result)
        // remove capture of nextRevisionNumber as it is handled by service


        // Create Snapshot if needed
        if (isFirstApproval) {
            await this.revisionService.createInspectionReportSnapshot(
                tx,
                reportId,
                reason || 'Initial approval',
                user.id,
                user.tenantId
            );
        } else if (isReopen) {
            // Reopen logic (Admin mutation) - This should eventually use createMutationRevision equivalent if fully consistent
            // But per specs: "Any Admin data mutation... create Revision n+1"
            // Reopen is a status mutation.
            // Requirement 5.2: "Any API operation that mutates... while status=APPROVED"
            // Reopen moves FROM Approved.
            // Wait, "Reopen transitions" usually mean going back to draft/inspection.
            // If we are leaving APPROVED, we are mutating the STATUS of an APPROVED report.
            // So yes, this counts as a mutation of an approved report.
            // However, the snapshot should capture the state BEFORE the transition? 
            // Or AFTER?
            // "snapshotJson = snapshot after the mutation"
            // If we change status to IN_INSPECTION, the snapshot will show IN_INSPECTION?
            // That seems wrong for an "Approved Revision". 
            // Actually, T0.5.3 says: "Any Admin data mutation... create Revision n+1".
            // If we are reopening, we are effectively creating a NEW version of the report history?
            // Use case: Mistake in approved report. Admin reopens (Rev 1). Admin fixes. Admin Approves (Rev 2).
            // So the Reopen action itself might be the trigger for Rev 2?
            // Let's stick to the explicit instruction for now: "Admin post-approval mutation requires reason and creates Rev n+1".
            // Changing status is a mutation.
            
            // However, the snapshot service implementation fetches the report from DB.
            // Inside this transaction, we updated the status to 'toStatus' (IN_INSPECTION) just above.
            // So `createInspectionReportSnapshot` will see IN_INSPECTION.
            
            await this.revisionService.createInspectionReportSnapshot(
                tx,
                reportId,
                reason!, // Reason mandatory for reopen
                user.id,
                user.tenantId
            );
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
