/**
 * Shared seed helpers for API integration specs (run against the ots_test DB).
 *
 * Factored out of the create-path spec so the create-path, workflow, and upcoming
 * revision-engine specs all agree on valid Tenant/Customer/Template row shapes
 * (e.g. Template requires fileBlob/hash/changeNote/createdById). Per-spec table
 * RESET is intentionally kept inline in each spec, since which tables a spec must
 * clear differs by spec — only the seeding is shared here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InspectionReportStatus,
  SerialApprovalStatus,
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
} from '@prisma/client';
import { PrismaService } from '../src/app/prisma/prisma.service';

/**
 * Truncate the whole inspection domain in FK-safe (child → parent) order.
 *
 * All integration specs share ONE test database (maxWorkers: 1), so each spec must
 * fully clear the domain in beforeEach — otherwise a prior suite's rows (serials,
 * transition logs, revisions, …) FK-block a later suite's inspectionReport delete.
 * Centralised here so every spec agrees on the order and no spec has to enumerate
 * the child tables it happens not to seed.
 */
export async function resetInspectionDomain(prisma: PrismaService) {
  await prisma.inspectionApprovalBatchSerialNumber.deleteMany();
  await prisma.inspectionApprovalBatch.deleteMany();
  await prisma.childReportSerialNumber.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.childReportRevision.deleteMany();
  await prisma.childReportTransitionLog.deleteMany();
  await prisma.childReport.deleteMany();
  await prisma.serialNumber.deleteMany();
  await prisma.inspectionReportRevision.deleteMany();
  await prisma.inspectionReportTransitionLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.inspectionReport.deleteMany();
  await prisma.template.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.tenant.deleteMany();
}

export function seedTenant(prisma: PrismaService, name = 'F2 test tenant') {
  return prisma.tenant.create({ data: { name } });
}

export function seedCustomer(prisma: PrismaService, tenantId: string) {
  return prisma.customer.create({
    data: { tenantId, name: 'Acme Drilling', code: 'ACME' },
  });
}

/**
 * The committed drill-pipe definition (the SAME artifact the backfill writes and the
 * engine gate/export/form consumers read). Loaded once from disk so seeders can attach
 * it by default — post-cutover every DRILL_PIPE_REPORT template carries it, so the
 * default gate-crossing fixture must too. `as unknown` — callers write it to a Json column.
 */
const DRILL_PIPE_DEFINITION: unknown = JSON.parse(
  readFileSync(
    resolve(__dirname, '../src/app/template/definitions/drill-pipe-v1.definition.json'),
    'utf-8',
  ),
);

/**
 * Resolve the definitionJson to seed onto a template. When `opts.definitionJson` is
 * omitted, the default depends on the key: DRILL_PIPE_REPORT gets the real committed
 * definition (matching production post-cutover); any other key stays NULL (a non-drill-
 * pipe template has no drill-pipe definition). Passing `{ definitionJson: null }` forces
 * NULL explicitly — for the deliberate-NULL specs that test the missing-definition path.
 */
function resolveSeedDefinition(
  templateKey: string,
  opts?: { definitionJson?: unknown | null },
): unknown | undefined {
  if (opts && 'definitionJson' in opts) {
    // Explicit choice (including null) wins. `null` → column stays NULL.
    return opts.definitionJson ?? undefined;
  }
  return templateKey === 'DRILL_PIPE_REPORT' ? DRILL_PIPE_DEFINITION : undefined;
}

export function seedActiveTemplate(
  prisma: PrismaService,
  tenantId: string,
  templateKey: string,
  opts?: { definitionJson?: unknown | null },
) {
  return prisma.template.create({
    data: {
      tenantId,
      templateKey,
      templateVersion: 1,
      status: 'ACTIVE',
      fileBlob: Buffer.from(`template-blob-${templateKey}`),
      hash: `hash-${templateKey}`,
      changeNote: 'seed',
      createdById: 'seed-user',
      definitionJson: resolveSeedDefinition(templateKey, opts) as never,
    },
  });
}

