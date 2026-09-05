import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  Prisma,
  UserRole,
  InspectionReportStatus,
  ChildReportStatus,
  SerialApprovalStatus,
  InspectionApprovalBatchStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { CreateInspectionReportDto } from './dto/create-inspection-report.dto';

/**
 * A human-readable label for a templateKey, derived PURELY from the scalar key —
 * `DRILL_PIPE_REPORT` → `Drill Pipe Report`. The nicer displayName lives inside
 * definitionJson, but the available-templates projection deliberately does not select
 * that column (no leaking definition contents), so the picker label is computed from
 * the key we already have. Presentation only; the picker binds on templateKey.
 */
function prettifyTemplateKey(templateKey: string): string {
  return templateKey
    .split(/[_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class InspectionReportsService {
  constructor(
    private prisma: PrismaService,
    private filesService: FilesService,
  ) {}

  async getReports(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    status?: InspectionReportStatus,
    q?: string,
    customerId?: string,
  ) {
    const where: Prisma.InspectionReportWhereInput = {
      tenantId: user.tenantId,
    };

    if (user.role === UserRole.CUSTOMER) {
      where.customerId = user.customerId;
    } else if (
      user.role === UserRole.SUPERVISOR ||
      user.role === UserRole.ADMIN
    ) {
      if (customerId) {
        where.customerId = customerId;
      }
    }

    if (status) {
      where.status = status;
    }

    if (q && q.trim().length >= 2) {
      where.poNumber = {
        contains: q.trim(),
        mode: 'insensitive',
      };
    }

    const reports = await this.prisma.inspectionReport.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    // Phase B3: attach each report's template definitionJson (from the Template
    // row it pins) so the portal can drive the inspection form from it offline.
    // definitionJson is NULL on every Template today, so every report carries
    // null here until cutover — the portal falls back to its hardcoded schema.
    if (reports.length === 0) {
      return reports;
    }

    const templates = await this.prisma.template.findMany({
      where: {
        tenantId: user.tenantId,
        OR: reports.map((r) => ({
          templateKey: r.templateKey,
          templateVersion: r.templateVersion,
        })),
      },
      select: {
        templateKey: true,
        templateVersion: true,
        definitionJson: true,
      },
    });
    const defByKey = new Map(
      templates.map((t) => [
        `${t.templateKey}@${t.templateVersion}`,
        t.definitionJson,
      ]),
    );

    return reports.map((r) => ({
      ...r,
      definitionJson:
        defByKey.get(`${r.templateKey}@${r.templateVersion}`) ?? null,
    }));
  }

  /**
   * The consumption picker's source: every template a report can be created against —
   * ACTIVE AND defined (`definitionJson != null`), newest version per templateKey. The
   * "available = uploaded AND defined" rule is enforced as a server-side WHERE, not a
   * client filter, so an undefined or deprecated template can never be offered. Returns
   * a MINIMAL shape only — never fileBlob, never the definitionJson contents (they are
   * not even selected). Tenant-wide; no role/customer scoping (none exists on Template).
   */
  async getAvailableTemplates(tenantId: string) {
    const templates = await this.prisma.template.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        // "defined": definitionJson is not database-NULL. This filter is the enforced
        // availability rule — load-bearing, proven by the filter integration spec.
        NOT: { definitionJson: { equals: Prisma.DbNull } },
      },
      orderBy: [{ templateKey: 'asc' }, { templateVersion: 'desc' }],
      select: {
        templateKey: true,
        templateVersion: true,
        // Deliberately NO fileBlob and NO definitionJson — minimal, non-leaking shape.
      },
    });

    // Newest version per key (ordered templateVersion desc within key → first wins).
    const newestByKey = new Map<string, { templateKey: string; templateVersion: number }>();
    for (const t of templates) {
      if (!newestByKey.has(t.templateKey)) {
        newestByKey.set(t.templateKey, t);
      }
    }
    return [...newestByKey.values()].map((t) => ({
      templateKey: t.templateKey,
      templateVersion: t.templateVersion,
      displayName: prettifyTemplateKey(t.templateKey),
    }));
  }

  async getReportById(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    id: string,
  ) {
    const where: Prisma.InspectionReportWhereInput = {
      tenantId: user.tenantId,
      id,
    };

    if (user.role === UserRole.CUSTOMER) {
      where.customerId = user.customerId;
    }

    const report = await this.prisma.inspectionReport.findFirst({
      where,
      include: { attachments: true },
    });
    if (!report) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }

    // Graft the pinned Template's definitionJson onto the detail payload — mirroring
    // findAll — so the single-report endpoint is self-consistent with the list. Without
    // this, any portal path that caches a report from the detail/mutation response (the
    // attachments-hydration merge, publish/update/patch echoes) would overwrite the
    // list-hydrated definitionJson with `undefined`, transiently breaking the read-only
    // Specs surface (a customer would see the false "template not defined" empty-state).
    const template = await this.prisma.template.findFirst({
      where: {
        tenantId: user.tenantId,
        templateKey: report.templateKey,
        templateVersion: report.templateVersion,
      },
      select: { definitionJson: true },
    });
    return { ...report, definitionJson: template?.definitionJson ?? null };
  }

  async addAttachment(
    tenantId: string,
    id: string,
    file: { originalname: string; buffer: Buffer },
  ) {
    const report = await this.prisma.inspectionReport.findFirst({
      where: { id, tenantId },
    });

    if (!report) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }

    if (
      report.status === InspectionReportStatus.APPROVED ||
      report.status === InspectionReportStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Cannot add attachment: Inspection Report is locked.',
      );
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        filename: file.originalname,
        url: '',
        inspectionReportId: id,
      },
    });

    try {
      await this.filesService.saveAttachmentBinary(attachment.id, file.buffer);
      const updated = await this.prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          url: this.filesService.buildAttachmentUrl(attachment.id),
        },
      });

      return updated;
    } catch (error) {
      await this.prisma.attachment.delete({ where: { id: attachment.id } });
      await this.filesService.removeAttachmentBinary(attachment.id);
      throw error;
    }
  }

  async createReport(
    tenantId: string,
    userId: string,
    data: CreateInspectionReportDto,
  ) {
    // 1. Validate customer belongs to tenant
    if (!data.customerId || data.customerId.trim() === '') {
      throw new BadRequestException(
        'Customer ID is required to generate a report number.',
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        id: data.customerId,
        tenantId,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found in this tenant');
    }

    let customerPrefix = '';
    if (customer.code && customer.code.trim().length > 0) {
      customerPrefix = customer.code.trim().toUpperCase();
    } else {
      // Fallback to initials
      const parts = customer.name.trim().split(/\s+/);
      if (parts.length === 1) {
        customerPrefix = (parts[0] ?? '').substring(0, 3).toUpperCase();
      } else {
        customerPrefix = parts
          .map((w) => w[0])
          .join('')
          .substring(0, 4)
          .toUpperCase();
      }
    }

    // 2. Resolve template binding by the CHOSEN templateKey (multi-template — the
    // consumption picker). The caller (portal picker) supplies the key of a defined+
    // active template; we bind the report to the newest ACTIVE version of that key.
    // No longer hardcoded to DRILL_PIPE_REPORT.
    const templateKey = data.templateKey?.trim();
    if (!templateKey) {
      throw new BadRequestException(
        'templateKey is required to create a report.',
      );
    }
    const template = await this.prisma.template.findFirst({
      where: {
        tenantId,
        templateKey,
        status: 'ACTIVE',
      },
      orderBy: {
        templateVersion: 'desc',
      },
    });

    if (!template) {
      throw new BadRequestException(
        `No active template found for ${templateKey}`,
      );
    }

    // Phase D guard — "undefined = not usable": a template whose definitionJson is
    // NULL has no validated field/export/gate definition and MUST NOT be a report
    // target (a report bound to it would drive nothing). Now that createReport honors
    // the caller's templateKey (the consumption picker), this guard is genuinely
    // load-bearing defense-in-depth: the picker only offers defined templates, but a
    // caller could name an undefined key directly — this rejects it. The picker's
    // available-templates filter (ACTIVE AND definitionJson != null) is the primary
    // gate; this is the backstop.
    if (template.definitionJson == null) {
      throw new BadRequestException(
        `Template ${template.templateKey}@${template.templateVersion} has no definition yet and cannot be used to create reports.`,
      );
    }

    // 3. Generate Report Number (PREFIX-YYMMDD-HHMMSS)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    const generatedReportNumber = `${customerPrefix}-${yy}${mm}${dd}-${hh}${min}${sec}`;

    // 4. Create report + Audit Log transaction
    return await this.prisma.$transaction(async (tx) => {
      const createData: Prisma.InspectionReportUncheckedCreateInput = {
        tenantId,
        customerId: data.customerId,
        poNumber: data.poNumber,
        reportNumber: generatedReportNumber,
        status: InspectionReportStatus.DRAFT,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        templateHash: template.hash,
        version: 1,
      };

      const report = await tx.inspectionReport.create({
        data: createData,
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entity: 'InspectionReport',
          entityId: report.id,
          tenantId,
          userId,
          inspectionReportId: report.id,
        },
      });

      return report;
    });
  }

  async updateReport(
    tenantId: string,
    id: string,
    userId: string,
    data: Partial<Prisma.InspectionReportUpdateInput>,
    version: number,
  ) {
    const existing = await this.prisma.inspectionReport.findFirst({
      where: { tenantId, id },
    });

    if (!existing) {
      throw new NotFoundException(`InspectionReport ${id} not found`);
    }

    if (existing.version !== version) {
      throw new ConflictException(
        `Version mismatch. Expected ${existing.version}, got ${version}`,
      );
    }

    if (
      existing.status === InspectionReportStatus.APPROVED ||
      existing.status === InspectionReportStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Cannot mutate an Approved or Closed report. Admin revision required.',
      );
    }

    // A roled header field (inspector/supervisor/inspectionDate) is system-derived and
    // NOT user-writable. If the client sends a value for one in `headerData`, drop it here
    // so the stored map can never carry a user-entered value for a derived field — the
    // exported value always comes from the transition-log-backed computed token, and the
    // form/specs read the derived value, never this key. Empty for every template with no
    // roled fields (all existing templates), so their header saves are unchanged.
    const roledKeys =
      data.headerData !== undefined && data.headerData !== null
        ? await this.roledHeaderKeys(
            tenantId,
            existing.templateKey,
            existing.templateVersion,
          )
        : new Set<string>();

    return await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.InspectionReportUpdateInput = {
        updatedAt: new Date(),
        version: existing.version + 1,
      };

      if (data.poNumber !== undefined) updateData.poNumber = data.poNumber;

      // Phase D step 3 — the generic, definition-keyed header store is the ONLY
      // header-write path (the named columns and their per-column mapping were
      // retired). The header edit form sends a single `headerData` map
      // (fieldKey -> value); MERGE it onto the existing map so partial writes (e.g.
      // the standalone global-comment editor) don't clobber other fields.
      if (data.headerData !== undefined && data.headerData !== null) {
        const incoming = { ...(data.headerData as Record<string, unknown>) };
        for (const k of roledKeys) delete incoming[k];
        const existingHeader =
          existing.headerData && typeof existing.headerData === 'object'
            ? (existing.headerData as Record<string, unknown>)
            : {};
        updateData.headerData = {
          ...existingHeader,
          ...incoming,
        } as Prisma.InputJsonValue;
      }

      if (data.status !== undefined) {
        updateData.status = data.status;
      }

      const updateResult = await tx.inspectionReport.updateMany({
        where: {
          id,
          tenantId,
          version: existing.version,
        },
        data: updateData,
      });

      if (updateResult.count === 0) {
        throw new ConflictException(
          `Version mismatch or entity not found. Expected version: ${existing.version}`,
        );
      }

      const updated = await tx.inspectionReport.findUniqueOrThrow({
        where: { id },
      });

      const nextStatus =
        typeof data.status === 'string'
          ? (data.status as InspectionReportStatus)
          : undefined;

      if (nextStatus && nextStatus !== existing.status) {
        await tx.inspectionReportTransitionLog.create({
          data: {
            inspectionReportId: id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            userId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'InspectionReport',
          entityId: id,
          tenantId,
          userId,
          reason: 'Manual update',
          inspectionReportId: id,
        },
      });
      return updated;
    });
  }

  /**
   * The header field keys bound to a system ROLE in the report's template definition.
   * Their values are always derived at export (from the transition-log-backed computed
   * token), so they are stripped from any incoming `headerData` on save — never stored
   * from user input. Reads the bound template's `definitionJson`; returns an empty set
   * when the template has no definition or no roled fields (every existing template), so
   * their header saves are byte-for-byte unchanged.
   */
  private async roledHeaderKeys(
    tenantId: string,
    templateKey: string,
    templateVersion: number,
  ): Promise<Set<string>> {
    const template = await this.prisma.template.findFirst({
      where: { tenantId, templateKey, templateVersion },
      select: { definitionJson: true },
    });
    const def = template?.definitionJson as
      | { fields?: { key?: string; role?: string }[] }
      | null
      | undefined;
    const keys = new Set<string>();
    for (const f of def?.fields ?? []) {
      if (f && typeof f.key === 'string' && f.role) keys.add(f.key);
    }
    return keys;
  }

  async submitForApproval(
    tenantId: string,
    reportId: string,
    userId: string,
    data: {
      serialNumberIds: string[];
      reportVersion: number;
      childReportId?: string;
    },
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Validate Report
      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion)
        throw new ConflictException(
          `Report version mismatch. Expected ${report.version}, got ${data.reportVersion}`,
        );

      // 2. Validate Serial Numbers
      if (data.childReportId) {
        const childReport = await tx.childReport.findFirst({
          where: {
            id: data.childReportId,
            tenantId,
            inspectionReportId: reportId,
          },
        });

        if (!childReport) {
          throw new NotFoundException(
            'Child report not found for this inspection report',
          );
        }

        const crSns = await tx.childReportSerialNumber.findMany({
          where: {
            childReportId: data.childReportId,
            serialNumberId: { in: data.serialNumberIds },
          },
        });
        if (crSns.length !== data.serialNumberIds.length) {
          throw new BadRequestException(
            'One or more serial numbers are not part of this child report',
          );
        }
        for (const sn of crSns) {
          if (sn.approvalStatus !== SerialApprovalStatus.INSPECTED_DRAFT) {
            throw new BadRequestException(
              `Serial number ${sn.serialNumberId} is in status ${sn.approvalStatus} and cannot be submitted`,
            );
          }
        }
      } else {
        const sns = await tx.serialNumber.findMany({
          where: {
            inspectionReportId: reportId,
            tenantId,
            id: { in: data.serialNumberIds },
          },
        });
        if (sns.length !== data.serialNumberIds.length) {
          throw new BadRequestException(
            'One or more serial numbers are not part of this report',
          );
        }
        for (const sn of sns) {
          if (sn.approvalStatus !== SerialApprovalStatus.INSPECTED_DRAFT) {
            throw new BadRequestException(
              `Serial number ${sn.serial} is in status ${sn.approvalStatus} and cannot be submitted`,
            );
          }
        }
      }

      // 3. Create Batch
      const batch = await tx.inspectionApprovalBatch.create({
        data: {
          tenantId,
          inspectionReportId: reportId,
          childReportId: data.childReportId,
          submittedByUserId: userId,
          status: InspectionApprovalBatchStatus.SUBMITTED,
          version: 1,
          serialNumbers: {
            create: data.serialNumberIds.map((snId) => ({
              tenantId,
              serialNumberId: snId,
              status: 'PENDING',
            })),
          },
        },
      });

      // 4. Update Serial Statuses
      if (data.childReportId) {
        await tx.childReportSerialNumber.updateMany({
          where: {
            childReportId: data.childReportId,
            serialNumberId: { in: data.serialNumberIds },
          },
          data: { approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL },
        });
      } else {
        await tx.serialNumber.updateMany({
          where: { id: { in: data.serialNumberIds } },
          data: { approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL },
        });
      }

      // 5. Check if Child Report should auto-transition
      if (data.childReportId) {
        const pendingSns = await tx.childReportSerialNumber.count({
          where: {
            childReportId: data.childReportId,
            approvalStatus: {
              notIn: [
                SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
                SerialApprovalStatus.APPROVED,
              ],
            },
          },
        });

        if (pendingSns === 0) {
          const currentChild = await tx.childReport.findUnique({
            where: { id: data.childReportId },
            select: { status: true },
          });

          if (currentChild?.status === ChildReportStatus.IN_INSPECTION) {
            await tx.childReport.update({
              where: { id: data.childReportId },
              data: {
                status: ChildReportStatus.PENDING_APPROVAL,
              },
            });

            await tx.childReportTransitionLog.create({
              data: {
                childReportId: data.childReportId,
                fromStatus: currentChild.status,
                toStatus: ChildReportStatus.PENDING_APPROVAL,
                userId,
              },
            });
          }
        }
      }

      // 6. Update report version
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: { version: report.version + 1 },
      });

      // 6. Audit log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_SUBMIT',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason: `Submitted ${data.serialNumberIds.length} S/N for approval`,
          tenantId,
          userId,
          inspectionReportId: report.id,
        },
      });

      return { batch, updatedReport };
    });
  }

  async approveBatch(
    tenantId: string,
    reportId: string,
    batchId: string,
    userId: string,
    data: {
      batchVersion: number;
      reportVersion: number;
      reason?: string;
      serialNumberIds?: string[];
    },
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const batch = await tx.inspectionApprovalBatch.findFirst({
        where: { id: batchId, tenantId, inspectionReportId: reportId },
        include: { serialNumbers: true },
      });

      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== InspectionApprovalBatchStatus.SUBMITTED) {
        throw new BadRequestException(
          `Cannot approve batch in status ${batch.status}`,
        );
      }
      if (batch.version !== data.batchVersion)
        throw new ConflictException(
          `Batch version mismatch. Expected ${batch.version}, got ${data.batchVersion}`,
        );

      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion)
        throw new ConflictException(
          `Report version mismatch. Expected ${report.version}, got ${data.reportVersion}`,
        );

      // Filter SNs to approve
      const allBatchSnIds = batch.serialNumbers.map((m) => m.serialNumberId);
      const targetSnIds = data.serialNumberIds || allBatchSnIds;

      // Validate targetSnIds are members of the batch
      for (const id of targetSnIds) {
        if (!allBatchSnIds.includes(id)) {
          throw new BadRequestException(
            `Serial number ${id} is not part of batch ${batchId}`,
          );
        }
      }

      // Verify members - filter out those not in SUBMITTED_FOR_APPROVAL
      const filteredTargetIds: string[] = [];
      if (batch.childReportId) {
        const crSns = await tx.childReportSerialNumber.findMany({
          where: {
            childReportId: batch.childReportId,
            serialNumberId: { in: targetSnIds },
          },
        });
        for (const sn of crSns) {
          if (
            sn.approvalStatus === SerialApprovalStatus.SUBMITTED_FOR_APPROVAL
          ) {
            filteredTargetIds.push(sn.serialNumberId);
          }
        }
      } else {
        const sns = await tx.serialNumber.findMany({
          where: { id: { in: targetSnIds } },
        });
        for (const sn of sns) {
          if (
            sn.approvalStatus === SerialApprovalStatus.SUBMITTED_FOR_APPROVAL
          ) {
            filteredTargetIds.push(sn.id);
          }
        }
      }

      if (filteredTargetIds.length > 0) {
        // Update SN states
        if (batch.childReportId) {
          await tx.childReportSerialNumber.updateMany({
            where: {
              childReportId: batch.childReportId,
              serialNumberId: { in: filteredTargetIds },
            },
            data: { approvalStatus: SerialApprovalStatus.APPROVED },
          });
        } else {
          await tx.serialNumber.updateMany({
            where: { id: { in: filteredTargetIds } },
            data: { approvalStatus: SerialApprovalStatus.APPROVED },
          });
        }

        // Update Junction Table Status
        await tx.inspectionApprovalBatchSerialNumber.updateMany({
          where: {
            inspectionApprovalBatchId: batchId,
            serialNumberId: { in: filteredTargetIds },
          },
          data: { status: 'APPROVED' },
        });
      }

      // Check if ALL SNs in this batch are now processed (no longer SUBMITTED_FOR_APPROVAL)
      let remainingInBatch = 0;

      if (batch.childReportId) {
        remainingInBatch = await tx.childReportSerialNumber.count({
          where: {
            childReportId: batch.childReportId,
            serialNumberId: { in: allBatchSnIds },
            approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
          },
        });
      } else {
        remainingInBatch = await tx.serialNumber.count({
          where: {
            id: { in: allBatchSnIds },
            approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
          },
        });
      }

      let updatedBatchStatus: InspectionApprovalBatchStatus = batch.status;
      if (remainingInBatch === 0) {
        updatedBatchStatus = InspectionApprovalBatchStatus.APPROVED;
      }

      // Update Batch
      const updatedBatch = await tx.inspectionApprovalBatch.update({
        where: { id: batchId },
        data: {
          status: updatedBatchStatus,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          version: batch.version + 1,
        },
      });

      const shouldAutoApproveParent = !batch.childReportId
        ? (await tx.serialNumber.count({
            where: {
              inspectionReportId: report.id,
              approvalStatus: { not: SerialApprovalStatus.APPROVED },
            },
          })) === 0 &&
          (await tx.inspectionApprovalBatch.count({
            where: {
              inspectionReportId: report.id,
              status: { not: InspectionApprovalBatchStatus.APPROVED },
            },
          })) === 0
        : false;

      // Update report
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          version: report.version + 1,
          status: shouldAutoApproveParent
            ? InspectionReportStatus.APPROVED
            : undefined,
        },
      });

      let updatedChildReport = null;
      if (batch.childReportId) {
        const shouldAutoApproveChild =
          (await tx.childReportSerialNumber.count({
            where: {
              childReportId: batch.childReportId,
              approvalStatus: { not: SerialApprovalStatus.APPROVED },
            },
          })) === 0 &&
          (await tx.inspectionApprovalBatch.count({
            where: {
              childReportId: batch.childReportId,
              status: { not: InspectionApprovalBatchStatus.APPROVED },
            },
          })) === 0;

        if (shouldAutoApproveChild) {
          const currentChild = await tx.childReport.findUnique({
            where: { id: batch.childReportId },
            select: { status: true },
          });

          updatedChildReport = await tx.childReport.update({
            where: { id: batch.childReportId },
            data: {
              status:
                currentChild?.status !== ChildReportStatus.APPROVED
                  ? ChildReportStatus.APPROVED
                  : undefined,
            },
          });

          if (
            currentChild &&
            currentChild.status !== ChildReportStatus.APPROVED
          ) {
            await tx.childReportTransitionLog.create({
              data: {
                childReportId: batch.childReportId,
                fromStatus: currentChild.status,
                toStatus: ChildReportStatus.APPROVED,
                userId,
              },
            });
          }
        } else {
          updatedChildReport = await tx.childReport.findUnique({
            where: { id: batch.childReportId },
          });
        }
      }

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_APPROVE',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason:
            (data.reason || 'Approved items') +
            (data.serialNumberIds
              ? ` (${data.serialNumberIds.length} S/N)`
              : ''),
          tenantId,
          userId,
          inspectionReportId: report.id,
        },
      });

      return {
        batch: updatedBatch,
        updatedReport,
        childReport: updatedChildReport,
      };
    });
  }

  async returnBatch(
    tenantId: string,
    reportId: string,
    batchId: string,
    userId: string,
    data: {
      batchVersion: number;
      reportVersion: number;
      reason: string;
      serialNumberIds?: string[];
    },
  ) {
    if (!data.reason || data.reason.trim() === '') {
      throw new BadRequestException(
        'Reason is mandatory when returning a batch',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      const batch = await tx.inspectionApprovalBatch.findFirst({
        where: { id: batchId, tenantId, inspectionReportId: reportId },
        include: { serialNumbers: true },
      });

      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== InspectionApprovalBatchStatus.SUBMITTED) {
        throw new BadRequestException(
          `Cannot return batch in status ${batch.status}`,
        );
      }
      if (batch.version !== data.batchVersion)
        throw new ConflictException(
          `Batch version mismatch. Expected ${batch.version}, got ${data.batchVersion}`,
        );

      const report = await tx.inspectionReport.findFirst({
        where: { id: reportId, tenantId },
      });

      if (!report) throw new NotFoundException('Report not found');
      if (report.version !== data.reportVersion)
        throw new ConflictException(
          `Report version mismatch. Expected ${report.version}, got ${data.reportVersion}`,
        );

      // Filter SNs to return
      const allBatchSnIds = batch.serialNumbers.map((m) => m.serialNumberId);
      const targetSnIds = data.serialNumberIds || allBatchSnIds;

      // Validate
      for (const id of targetSnIds) {
        if (!allBatchSnIds.includes(id)) {
          throw new BadRequestException(
            `Serial number ${id} is not part of batch ${batchId}`,
          );
        }
      }

      // Verify members - filter out those not in SUBMITTED_FOR_APPROVAL
      const filteredTargetIds: string[] = [];
      if (batch.childReportId) {
        const crSns = await tx.childReportSerialNumber.findMany({
          where: {
            childReportId: batch.childReportId,
            serialNumberId: { in: targetSnIds },
          },
        });
        for (const sn of crSns) {
          if (
            sn.approvalStatus === SerialApprovalStatus.SUBMITTED_FOR_APPROVAL
          ) {
            filteredTargetIds.push(sn.serialNumberId);
          }
        }
      } else {
        const sns = await tx.serialNumber.findMany({
          where: { id: { in: targetSnIds } },
        });
        for (const sn of sns) {
          if (
            sn.approvalStatus === SerialApprovalStatus.SUBMITTED_FOR_APPROVAL
          ) {
            filteredTargetIds.push(sn.id);
          }
        }
      }

      if (filteredTargetIds.length > 0) {
        // Revert SNs to INSPECTED_DRAFT
        if (batch.childReportId) {
          await tx.childReportSerialNumber.updateMany({
            where: {
              childReportId: batch.childReportId,
              serialNumberId: { in: filteredTargetIds },
            },
            data: { approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT },
          });
        } else {
          await tx.serialNumber.updateMany({
            where: { id: { in: filteredTargetIds } },
            data: { approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT },
          });
        }

        // Update Junction Table Status
        await tx.inspectionApprovalBatchSerialNumber.updateMany({
          where: {
            inspectionApprovalBatchId: batchId,
            serialNumberId: { in: filteredTargetIds },
          },
          data: { status: 'RETURNED' },
        });
      }
      // Check if ALL SNs in this batch are now processed
      let remainingInBatch = 0;
      if (batch.childReportId) {
        remainingInBatch = await tx.childReportSerialNumber.count({
          where: {
            childReportId: batch.childReportId,
            serialNumberId: { in: allBatchSnIds },
            approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
          },
        });
      } else {
        remainingInBatch = await tx.serialNumber.count({
          where: {
            id: { in: allBatchSnIds },
            approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
          },
        });
      }
      let updatedBatchStatus: InspectionApprovalBatchStatus = batch.status;
      if (remainingInBatch === 0) {
        // If everything is processed, we mark it as RETURNED if any were returned.
        // If we choose RETURNED, it signals to the user that this batch needs attention or is finished with corrections.
        updatedBatchStatus = InspectionApprovalBatchStatus.RETURNED;
      }

      // Update Batch
      const updatedBatch = await tx.inspectionApprovalBatch.update({
        where: { id: batchId },
        data: {
          status: updatedBatchStatus,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          version: batch.version + 1,
          notes: data.reason, // Overwrite notes with the latest return reason if applicable
        },
      });

      // Update report
      const updatedReport = await tx.inspectionReport.update({
        where: { id: report.id },
        data: {
          version: report.version + 1,
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BATCH_RETURN',
          entity: 'InspectionApprovalBatch',
          entityId: batch.id,
          reason:
            data.reason +
            (data.serialNumberIds
              ? ` (${data.serialNumberIds.length} S/N)`
              : ''),
          tenantId,
          userId,
          inspectionReportId: report.id,
        },
      });

      return { batch: updatedBatch, updatedReport };
    });
  }

  async getBatchesForReport(tenantId: string, reportId: string) {
    return this.prisma.inspectionApprovalBatch.findMany({
      where: {
        tenantId,
        inspectionReportId: reportId,
      },
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
        reviewedByUser: { select: { id: true, name: true, email: true } },
        serialNumbers: {
          include: {
            serialNumber: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getBatchById(tenantId: string, reportId: string, batchId: string) {
    const batch = await this.prisma.inspectionApprovalBatch.findFirst({
      where: {
        id: batchId,
        tenantId,
        inspectionReportId: reportId,
      },
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
        reviewedByUser: { select: { id: true, name: true, email: true } },
        serialNumbers: {
          include: {
            serialNumber: true,
          },
        },
      },
    });

    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async getReportApprovalProgress(tenantId: string, reportId: string) {
    const serials = await this.prisma.serialNumber.findMany({
      where: { tenantId, inspectionReportId: reportId },
    });

    return {
      total: serials.length,
      notInspected: serials.filter((s) => s.approvalStatus === 'NOT_INSPECTED')
        .length,
      inspectedDraft: serials.filter(
        (s) => s.approvalStatus === 'INSPECTED_DRAFT',
      ).length,
      submitted: serials.filter(
        (s) => s.approvalStatus === 'SUBMITTED_FOR_APPROVAL',
      ).length,
      approved: serials.filter((s) => s.approvalStatus === 'APPROVED').length,
    };
  }
}
