import { Controller, Get, Post, Patch, Body, Param, Query, Request, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ChildReportsService } from './child-reports.service';
import { ChildReportStatus, ChildReportType } from '@prisma/client';

export interface UploadedFileDto {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('child-reports')
export class ChildReportsController {
  constructor(private readonly childReportsService: ChildReportsService) {}

  @Post()
  async createChildReport(@Request() req: any, @Body() body: Record<string, unknown>) {
    if (!body['id']) {
       throw new BadRequestException('Client must provide an id (UUID) for idempotency.');
    }
    return this.childReportsService.createChildReport(
      req.user.tenantId, 
      req.user.userId,
      {
         id: body['id'] as string,
         inspectionReportId: body['inspectionReportId'] as string,
         serialNumberId: body['serialNumberId'] as string,
         type: body['type'] as ChildReportType,
         notes: body['notes'] as string
      }
    );
  }

  @Get()
  async getChildReports(@Request() req, @Query('inspectionReportId') reportId: string) {
    if (!reportId) {
       throw new BadRequestException('inspectionReportId is required');
    }
    return this.childReportsService.getChildReports(req.user.tenantId, reportId);
  }

  @Patch(':id')
  async updateChildReport(@Request() req: any, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.childReportsService.updateChildReport(
      req.user.tenantId, 
      id, 
      req.user.userId,
      {
         status: body['status'] as ChildReportStatus,
         notes: body['notes'] as string
      }, 
      body['version'] as number
    );
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileDto
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.childReportsService.addAttachment(req.user.tenantId, id, file);
  }
}
