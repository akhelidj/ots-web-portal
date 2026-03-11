import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, UserRole, InspectionReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';

@Injectable()
export class InspectionReportsService {
  constructor(private prisma: PrismaService) {}

  async getReports(user: { tenantId: string, role: UserRole, customerId?: string }, status?: InspectionReportStatus, q?: string, customerId?: string) {
    const where: Prisma.InspectionReportWhereInput = { tenantId: user.tenantId };
    
    if (user.role === UserRole.CUSTOMER) {
      where.customerId = user.customerId;
    } else if (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN) {
      if (customerId) {
        where.customerId = customerId;
      }
    }

    if (status) {
      where.status = status;
    }

    if (q && q.trim().length >= 2) {
      where.poNumber = {
        contains: q.trim(),
        mode: 'insensitive'
      };
    }

    return this.prisma.inspectionReport.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getReportById(user: { tenantId: string, role: UserRole, customerId?: string }, id: string) {
    const where: Prisma.InspectionReportWhereInput = { tenantId: user.tenantId, id };
    
    if (user.role === UserRole.CUSTOMER) {
      where.customerId = user.customerId;
    }

    const report = await this.prisma.inspectionReport.findFirst({
      where,
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }
    return report;
  }

  async createReport(tenantId: string, userId: string, data: CreateInspectionReportDto) {
    console.log('CREATE REPORT DATA:', data);
    
    // 1. Validate customer belongs to tenant
    if (!data.customerId || data.customerId.trim() === '') {
      throw new BadRequestException('Customer ID is required to generate a report number.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
          id: data.customerId,
          tenantId,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found in this tenant');
    }
    
    let customerPrefix = '';
    if (customer.code && customer.code.trim().length > 0) {
        customerPrefix = customer.code.trim().toUpperCase();
    } else {
        // Fallback to initials
        const parts = customer.name.trim().split(/\s+/);
        if (parts.length === 1) {
            customerPrefix = parts[0].substring(0, 3).toUpperCase();
        } else {
            customerPrefix = parts.map(w => w[0]).join('').substring(0, 4).toUpperCase();
        }
    }

    // 2. Resolve template binding (DRILL_PIPE_REPORT v1 scope)
    const templateKey = 'DRILL_PIPE_REPORT';
    const template = await this.prisma.template.findFirst({
      where: {
        tenantId,
        templateKey,
        status: 'ACTIVE',
      },
      orderBy: {
        templateVersion: 'desc',
      }
    });

    if (!template) {
      throw new BadRequestException(`No active template found for ${templateKey}`);
    }

    // 3. Generate Report Number (PREFIX-YYMMDD-HHMMSS)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    const generatedReportNumber = `${customerPrefix}-${yy}${mm}${dd}-${hh}${min}${sec}`;

    // 4. Create report + Audit Log transaction
    return await this.prisma.$transaction(async (tx) => {
      const createData: Prisma.InspectionReportUncheckedCreateInput = {
        tenantId,
        customerId: data.customerId,
        poNumber: data.poNumber,
        reportNumber: generatedReportNumber,
        status: InspectionReportStatus.DRAFT,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        templateHash: template.hash,
        version: 1,
      };

      const report = await tx.inspectionReport.create({
        data: createData,
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entity: 'InspectionReport',
          entityId: report.id,
          tenantId,
          userId,
          inspectionReportId: report.id,
        },
      });

      return report;
    });
  }

  async updateReport(
    tenantId: string,
    id: string,
    userId: string,
    data: Partial<Prisma.InspectionReportUpdateInput>,
    version: number,
  ) {
    const existing = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id },
    });

