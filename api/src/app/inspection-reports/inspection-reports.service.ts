import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';

@Injectable()
export class InspectionReportsService {
  constructor(private prisma: PrismaService) {}

  async getReports(user: any, status?: string, q?: string, customerId?: string) {
    const where: any = { tenantId: user.tenantId };
    
    if (user.role === 'CUSTOMER') {
      where.customerId = user.customerId;
    } else if (user.role === 'SUPERVISOR' || user.role === 'ADMIN') {
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

  async getReportById(user: any, id: string) {
    const where: any = { tenantId: user.tenantId, id };
    
    if (user.role === 'CUSTOMER') {
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
      const createData: any = {
        tenantId,
        customerId: data.customerId,
        poNumber: data.poNumber,
        reportNumber: generatedReportNumber,
        status: 'DRAFT',
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
    data: any,
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

    if (existing.status === 'APPROVED' || existing.status === 'CLOSED') {
      throw new BadRequestException('Cannot mutate an Approved or Closed report. Admin revision required.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updateData: any = {
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
}
