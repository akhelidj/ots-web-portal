/**
 * Characterization — serial-numbers edit-forbidden guard (Block 3a, HIGHEST STAKES).
 * Runs under the `test-integration` target against the dedicated test Postgres.
 * Real PrismaService, real rows in real approval/report states.
 *
 * WHY THIS EXISTS: SerialNumbersService.updateSerialNumber gates edits with an
 * authorization guard keyed on the serial's `approvalStatus`, read today through
 * six `(serialToUpdate as any).approvalStatus` casts. `approvalStatus` is in fact a
 * typed enum column (SerialApprovalStatus: NOT_INSPECTED | INSPECTED_DRAFT |
 * SUBMITTED_FOR_APPROVAL | APPROVED), so Block 3d will drop those casts. This spec
 * pins the exact allowed/forbidden boundary FIRST, so any shift in when the guard
 * fires — i.e. who may edit an in-flight/approved serial — breaks a test.
 *
 * The guard has TWO locks, checked in order:
 *   Lock 1 (report status): inspectionReport.status in {APPROVED, CLOSED}
 *           -> BadRequestException 'Inspection data is locked by report status.'
 *   Lock 2 (serial approvalStatus): approvalStatus in {SUBMITTED_FOR_APPROVAL,
 *           APPROVED} -> BadRequestException
 *           'Cannot edit serial numbers that are <approvalStatus>'
 * Allowed: approvalStatus in {NOT_INSPECTED, INSPECTED_DRAFT} AND report not
 *   APPROVED/CLOSED. The boundary sits between INSPECTED_DRAFT (editable) and
 *   SUBMITTED_FOR_APPROVAL (forbidden).
 *
 * BASELINE assertions of intended authorization behavior — no flip tag, NOT in
 * docs/internal/sync-risks.md. This is a deliberate control, not a bug.
 */
import { BadRequestException } from '@nestjs/common';
import {
  InspectionReportStatus,
  SerialApprovalStatus,
  SerialDisposition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SerialNumbersService } from './serial-numbers.service';
import {
  resetInspectionDomain,
  seedTenant,
  seedInspectionReport,
  seedApprovableSerial,
} from '../../../test/seed-helpers';

