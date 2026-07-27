/**
 * Shared seed helpers for API integration specs (run against the ots_test DB).
 *
 * Factored out of the create-path spec so the create-path, workflow, and upcoming
 * revision-engine specs all agree on valid Tenant/Customer/Template row shapes
 * (e.g. Template requires fileBlob/hash/changeNote/createdById). Per-spec table
 * RESET is intentionally kept inline in each spec, since which tables a spec must
 * clear differs by spec — only the seeding is shared here.
 */
import { PrismaService } from '../src/app/prisma/prisma.service';

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
) {
  const inspectionData: Record<string, Record<string, unknown>> = {};
  for (const key of DRILL_PIPE_REQUIRED_KEYS) {
    const [group, field] = key.split('.');
    inspectionData[group] ??= {};
    inspectionData[group][field] = 1; // truthy, non-empty → passes the gate
  }
  // Gate: disposition = inspectionData.final?.disposition || inspectionData.disposition
  inspectionData.final.disposition = 'ACCEPT';

  return prisma.serialNumber.create({
    data: {
      tenantId,
      inspectionReportId,
      serial,
      inspectionData: inspectionData as never,
    },
  });
}
