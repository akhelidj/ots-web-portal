import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from '../storage/attachment-storage.types';

/** Hard ceiling on an uploaded logo. A header logo is tens of KB. */
export const MAX_LOGO_BYTES = 1024 * 1024;

/** What a customer's portal needs to brand itself. */
export interface CustomerBranding {
  customerId: string;
  name: string;
  /** `#rrggbb`, or null for the default palette. */
  brandColor: string | null;
  /** Changes on every upload (the logo's object id) — a cache-buster; null = no logo. */
  logoId: string | null;
}

/**
 * Sniff the image type from the bytes, never from the client's declared mimetype.
 * Raster formats only: SVG is refused because it can carry script.
 */
export function sniffLogoType(
  buffer: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Customer branding: the optional logo (bytes in AttachmentStorage, key on the
 * Customer row) and the read model a customer's portal themes itself from. The brand
 * colour itself is an ordinary Customer field, written through `PATCH /customers/:id`.
 *
 * Logo writes follow the optimistic-concurrency pattern (version compare, then a
 * guarded `updateMany`); a fresh object id per upload means a lost race only ever
 * orphans the loser's new object, which is deleted again.
 */
@Injectable()
export class CustomerBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async getBranding(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerBranding> {
    const customer = await this.findInTenant(tenantId, customerId);
    return {
      customerId: customer.id,
      name: customer.name,
      brandColor: customer.brandColor,
      logoId: customer.logoKey
        ? (customer.logoKey.split('/').pop() ?? null)
        : null,
    };
  }

  async getLogo(
    tenantId: string,
    customerId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const customer = await this.findInTenant(tenantId, customerId);
    if (!customer.logoKey) {
      throw new NotFoundException('This customer has no logo.');
    }
    const buffer = await this.storage.getLogo(customer.logoKey);
    if (!buffer) {
      throw new NotFoundException('Logo file is missing from storage.');
    }
    return {
      buffer,
      mimeType: customer.logoMimeType ?? 'application/octet-stream',
    };
  }

  async setLogo(
    tenantId: string,
    userId: string,
    customerId: string,
    version: number,
    buffer: Buffer | undefined,
  ) {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Logo file is required.');
    }
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new BadRequestException(
        `Logo is too large (max ${MAX_LOGO_BYTES / 1024 / 1024} MB).`,
      );
    }
    const mimeType = sniffLogoType(buffer);
    if (!mimeType) {
      throw new BadRequestException('Logo must be a PNG, JPEG or WebP image.');
    }

    const customer = await this.findInTenant(tenantId, customerId);
    if (customer.version !== version) {
      throw new ConflictException('Version mismatch');
    }

    const logoKey = this.storage.buildLogoKey({
      tenantId,
      customerId,
      objectId: randomUUID(),
    });
    await this.storage.putLogo(logoKey, buffer, mimeType);

    const updated = await this.guardedUpdate(customerId, version, {
      logoKey,
      logoMimeType: mimeType,
    }).catch(async (error: unknown) => {
      await this.storage.deleteLogo(logoKey);
      throw error;
    });

    if (customer.logoKey) {
      await this.storage.deleteLogo(customer.logoKey);
    }
    await this.audit(
      tenantId,
      userId,
      customerId,
      'CUSTOMER_LOGO_SET',
      mimeType,
    );
    return updated;
  }

  async removeLogo(
    tenantId: string,
    userId: string,
    customerId: string,
    version: number,
  ) {
    const customer = await this.findInTenant(tenantId, customerId);
    if (customer.version !== version) {
      throw new ConflictException('Version mismatch');
    }
    if (!customer.logoKey) {
      return customer;
    }
    const updated = await this.guardedUpdate(customerId, version, {
      logoKey: null,
      logoMimeType: null,
    });
    await this.storage.deleteLogo(customer.logoKey);
    await this.audit(tenantId, userId, customerId, 'CUSTOMER_LOGO_REMOVE', '');
    return updated;
  }

  private async guardedUpdate(
    customerId: string,
    version: number,
    data: { logoKey: string | null; logoMimeType: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: { id: customerId, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConflictException('Version mismatch');
      }
      return tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    });
  }

  private async findInTenant(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private async audit(
    tenantId: string,
    userId: string,
    customerId: string,
    action: string,
    detail: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        entity: 'CUSTOMER',
        entityId: customerId,
        action,
        reason: detail ? `${action} | ${detail}` : action,
      },
    });
  }
}