describe('SerialNumbersService.updateSerialNumber edit-guard [integration]', () => {
  let prisma: PrismaService;
  let service: SerialNumbersService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new SerialNumbersService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  // Seed a tenant + a report in `reportStatus` + one serial in `approvalStatus`.
  async function seedGuardCase(
    reportStatus: InspectionReportStatus,
    approvalStatus: SerialApprovalStatus,
  ) {
    const tenant = await seedTenant(prisma);
    const report = await seedInspectionReport(prisma, tenant.id, {
      status: reportStatus,
    });
    const serial = await seedApprovableSerial(
      prisma,
      tenant.id,
      report.id,
      'SN-001',
      { approvalStatus },
    );
    return { tenant, report, serial };
  }

  describe('ALLOWED — editable approval states (report not APPROVED/CLOSED)', () => {
    it('permits editing a NOT_INSPECTED serial: rename persists and bumps version', async () => {
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      const result = await service.updateSerialNumber(
        tenant.id,
        serial.id,
        'user-1',
        { serialNumber: 'SN-RENAMED' },
        serial.version,
      );

      expect(result.serialNumber).toBe('SN-RENAMED');
      expect(result.version).toBe(2);

      const row = await prisma.serialNumber.findUnique({
        where: { id: serial.id },
      });
      expect(row?.serial).toBe('SN-RENAMED');
      expect(row?.version).toBe(2);
    });

    it('permits editing an INSPECTED_DRAFT serial — the state immediately below the forbidden boundary', async () => {
      // BOUNDARY: INSPECTED_DRAFT must stay editable. This is the allowed side of
      // the exact line 3d must not move.
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.INSPECTED_DRAFT,
      );

      const result = await service.updateSerialNumber(
        tenant.id,
        serial.id,
        'user-1',
        { serialNumber: 'SN-DRAFT-EDIT' },
        serial.version,
      );

      expect(result.serialNumber).toBe('SN-DRAFT-EDIT');
      expect(result.version).toBe(2);
    });

    it('auto-transitions NOT_INSPECTED -> INSPECTED_DRAFT when inspection data is supplied', async () => {
      // Keyed on the approvalStatus cast (line 267): an allowed edit that supplies
      // inspectionData promotes NOT_INSPECTED to INSPECTED_DRAFT. inspectionData is
      // deliberately body-less so the emiResult->disposition sync is not triggered.
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      const result = await service.updateSerialNumber(
        tenant.id,
        serial.id,
        'user-1',
        { inspectionData: { note: 'edited offline' } },
        serial.version,
      );

      expect(result.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);

      const row = await prisma.serialNumber.findUnique({
        where: { id: serial.id },
      });
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);
      expect(row?.version).toBe(2);
    });
  });

  describe('FORBIDDEN by serial approvalStatus — Lock 2 (the cast-gated authorization control)', () => {
    it('blocks editing a SUBMITTED_FOR_APPROVAL serial and writes nothing', async () => {
      // BOUNDARY: the forbidden side, immediately above INSPECTED_DRAFT.
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toThrow(
        /Cannot edit serial numbers that are SUBMITTED_FOR_APPROVAL/,
      );
      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Guard fires before the write: row is untouched.
      const row = await prisma.serialNumber.findUnique({
        where: { id: serial.id },
      });
      expect(row?.serial).toBe('SN-001');
      expect(row?.version).toBe(1);
    });

    it('blocks editing an APPROVED serial', async () => {
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.APPROVED,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toThrow(/Cannot edit serial numbers that are APPROVED/);
    });
  });

  describe('FORBIDDEN by report status — Lock 1 (checked before Lock 2)', () => {
    it('blocks editing when the parent report is APPROVED (even if the serial itself is editable-state)', async () => {
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.APPROVED,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toThrow(/Inspection data is locked by report status/);
    });

    it('blocks editing when the parent report is CLOSED', async () => {
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.CLOSED,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toThrow(/Inspection data is locked by report status/);
    });

    it('report lock takes precedence over the serial lock — an APPROVED report + SUBMITTED_FOR_APPROVAL serial reports the report-status message', async () => {
      // Pins the ordering: Lock 1 (report) is evaluated first, so its message wins
      // even though Lock 2 would also block.
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.APPROVED,
        SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { serialNumber: 'SHOULD-NOT-APPLY' },
          serial.version,
        ),
      ).rejects.toThrow(/Inspection data is locked by report status/);
    });
  });

  describe('parent REWORK-via-emiResult is SANCTIONED (class-C baseline — feeds syncReworkChildReport)', () => {
    it('accepts a parent serial whose body.emiResult is REWORK and writes disposition=REWORK', async () => {
      // BASELINE — no flip tag. Unlike the child path (which rejects REWORK), a PARENT
      // serial marked REWORK via emiResult is the sanctioned trigger ChildReportsService
      // .syncReworkChildReport keys on (it filters serials by body.emiResult === REWORK).
      // The 3d-ii membership check must therefore let REWORK pass through here. This pins
      // that acceptance so the membership change can never silently start rejecting it.
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      await service.updateSerialNumber(
        tenant.id,
        serial.id,
        'user-1',
        { inspectionData: { body: { emiResult: 'REWORK' } } },
        serial.version,
      );

      // Assert on the persisted row (updateSerialNumber's return type is a union whose
      // no-op branch omits `disposition`; the row is the authoritative check anyway).
      const row = await prisma.serialNumber.findUnique({
        where: { id: serial.id },
      });
      expect(row?.disposition).toBe(SerialDisposition.REWORK);
    });

    it('rejects a parent serial whose body.emiResult is not a valid disposition with BadRequestException', async () => {
      // BASELINE for the membership check's invalid branch on the parent path: an invalid
      // emiResult is rejected in-service (was a Prisma query-time error before 3d-ii).
      const { tenant, serial } = await seedGuardCase(
        InspectionReportStatus.IN_INSPECTION,
        SerialApprovalStatus.NOT_INSPECTED,
      );

      await expect(
        service.updateSerialNumber(
          tenant.id,
          serial.id,
          'user-1',
          { inspectionData: { body: { emiResult: 'NONSENSE' } } },
          serial.version,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const row = await prisma.serialNumber.findUnique({
        where: { id: serial.id },
      });
      expect(row?.disposition).toBeNull();
    });
  });
});
