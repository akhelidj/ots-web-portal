import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateValidationService } from './template-validation.service';
import { TemplateFileStoreService } from './template-file-store.service';
import * as crypto from 'crypto';
import { TemplateStatus } from '@prisma/client';
import 'multer';

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: TemplateValidationService,
    private readonly fileStore: TemplateFileStoreService,
  ) {}

  async createTemplate(
    tenantId: string,
    templateKey: string,
    file: any,
    changeNote: string,
    userId: string,
  ) {
    // 1. Validate File
    await this.validationService.validateTemplate(file);

    // 2. Compute Hash
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 3. Store File (Abstracted, currently returns buffer or creates blob reference)
    // For DB storage, we just use the buffer in the create call directly.
    // If S3, we would upload here and get a key.
    // const fileBlob = await this.fileStore.storeFile(file.buffer);

    return this.prisma.$transaction(async (tx) => {
      // 4. Determine next version (Locking via transaction execution)
      // Note: In standard Postgres Read Commited, this might race.
      // However, the Unique Constraint on [tenantId, templateKey, templateVersion]
      // will prevent duplicates. Use retry logic if needed, or rely on client retry.
      // For strictly serializable, we'd need more aggressive locking.
      // We will assume the unique constraint is the safety net.

      const currentMax = await tx.template.findFirst({
        where: { tenantId, templateKey },
        orderBy: { templateVersion: 'desc' },
        select: { templateVersion: true },
      });

      const nextVersion = (currentMax?.templateVersion ?? 0) + 1;

      // 5. Deprecate previous ACTIVE version if exists
      // "If previous ACTIVE exists: Set previous ACTIVE -> DEPRECATED"
      // We only target the *specifically* previous active one, or all previous active?
      // Spec says: "If previous ACTIVE version exists: Set its status = DEPRECATED"
      // Implies we should find the currently active one and deprecate it.
      // There should only be one ACTIVE at a time ideally by this logic.

      const previousActive = await tx.template.findFirst({
        where: { tenantId, templateKey, status: TemplateStatus.ACTIVE },
      });

      if (previousActive) {
        await tx.template.update({
          where: { id: previousActive.id },
          data: { status: TemplateStatus.DEPRECATED },
        });

        // Audit Log for Deprecation (System action)
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'DEPRECATE_VERSION',
            entity: 'Template',
            entityId: previousActive.id,
            reason: `System deprecation due to release of version ${nextVersion}`,
            userId,
            // We can store metadata in 'reason' or a JSON field if AuditLog had it.
            // Using reason for now as per schema.
          },
        });
      }

      // 6. Insert New Version
      const newTemplate = await tx.template.create({
        data: {
          tenantId,
          templateKey,
          templateVersion: nextVersion,
          status: TemplateStatus.ACTIVE,
          fileBlob: file.buffer, // Storing directly to DB
          hash,
          changeNote,
          createdById: userId,
        },
      });

      // 7. Audit Log for Creation
      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'CREATE_VERSION',
          entity: 'Template',
          entityId: newTemplate.id,
          reason: `Version ${nextVersion} created: ${changeNote}`,
          userId,
        },
      });

      // Return metadata (Exclude blob)
      const { fileBlob, ...metadata } = newTemplate;
      return metadata;
    });
  }

  async getTemplates(tenantId: string) {
    const templates = await this.prisma.template.findMany({
      where: { tenantId },
      orderBy: [{ templateKey: 'asc' }, { templateVersion: 'desc' }],
      select: {
        id: true,
        tenantId: true,
        templateKey: true,
        templateVersion: true,
        status: true,
        hash: true,
        changeNote: true,
        createdAt: true,
        createdById: true,
        // Exclude fileBlob
      },
    });
    return templates;
  }

  async deprecateTemplate(
    tenantId: string,
    templateId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.template.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        throw new NotFoundException('Template not found');
      }

      if (template.tenantId !== tenantId) {
        throw new ForbiddenException('Access denied');
      }

      if (template.status === TemplateStatus.DEPRECATED) {
        return template; // Already deprecated
      }

      // Check if this is the last ACTIVE version
      const activeCount = await tx.template.count({
        where: {
          tenantId,
          templateKey: template.templateKey,
          status: TemplateStatus.ACTIVE,
        },
      });

      if (activeCount <= 1) {
        throw new BadRequestException(
          'Cannot deprecate the last ACTIVE version. Upload a new version first.',
        );
      }

      const updated = await tx.template.update({
        where: { id: templateId },
        data: { status: TemplateStatus.DEPRECATED },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'DEPRECATE_VERSION',
          entity: 'Template',
          entityId: template.id,
          reason: 'Manual deprecation by admin',
          userId,
        },
      });

      const { fileBlob, ...metadata } = updated;
      return metadata;
    });
  }
}
