import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Req,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/authenticated-request';

export interface CreateUserDto {
  email: string;
  name?: string;
  role: UserRole;
  password: string;
  isActive?: boolean;
  customerId?: string;
}

export interface UpdateUserActiveDto {
  isActive: boolean;
}

export interface UpdateUserDto {
  name?: string;
  password?: string;
}

@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async listUsers(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId;
    return this.usersService.listUsers(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async createUser(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateUserDto,
  ) {
    const tenantId = req.user.tenantId;
    return this.usersService.createUser(tenantId, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/active')
  async updateActiveStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateUserActiveDto,
  ) {
    const tenantId = req.user.tenantId;
    return this.usersService.updateActiveStatus(tenantId, id, data.isActive);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateUserDto,
  ) {
    const tenantId = req.user.tenantId;
    return this.usersService.updateUser(tenantId, id, data);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async deleteUser(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    return this.usersService.deleteUser(tenantId, id);
  }
}