/**
 * Seed a bare InspectionReport in a chosen status. The template fields are plain
 * columns (no FK to Template — only the nullable legacyTemplateVersion is a FK), so
 * a report row stands alone without seeding a Template. Used by specs that need a
 * report parked in a specific status (e.g. the serial-numbers edit-guard matrix,
 * which reads inspectionReport.status). Defaults to DRAFT.
 */
export function seedInspectionReport(
  prisma: PrismaService,
  tenantId: string,
  opts: {
    status?: InspectionReportStatus;
    customerId?: string;
    poNumber?: string;
  } = {},
) {
  return prisma.inspectionReport.create({
    data: {
      tenantId,
      customerId: opts.customerId,
      poNumber: opts.poNumber ?? 'PO-SEED',
      templateKey: 'DRILL_PIPE_REPORT',
      templateVersion: 1,
      templateHash: 'hash-DRILL_PIPE_REPORT',
      status: opts.status ?? InspectionReportStatus.DRAFT,
    },
  });
}

/**
 * Seed a Template whose fileBlob is the REAL tracked DRILL_PIPE_REPORT xlsx
 * (api/scripts/valid-template.xlsx) rather than the dummy buffer seedActiveTemplate
 * writes. Export needs a genuine OOXML template — ExcelJS throws on the dummy blob —
 * so this variant exists specifically for the export characterization spec. Other
 * specs keep using seedActiveTemplate (they never load the blob).
 *
 * The hash is arbitrary but consistent: createReport copies template.hash onto the
 * report, and export re-verifies report.templateHash === template.hash
 * (export.service.ts:274), so any fixed value round-trips.
 */
const REAL_DRILL_PIPE_TEMPLATE_PATH = resolve(
  __dirname,
  '../scripts/valid-template.xlsx',
);

export function seedRealDrillPipeTemplate(
  prisma: PrismaService,
  tenantId: string,
  opts?: { definitionJson?: unknown | null },
) {
  const fileBlob = readFileSync(REAL_DRILL_PIPE_TEMPLATE_PATH);
  return prisma.template.create({
    data: {
      tenantId,
      templateKey: 'DRILL_PIPE_REPORT',
      templateVersion: 1,
      status: 'ACTIVE',
      fileBlob,
      hash: 'hash-DRILL_PIPE_REPORT',
      changeNote: 'seed-real-xlsx',
      createdById: 'seed-user',
      definitionJson: resolveSeedDefinition('DRILL_PIPE_REPORT', opts) as never,
    },
  });
}

/**
 * Mirror of DRILL_PIPE_REQUIRED_KEYS in
 * api/src/app/workflow/inspection-report-workflow.service.ts (that const is not
 * exported). These are the inspectionData keys the IN_INSPECTION → PENDING_APPROVAL
 * gate requires present (non-null / non-empty) for a DRILL_PIPE_REPORT serial.
 * Kept deliberately in sync: if the service's required-key list changes, this must
 * follow, or the approval gate can no longer be crossed by seedApprovableSerial.
 */
const DRILL_PIPE_REQUIRED_KEYS = [
  'box.minTongSpace',
  'box.minOD',
  'box.minBoxThreads',
  'box.minEccShoulder',
  'box.maxCounterBoreDiameter',
  'box.maxCounterBoreLength',
  'box.bevelDiameterMin',
  'box.bevelDiameterMax',
  'box.condition',
  'pin.minTongSpace',
  'pin.minOD',
  'pin.maxID',
  'pin.minEccShoulder',
  'pin.lengthPinConnMin',
  'pin.lengthPinConnMax',
  'pin.maxLengthPinBase',
  'pin.bevelDiameterMin',
  'pin.bevelDiameterMax',
  'pin.condition',
  'box.hardBanding',
  'body.wallRemaining',
  'body.odDecrease',
  'body.emiResult',
  'body.slipArea',
  'body.corrosionIn',
  'body.corrosionOut',
  'body.ipc',
  'body.bentJoints',
  'final.isNew',
  'final.isPremium',
  'final.isC2',
  'final.isScrap',
];

