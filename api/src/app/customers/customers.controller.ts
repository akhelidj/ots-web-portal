import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  Delete,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import type { Response } from 'express';
import { CustomersService } from './customers.service';
import {
  CustomerBrandingService,
  MAX_LOGO_BYTES,
} from './customer-branding.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  UpdateCustomerDto,
  UpdateCustomerActiveDto,
} from './dto/update-customer.dto';
import { AuthenticatedRequest } from '../auth/authenticated-request';

@UseGuards(RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly branding: CustomerBrandingService,
  ) {}

  // Read-only list: a SUPERVISOR creates reports, so they need the customer picker; an
  // INSPECTOR and RECEIVER need it to show customer names (not ids) on the reports they work.
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
    UserRole.RECEIVER,
  )
  @Get()
  async listCustomers(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId;
    return this.customersService.listCustomers(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async createCustomer(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateCustomerDto,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.createCustomer(tenantId, userId, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async updateCustomer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateCustomerDto,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.updateCustomer(tenantId, userId, id, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/active')
  async updateActiveStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateCustomerActiveDto,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.updateActiveStatus(tenantId, userId, id, data);
  }

  // ---- Branding: logo (the brand colour goes through PATCH :id) ----

  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @Get(':id/logo')
  async getLogo(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimeType } = await this.branding.getLogo(req.user.tenantId, id);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store' });
    return new StreamableFile(buffer);
  }

  @Roles(UserRole.ADMIN)
  @Put(':id/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }),
  )
  async setLogo(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('version') version: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.branding.setLogo(
      req.user.tenantId,
      req.user.sub || req.user.id,
      id,
      this.parseVersion(version),
      file?.buffer,
    );
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/logo')
  async removeLogo(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('version') version: string,
  ) {
    return this.branding.removeLogo(
      req.user.tenantId,
      req.user.sub || req.user.id,
      id,
      this.parseVersion(version),
    );
  }

  private parseVersion(raw: string | undefined): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException('A valid version is required.');
    }
    return version;
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async deleteCustomer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.deleteCustomer(tenantId, userId, id);
  }
}
