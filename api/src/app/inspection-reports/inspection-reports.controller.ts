import { Controller, Get, Patch, Param, Body, Req } from '@nestjs/common';
import { InspectionReportsService } from './inspection-reports.service';

@Controller('inspection-reports')
export class InspectionReportsController {
  constructor(private readonly reportsService: InspectionReportsService) {}

  @Get()
  async getReports(@Req() req: any) {
    return this.reportsService.getReports(req.user.tenantId);
  }

  @Get(':id')
  async getReportById(@Req() req: any, @Param('id') id: string) {
    return this.reportsService.getReportById(req.user.tenantId, id);
  }

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