/**
 * Seed one SerialNumber whose inspectionData satisfies the PENDING_APPROVAL gate
 * for a DRILL_PIPE_REPORT: every required key populated with a non-empty value,
 * plus a disposition (the gate reads inspectionData.final.disposition, NOT the
 * SerialDisposition column). This is exactly what lets a report cross
 * IN_INSPECTION → PENDING_APPROVAL so the approval snapshot can be exercised.
 */
export function seedApprovableSerial(
  prisma: PrismaService,
  tenantId: string,
  inspectionReportId: string,
  serial = 'SN-001',
  opts: {
    // final.disposition — export sorts REWORK serials last (export.service.ts:296).
    disposition?: string;
    // Override box.minOD so the export spec can assert a distinctive {{b_od}} value.
    boxMinOD?: unknown;
    // When false, all four final.* jacket-condition flags are 0 so {{jc_*}} render
    // as '' instead of 'X' (still gate-passing: the keys are present, just falsy).
    finalFlags?: boolean;
    // Override the serial's approvalStatus (defaults to the column default
    // NOT_INSPECTED). Lets the edit-guard spec park a serial in a specific
    // approval state; existing callers omit it and are unaffected.
    approvalStatus?: SerialApprovalStatus;
  } = {},
) {
  const inspectionData: Record<string, Record<string, unknown>> = {};
  for (const key of DRILL_PIPE_REQUIRED_KEYS) {
    const [group, field] = key.split('.');
    inspectionData[group] ??= {};
    inspectionData[group][field] = 1; // truthy, non-empty → passes the gate
  }
  // Gate: disposition = inspectionData.final?.disposition || inspectionData.disposition
  inspectionData.final.disposition = opts.disposition ?? 'ACCEPT';
  if (opts.boxMinOD !== undefined) {
    inspectionData.box.minOD = opts.boxMinOD;
  }
  if (opts.finalFlags === false) {
    inspectionData.final.isNew = 0;
    inspectionData.final.isPremium = 0;
    inspectionData.final.isC2 = 0;
    inspectionData.final.isScrap = 0;
  }

  return prisma.serialNumber.create({
    data: {
      tenantId,
      inspectionReportId,
      serial,
      inspectionData: inspectionData as never,
      approvalStatus: opts.approvalStatus,
    },
  });
}

/**
 * Seed a bare ChildReport under an inspection report. A ChildReport carries its own
 * status/type/version and a unique (tenantId, inspectionReportId, type) constraint, so
 * a report holds at most one child per type. The updateChildReportSerialNumber path
 * (Block 3b characterization) does not gate on the child's status, so this defaults to
 * a DRAFT REWORK child at version 1. FK-safe extension added for the child-reports
 * spec; no existing caller is affected.
 */
export function seedChildReport(
  prisma: PrismaService,
  tenantId: string,
  inspectionReportId: string,
  opts: {
    status?: ChildReportStatus;
    type?: ChildReportType;
    version?: number;
  } = {},
) {
  return prisma.childReport.create({
    data: {
      tenantId,
      inspectionReportId,
      type: opts.type ?? ChildReportType.REWORK,
      status: opts.status ?? ChildReportStatus.DRAFT,
      version: opts.version ?? 1,
    },
  });
}

/**
 * Seed one ChildReportSerialNumber join row — the exact entity
 * updateChildReportSerialNumber mutates. This table has NO version column and owns its
 * own inspectionData / disposition / approvalStatus, independent of the underlying
 * SerialNumber. Defaults leave inspectionData null and approvalStatus at the column
 * default NOT_INSPECTED, so a spec can drive the NOT_INSPECTED -> INSPECTED_DRAFT
 * auto-transition. FK-safe extension added for Block 3b.
 */
export function seedChildReportSerial(
  prisma: PrismaService,
  childReportId: string,
  serialNumberId: string,
  opts: {
    approvalStatus?: SerialApprovalStatus;
    disposition?: SerialDisposition;
    inspectionData?: Record<string, unknown>;
  } = {},
) {
  return prisma.childReportSerialNumber.create({
    data: {
      childReportId,
      serialNumberId,
      approvalStatus: opts.approvalStatus,
      disposition: opts.disposition,
      inspectionData: opts.inspectionData as never,
    },
  });
}
