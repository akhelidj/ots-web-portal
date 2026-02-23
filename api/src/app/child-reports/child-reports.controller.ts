import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ChildReportsService } from './child-reports.service';
import { JwtAuthGuard } from '../auth/strategies/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('child-reports')
export class ChildReportsController {
  constructor(private readonly childReportsService: ChildReportsService) {}

  @Post()
  async createChildReport(@Request() req, @Body() body: any) {
    if (!body.id) {
       throw new BadRequestException('Client must provide an id (UUID) for idempotency.');
    }
    return this.childReportsService.createChildReport(
      req.user.tenantId, 
      req.user.userId,
      body
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
  async updateChildReport(@Request() req, @Param('id') id: string, @Body() body: any) {
    return this.childReportsService.updateChildReport(
      req.user.tenantId, 
      id, 
      req.user.userId,
      body, 
      body.version
    );
  }
}
