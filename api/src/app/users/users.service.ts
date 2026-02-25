import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        customerId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(tenantId: string, data: { email: string; name?: string; role: UserRole; isActive?: boolean; customerId?: string }) {
    const normalizedEmail = data.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: normalizedEmail } },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists in the tenant');
    }

    if (data.role === UserRole.CUSTOMER && !data.customerId) {
      throw new ConflictException('Customer ID is required for Customer role');
    }
    if (data.role !== UserRole.CUSTOMER && data.customerId) {
      throw new ConflictException('Customer ID is only allowed for Customer role');
    }

    // Generate random 16-character base64 password (it's secure and reasonably easy to copy-paste)
    const tempPassword = crypto.randomBytes(12).toString('base64');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: normalizedEmail,
        name: data.name,
        role: data.role,
        isActive: data.isActive ?? true,
        mustChangePassword: true,
        passwordHash,
        customerId: data.customerId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        customerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...user,
      temporaryPassword: tempPassword,
    };
  }

  async updateActiveStatus(tenantId: string, id: string, isActive: boolean) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        customerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
