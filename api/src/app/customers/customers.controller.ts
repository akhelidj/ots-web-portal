import { Controller, Get, Post, Body, Patch, Param, UseGuards, Req } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto, UpdateCustomerActiveDto } from './dto/update-customer.dto';

@UseGuards(RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async listCustomers(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.customersService.listCustomers(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async createCustomer(@Req() req: any, @Body() data: CreateCustomerDto) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.createCustomer(tenantId, userId, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async updateCustomer(@Req() req: any, @Param('id') id: string, @Body() data: UpdateCustomerDto) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.updateCustomer(tenantId, userId, id, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/active')
  async updateActiveStatus(@Req() req: any, @Param('id') id: string, @Body() data: UpdateCustomerActiveDto) {
    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.id;
    return this.customersService.updateActiveStatus(tenantId, userId, id, data);
  }
}