    if (!existing) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }

    if (existing.version !== version) {
      throw new ConflictException(`Version mismatch. Expected ${existing.version}, got ${version}`);
    }

    if (existing.status === InspectionReportStatus.APPROVED || existing.status === InspectionReportStatus.CLOSED) {
      throw new BadRequestException('Cannot mutate an Approved or Closed report. Admin revision required.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.InspectionReportUpdateInput = {
        updatedAt: new Date(),
        version: existing.version + 1,
      };

      if (data.inspectorComment !== undefined) updateData.inspectorComment = data.inspectorComment;
      if (data.inspectionAddress !== undefined) updateData.inspectionAddress = data.inspectionAddress;
      if (data.standardUsed !== undefined) updateData.standardUsed = data.standardUsed;
      if (data.equipmentUsed !== undefined) {
         updateData.equipmentUsed = data.equipmentUsed === null ? Prisma.DbNull : data.equipmentUsed;
      }
      if (data.inspectionMethod !== undefined) {
         updateData.inspectionMethod = data.inspectionMethod === null ? Prisma.DbNull : data.inspectionMethod;
      }
      if (data.grade !== undefined) updateData.grade = data.grade;
      if (data.range !== undefined) updateData.range = data.range;
      if (data.weight !== undefined) updateData.weight = data.weight;
      if (data.nomWT !== undefined) updateData.nomWT = data.nomWT;
      if (data.nomOD !== undefined) updateData.nomOD = data.nomOD;
      if (data.nomID !== undefined) updateData.nomID = data.nomID;
      if (data.connection !== undefined) updateData.connection = data.connection;
      if (data.poNumber !== undefined) updateData.poNumber = data.poNumber;
      
      const updateResult = await tx.inspectionReport.updateMany({
        where: { 
            id,
            tenantId,
            version: existing.version
        },
        data: updateData,
      });

      if (updateResult.count === 0) {
          throw new ConflictException(`Version mismatch or entity not found. Expected version: ${existing.version}`);
      }
      
      const updated = await tx.inspectionReport.findUniqueOrThrow({
          where: { id }
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'InspectionReport',
          entityId: id,
          tenantId,
          userId,
          reason: 'Manual update',
          inspectionReportId: id,
        },
      });

      return updated;
    });
  }

  async createApprovalBatch(tenantId: string, reportId: string, userId: string, data: { serialNumberIds: string[], notes?: string, reportVersion: number }) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Validate report state
      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
        include: { serialNumbers: true }
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion) throw new ConflictException(`Version mismatch. Expected ${report.version}, got ${data.reportVersion}`);
      if (report.status === 'APPROVED' || report.status === 'CLOSED') {
        throw new BadRequestException('Report is already approved or closed.');
      }

      // 2. Validate all provided S/N belong to the report
      const invalidIds = data.serialNumberIds.filter(id => !report.serialNumbers.some(sn => sn.id === id));
      if (invalidIds.length > 0) {
        throw new BadRequestException(`Some Serial Numbers do not belong to this report: ${invalidIds.join(', ')}`);
      }

      // 3. Find current S/N database states to enforce safeguard 1
      const serials = await tx.serialNumber.findMany({
        where: {
          id: { in: data.serialNumberIds },
          tenantId,
          inspectionReportId: reportId
        }
      });

      for (const sn of serials) {
        if (sn.approvalStatus === 'SUBMITTED_FOR_APPROVAL' || sn.approvalStatus === 'APPROVED') {
          throw new BadRequestException(`Serial number ${sn.serial} cannot be submitted, it is already ${sn.approvalStatus}`);
        }

        // Technically also verify it's not in an active SUBMITTED batch just in case status is out of sync
        const activeBatchMember = await tx.inspectionApprovalBatchSerialNumber.findFirst({
          where: {
            serialNumberId: sn.id,
            batch: {
              status: 'SUBMITTED'
            }
          }
        });
        if (activeBatchMember) {
           throw new BadRequestException(`Serial number ${sn.serial} is already linked to an active unapproved batch.`);
        }
      }

      // 4. Create the batch
      const batch = await tx.inspectionApprovalBatch.create({
        data: {
          tenantId,
          inspectionReportId: reportId,
          submittedByUserId: userId,
          status: 'SUBMITTED',
          notes: data.notes || null,
          serialNumbers: {
            create: data.serialNumberIds.map(id => ({
              tenantId,
              serialNumberId: id
            }))
          }
        },
        include: { serialNumbers: true }
      });

      // 5. Update S/N approval states
      await tx.serialNumber.updateMany({
        where: { id: { in: data.serialNumberIds }, tenantId },
        data: { approvalStatus: 'SUBMITTED_FOR_APPROVAL' }
      });

      // 6. Update report version (optimistic locking)
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: { version: report.version + 1 }
      });

      // 7. Audit log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_SUBMIT',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason: `Submitted ${data.serialNumberIds.length} S/N for approval`,
          tenantId,
          userId,
          inspectionReportId: report.id,
        }
      });

      return { batch, updatedReport };
    });
  }

  async approveBatch(tenantId: string, reportId: string, batchId: string, userId: string, data: { batchVersion: number, reportVersion: number, reason?: string }) {
    return await this.prisma.$transaction(async (tx) => {
      const batch = await tx.inspectionApprovalBatch.findFirst({
        where: { id: batchId, tenantId, inspectionReportId: reportId },
        include: { serialNumbers: { include: { serialNumber: true } } }
      });

      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'SUBMITTED') throw new BadRequestException(`Cannot approve batch in status ${batch.status}`);
      if (batch.version !== data.batchVersion) throw new ConflictException(`Batch version mismatch. Expected ${batch.version}, got ${data.batchVersion}`);

      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
        include: { serialNumbers: true }
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion) throw new ConflictException(`Report version mismatch. Expected ${report.version}, got ${data.reportVersion}`);

      // Verify each member is actually STILL SUBMITTED_FOR_APPROVAL
      for (const member of batch.serialNumbers) {
         const sn = await tx.serialNumber.findUnique({ where: { id: member.serialNumberId } });
         if (!sn || sn.approvalStatus !== 'SUBMITTED_FOR_APPROVAL') {
             throw new BadRequestException(`Serial ${sn?.serial} is not in SUBMITTED_FOR_APPROVAL state.`);
         }
      }

      // Update Batch
      const updatedBatch = await tx.inspectionApprovalBatch.update({
        where: { id: batchId },
        data: {
          status: 'APPROVED',
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          version: batch.version + 1
        }
      });

      // Update S/N states
      const snIds = batch.serialNumbers.map(m => m.serialNumberId);
      await tx.serialNumber.updateMany({
        where: { id: { in: snIds } },
        data: { approvalStatus: 'APPROVED' }
      });

      // We must check if ALL S/N for the report are now approved.
      // Recompute the parent aggregate
      let nextReportStatus = report.status;
      const allReportSerials = await tx.serialNumber.findMany({
        where: { inspectionReportId: reportId, tenantId }
      });

      const allApproved = allReportSerials.every(sn => sn.approvalStatus === 'APPROVED' || snIds.includes(sn.id));
      
      if (allApproved && allReportSerials.length > 0) {
        nextReportStatus = 'APPROVED';
      }

      // Update report
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          status: nextReportStatus,
          version: report.version + 1
        }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_APPROVE',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason: data.reason || 'Approved batch',
          tenantId,
          userId,
          inspectionReportId: report.id,
        }
      });

      if (nextReportStatus === 'APPROVED' && report.status !== 'APPROVED') {
         await tx.auditLog.create({
            data: {
              action: 'REPORT_APPROVE_AUTO',
              entity: 'InspectionReport',
              entityId: report.id,
              reason: 'All S/N approved',
              tenantId,
              userId: 'system',
              inspectionReportId: report.id,
            }
         });
      }

      return { batch: updatedBatch, updatedReport, allApproved };
    });
  }

  async returnBatch(tenantId: string, reportId: string, batchId: string, userId: string, data: { batchVersion: number, reportVersion: number, reason: string }) {
    if (!data.reason || data.reason.trim() === '') {
      throw new BadRequestException('Reason is mandatory when returning a batch');
    }

    return await this.prisma.$transaction(async (tx) => {
      const batch = await tx.inspectionApprovalBatch.findFirst({
        where: { id: batchId, tenantId, inspectionReportId: reportId },
        include: { serialNumbers: true }
      });

      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'SUBMITTED') throw new BadRequestException(`Cannot return batch in status ${batch.status}`);
      if (batch.version !== data.batchVersion) throw new ConflictException(`Batch version mismatch. Expected ${batch.version}, got ${data.batchVersion}`);

      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion) throw new ConflictException(`Report version mismatch. Expected ${report.version}, got ${data.reportVersion}`);

      // Verify members
      for (const member of batch.serialNumbers) {
         const sn = await tx.serialNumber.findUnique({ where: { id: member.serialNumberId } });
         if (!sn || sn.approvalStatus !== 'SUBMITTED_FOR_APPROVAL') {
             throw new BadRequestException(`Serial ${sn?.serial} is not in SUBMITTED_FOR_APPROVAL state.`);
         }
      }

      // Update Batch
      const updatedBatch = await tx.inspectionApprovalBatch.update({
        where: { id: batchId },
        data: {
          status: 'RETURNED',
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          version: batch.version + 1
        }
      });

      // Revert S/N to INSPECTED_DRAFT
      const snIds = batch.serialNumbers.map(m => m.serialNumberId);
      await tx.serialNumber.updateMany({
        where: { id: { in: snIds } },
        data: { approvalStatus: 'INSPECTED_DRAFT' }
      });

      // Report status doesn't change since we're just returning S/N to draft

      // Update report
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          version: report.version + 1
        }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_RETURN',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason: data.reason,
          tenantId,
          userId,
          inspectionReportId: report.id,
        }
      });

      return { batch: updatedBatch, updatedReport };
    });
  }

  async getBatchesForReport(tenantId: string, reportId: string) {
    return this.prisma.inspectionApprovalBatch.findMany({
      where: {
        tenantId,
        inspectionReportId: reportId
      },
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
        reviewedByUser: { select: { id: true, name: true, email: true } },
        serialNumbers: {
          include: {
            serialNumber: true
          }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });
  }

  async getBatchById(tenantId: string, reportId: string, batchId: string) {
    const batch = await this.prisma.inspectionApprovalBatch.findFirst({
      where: {
        id: batchId,
        tenantId,
        inspectionReportId: reportId
      },
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
        reviewedByUser: { select: { id: true, name: true, email: true } },
        serialNumbers: {
          include: {
            serialNumber: true
          }
        }
      }
    });

    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async getReportApprovalProgress(tenantId: string, reportId: string) {
    const serials = await this.prisma.serialNumber.findMany({
      where: { tenantId, inspectionReportId: reportId }
    });

    return {
      total: serials.length,
      notInspected: serials.filter(s => s.approvalStatus === 'NOT_INSPECTED').length,
      inspectedDraft: serials.filter(s => s.approvalStatus === 'INSPECTED_DRAFT').length,
      submitted: serials.filter(s => s.approvalStatus === 'SUBMITTED_FOR_APPROVAL').length,
      approved: serials.filter(s => s.approvalStatus === 'APPROVED').length,
    };
  }
}
