import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  UpdateCustomerDto,
  UpdateCustomerActiveDto,
} from './dto/update-customer.dto';

export enum CustomerAuditAction {
  CREATE = 'CUSTOMER_CREATE',
  UPDATE = 'CUSTOMER_UPDATE',
  SET_ACTIVE = 'CUSTOMER_SET_ACTIVE',
  DELETE = 'CUSTOMER_DELETE',
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomers(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async createCustomer(
    tenantId: string,
    userId: string,
    data: CreateCustomerDto,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: data.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Customer with this name already exists');
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        ...data,
      },
    });

    await this.logAudit(
      tenantId,
      userId,
      customer.id,
      CustomerAuditAction.CREATE,
      {
        ...data,
      },
    );

    return customer;
  }

  async updateCustomer(
    tenantId: string,
    userId: string,
    id: string,
    data: UpdateCustomerDto,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.version !== data.version) {
      throw new ConflictException('Version mismatch');
    }

    // Extract changed fields for audit log
    const updateData = { ...data };
    delete (updateData as Record<string, unknown>).version;

    const changedFields: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(updateData)) {
      const oldValue = (customer as Record<string, unknown>)[key];
      if (value !== undefined && oldValue !== value) {
        changedFields[key] = { old: oldValue, new: value };
      }
    }

    if (Object.keys(changedFields).length === 0) {
      return customer;
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...updateData,
        version: { increment: 1 },
      },
    });

    await this.logAudit(
      tenantId,
      userId,
      updatedCustomer.id,
      CustomerAuditAction.UPDATE,
      changedFields,
    );

    return updatedCustomer;
  }

  async updateActiveStatus(
    tenantId: string,
    userId: string,
    id: string,
    data: UpdateCustomerActiveDto,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.version !== data.version) {
      throw new ConflictException('Version mismatch');
    }

    if (!data.isActive && !data.reason) {
      throw new BadRequestException('Reason is required when deactivating');
    }

    const changedFields: Record<string, { old: unknown; new: unknown }> = {
      isActive: { old: customer.isActive, new: data.isActive },
    };

    const updatePayload: Prisma.CustomerUpdateInput = {
      isActive: data.isActive,
      version: { increment: 1 },
    };

    if (!data.isActive) {
      updatePayload.deactivatedAt = new Date();
      updatePayload.deactivatedBy = userId;
      updatePayload.deactivationReason = data.reason;
      changedFields.deactivationReason = {
        old: customer.deactivationReason,
        new: data.reason,
      };
    } else {
      updatePayload.deactivatedAt = null;
      updatePayload.deactivatedBy = null;
      updatePayload.deactivationReason = null;
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id },
      data: updatePayload,
    });

    await this.logAudit(
      tenantId,
      userId,
      updatedCustomer.id,
      CustomerAuditAction.SET_ACTIVE,
      changedFields,
      data.reason,
    );

    return updatedCustomer;
  }

  private async logAudit(
    tenantId: string,
    userId: string,
    entityId: string,
    action: CustomerAuditAction,
    payload: Record<string, unknown>,
    explicitReason?: string,
  ) {
    let reasonString = explicitReason || '';
    if (payload && Object.keys(payload).length > 0) {
      const changesStr = JSON.stringify(payload);
      reasonString = reasonString
        ? `${reasonString} | Data: ${changesStr}`
        : `Data: ${changesStr}`;
    }

    // fallback if it's somehow completely empty
    if (!reasonString) {
      reasonString = action;
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        entity: 'CUSTOMER',
        entityId,
        action,
        reason: reasonString,
      },
    });
  }

  async deleteCustomer(tenantId: string, userId: string, id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException('Customer not found');
    }

    // Since we set onDelete: SetNull on related fields in Prisma schema,
    // we can safely delete the customer here.
    const deletedCustomer = await this.prisma.customer.delete({
      where: { id },
    });

    await this.logAudit(tenantId, userId, id, CustomerAuditAction.DELETE, {
      name: deletedCustomer.name,
    });

    return { success: true };
  }
}
