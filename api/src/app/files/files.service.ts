import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

interface AuthUser {
  tenantId: string;
  role: UserRole;
  customerId?: string | null;
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly attachmentDir = path.join(
    process.cwd(),
    'api',
    'uploads',
    'attachments',
  );

  constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    await this.ensureAttachmentStorageConsistency();
  }

  public async saveAttachmentBinary(
    attachmentId: string,
    buffer: Buffer,
  ): Promise<void> {
    await fs.mkdir(this.attachmentDir, { recursive: true });
    await fs.writeFile(this.getAttachmentPath(attachmentId), buffer);
  }

  public async removeAttachmentBinary(attachmentId: string): Promise<void> {
    try {
      await fs.unlink(this.getAttachmentPath(attachmentId));
    } catch {
      // no-op when file is already missing
    }
  }

  public async resolveAttachmentForDownload(
    user: AuthUser,
    attachmentId: string,
  ) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        inspectionReport: {
          select: {
            tenantId: true,
            customerId: true,
          },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    const ownerReport = attachment.inspectionReport;
    if (!ownerReport || ownerReport.tenantId !== user.tenantId) {
      throw new ForbiddenException('Attachment access denied');
    }

    if (
      user.role === UserRole.CUSTOMER &&
      ownerReport.customerId !== user.customerId
    ) {
      throw new ForbiddenException('Attachment access denied');
    }

    const filePath = this.getAttachmentPath(attachment.id);
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(filePath);
    } catch {
      throw new NotFoundException('Attachment file missing on server');
    }

    return {
      filename: attachment.filename,
      buffer: fileBuffer,
    };
  }

  public buildAttachmentUrl(attachmentId: string): string {
    return `/api/files/attachments/${attachmentId}`;
  }

  private async ensureAttachmentStorageConsistency(): Promise<void> {
    await fs.mkdir(this.attachmentDir, { recursive: true });

    const attachments = await this.prisma.attachment.findMany({
      select: {
        id: true,
        filename: true,
        url: true,
      },
    });

    if (attachments.length === 0) {
      return;
    }

    const updates: Array<{ id: string; url: string }> = [];

    for (const attachment of attachments) {
      const canonicalUrl = this.buildAttachmentUrl(attachment.id);
      if (attachment.url !== canonicalUrl) {
        updates.push({ id: attachment.id, url: canonicalUrl });
      }

      const filePath = this.getAttachmentPath(attachment.id);
      try {
        await fs.access(filePath);
      } catch {
        const placeholder = Buffer.from(
          `Attachment '${attachment.filename}' was migrated from legacy storage.\n` +
            `The original binary is not available on disk.\n` +
            `Please re-upload this attachment if you need the original file.\n`,
          'utf-8',
        );
        await fs.writeFile(filePath, placeholder);
      }
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((item) =>
          this.prisma.attachment.update({
            where: { id: item.id },
            data: { url: item.url },
          }),
        ),
      );
      this.logger.log(
        `Normalized ${updates.length} attachment URL(s) to canonical endpoint.`,
      );
    }
  }

  private getAttachmentPath(attachmentId: string): string {
    return path.join(this.attachmentDir, attachmentId);
  }
}
