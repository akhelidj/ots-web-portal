import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { InspectionReportsService } from './inspection-reports.service';
import { ReportDeletionService } from './report-deletion.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';
import { CreateApprovalBatchDto } from './dto/create-approval-batch.dto';
import { ApproveBatchDto } from './dto/approve-batch.dto';
import { ReturnBatchDto } from './dto/return-batch.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole, InspectionReportStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/authenticated-request';

export interface UploadedFileDto {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(RolesGuard)
@Controller('inspection-reports')
export class InspectionReportsController {
  constructor(
    private readonly reportsService: InspectionReportsService,
    private readonly deletion: ReportDeletionService,
  ) {}

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
    UserRole.CUSTOMER,
  )
  @Get()
  async getReports(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: InspectionReportStatus,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.reportsService.getReports(req.user, status, q, customerId);
  }

  // The consumption picker's source. Declared BEFORE @Get(':id') so the literal path
  // is not captured as an :id param. ADMIN + RECEIVER are the report-creating roles;
  // RECEIVER has no other way to list templates (TemplateController is admin-only).
  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR)
  @Get('available-templates')
  async getAvailableTemplates(@Req() req: AuthenticatedRequest) {
    return this.reportsService.getAvailableTemplates(req.user.tenantId);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR)
  @Post()
  async createReport(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateInspectionReportDto,
  ) {
    return this.reportsService.createReport(
      req.user.tenantId,
      req.user.id,
      data,
    );
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
    UserRole.CUSTOMER,
  )
  @Get(':id')
  async getReportById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.reportsService.getReportById(req.user, id);
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.INSPECTOR,
    UserRole.SUPERVISOR,
  )
  @Patch(':id')
  async updateReport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { version: number; [key: string]: unknown },
  ) {
    const { version, ...data } = body;
    return this.reportsService.updateReport(
      req.user.tenantId,
      id,
      req.user.id,
      data,
      version,
    );
  }

  /** ADMIN-only, read-only: what deleting this report would take with it. */
  @Roles(UserRole.ADMIN)
  @Get(':id/delete-impact')
  async getDeleteImpact(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.deletion.getDeleteImpact(req.user.tenantId, id);
  }

  /** ADMIN-only permanent delete of a report and everything under it. */
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async deleteReport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { version?: number; reason?: string },
  ) {
    return this.deletion.deleteReport(
      req.user.tenantId,
      req.user.id,
      id,
      Number(body?.version),
      body?.reason,
    );
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.INSPECTOR,
    UserRole.SUPERVISOR,
  )
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.reportsService.addAttachment(
      req.user.tenantId,
      id,
      file,
      req.user.sub || req.user.id,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.INSPECTOR, UserRole.SUPERVISOR)
  @Post(':id/approval-batches')
  async createApprovalBatch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CreateApprovalBatchDto,
  ) {
    return this.reportsService.submitForApproval(
      req.user.tenantId,
      id,
      req.user.id,
      body,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @Post(':id/approval-batches/:batchId/approve')
  async approveBatch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() body: ApproveBatchDto,
  ) {
    return this.reportsService.approveBatch(
      req.user.tenantId,
      id,
      batchId,
      req.user.id,
      body,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @Post(':id/approval-batches/:batchId/return')
  async returnBatch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() body: ReturnBatchDto,
  ) {
    return this.reportsService.returnBatch(
      req.user.tenantId,
      id,
      batchId,
      req.user.id,
      body,
    );
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
  )
  @Get(':id/approval-batches')
  async getBatchesForReport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.reportsService.getBatchesForReport(req.user.tenantId, id);
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
  )
  @Get(':id/approval-batches/:batchId')
  async getBatchById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
  ) {
    return this.reportsService.getBatchById(req.user.tenantId, id, batchId);
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
  )
  @Get(':id/approval-progress')
  async getReportApprovalProgress(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.reportsService.getReportApprovalProgress(req.user.tenantId, id);
  }
}
