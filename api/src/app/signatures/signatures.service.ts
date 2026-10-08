import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InspectionReportStatus, Prisma, UserRole } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FrozenSignature, freezeSignatureForReport } from './freeze-signature';
import {
  currentFieldSignatures,
  SignatureDefinitionView,
  SignatureFieldSpec,
  signatureFieldsOf,
} from './signature-fields';
import { INSPECTOR_SIGNATURE_SLOT, SignatureSigner } from './signature-slots';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from '../storage/attachment-storage.types';

/** Hard ceiling on an uploaded signature image. A 600x200 PNG is a few KB. */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

/** PNG dimension bounds (px). The portal emits 600x200; the range tolerates a retina export. */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 40;
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 1200;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export interface SignatureStatus {
  hasSignature: boolean;
  updatedAt: Date | null;
}

/** The caller, as the per-report signature endpoints need it. */
export interface SignatureActor {
  id: string;
  tenantId: string;
  role: UserRole;
  customerId: string | null;
}

/** Report states in which a customer may sign (the report has been approved). */
const SIGNABLE_STATUSES: ReadonlySet<InspectionReportStatus> = new Set([
  InspectionReportStatus.APPROVED,
  InspectionReportStatus.CLOSED,
]);

const REPORT_SELECT = {
  id: true,
  reportNumber: true,
  poNumber: true,
  status: true,
  revisionNumber: true,
  templateKey: true,
  templateVersion: true,
} satisfies Prisma.InspectionReportSelect;

type ReportRow = Prisma.InspectionReportGetPayload<{
  select: typeof REPORT_SELECT;
}>;

const templateRef = (t: { templateKey: string; templateVersion: number }): string =>
  `${t.templateKey}@${t.templateVersion}`;

export interface ReportSignatureStates {
  reportId: string;
  revisionNumber: number;
  /** Whether the report is in a state where customer signatures can be provided. */
  signable: boolean;
  fields: {
    key: string;
    label: string;
    signer: SignatureSigner;
    required: boolean;
    signed: boolean;
    signedAt: Date | null;
    signedByName: string | null;
  }[];
  /**
   * The inspector's signature frozen at submission for review, or null when none was frozen.
   * Not a template field (it has no `key` among `fields`); its image is served under the
   * fixed key {@link INSPECTOR_IMAGE_KEY}.
   */
  inspector: {
    signed: boolean;
    signedAt: Date | null;
    signedByName: string | null;
  } | null;
}

/** Image key of the inspector's frozen signature (template field keys cannot collide: they are `{token}`s). */
export const INSPECTOR_IMAGE_KEY = 'inspector';

export interface PendingSignatureReport {
  reportId: string;
  reportNumber: string | null;
  poNumber: string | null;
  status: InspectionReportStatus;
  fields: { key: string; label: string; required: boolean }[];
}

/**
 * Owns the account signature (one per user) and the freeze of that signature onto a
 * report at submission.
 *
 * Signature objects are IMMUTABLE: every registration mints a fresh uuid-keyed object
 * and repoints the user's single `UserSignature` row at it. Reports keep a pointer to
 * the object that was current when they were submitted ({@link freezeForReport}), so
 * re-exporting an old report renders the old signature even after the signer changes
 * theirs — with no file copy.
 */
