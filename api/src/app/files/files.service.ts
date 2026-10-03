import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
  StorageObjectRef,
} from '../storage/attachment-storage.types';

interface AuthUser {
  tenantId: string;
  role: UserRole;
  customerId?: string | null;
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.ensureAttachmentStorageConsistency();
  }

  public async saveAttachmentBinary(
    ref: StorageObjectRef,
    buffer: Buffer,
  ): Promise<void> {
    await this.storage.put(ref, buffer);
  }

  public async removeAttachmentBinary(ref: StorageObjectRef): Promise<void> {
    await this.storage.delete(ref);
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
            id: true,
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

    const fileBuffer = await this.storage.get({
      tenantId: ownerReport.tenantId,
      customerId: ownerReport.customerId,
      reportId: ownerReport.id,
      attachmentId: attachment.id,
    });
    if (!fileBuffer) {
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
    const attachments = await this.prisma.attachment.findMany({
      select: {
        id: true,
        filename: true,
        url: true,
        inspectionReportId: true,
        inspectionReport: {
          select: { tenantId: true, customerId: true },
        },
      },
    });

    // Storage-side reconciliation (disk placeholders for missing binaries on the
    // local backend; a no-op on S3). Runs even with zero attachments so the local
    // backend still materializes its upload directory on boot.
    await this.storage.reconcile(
      attachments.map((attachment) => ({
        ref: {
          tenantId: attachment.inspectionReport.tenantId,
          customerId: attachment.inspectionReport.customerId,
          reportId: attachment.inspectionReportId,
          attachmentId: attachment.id,
        },
        filename: attachment.filename,
      })),
    );

    if (attachments.length === 0) {
      return;
    }

    // DB-side normalization: canonicalize every attachment `url` to the download
    // endpoint. Independent of the storage backend.
    const updates: Array<{ id: string; url: string }> = [];
    for (const attachment of attachments) {
      const canonicalUrl = this.buildAttachmentUrl(attachment.id);
      if (attachment.url !== canonicalUrl) {
        updates.push({ id: attachment.id, url: canonicalUrl });
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
}
