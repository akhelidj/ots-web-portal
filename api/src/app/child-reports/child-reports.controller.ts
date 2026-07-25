import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ChildReportsService } from './child-reports.service';
import { ChildReportStatus, SerialDisposition } from '@prisma/client';

export interface UploadedFileDto {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller()
export class ChildReportsController {
  constructor(private readonly childReportsService: ChildReportsService) {}

  @Post('inspection-reports/:id/child-reports/sync-rework')
  async syncReworkChildReport(@Request() req: any, @Param('id') id: string) {
    if (!id) {
      throw new BadRequestException(
        'Inspection Report ID is required for sync.',
      );
    }
    return this.childReportsService.syncReworkChildReport(
      req.user.tenantId,
      id,
    );
  }

  @Get('child-reports')
  async getChildReports(
    @Request() req: any,
    @Query('inspectionReportId') reportId: string,
  ) {
    if (!reportId) {
      throw new BadRequestException('inspectionReportId is required');
    }
    return this.childReportsService.getChildReports(
      req.user.tenantId,
      reportId,
    );
  }

  @Get('child-reports/:id')
  async getChildReport(@Request() req: any, @Param('id') id: string) {
    return this.childReportsService.getChildReportById(req.user.tenantId, id);
  }

  @Patch('child-reports/:id')
  async updateChildReport(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.childReportsService.updateChildReport(
      req.user.tenantId,
      id,
      req.user.userId,
      {
        status: body['status'] as ChildReportStatus,
        notes: body['notes'] as string,
      },
      body['version'] as number,
    );
  }

  @Patch('child-reports/:id/serial-numbers/:snId')
  async updateChildReportSerialNumber(
    @Request() req: any,
    @Param('id') childReportId: string,
    @Param('snId') serialNumberId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.childReportsService.updateChildReportSerialNumber(
      req.user.tenantId,
      childReportId,
      serialNumberId,
      {
        inspectionData: body['inspectionData'] as Record<string, unknown>,
        disposition: body['disposition'] as SerialDisposition,
      },
    );
  }

  @Post('child-reports/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.childReportsService.addAttachment(req.user.tenantId, id, file);
  }
}
