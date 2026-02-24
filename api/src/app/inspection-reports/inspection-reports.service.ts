import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';

@Injectable()
export class InspectionReportsService {
  constructor(private prisma: PrismaService) {}

  async getReports(user: any, status?: string) {
    const where: any = { tenantId: user.tenantId };
    
    if (user.role === 'CUSTOMER') {
      where.customerId = user.customerId;
    }

    if (status) {
      where.status = status;
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
    // 1. Validate customer belongs to tenant
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: data.customerId,
        tenantId,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found in this tenant');
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

    // 3. Create report + Audit Log transaction
    return await this.prisma.$transaction(async (tx) => {
      const report = await tx.inspectionReport.create({
        data: {
          tenantId,
          customerId: data.customerId,
          poNumber: data.poNumber,
          status: 'DRAFT',
          templateKey: template.templateKey,
          templateVersion: template.templateVersion,
          templateHash: template.hash,
          version: 1,
        },
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

    return await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.inspectionReport.updateMany({
        where: { 
            id,
            tenantId,
            version: existing.version
        },
        data: {
          ...data,
          version: existing.version + 1,
        },
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
