import {
  Injectable,
  Inject,
  Optional,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  PreconditionFailedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { RevisionService } from '../revision/revision.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from '../storage/attachment-storage.types';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { engineMap, ExportDefinition } from './export-engine';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserRole,
  InspectionReportStatus,
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
} from '@prisma/client';
import { InspectionData, Snapshot } from '../common/inspection-data.types';
import { assembleSnapshotHeader } from '../common/snapshot-header';
import { resolveDisposition } from '../workflow/approval-gate';
import { embedSignatures, SignatureImage } from './signature-embed';
import { PdfConverterService } from './pdf-converter.service';
import { prepareWorkbookForPdf } from './pdf-page-setup';
import { INSPECTOR_SIGNATURE_SLOT } from '../signatures/freeze-signature';
import {
  currentFieldSignatures,
  SignatureDefinitionView,
  SignatureFieldSpec,
  signatureFieldsOf,
} from '../signatures/signature-fields';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revisionService: RevisionService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
    // Optional so the xlsx-only constructions in tests keep working; PDF needs it.
    @Optional() private readonly pdfConverter?: PdfConverterService,
  ) {}

  async exportInspectionReport(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    reportId: string,
    requestedRevision?: number,
    format: 'pdf' | 'xlsx' = 'xlsx',
  ): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    // 1. Fetch Report & Validate Approval
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
      include: {
        customer: { select: { name: true } },
        childReports: {
          include: {
            serialNumbers: {
              include: { serialNumber: true },
              orderBy: { serialNumber: { serial: 'asc' } },
            },
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection report not found');
    }
    if (report.tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied');
    }
    if (
      user.role === UserRole.CUSTOMER &&
      report.customerId !== user.customerId
    ) {
      throw new ForbiddenException(
        'Access denied: report does not belong to customer',
      );
    }

    const isParentApproved =
      report.status === InspectionReportStatus.APPROVED ||
      report.status === InspectionReportStatus.CLOSED;

    const childReport = report.childReports.find(
      (cr) => cr.type === ChildReportType.REWORK,
    );
    const isChildApproved =
      childReport &&
      (childReport.status === ChildReportStatus.APPROVED ||
        childReport.status === ChildReportStatus.CLOSED);

    if (!isParentApproved && !isChildApproved) {
      throw new ForbiddenException(
        `Export is only allowed when either the Parent or Child report is ${InspectionReportStatus.APPROVED} or ${InspectionReportStatus.CLOSED}`,
      );
    }

    // 2. Resolve Revision
    let revisionNumber = requestedRevision;
    if (revisionNumber === undefined) {
      revisionNumber = report.revisionNumber;
    }

    let snapshot: Snapshot;

    if (revisionNumber === 0) {
      // Build an equivalent snapshot on-the-fly from live data so export still works.
      const liveReport = await this.prisma.inspectionReport.findUnique({
        where: { id: reportId },
        include: {
          serialNumbers: { orderBy: { serial: 'asc' } },
          childReports: {
            orderBy: { reportNumber: 'asc' },
            select: { id: true, reportNumber: true, status: true },
          },
          transitionLogs: { orderBy: { timestamp: 'asc' } },
        },
      });
      if (!liveReport) {
        throw new NotFoundException('Inspection report not found');
      }
      snapshot = {
        // Phase D step 2 — header assembled generically (definition-keyed
        // `headerData` overlaid on the legacy named-column bridge) via the SAME
        // shared assembler the revision snapshot uses, so the rev-0 live rebuild
        // and the persisted snapshot stay identical. See assembleSnapshotHeader.
        header: assembleSnapshotHeader(liveReport),
        template: {
          key: liveReport.templateKey,
          version: liveReport.templateVersion,
          hash: liveReport.templateHash,
          versionId: liveReport.templateVersionId,
        },
        serialNumbers: liveReport.serialNumbers.map((sn) => {
          return {
            id: sn.id,
            serial: sn.serial,
            inspectionData: sn.inspectionData as InspectionData,
            // Re-derived below once the template definition is loaded (the shared
            // resolver needs disposition.source). Both this live rev-0 build and any
            // historical persisted snapshot are normalized in the same pass, so both
            // resolve disposition identically to the gate.
            disposition: null,
            updatedAt: sn.updatedAt,
          };
        }),
        childReports: liveReport.childReports,
        transitionLogs: liveReport.transitionLogs,
      } satisfies Snapshot;
    } else {
      const revision = await this.prisma.inspectionReportRevision.findUnique({
        where: {
          inspectionReportId_revisionNumber: {
            inspectionReportId: reportId,
            revisionNumber: revisionNumber,
          },
        },
      });

      if (!revision) {
        throw new NotFoundException(`Revision ${revisionNumber} not found`);
      }

      snapshot = revision.snapshotJson as unknown as Snapshot;
      if (!snapshot) {
        throw new InternalServerErrorException('Snapshot data is missing');
      }
    }

    // Inject User Data into Snapshot for the export mappers to compute "Inspected By" and "Approved By"
    const transitionUserIds = (snapshot.transitionLogs || [])
      .map((l) => l.userId)
      .filter((id): id is string => Boolean(id));
    if (transitionUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: transitionUserIds } },
        select: { id: true, name: true, email: true },
      });
      snapshot.users = users;
    }

    const liveTransitionLogs =
      await this.prisma.inspectionReportTransitionLog.findMany({
        where: { inspectionReportId: reportId },
        orderBy: { timestamp: 'asc' },
        select: { userId: true, toStatus: true, timestamp: true },
      });

    const latestApprovedBatch =
      await this.prisma.inspectionApprovalBatch.findFirst({
        where: {
          inspectionReportId: reportId,
          status: 'APPROVED',
          reviewedByUserId: { not: null },
        },
        orderBy: { reviewedAt: 'desc' },
        select: { reviewedByUserId: true },
      });

    const userIds = new Set<string>();
    for (const log of liveTransitionLogs) {
      if (log.userId) {
        userIds.add(log.userId);
      }
    }
    if (latestApprovedBatch?.reviewedByUserId) {
      userIds.add(latestApprovedBatch.reviewedByUserId);
    }

    let usersById = new Map<string, { name: string | null; email: string }>();
    if (userIds.size > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, name: true, email: true },
      });
      usersById = new Map(
        users.map((u) => [u.id, { name: u.name, email: u.email }]),
      );
    }

    const latestInspectorLog = [...liveTransitionLogs]
      .reverse()
      .find((log) => log.toStatus === 'IN_INSPECTION');
    const latestApproveLog = [...liveTransitionLogs]
      .reverse()
      .find((log) => log.toStatus === 'APPROVED' || log.toStatus === 'CLOSED');

    const inspectedByName = latestInspectorLog?.userId
      ? usersById.get(latestInspectorLog.userId)?.name ||
        usersById.get(latestInspectorLog.userId)?.email ||
        'N/A'
      : 'N/A';

    let approvedByName = 'N/A';
    if (latestApproveLog?.userId) {
      approvedByName =
        usersById.get(latestApproveLog.userId)?.name ||
        usersById.get(latestApproveLog.userId)?.email ||
        'N/A';
    } else if (latestApprovedBatch?.reviewedByUserId) {
      approvedByName =
        usersById.get(latestApprovedBatch.reviewedByUserId)?.name ||
        usersById.get(latestApprovedBatch.reviewedByUserId)?.email ||
        'N/A';
    }

    snapshot.header = snapshot.header || ({} as Snapshot['header']);
    snapshot.header.inspectedByName = inspectedByName;
    snapshot.header.approvedByName = approvedByName;

    // Inject Customer Data
    if (!snapshot.header.customerName) {
      snapshot.header.customerName = report.customer?.name || 'N/A';
    }

    // 4. Fetch Template Bytes and verify
    const template = await this.prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId: user.tenantId,
          templateKey: report.templateKey,
          templateVersion: report.templateVersion,
        },
      },
    });

    if (!template) {
      throw new InternalServerErrorException(
        'Template file could not be loaded',
      );
    }

    if (template.hash !== report.templateHash) {
      throw new InternalServerErrorException(
        'Template hash verification failed',
      );
    }

    // Fetch the workbook bytes from the storage abstraction by the row's stored
    // key (local disk or S3 per STORAGE_DRIVER), then re-verify: the fetched bytes
    // must hash to the template's recorded sha256. This preserves the original
    // integrity guarantee now that the bytes live outside Postgres — a corrupted
    // or wrong object surfaces as a server-side precondition, not a bad export.
    const templateBuffer = await this.storage.getTemplate(template.fileKey);
    if (!templateBuffer) {
      throw new InternalServerErrorException(
        'Template file could not be loaded',
      );
    }
    const fetchedHash = crypto
      .createHash('sha256')
      .update(templateBuffer)
      .digest('hex');
    if (fetchedHash !== template.hash) {
      throw new InternalServerErrorException(
        'Template hash verification failed',
      );
    }

    // The template's structured definition drives export. The legacy hardcoded
    // mapDrillPipeReportV1 fallback was retired once every template carried a
    // definition (the engine mapper is proven equivalent to it, then made sole
    // authority — see export-engine.equivalence.spec.ts). The template row is
    // already loaded above — no extra query.
    const definition =
      (template.definitionJson as unknown as ExportDefinition | null) ?? null;

    // A missing definition is a template-misconfiguration, not a user-input
    // failure — surface it as a server-side precondition, NOT a BadRequest
    // (which would wrongly blame the caller's request). Defensive-only:
    // unreachable for correctly-seeded templates post-cutover.
    if (!definition) {
      throw new PreconditionFailedException(
        `Template ${report.templateKey}@${report.templateVersion} has no export definition`,
      );
    }

    // Normalize each snapshot serial's disposition through the shared resolver, keyed on
    // this template's declared `disposition.source`. This is what makes the parent
    // REWORK-last sort correct for BOTH live rev-0 exports AND historical persisted
    // snapshots — the latter recorded `disposition: null` under the old phantom
    // `final.disposition` read but embed the full inspectionData, so the true value is
    // re-derivable at read time with zero migration. The Excel CELL value is unaffected
    // (it comes from the `{{emi}}` token → body.emiResult); only this sort key changes.
    const dispositionView = template.definitionJson as {
      disposition?: { source?: string[] };
    } | null;
    if (snapshot.serialNumbers) {
      for (const s of snapshot.serialNumbers) {
        s.disposition = resolveDisposition(s.inspectionData, dispositionView);
      }
    }

    const signatureImages = await this.loadSignatureImages(
      user.tenantId,
      reportId,
      snapshot,
      definition,
      {
        revisionNumber,
        // Only the report's CURRENT revision is gated on its required signatures: an older
        // revision may legitimately have been reopened before anyone signed it, and must
        // stay exportable with whatever was signed on it. A child-only export (parent not
        // approved) has no parent signatures to wait for.
        enforceRequired:
          isParentApproved && revisionNumber === report.revisionNumber,
      },
    );

    const allFiles: { buffer: Buffer; filename: string }[] = [];
    const poStr =
      report.poNumber && report.poNumber.trim().length > 0
        ? report.poNumber.trim().replace(/\s+/g, '_').toUpperCase()
        : 'NOPO';
    const reportNum = report.reportNumber || 'UNKNOWN';
    // Revision 0 (never snapshotted) carries no suffix; reopened revisions keep `_<n>` so
    // their files stay distinguishable.
    const revSuffix = revisionNumber > 0 ? `_${revisionNumber}` : '';
    const baseParentFilename = `OTS_${poStr}_${reportNum}${revSuffix}`;
    const baseChildFilename = `OTS_${poStr}_${reportNum}_rework${revSuffix}`; // Child naming: _rework

    if (isParentApproved) {
      const parentSerials = [...(snapshot.serialNumbers || [])];

      // Order Parent export deterministic: non-REWORK first, REWORK last, original ID/Sequence order preserved
      parentSerials.sort((a, b) => {
        const aDisp = (a.disposition || '').toUpperCase();
        const bDisp = (b.disposition || '').toUpperCase();
        const aIsRework = aDisp === SerialDisposition.REWORK ? 1 : 0;
        const bIsRework = bDisp === SerialDisposition.REWORK ? 1 : 0;

        if (aIsRework !== bIsRework) {
          return aIsRework - bIsRework;
        }

        return (a.serial || '').localeCompare(b.serial || '');
      });

      const parentFiles = await this.generateExcelFiles(
        templateBuffer,
        snapshot,
        parentSerials,
        baseParentFilename,
        definition,
        signatureImages,
      );
      allFiles.push(...parentFiles);
    }

    if (isChildApproved && childReport) {
      // Map child serials to the structure expected by applyMapping
      const childSerials = childReport.serialNumbers.map((crsn) => {
        const sn = crsn.serialNumber;
        return {
          id: sn.id,
          serial: sn.serial,
          inspectionData: crsn.inspectionData as InspectionData,
          disposition: crsn.disposition,
          updatedAt: sn.updatedAt,
        };
      });

      const childFiles = await this.generateExcelFiles(
        templateBuffer,
        snapshot,
        childSerials,
        baseChildFilename,
        definition,
        signatureImages,
      );
      allFiles.push(...childFiles);
    }

    if (allFiles.length === 0) {
      throw new InternalServerErrorException('No files generated for export');
    }

    // PDF: convert each finished workbook; the file set (single / zip of parts) is unchanged.
    if (format === 'pdf') {
      if (!this.pdfConverter) {
        throw new InternalServerErrorException('PDF converter is not available');
      }
      for (const f of allFiles) {
        f.buffer = await this.pdfConverter.xlsxToPdf(
          await this.prepareForPdf(f.buffer, f.filename),
          f.filename,
        );
        f.filename = f.filename.replace(/.xlsx$/i, '.pdf');
      }
    }

    // Uploaded files travel with the export: when the report has any, the download is always
    // a zip — the export file(s) at the root, the originals untouched under attachments/.
    const attachmentFiles = await this.loadAttachmentFiles(report);

    const single = allFiles[0];
    if (allFiles.length === 1 && single && attachmentFiles.length === 0) {
      return {
        buffer: single.buffer,
        filename: single.filename,
        mimetype:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    // Zip multiple files (either chunks or parent+child combo)
    const zip = new JSZip();
    for (const f of allFiles) {
      zip.file(
        f.filename,
        f.buffer as unknown as Parameters<typeof zip.file>[1],
      );
    }
    for (const f of attachmentFiles) {
      zip.file(
        `attachments/${f.filename}`,
        f.buffer as unknown as Parameters<typeof zip.file>[1],
      );
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    return {
      buffer: zipBuffer as unknown as Buffer,
      filename: `OTS_${poStr}_${reportNum}${revSuffix}.zip`,
      mimetype: 'application/zip',
    };
  }

  /**
   * The blank template workbook (tokens intact) the report is pinned to. Same access rules
   * as the export itself — tenant match, and a customer only for their own reports — but no
   * approval/signature gate: the file carries no report data.
   */
  async getReportTemplateFile(
    user: { tenantId: string; role: UserRole; customerId?: string | null },
    reportId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    const report = await this.prisma.inspectionReport.findUnique({
      where: { id: reportId },
      select: {
        tenantId: true,
        customerId: true,
        templateKey: true,
        templateVersion: true,
      },
    });
    if (!report) throw new NotFoundException('Inspection report not found');
    if (report.tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied');
    }
    if (
      user.role === UserRole.CUSTOMER &&
      report.customerId !== user.customerId
    ) {
      throw new ForbiddenException(
        'Access denied: report does not belong to customer',
      );
    }

    const template = await this.prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId: user.tenantId,
          templateKey: report.templateKey,
          templateVersion: report.templateVersion,
        },
      },
      select: { fileKey: true },
    });
    const buffer = template ? await this.storage.getTemplate(template.fileKey) : null;
    if (!buffer) {
      throw new InternalServerErrorException('Template file could not be loaded');
    }
    return {
      buffer,
      filename: `${report.templateKey}_v${report.templateVersion}_template.xlsx`,
      mimetype:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * The report's uploaded files, read from storage under their original names (de-duplicated
   * and stripped of path separators so a name can never escape the attachments/ folder).
   * A file whose bytes are missing from storage is skipped with a warning rather than
   * failing the whole export.
   */
  private async loadAttachmentFiles(report: {
    id: string;
    tenantId: string;
    customerId: string | null;
  }): Promise<{ buffer: Buffer; filename: string }[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { inspectionReportId: report.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, filename: true },
    });

    const files: { buffer: Buffer; filename: string }[] = [];
    const taken = new Set<string>();
    for (const row of rows) {
      const buffer = await this.storage.get({
        tenantId: report.tenantId,
        customerId: report.customerId,
        reportId: report.id,
        attachmentId: row.id,
      });
      if (!buffer) {
        this.logger.warn(
          `Report ${report.id}: attachment ${row.id} (${row.filename}) is missing from storage; left out of the export.`,
        );
        continue;
      }

      const safe =
        row.filename.replace(/[\\/]+/g, '_').trim() || `attachment-${row.id}`;
      let name = safe;
      for (let n = 2; taken.has(name.toLowerCase()); n++) {
        const dot = safe.lastIndexOf('.');
        name =
          dot > 0
            ? `${safe.slice(0, dot)} (${n})${safe.slice(dot)}`
            : `${safe} (${n})`;
      }
      taken.add(name.toLowerCase());
      files.push({ buffer, filename: name });
    }
    return files;
  }

  /** PDF-only page normalisation; a failure falls back to the unmodified workbook. */
  private async prepareForPdf(xlsx: Buffer, filename: string): Promise<Buffer> {
    try {
      return await prepareWorkbookForPdf(xlsx);
    } catch (err) {
      this.logger.warn(
        `PDF page preparation failed for ${filename}; converting as-is: ${(err as Error).message}`,
      );
      return xlsx;
    }
  }

  private async generateExcelFiles(
    templateBuffer: Buffer,
    snapshot: Snapshot,
    serialNumbers: Snapshot['serialNumbers'],
    baseFilename: string,
    definition: ExportDefinition,
    signatureImages: Record<string, SignatureImage> = {},
  ): Promise<{ buffer: Buffer; filename: string }[]> {
    const files: { buffer: Buffer; filename: string }[] = [];
    const N = serialNumbers.length;

    // FLAT (region-less) definition — Phase D flat templates. There is no repeating
    // region, so the output is one fixed-layout, header-only file: no chunking, and no
    // zero-serial early return (a flat report is "one serial's worth of header data",
    // so it always yields exactly one file). Region definitions carry regions.length
    // === 1 and never enter this branch, so the region path below is byte-unchanged.
    // Nothing can author regions: [] yet (the builder always emits one region and the
    // validator rejects any other count), so this is unreachable in production this
    // step — engine mechanism only. See docs/architecture/template-definition.md.
    if (!definition.regions || definition.regions.length === 0) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
      try {
        await this.applyMapping(workbook, snapshot, serialNumbers, definition, signatureImages);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined;
        throw new BadRequestException(
          message || 'Error applying template mapping',
        );
      }
      const outBuffer = await workbook.xlsx.writeBuffer();
      files.push({
        buffer: Buffer.from(outBuffer),
        filename: `${baseFilename}.xlsx`,
      });
      return files;
    }

    // Chunk size comes from the definition's (single) region. A null region
    // chunkSize means "never split".
    const chunkSize =
      definition.regions?.[0]?.chunkSize ?? Number.POSITIVE_INFINITY;

    if (N === 0) {
      return files;
    }

    if (N <= chunkSize) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );

      try {
        await this.applyMapping(workbook, snapshot, serialNumbers, definition, signatureImages);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined;
        throw new BadRequestException(
          message || 'Error applying template mapping',
        );
      }

      const outBuffer = await workbook.xlsx.writeBuffer();
      files.push({
        buffer: Buffer.from(outBuffer),
        filename: `${baseFilename}.xlsx`,
      });
    } else {
      const chunks = Math.ceil(N / chunkSize);
      for (let k = 1; k <= chunks; k++) {
        const startIndex = (k - 1) * chunkSize;
        const endIndex = startIndex + chunkSize;
        const chunkSerials = serialNumbers.slice(startIndex, endIndex);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
        );

        try {
          await this.applyMapping(workbook, snapshot, chunkSerials, definition, signatureImages);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : undefined;
          throw new BadRequestException(
            `Error in part ${k}: ${message || 'Error applying template mapping'}`,
          );
        }

        const partBuffer = await workbook.xlsx.writeBuffer();
        files.push({
          buffer: Buffer.from(partBuffer),
          filename: `${baseFilename}_part${k}of${chunks}.xlsx`,
        });
      }
    }
    return files;
  }

  private async applyMapping(
    workbook: ExcelJS.Workbook,
    snapshot: Snapshot,
    chunk: Snapshot['serialNumbers'],
    definition: ExportDefinition,
    signatureImages: Record<string, SignatureImage> = {},
  ): Promise<void> {
    await engineMap(definition, workbook, snapshot, chunk);
    // After the engine: row expansion has settled, so marker cells are at their final
    // address. Also clears the marker when no image exists.
    embedSignatures(workbook, signatureImages);
  }

  /**
   * The signature images this report's template asks for. Only touches storage when the
   * definition actually binds the `inspectorSignature` role (legacy/seed templates don't).
   *
   * Source of truth, in order: the pointer embedded in the revision snapshot (the one in
   * force when THAT revision was made), then the latest pointer frozen on the report (the
   * live rev-0 build carries none). Neither → no image; the cell is left blank and the
   * gap is logged rather than failing a legitimate export of a legacy report.
   */
  private async loadSignatureImages(
    tenantId: string,
    reportId: string,
    snapshot: Snapshot,
    definition: ExportDefinition,
    opts: { revisionNumber: number; enforceRequired: boolean },
  ): Promise<Record<string, SignatureImage>> {
    const images: Record<string, SignatureImage> = {};
    const inspector = await this.loadInspectorSignature(
      tenantId,
      reportId,
      snapshot,
      definition,
    );
    if (inspector) images[INSPECTOR_SIGNATURE_SLOT] = inspector;
    Object.assign(
      images,
      await this.loadFieldSignatures(tenantId, reportId, definition, opts),
    );
    return images;
  }

  /**
   * The pictures for the template's `signature` fields (customer / supervisor), taken from
   * the rows current for the exported revision. An unsigned field is left out — its cell is
   * cleared blank — unless it was defined `required` and this is the report's current
   * revision, in which case the export is refused with a structured 409 listing what is
   * still missing, so the UI can tell the user exactly who has to sign.
   */
  private async loadFieldSignatures(
    tenantId: string,
    reportId: string,
    definition: ExportDefinition,
    opts: { revisionNumber: number; enforceRequired: boolean },
  ): Promise<Record<string, SignatureImage>> {
    const specs = signatureFieldsOf(
      definition as unknown as SignatureDefinitionView,
    );
    if (specs.length === 0) return {};

    const current = (
      await currentFieldSignatures(this.prisma, {
        tenantId,
        reports: [{ id: reportId, revisionNumber: opts.revisionNumber }],
      })
    ).get(reportId);

    const images: Record<string, SignatureImage> = {};
    const missing: SignatureFieldSpec[] = [];
    for (const spec of specs) {
      const row = current?.get(spec.slot);
      const bytes = row ? await this.storage.getSignature(row.storageKey) : null;
      if (bytes) {
        images[spec.slot] = { bytes };
        continue;
      }
      if (row) {
        this.logger.warn(
          `Report ${reportId}: signature object ${row.storageKey} for ${spec.slot} is missing from storage.`,
        );
      }
      if (spec.required) missing.push(spec);
    }

    if (opts.enforceRequired && missing.length > 0) {
      throw new ConflictException({
        code: 'SIGNATURE_PENDING',
        message: `Export is blocked until the report is signed: ${missing
          .map((m) => `${m.label} (${m.signer.toLowerCase()})`)
          .join(', ')}.`,
        pending: missing.map((m) => ({
          key: m.key,
          label: m.label,
          signer: m.signer,
        })),
      });
    }
    return images;
  }

  /**
   * The inspector's frozen signature picture. Only touches storage when the
   * definition actually binds the `inspectorSignature` role (legacy/seed templates don't).
   */
  private async loadInspectorSignature(
    tenantId: string,
    reportId: string,
    snapshot: Snapshot,
    definition: ExportDefinition,
  ): Promise<SignatureImage | null> {
    const wanted = (definition.export?.global ?? []).some(
      (e) => e.computed === INSPECTOR_SIGNATURE_SLOT,
    );
    if (!wanted) return null;

    const pointer =
      snapshot.signatures?.[INSPECTOR_SIGNATURE_SLOT] ??
      (await this.prisma.reportSignature.findFirst({
        where: {
          tenantId,
          inspectionReportId: reportId,
          slot: INSPECTOR_SIGNATURE_SLOT,
        },
        orderBy: { signedAt: 'desc' },
      }));
    if (!pointer) {
      this.logger.warn(
        `Report ${reportId}: no frozen inspector signature; exporting without one.`,
      );
      return null;
    }
    const bytes = await this.storage.getSignature(pointer.storageKey);
    if (!bytes) {
      this.logger.warn(
        `Report ${reportId}: signature object ${pointer.storageKey} is missing from storage.`,
      );
      return null;
    }
    return { bytes };
  }
}
