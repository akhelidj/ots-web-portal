import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { InspectionReportsService } from './inspection-reports.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(RolesGuard)
@Controller('inspection-reports')
export class InspectionReportsController {
  constructor(private readonly reportsService: InspectionReportsService) {}

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR, UserRole.CUSTOMER)
  @Get()
  async getReports(
    @Req() req: any, 
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string
  ) {
    return this.reportsService.getReports(req.user, status, q, customerId);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER)
  @Post()
  async createReport(@Req() req: any, @Body() data: CreateInspectionReportDto) {
    return this.reportsService.createReport(req.user.tenantId, req.user.id, data);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.SUPERVISOR, UserRole.INSPECTOR, UserRole.CUSTOMER)
  @Get(':id')
  async getReportById(@Req() req: any, @Param('id') id: string) {
    return this.reportsService.getReportById(req.user, id);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER)
  @Patch(':id')
  async updateReport(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const { version, ...data } = body;
    return this.reportsService.updateReport(req.user.tenantId, id, req.user.id, data, version);
  }
}