@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  public async getStatus(userId: string): Promise<SignatureStatus> {
    const row = await this.prisma.userSignature.findUnique({
      where: { userId },
      select: { updatedAt: true },
    });
    return { hasSignature: !!row, updatedAt: row?.updatedAt ?? null };
  }

  /** Whether the user currently has a registered signature (the gate's question). */
  public async hasSignature(userId: string): Promise<boolean> {
    const count = await this.prisma.userSignature.count({ where: { userId } });
    return count > 0;
  }

  /**
   * Register or replace the user's signature. The PNG is validated, written as a NEW
   * object, then the row is upserted to point at it. The previous object is deleted
   * only when no report has frozen a pointer to it.
   */
  public async saveForUser(
    user: { id: string; tenantId: string },
    buffer: Buffer,
  ): Promise<SignatureStatus> {
    this.assertValidPng(buffer);

    const storageKey = this.storage.buildSignatureKey({
      tenantId: user.tenantId,
      userId: user.id,
      objectId: crypto.randomUUID(),
    });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    const previous = await this.prisma.userSignature.findUnique({
      where: { userId: user.id },
      select: { storageKey: true },
    });

    // Object first, row second: a crash in between leaves an unreferenced object
    // (harmless), never a row pointing at nothing.
    await this.storage.putSignature(storageKey, buffer);
    const row = await this.prisma.userSignature.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tenantId: user.tenantId,
        storageKey,
        mimeType: 'image/png',
        hash,
      },
      update: { storageKey, mimeType: 'image/png', hash },
    });

    if (previous && previous.storageKey !== storageKey) {
      await this.deleteIfUnreferenced(previous.storageKey);
    }
    return { hasSignature: true, updatedAt: row.updatedAt };
  }

  /** The caller's own current signature image, for the "my signature" preview. */
  public async getImageForUser(userId: string): Promise<Buffer> {
    const row = await this.prisma.userSignature.findUnique({
      where: { userId },
      select: { storageKey: true },
    });
    if (!row) {
      throw new NotFoundException('No signature registered.');
    }
    const bytes = await this.storage.getSignature(row.storageKey);
    if (!bytes) {
      throw new NotFoundException('Signature image is missing from storage.');
    }
    return bytes;
  }

  /**
   * Freeze a pointer to the user's CURRENT signature onto a report for `slot`.
   * Copies the key + hash, not the file. Returns `null` (and writes nothing) when the
   * user has no signature — callers decide whether that is an error. Takes the
   * caller's transaction client so the freeze commits atomically with the transition
   * that triggered it.
   */
  public async freezeForReport(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      inspectionReportId: string;
      slot: string;
      userId: string;
      revisionNumber?: number;
    },
  ): Promise<FrozenSignature | null> {
    return freezeSignatureForReport(tx, args);
  }

  /**
   * The signature to render for `slot` on a report: the most recently frozen pointer.
   * `null` when none was frozen (legacy reports submitted before this feature, or a
   * signer who had no signature at submission).
   */
  public async getFrozenForReport(
    tenantId: string,
    inspectionReportId: string,
    slot: string,
  ): Promise<FrozenSignature | null> {
    const row = await this.prisma.reportSignature.findFirst({
      where: { tenantId, inspectionReportId, slot },
      orderBy: { signedAt: 'desc' },
    });
    return row
      ? {
          storageKey: row.storageKey,
          hash: row.hash,
          signedById: row.signedById,
          signedAt: row.signedAt,
        }
      : null;
  }

  /** Load the image bytes behind a frozen pointer. */
  public getImageByKey(storageKey: string): Promise<Buffer | null> {
    return this.storage.getSignature(storageKey);
  }

  /**
   * The state of every signature field on a report, for the current revision. Visible to
   * any user who can see the report (a CUSTOMER only for their own customer's).
   */
  public async getFieldStates(
    user: SignatureActor,
    reportId: string,
  ): Promise<ReportSignatureStates> {
    const report = await this.loadReportFor(user, reportId);
    const specs = await this.specsFor(user.tenantId, report);
    const current = (
      await currentFieldSignatures(this.prisma, {
        tenantId: user.tenantId,
        reports: [report],
      })
    ).get(report.id);

    const inspectorRow = await this.getFrozenForReport(
      user.tenantId,
      report.id,
      INSPECTOR_SIGNATURE_SLOT,
    );
    const signerIds = [
      ...[...(current?.values() ?? [])].map((r) => r.signedById),
      ...(inspectorRow ? [inspectorRow.signedById] : []),
    ];
    const signers = signerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: signerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const nameOf = new Map(signers.map((u) => [u.id, u.name || u.email]));

    return {
      reportId: report.id,
      revisionNumber: report.revisionNumber,
      signable: SIGNABLE_STATUSES.has(report.status),
      fields: specs.map((s) => {
        const row = current?.get(s.slot);
        return {
          key: s.key,
          label: s.label,
          signer: s.signer,
          required: s.required,
          signed: !!row,
          signedAt: row?.signedAt ?? null,
          signedByName: row ? (nameOf.get(row.signedById) ?? null) : null,
        };
      }),
      inspector: inspectorRow
        ? {
            signed: true,
            signedAt: inspectorRow.signedAt,
            signedByName: nameOf.get(inspectorRow.signedById) ?? null,
          }
        : null,
    };
  }

  /**
   * The PNG behind one signature on a report, for the customer / ops report views. `key` is a
   * template signature field key (the CURRENT revision's signature) or {@link INSPECTOR_IMAGE_KEY}
   * (the signature frozen at submission). Same visibility as {@link getFieldStates}: any user who
   * can see the report, a CUSTOMER only for their own customer's.
   */
  public async getSignatureImage(
    user: SignatureActor,
    reportId: string,
    key: string,
  ): Promise<Buffer> {
    const report = await this.loadReportFor(user, reportId);
    let storageKey: string | null = null;
    if (key === INSPECTOR_IMAGE_KEY) {
      storageKey =
        (
          await this.getFrozenForReport(
            user.tenantId,
            report.id,
            INSPECTOR_SIGNATURE_SLOT,
          )
        )?.storageKey ?? null;
    } else {
      const spec = (await this.specsFor(user.tenantId, report)).find(
        (s) => s.key === key,
      );
      if (spec) {
        const current = (
          await currentFieldSignatures(this.prisma, {
            tenantId: user.tenantId,
            reports: [report],
          })
        ).get(report.id);
        storageKey = current?.get(spec.slot)?.storageKey ?? null;
      }
    }
    if (!storageKey) throw new NotFoundException('Signature not found.');
    const bytes = await this.storage.getSignature(storageKey);
    if (!bytes) {
      throw new NotFoundException('Signature image is missing from storage.');
    }
    return bytes;
  }

  /**
   * A customer user draws their signature on one CUSTOMER field of a report.
   *
   * Allowed once the report is APPROVED (or CLOSED) and only while that field is unsigned
   * for the current revision — a signed field is never overwritten; reopening the report
   * is what clears it. Any user of the report's customer may sign. The image is written as
   * its own immutable object, keyed under the signer, and recorded as a pointer tagged with
   * the report's current revision.
   */
  public async signCustomerField(
    user: SignatureActor,
    reportId: string,
    fieldKey: string,
    buffer: Buffer,
  ): Promise<ReportSignatureStates> {
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Only a customer user can sign this field.');
    }
    const report = await this.loadReportFor(user, reportId);
    if (!SIGNABLE_STATUSES.has(report.status)) {
      throw new ConflictException({
        code: 'NOT_SIGNABLE',
        message: 'A report can be signed once it is approved.',
      });
    }
    const spec = (await this.specsFor(user.tenantId, report)).find(
      (s) => s.key === fieldKey,
    );
    if (!spec || spec.signer !== 'CUSTOMER') {
      throw new NotFoundException('No such customer signature field.');
    }
    this.assertValidPng(buffer);

    const storageKey = this.storage.buildSignatureKey({
      tenantId: user.tenantId,
      userId: user.id,
      objectId: crypto.randomUUID(),
    });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    // Object first, row second (as for the account signature): a crash in between leaves
    // an unreferenced object, never a row pointing at nothing.
    await this.storage.putSignature(storageKey, buffer);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the report may have been reopened (revision
        // bumped) or the field signed by a colleague while the image was uploading.
        const fresh = await tx.inspectionReport.findUnique({
          where: { id: report.id },
          select: { status: true, revisionNumber: true },
        });
        if (!fresh || !SIGNABLE_STATUSES.has(fresh.status)) {
          throw new ConflictException({
            code: 'NOT_SIGNABLE',
            message: 'A report can be signed once it is approved.',
          });
        }
        const already = await tx.reportSignature.count({
          where: {
            tenantId: user.tenantId,
            inspectionReportId: report.id,
            slot: spec.slot,
            revisionNumber: fresh.revisionNumber,
          },
        });
        if (already > 0) {
          throw new ConflictException({
            code: 'ALREADY_SIGNED',
            message: 'This signature has already been provided.',
          });
        }
        await tx.reportSignature.create({
          data: {
            tenantId: user.tenantId,
            inspectionReportId: report.id,
            slot: spec.slot,
            signedById: user.id,
            storageKey,
            hash,
            revisionNumber: fresh.revisionNumber,
          },
        });
      });
    } catch (err) {
      await this.deleteIfUnreferenced(storageKey).catch(() => undefined);
      throw err;
    }
    return this.getFieldStates(user, reportId);
  }

  /**
   * Reports of the caller's customer that are waiting on a CUSTOMER signature: APPROVED (or
   * CLOSED), on a template with CUSTOMER signature fields, with at least one still unsigned
   * for the report's current revision. Drives the customer "Signature pending" area.
   */
  public async listPendingForCustomer(
    user: SignatureActor,
  ): Promise<PendingSignatureReport[]> {
    if (user.role !== UserRole.CUSTOMER || !user.customerId) return [];

    const reports = await this.prisma.inspectionReport.findMany({
      where: {
        tenantId: user.tenantId,
        customerId: user.customerId,
        status: { in: [...SIGNABLE_STATUSES] },
      },
      select: REPORT_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
    if (reports.length === 0) return [];

    const definitions = await this.definitionsFor(user.tenantId, reports);
    const withFields = reports
      .map((r) => ({
        report: r,
        specs: signatureFieldsOf(
          definitions.get(templateRef(r)),
        ).filter((s) => s.signer === 'CUSTOMER'),
      }))
      .filter((x) => x.specs.length > 0);
    if (withFields.length === 0) return [];

    const current = await currentFieldSignatures(this.prisma, {
      tenantId: user.tenantId,
      reports: withFields.map((x) => x.report),
    });

    const out: PendingSignatureReport[] = [];
    for (const { report, specs } of withFields) {
      const signed = current.get(report.id);
      const pending = specs.filter((s) => !signed?.has(s.slot));
      if (pending.length === 0) continue;
      out.push({
        reportId: report.id,
        reportNumber: report.reportNumber,
        poNumber: report.poNumber,
        status: report.status,
        fields: pending.map((s) => ({
          key: s.key,
          label: s.label,
          required: s.required,
        })),
      });
    }
    return out;
  }

  /** The report, tenant-scoped; a CUSTOMER only ever sees their own customer's. */
  private async loadReportFor(
    user: SignatureActor,
    reportId: string,
  ): Promise<ReportRow> {
    const report = await this.prisma.inspectionReport.findFirst({
      where: {
        id: reportId,
        tenantId: user.tenantId,
        ...(user.role === UserRole.CUSTOMER
          ? { customerId: user.customerId ?? '__none__' }
          : {}),
      },
      select: REPORT_SELECT,
    });
    if (!report) throw new NotFoundException('Inspection report not found.');
    return report;
  }

  private async specsFor(
    tenantId: string,
    report: ReportRow,
  ): Promise<SignatureFieldSpec[]> {
    const defs = await this.definitionsFor(tenantId, [report]);
    return signatureFieldsOf(defs.get(templateRef(report)));
  }

  /** `definitionJson` per distinct pinned template of the given reports. */
  private async definitionsFor(
    tenantId: string,
    reports: ReportRow[],
  ): Promise<Map<string, SignatureDefinitionView | null>> {
    const refs = new Map(
      reports.map((r) => [
        templateRef(r),
        { templateKey: r.templateKey, templateVersion: r.templateVersion },
      ]),
    );
    const templates = await this.prisma.template.findMany({
      where: { tenantId, OR: [...refs.values()] },
      select: { templateKey: true, templateVersion: true, definitionJson: true },
    });
    return new Map(
      templates.map((t) => [
        templateRef(t),
        t.definitionJson as SignatureDefinitionView | null,
      ]),
    );
  }

  private async deleteIfUnreferenced(storageKey: string): Promise<void> {
    const referenced = await this.prisma.reportSignature.count({
      where: { storageKey },
    });
    if (referenced === 0) {
      await this.storage.deleteSignature(storageKey);
    }
  }

  /**
   * Cheap structural validation: PNG magic, an IHDR with sane dimensions, a closing
   * IEND chunk (catches truncated uploads) and a size cap. It does not decode pixels.
   */
  private assertValidPng(buffer: Buffer): void {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Signature image is required.');
    }
    if (buffer.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException(
        `Signature image is too large (max ${MAX_SIGNATURE_BYTES / 1024} KB).`,
      );
    }
    // 8 magic + 4 length + 4 'IHDR' + 4 width + 4 height + IEND(12)
    const minimum = 8 + 8 + 8 + PNG_IEND.length;
    if (
      buffer.length < minimum ||
      !buffer.subarray(0, 8).equals(PNG_MAGIC) ||
      buffer.toString('ascii', 12, 16) !== 'IHDR'
    ) {
      throw new BadRequestException('Signature must be a PNG image.');
    }
    if (!buffer.subarray(buffer.length - PNG_IEND.length).equals(PNG_IEND)) {
      throw new BadRequestException('Signature PNG is truncated or corrupt.');
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (
      width < MIN_WIDTH ||
      height < MIN_HEIGHT ||
      width > MAX_WIDTH ||
      height > MAX_HEIGHT
    ) {
      throw new BadRequestException(
        `Signature dimensions ${width}x${height} are out of range.`,
      );
    }
  }
}
