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

export function seedActiveTemplate(
  prisma: PrismaService,
  tenantId: string,
  templateKey: string,
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
    },
  });
}
