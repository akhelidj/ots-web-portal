import { Controller, Get, Post, Patch, Param, Body, Req } from '@nestjs/common';
import { SerialNumbersService } from './serial-numbers.service';

@Controller()
export class SerialNumbersController {
  constructor(private readonly serialNumbersService: SerialNumbersService) {}

  @Get('inspection-reports/:id/serial-numbers')
  async getSerialNumbers(@Req() req: any, @Param('id') reportId: string) {
    return this.serialNumbersService.getSerialNumbers(req.user.tenantId, reportId);
  }

  @Post('inspection-reports/:id/serial-numbers')
  async createSerialNumber(
    @Req() req: any,
    @Param('id') reportId: string,
    @Body() body: any,
  ) {
    return this.serialNumbersService.createSerialNumber(req.user.tenantId, reportId, req.user.id, body);
  }

  @Patch('serial-numbers/:id')
  async updateSerialNumber(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const { version, ...data } = body;
    return this.serialNumbersService.updateSerialNumber(req.user.tenantId, id, req.user.id, data, version);
  }
}
