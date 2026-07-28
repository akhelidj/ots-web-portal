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
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SerialNumbersService } from './serial-numbers.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/authenticated-request';

@UseGuards(RolesGuard)
@Controller()
export class SerialNumbersController {
  constructor(private readonly serialNumbersService: SerialNumbersService) {}

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
    UserRole.CUSTOMER,
  )
  @Get('inspection-reports/:id/serial-numbers')
  async getSerialNumbers(
    @Req() req: AuthenticatedRequest,
    @Param('id') reportId: string,
  ) {
    return this.serialNumbersService.getSerialNumbers(req.user, reportId);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER)
  @Post('inspection-reports/:id/serial-numbers')
  async createSerialNumber(
    @Req() req: any,
    @Param('id') reportId: string,
    @Body() body: { items: { clientRef: string; serialNumber: string }[] },
  ) {
    return this.serialNumbersService.createSerialNumber(
      req.user.tenantId,
      reportId,
      req.user.id,
      body,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER, UserRole.INSPECTOR)
  @Patch('serial-numbers/:id')
  async updateSerialNumber(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: { serialNumber?: string; version: number; inspectionData?: any },
  ) {
    if (body.version === undefined || body.version === null) {
      throw new BadRequestException('version is required');
    }
    if (
      body.inspectionData !== undefined &&
      req.user.role === UserRole.RECEIVER
    ) {
      throw new ForbiddenException(
        'RECEIVER role cannot inspect serial numbers',
      );
    }
    const { version, ...data } = body;
    return this.serialNumbersService.updateSerialNumber(
      req.user.tenantId,
      id,
      req.user.id,
      data,
      version,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.RECEIVER)
  @Delete('serial-numbers/:id')
  async deleteSerialNumber(@Req() req: any, @Param('id') id: string) {
    return this.serialNumbersService.deleteSerialNumber(
      req.user.tenantId,
      id,
      req.user.id,
    );
  }
}
