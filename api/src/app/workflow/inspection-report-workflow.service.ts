import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  InspectionReportStatus,
  UserRole,
  InspectionReport,
  Prisma,
  TemplateStatus,
} from '@prisma/client';
import {
  INSPECTION_REPORT_TRANSITIONS,
  isReasonRequiredForInspection,
} from './workflow.policy';
import { RevisionService } from '../revision/revision.service';
import { engineGate, enforce, GateDefinition } from './approval-gate';

@Injectable()
export class InspectionReportWorkflowService {
  async create(
    user: { id: string; tenantId: string; role: UserRole },
    dto: { templateKey: string; poNumber: string; customerId?: string },
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
      throw new BadRequestException(
        `No ACTIVE template found for key: ${templateKey}`,
      );
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
          },
        });

        return report;
      });
    } catch (error: unknown) {
      console.error('Error creating InspectionReport:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to create report: ${message}`);
    }
  }

  constructor(
    private prisma: PrismaService,
    private revisionService: RevisionService,
  ) {}

  async getAvailableTransitions(
    user: { tenantId: string; role: UserRole },
    reportId: string,
  ): Promise<{
    fromStatus: InspectionReportStatus;
    transitions: {
      toStatus: InspectionReportStatus;
      requiresReason: boolean;
    }[];
  }> {
    const report = await this.prisma.inspectionReport.findFirst({
      where: {
        id: reportId,
        tenantId: user.tenantId,
      },
      select: { status: true },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    if (user.role === UserRole.CUSTOMER) {
      return { fromStatus: report.status, transitions: [] };
    }

    let allowedTargetStatuses =
      INSPECTION_REPORT_TRANSITIONS[user.role]?.[report.status] || [];

    // 4) ON_HOLD Resume Visibility
    if (
      report.status === InspectionReportStatus.ON_HOLD &&
      (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN)
    ) {
      const lastHoldLog =
        await this.prisma.inspectionReportTransitionLog.findFirst({
          where: {
            inspectionReportId: reportId,
            toStatus: InspectionReportStatus.ON_HOLD,
          },
          orderBy: { timestamp: 'desc' },
        });

      if (lastHoldLog?.previousActiveStatus) {
        allowedTargetStatuses = [
          ...allowedTargetStatuses,
          lastHoldLog.previousActiveStatus,
        ];
      }
    }

    const transitions = allowedTargetStatuses.map((toStatus) => ({
      toStatus,
      requiresReason: isReasonRequiredForInspection(report.status, toStatus),
    }));

    return {
      fromStatus: report.status,
      transitions,
    };
  }

  async getTransitions(user: { tenantId: string }, reportId: string) {
    // Escalate tenant validation
    const report = await this.prisma.inspectionReport.findFirst({
      where: { id: reportId, tenantId: user.tenantId },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    // Fetch the safely scoped logs
    const transitionLogs =
      await this.prisma.inspectionReportTransitionLog.findMany({
        where: { inspectionReportId: reportId },
        orderBy: { timestamp: 'desc' },
      });

    const auditLogs = await this.prisma.auditLog.findMany({
      where: { inspectionReportId: reportId, action: 'TRANSITION' },
      orderBy: { timestamp: 'desc' },
    });

    return transitionLogs.map((log) => {
      let closestAudit = null;
      let minDiff = Infinity;
      for (const a of auditLogs) {
        if (a.userId === log.userId) {
          const diff = Math.abs(
            a.timestamp.getTime() - log.timestamp.getTime(),
          );
          if (diff < minDiff) {
            minDiff = diff;
            closestAudit = a;
          }
        }
      }
      return {
        ...log,
        reason: minDiff < 10000 && closestAudit ? closestAudit.reason : null,
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
        tenantId: user.tenantId,
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
      throw new ConflictException(
        `Version mismatch. Expected ${report.version}, got ${version}`,
      );
    }

    // 2. Validate Role & Matrix
    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers cannot perform transitions');
    }

    const currentStatus = report.status;
    const allowedTransitions =
      INSPECTION_REPORT_TRANSITIONS[user.role]?.[currentStatus] || [];

    // Explicit check for ON_HOLD restoration which might not be in the static map if dynamic
    // The policy map says ON_HOLD -> [CLOSED], but we need to allow restoring to previous.
    // However, the prompt says "Must store the current active status as previousActiveStatus".
    // And "When leaving ON_HOLD... Restore to previousActiveStatus".
    // So the 'toStatus' for ON_HOLD -> Restore is dynamic.
    // The map in Policy should probably allow the variable target, but for now we enforce the logic here.

    const isRestoringFromHold =
      currentStatus === InspectionReportStatus.ON_HOLD &&
      toStatus !== InspectionReportStatus.CLOSED;

    if (!allowedTransitions.includes(toStatus) && !isRestoringFromHold) {
      // 2) HTTP Error Semantics - 403 for unauthorized
      throw new ForbiddenException(
        `Transition from ${currentStatus} to ${toStatus} is not allowed for role ${user.role}`,
      );
    }

    // 2b. If restoring from hold, valid that toStatus == previousActiveStatus
    if (isRestoringFromHold) {
      // 3) ON_HOLD Restore Authorization
      if (user.role !== UserRole.SUPERVISOR && user.role !== UserRole.ADMIN) {
        throw new ForbiddenException(
          'Only Supervisor or Admin can restore from ON_HOLD',
        );
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

      const lastHoldLog =
        await this.prisma.inspectionReportTransitionLog.findFirst({
          where: {
            inspectionReportId: reportId,
            toStatus: InspectionReportStatus.ON_HOLD,
          },
          orderBy: { timestamp: 'desc' },
        });

      if (!lastHoldLog || !lastHoldLog.previousActiveStatus) {
        throw new BadRequestException(
          'Cannot restore from ON_HOLD: Previous status not found',
        );
      }

      if (toStatus !== lastHoldLog.previousActiveStatus) {
        throw new BadRequestException(
          `From ON_HOLD, you must return to ${lastHoldLog.previousActiveStatus}, not ${toStatus}`,
        );
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

      // The template's structured definition drives the gate. One read-only query,
      // only on approval requests. The legacy hardcoded fallback was retired once
      // every template carried a definition (the engine gate is proven equivalent
      // to it, then made sole authority).
      const template = await this.prisma.template.findUnique({
        where: {
          tenantId_templateKey_templateVersion: {
            tenantId: user.tenantId,
            templateKey: report.templateKey,
            templateVersion: report.templateVersion,
          },
        },
        select: { definitionJson: true },
      });
      const definition =
        (template?.definitionJson as unknown as GateDefinition | null) ?? null;

      // A missing definition is a template-misconfiguration, not a user-input
      // failure — surface it as a server-side precondition, NOT the gate's
      // VALIDATION_FAILED (which would wrongly tell the user their serials are
      // invalid). Post-cutover this is unreachable for correctly-seeded templates.
      if (!definition) {
        throw new PreconditionFailedException(
          `Template ${report.templateKey}@${report.templateVersion} has no gate definition`,
        );
      }

      enforce(engineGate(definition, serials));
    }

    // 5. Governance / Logic Calculation

    // 8) Revision Number Computation Must Be Inside Transaction
    // Moving revisionNumber and shouldSnapshot logic to inside transaction or preparing flags here.
    // actually we can keep flags here but calculation inside.
    // Moving revisionNumber and shouldSnapshot logic to inside transaction or preparing flags here.
    const isFirstApproval =
      toStatus === InspectionReportStatus.APPROVED &&
      report.revisionNumber === 0;

    const isReopen =
      (currentStatus === InspectionReportStatus.APPROVED &&
        toStatus === InspectionReportStatus.IN_INSPECTION) ||
      (currentStatus === InspectionReportStatus.CLOSED &&
        (toStatus === InspectionReportStatus.APPROVED ||
          toStatus === InspectionReportStatus.IN_INSPECTION));

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
          version: report.version,
        },
        data: updateData,
      });

      if (updateResult.count === 0) {
        throw new ConflictException(
          `Version mismatch or entity not found. Expected version: ${report.version}`,
        );
      }

      // Fetch the updated report to return it
      const updatedReport = await tx.inspectionReport.findUniqueOrThrow({
        where: { id: reportId },
        include: { childReports: true, serialNumbers: true },
      });

      // Capture the actual new revision number from the DB (crucial for atomic increment result)
      // remove capture of nextRevisionNumber as it is handled by service

      // Create Transition Log first so it is included in the snapshot
      await tx.inspectionReportTransitionLog.create({
        data: {
          inspectionReportId: reportId,
          fromStatus: currentStatus,
          toStatus: toStatus,
          userId: user.id,
          previousActiveStatus:
            toStatus === InspectionReportStatus.ON_HOLD ? currentStatus : null,
        },
      });

      // Create Snapshot if needed (after transition log so the approvedBy userId is captured)
      if (isFirstApproval) {
        await this.revisionService.createInspectionReportSnapshot(
          tx,
          reportId,
          reason || 'Initial approval',
          user.id,
          user.tenantId,
        );
      } else if (isReopen) {
        // Every isReopen transition requires a reason
        // (isReasonRequiredForInspection is true for each case), and the guard
        // above throws when it is absent — so this narrows `reason` to non-null
        // for the compiler without altering behavior.
        if (!reason) {
          throw new BadRequestException(
            'Reason is required for this transition',
          );
        }
        await this.revisionService.createInspectionReportSnapshot(
          tx,
          reportId,
          reason,
          user.id,
          user.tenantId,
        );
      }

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
        },
      });

      return updatedReport;
    });
  }
}
