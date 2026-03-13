import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { InspectionReportsService } from './inspection-reports.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';
import { CreateApprovalBatchDto } from './dto/create-approval-batch.dto';
import { ApproveBatchDto } from './dto/approve-batch.dto';
import { ReturnBatchDto } from './dto/return-batch.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole, InspectionReportStatus } from '@prisma/client';

export interface AuthRequest {
  user: {
    id: string;
    tenantId: string;
    role: UserRole;
  };
}

@UseGuards(RolesGuard)
@Controller('inspection-reports')
export class InspectionReportsController {
  constructor(private readonly reportsService: InspectionReportsService) {}

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR, UserRole.CUSTOMER)
  @Get()
  async getReports(
    @Req() req: AuthRequest, 
    @Query('status') status?: InspectionReportStatus,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string
  ) {
    return this.reportsService.getReports(req.user, status, q, customerId);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER)
  @Post()
  async createReport(@Req() req: AuthRequest, @Body() data: CreateInspectionReportDto) {
    return this.reportsService.createReport(req.user.tenantId, req.user.id, data);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR, UserRole.CUSTOMER)
  @Get(':id')
  async getReportById(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.reportsService.getReportById(req.user, id);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.INSPECTOR, UserRole.SUPERVISOR)
  @Patch(':id')
  async updateReport(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { version: number; [key: string]: unknown }
  ) {
    const { version, ...data } = body;
    return this.reportsService.updateReport(req.user.tenantId, id, req.user.id, data, version);
  }

  @Roles(UserRole.ADMIN, UserRole.INSPECTOR)
  @Post(':id/approval-batches')
  async createApprovalBatch(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: CreateApprovalBatchDto
  ) {
    return this.reportsService.submitForApproval(req.user.tenantId, id, req.user.id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @Post(':id/approval-batches/:batchId/approve')
  async approveBatch(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() body: ApproveBatchDto
  ) {
    return this.reportsService.approveBatch(req.user.tenantId, id, batchId, req.user.id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @Post(':id/approval-batches/:batchId/return')
  async returnBatch(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() body: ReturnBatchDto
  ) {
    return this.reportsService.returnBatch(req.user.tenantId, id, batchId, req.user.id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR)
  @Get(':id/approval-batches')
  async getBatchesForReport(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.reportsService.getBatchesForReport(req.user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR)
  @Get(':id/approval-batches/:batchId')
  async getBatchById(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string
  ) {
    return this.reportsService.getBatchById(req.user.tenantId, id, batchId);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR)
  @Get(':id/approval-progress')
  async getReportApprovalProgress(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.reportsService.getReportApprovalProgress(req.user.tenantId, id);
  }
}
