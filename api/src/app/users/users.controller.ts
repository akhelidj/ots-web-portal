import { Controller, Get, Post, Body, Patch, Param, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

export interface CreateUserDto {
  email: string;
  name?: string;
  role: UserRole;
  isActive?: boolean;
}

export interface UpdateUserActiveDto {
  isActive: boolean;
}

@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async listUsers(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.usersService.listUsers(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async createUser(@Req() req: any, @Body() data: CreateUserDto) {
    const tenantId = req.user.tenantId;
    return this.usersService.createUser(tenantId, data);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/active')
  async updateActiveStatus(@Req() req: any, @Param('id') id: string, @Body() data: UpdateUserActiveDto) {
    const tenantId = req.user.tenantId;
    return this.usersService.updateActiveStatus(tenantId, id, data.isActive);
  }
}
