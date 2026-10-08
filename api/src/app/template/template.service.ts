import {
  Injectable,
  Inject,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deleteReportGraph } from '../inspection-reports/delete-report-graph';
import { TemplateValidationService } from './template-validation.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
  StorageObjectRef,
} from '../storage/attachment-storage.types';
import * as crypto from 'crypto';
import {
  Prisma,
  TemplateApprovalStatus,
  TemplateStatus,
  UserRole,
} from '@prisma/client';
import 'multer';

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: TemplateValidationService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
  ) {}

  /**
   * Upload a new template version. Open to ADMIN and SUPERVISOR, but the uploader's role
   * decides the validation gate: an ADMIN upload is born APPROVED (self-validation is a
   * no-op ceremony), a SUPERVISOR upload lands PENDING_APPROVAL and cannot back a report
   * until an admin approves it. `uploaderRole` comes from the JWT, never from the body.
   */
  async createTemplate(
    tenantId: string,
    templateKey: string,
    file: Express.Multer.File,
    changeNote: string,
    userId: string,
    uploaderRole: UserRole,
  ) {
    // 1. Validate File
    await this.validationService.validateTemplate(file);

    const approvalStatus =
      uploaderRole === UserRole.ADMIN
        ? TemplateApprovalStatus.APPROVED
        : TemplateApprovalStatus.PENDING_APPROVAL;

    // 2. Compute Hash
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 3. The workbook bytes now live in the storage abstraction (local disk or
    // S3 per STORAGE_DRIVER), not in Postgres. The row records the storage key;
    // the actual object is written AFTER the row commits (below), so a rolled-back
    // insert never leaves a stray object under a key no row references.
    let fileKey!: string;

    const metadata = await this.prisma.$transaction(async (tx) => {
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

      // Canonical storage key for this workbook — tenant/templateKey/version, all
      // in scope here. Persisted on the row and used verbatim by every read path.
      fileKey = this.storage.buildTemplateKey({
        tenantId,
        templateKey,
        version: nextVersion,
      });

      // 5. Deprecate previous ACTIVE version if exists
      // "If previous ACTIVE exists: Set previous ACTIVE -> DEPRECATED"
      // We only target the *specifically* previous active one, or all previous active?
      // Spec says: "If previous ACTIVE version exists: Set its status = DEPRECATED"
      // Implies we should find the currently active one and deprecate it.
      // There should only be one ACTIVE at a time ideally by this logic.
      //
      // GATED ON APPROVAL: a version that is born PENDING_APPROVAL must NOT retire the
      // template ops are currently using — an unvalidated supervisor upload would
      // otherwise take the live form out of service on the spot. The handover is deferred
      // to `approveTemplate`, which performs this exact step when the gate clears.
      if (approvalStatus === TemplateApprovalStatus.APPROVED) {
        await this.retirePreviousActive(tx, {
          tenantId,
          templateKey,
          nextVersion,
          userId,
        });
      }

      // 6. Insert New Version
      const newTemplate = await tx.template.create({
        data: {
          tenantId,
          templateKey,
          templateVersion: nextVersion,
          status: TemplateStatus.ACTIVE,
          approvalStatus,
          // An admin upload is self-validated at birth; a pending one has no approver yet.
          approvedById:
            approvalStatus === TemplateApprovalStatus.APPROVED ? userId : null,
          approvedAt:
            approvalStatus === TemplateApprovalStatus.APPROVED
              ? new Date()
              : null,
          fileKey, // Storage key; bytes are written to storage after commit.
          hash,
          changeNote,
          createdById: userId,
        },
      });

      // 7. Audit Log for Creation — records the gate the version was born under, so the
      // trail shows whether it went live immediately or waited on an admin.
      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'CREATE_VERSION',
          entity: 'Template',
          entityId: newTemplate.id,
          reason: `Version ${nextVersion} created (${approvalStatus}): ${changeNote}`,
          userId,
        },
      });

      // Return metadata (exclude the storage key — the API never surfaces it).
      const { fileKey: _fileKey, ...rest } = newTemplate;
      return rest;
    });

    // Row committed — now persist the workbook bytes at its recorded key. If this
    // throws, the request fails and the caller sees the error; the deterministic
    // key means a retry (same version) overwrites cleanly.
    await this.storage.putTemplate(fileKey, file.buffer);

    return metadata;
  }

  /**
   * Retire the currently-ACTIVE version of `templateKey` so a newly-released version can
   * take over, writing the system deprecation to the audit trail. Shared by the two points
   * a version goes live: an ADMIN upload (immediately) and `approveTemplate` (when a
   * supervisor's pending upload clears the gate). Runs inside the caller's transaction.
   *
   * `excludeId` keeps the approval path from deprecating the very row it is releasing —
   * that row is already ACTIVE and would otherwise match its own query.
   */
  private async retirePreviousActive(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      templateKey: string;
      nextVersion: number;
      userId: string;
      excludeId?: string;
    },
  ) {
    const { tenantId, templateKey, nextVersion, userId, excludeId } = params;

    const previousActive = await tx.template.findFirst({
      where: {
        tenantId,
        templateKey,
        status: TemplateStatus.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (!previousActive) {
      return;
    }

    await tx.template.update({
      where: { id: previousActive.id },
      data: { status: TemplateStatus.DEPRECATED },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'DEPRECATE_VERSION',
        entity: 'Template',
        entityId: previousActive.id,
        reason: `System deprecation due to release of version ${nextVersion}`,
        userId,
      },
    });
  }

  /**
   * ADMIN clears the validation gate on a pending template version. Releasing it is the
   * moment it takes over from the previously-ACTIVE version of the same key — the handover
   * `createTemplate` deliberately skipped while it was unvalidated.
   *
   * Idempotent on an already-APPROVED row (returns it unchanged, no second handover). A
   * REJECTED row cannot be approved directly: its author re-defines it, which resubmits it
   * as PENDING_APPROVAL (see TemplateDefinitionService), or uploads a new version.
   */
  async approveTemplate(tenantId: string, templateId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.loadForApproval(tx, tenantId, templateId);

      if (template.approvalStatus === TemplateApprovalStatus.APPROVED) {
        const { fileKey: _fileKey, ...metadata } = template;
        return metadata;
      }

      if (template.approvalStatus === TemplateApprovalStatus.REJECTED) {
        throw new BadRequestException(
          'This template version was rejected and cannot be approved. It must be re-defined (which resubmits it) or replaced by a new version.',
        );
      }

      // Gate clears → this version goes live, retiring the one ops were using.
      await this.retirePreviousActive(tx, {
        tenantId,
        templateKey: template.templateKey,
        nextVersion: template.templateVersion,
        userId,
        excludeId: template.id,
      });

      const updated = await tx.template.update({
        where: { id: templateId },
        data: {
          approvalStatus: TemplateApprovalStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'APPROVE_TEMPLATE_VERSION',
          entity: 'Template',
          entityId: templateId,
          reason: `Version ${template.templateVersion} approved for use`,
          userId,
        },
      });

      const { fileKey: _fileKey, ...metadata } = updated;
      return metadata;
    });
  }

  /**
   * ADMIN refuses a pending template version, with a reason the uploader sees on the
   * templates list. The row keeps its place in the version history (auditable, never
   * silently vanishes) and cannot be consumed while rejected. It stays definable: saving a
   * new definition resubmits it as PENDING_APPROVAL; a new version upload also works.
   *
   * Touches no other row — in particular the previously-ACTIVE version is left alone,
   * since a pending upload never displaced it in the first place.
   */
  async rejectTemplate(
    tenantId: string,
    templateId: string,
    userId: string,
    reason: string,
  ) {
    const trimmedReason = reason?.trim() ?? '';
    if (!trimmedReason) {
      throw new BadRequestException('A rejection reason is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const template = await this.loadForApproval(tx, tenantId, templateId);

      if (template.approvalStatus === TemplateApprovalStatus.APPROVED) {
        throw new BadRequestException(
          'This template version is already approved. Deprecate it instead of rejecting.',
        );
      }

      const updated = await tx.template.update({
        where: { id: templateId },
        data: {
          approvalStatus: TemplateApprovalStatus.REJECTED,
          approvedById: userId,
          approvedAt: new Date(),
          rejectionReason: trimmedReason,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'REJECT_TEMPLATE_VERSION',
          entity: 'Template',
          entityId: templateId,
          reason: `Version ${template.templateVersion} rejected: ${trimmedReason}`,
          userId,
        },
      });

      const { fileKey: _fileKey, ...metadata } = updated;
      return metadata;
    });
  }

  /** Tenant-scoped load for the approve/reject paths (NotFound / Forbidden, mirroring
   *  `deprecateTemplate`), so an admin cannot act on another tenant's template. */
  private async loadForApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    templateId: string,
  ) {
    const template = await tx.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (template.tenantId !== tenantId) {
      throw new ForbiddenException('Access denied');
    }

    return template;
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
        // The validation gate, so the list can badge PENDING_APPROVAL / REJECTED, offer the
        // admin's Approve/Reject actions, and show a supervisor why their upload bounced.
        approvalStatus: true,
        approvedById: true,
        approvedAt: true,
        rejectionReason: true,
        // The CURRENT definition (null until defined) so the admin list can label a row's
        // action View-vs-Define off the same shape the Define page reads. Excludes fileBlob.
        definitionJson: true,
      },
    });
    return templates;
  }

  /**
   * Permanently remove a template version that was uploaded by mistake (wrong workbook).
   * Only an UNDEFINED version (`definitionJson == null`) may go: an undefined template can
   * never back a report (consumption requires a definition), so nothing downstream depends
   * on it. A defined one is refused — retire it with deprecate instead.
   *
   * If the deleted row was the live ACTIVE version and its upload retired a predecessor
   * (the "System deprecation due to release of version N" audit entry), that predecessor
   * is reinstated so the key isn't left with no usable version.
   */
  async deleteTemplate(
    tenantId: string,
    templateId: string,
    userId: string,
    opts: { role?: UserRole; reason?: string } = {},
  ) {
    const cascade = opts.role === UserRole.ADMIN;
    const reason = opts.reason?.trim();
    let fileKey!: string;
    let reportsDeleted = 0;
    const attachmentRefs: StorageObjectRef[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        const template = await this.loadForApproval(tx, tenantId, templateId);
        fileKey = template.fileKey;

        const reportScope = { tenantId, ...this.reportWhere(template) };
        const reports = await tx.inspectionReport.findMany({
          where: reportScope,
          select: {
            id: true,
            customerId: true,
            attachments: { select: { id: true } },
          },
        });
        const reportIds = reports.map((r) => r.id);

        if (!cascade) {
          if (template.definitionJson != null) {
            throw new BadRequestException(
              'Only templates that have not been defined yet can be deleted. Deprecate this version instead.',
            );
          }
          const revisionCount = await tx.templateDefinitionRevision.count({
            where: { templateId },
          });
          if (reportIds.length > 0 || revisionCount > 0) {
            throw new BadRequestException(
              'This template version is already referenced and cannot be deleted.',
            );
          }
        } else if (
          (template.definitionJson != null || reportIds.length > 0) &&
          !reason
        ) {
          throw new BadRequestException(
            'A reason is required to delete a defined or referenced template.',
          );
        }

        reportsDeleted = reportIds.length;
        if (reportIds.length > 0) {
          for (const r of reports) {
            for (const a of r.attachments) {
              attachmentRefs.push({
                tenantId,
                customerId: r.customerId,
                reportId: r.id,
                attachmentId: a.id,
              });
            }
          }
          await deleteReportGraph(tx, reportIds);
        }

        await tx.templateDefinitionRevision.deleteMany({ where: { templateId } });
        await tx.template.delete({ where: { id: templateId } });

        // Hand the key back to the version this upload displaced, if it did displace one.
        if (template.status === TemplateStatus.ACTIVE) {
          const stillActive = await tx.template.count({
            where: {
              tenantId,
              templateKey: template.templateKey,
              status: TemplateStatus.ACTIVE,
            },
          });
          if (stillActive === 0) {
            // The audit reason carries only the version number (not the key), so narrow the
            // candidates to this key's own deprecated rows before reinstating the newest.
            const displacedLogs = await tx.auditLog.findMany({
              where: {
                tenantId,
                action: 'DEPRECATE_VERSION',
                entity: 'Template',
                reason: `System deprecation due to release of version ${template.templateVersion}`,
              },
              select: { entityId: true },
            });
            const displaced = await tx.template.findFirst({
              where: {
                tenantId,
                templateKey: template.templateKey,
                status: TemplateStatus.DEPRECATED,
                id: { in: displacedLogs.map((l) => l.entityId) },
              },
              orderBy: { templateVersion: 'desc' },
            });
            if (displaced) {
              await tx.template.update({
                where: { id: displaced.id },
                data: { status: TemplateStatus.ACTIVE },
              });
            }
          }
        }

        const label = `version ${template.templateVersion} of ${template.templateKey}`;
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'DELETE_VERSION',
            entity: 'Template',
            entityId: templateId,
            reason: cascade
              ? `${template.definitionJson != null ? 'Defined' : 'Undefined'} ${label} deleted with ${reportIds.length} report(s) [${reportIds.join(', ')}]. Reason: ${reason ?? 'n/a'}`
              : `Undefined ${label} deleted`,
            userId,
          },
        });
      },
      // The cascade can touch many rows across a dozen tables.
      { timeout: 60_000, maxWait: 10_000 },
    );

    // Rows gone — drop the binaries. Best effort: an orphaned object is harmless, and the
    // delete itself must not fail after the rows are already removed. Signature images are
    // deliberately kept: the same objects back users' registered signatures.
    await this.storage.deleteTemplate(fileKey).catch(() => undefined);
    await Promise.all(
      attachmentRefs.map((ref) => this.storage.delete(ref).catch(() => undefined)),
    );

    return { deleted: true, reportsDeleted };
  }

  /**
   * What an admin delete would remove, for the confirmation dialog. Read-only.
   */
  async getDeleteImpact(tenantId: string, templateId: string) {
    const template = await this.loadForApproval(this.prisma, tenantId, templateId);
    const reportIds = (
      await this.prisma.inspectionReport.findMany({
        where: { tenantId, ...this.reportWhere(template) },
        select: { id: true },
      })
    ).map((r) => r.id);
    const inReports = { inspectionReportId: { in: reportIds } };
    const [childReports, serialNumbers, attachments, signatures] =
      await Promise.all([
        this.prisma.childReport.count({ where: inReports }),
        this.prisma.serialNumber.count({ where: inReports }),
        this.prisma.attachment.count({ where: inReports }),
        this.prisma.reportSignature.count({ where: inReports }),
      ]);
    return {
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      defined: template.definitionJson != null,
      reports: reportIds.length,
      childReports,
      serialNumbers,
      attachments,
      signatures,
    };
  }

  private reportWhere(template: { templateKey: string; templateVersion: number }) {
    return {
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
    };
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
        // Already deprecated — exclude the storage key from the response.
        const { fileKey: _fileKey, ...metadata } = template;
        return metadata;
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

      const { fileKey: _fileKey, ...metadata } = updated;
      return metadata;
    });
  }
}
