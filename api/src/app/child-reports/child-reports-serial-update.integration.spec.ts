/**
 * Integration test — ChildReportsService.updateChildReportSerialNumber.
 * Runs under the `test-integration` target against the dedicated test Postgres.
 * Real PrismaService, real ChildReport / ChildReportSerialNumber rows.
 *
 * WHY THIS EXISTS: updateChildReportSerialNumber writes a child-serial join row via
 * two paths worth pinning:
 *
 *   inspectionData (:286) — the payload JSON is written to the `inspectionData Json?`
 *     column via Prisma's InputJsonValue (stricter than Record<string, unknown>). The
 *     value flowing through is always a valid JSON object, so it is pinned only
 *     incidentally (every write carries it).
 *
 *   disposition (:296) — `disp = inspectionData.body.emiResult` is a RAW STRING lifted
 *     out of the JSON blob and resolved into the `disposition SerialDisposition?` enum
 *     column via a runtime membership check. This is the load-bearing path (see the
 *     REWORK guard and invalid-value rejection below).
 *
 * The write path also branches on real persisted state (`crsn.approvalStatus` drives a
 * NOT_INSPECTED -> INSPECTED_DRAFT auto-transition; tenant ownership is re-checked
 * against the loaded row), which is why this is an INTEGRATION spec: the branches read
 * rows, not just inputs. The only pure-input branch — the REWORK payload guard — fires
 * before any DB read and is exercised here too.
 *
 * Two assertions pin behavior that closed real gaps (REWORK asymmetry — see
 * docs/adr/0007-rework-asymmetry.md):
 *   - the 'REWORK'-via-emiResult bypass is now rejected (child guard-gap closed);
 *   - an invalid emiResult is now rejected up-front with BadRequestException in-service
 *     (previously an opaque Prisma query-time error).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SerialApprovalStatus, SerialDisposition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChildReportsService } from './child-reports.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';
import {
  resetInspectionDomain,
  seedTenant,
  seedActiveTemplate,
  seedInspectionReport,
  seedApprovableSerial,
  seedChildReport,
  seedChildReportSerial,
} from '../../../test/seed-helpers';

describe('ChildReportsService.updateChildReportSerialNumber [integration]', () => {
  let prisma: PrismaService;
  let service: ChildReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new ChildReportsService(
      prisma,
      new ReworkRulesInterpreter(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  // Seed tenant -> report -> serial -> REWORK child report -> crsn join row, and hand
  // back the ids updateChildReportSerialNumber addresses (childReportId, serialNumberId).
  async function seedCrsnCase(
    opts: {
      approvalStatus?: SerialApprovalStatus;
      disposition?: SerialDisposition;
      inspectionData?: Record<string, unknown>;
      serial?: string;
    } = {},
  ) {
    const tenant = await seedTenant(prisma);
    // updateChildReportSerialNumber now resolves disposition through the PARENT report's
    // template definition (declared source body.emiResult), so the template row must
    // exist as it does in production.
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
    const report = await seedInspectionReport(prisma, tenant.id);
    const serial = await seedApprovableSerial(
      prisma,
      tenant.id,
      report.id,
      opts.serial ?? 'SN-CR-1',
    );
    const child = await seedChildReport(prisma, tenant.id, report.id);
    await seedChildReportSerial(prisma, child.id, serial.id, {
      approvalStatus: opts.approvalStatus,
      disposition: opts.disposition,
      inspectionData: opts.inspectionData,
    });
    return { tenant, report, serial, child };
  }

  // The mapped response re-reads the WHOLE child report; pick out the one serial row.
  function crsnOf(
    result: Awaited<
      ReturnType<ChildReportsService['updateChildReportSerialNumber']>
    >,
    serialNumberId: string,
  ) {
    return result?.serialNumbers?.find((s) => s.id === serialNumberId);
  }

  function readCrsn(childReportId: string, serialNumberId: string) {
    return prisma.childReportSerialNumber.findUnique({
      where: {
        childReportId_serialNumberId: { childReportId, serialNumberId },
      },
    });
  }

  describe('successful update — inspectionData persist + auto-transition', () => {
    it('persists inspectionData, syncs disposition from body.emiResult, and promotes NOT_INSPECTED -> INSPECTED_DRAFT', async () => {
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.NOT_INSPECTED,
      });
      const inspectionData = { body: { emiResult: 'PASS' }, note: 'edited' };

      const result = await service.updateChildReportSerialNumber(
        tenant.id,
        child.id,
        serial.id,
        { inspectionData },
      );

      // Mapped response reflects the write.
      const mapped = crsnOf(result, serial.id);
      expect(mapped?.inspectionData).toEqual(inspectionData);
      expect(mapped?.disposition).toBe(SerialDisposition.PASS);
      expect(mapped?.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);

      // Persisted row agrees.
      const row = await readCrsn(child.id, serial.id);
      expect(row?.inspectionData).toEqual(inspectionData);
      expect(row?.disposition).toBe(SerialDisposition.PASS);
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);

      // This path does NOT bump the parent child report's version.
      const parent = await prisma.childReport.findUnique({
        where: { id: child.id },
      });
      expect(parent?.version).toBe(1);
    });

    it.each([
      SerialDisposition.PASS,
      SerialDisposition.SCRAP,
      SerialDisposition.HOLD,
    ])(
      'writes the disposition column from a valid body.emiResult of %s',
      async (value) => {
        const { tenant, serial, child } = await seedCrsnCase();

        await service.updateChildReportSerialNumber(
          tenant.id,
          child.id,
          serial.id,
          { inspectionData: { body: { emiResult: value } } },
        );

        const row = await readCrsn(child.id, serial.id);
        expect(row?.disposition).toBe(value);
      },
    );
  });

  describe('the emiResult -> disposition guard (child path rejects REWORK)', () => {
    it("a body.emiResult of 'REWORK' is REJECTED — the child guard-gap is closed", async () => {
      // See docs/adr/0007-rework-asymmetry.md. Previously the top-level guard only
      // inspected payload.disposition, so REWORK smuggled through
      // inspectionData.body.emiResult bypassed it and was written to the column. The
      // membership check now resolves the emiResult-derived value and re-applies the
      // same REWORK rejection.
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.NOT_INSPECTED,
      });

      await expect(
        service.updateChildReportSerialNumber(tenant.id, child.id, serial.id, {
          inspectionData: { body: { emiResult: 'REWORK' } },
        }),
      ).rejects.toThrow(/disposition cannot be REWORK/);

      // Rejected before the write: nothing persisted.
      const row = await readCrsn(child.id, serial.id);
      expect(row?.disposition).toBeNull();
      expect(row?.inspectionData).toBeNull();
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.NOT_INSPECTED);
    });

    it('an invalid body.emiResult is rejected up-front with BadRequestException, persisting nothing', async () => {
      // An untyped write once let an arbitrary string reach the enum column, where
      // Prisma rejected it at query time (opaque, server-attributed). The membership
      // check now detects the invalid value in-service and throws BadRequestException
      // before any write. Outcome is still "rejected + nothing persisted", now honest
      // and client-attributable.
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.NOT_INSPECTED,
      });

      await expect(
        service.updateChildReportSerialNumber(tenant.id, child.id, serial.id, {
          inspectionData: { body: { emiResult: 'NONSENSE' } },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // The failing update is atomic: neither disposition, inspectionData, nor the
      // approvalStatus auto-transition was committed.
      const row = await readCrsn(child.id, serial.id);
      expect(row?.disposition).toBeNull();
      expect(row?.inspectionData).toBeNull();
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.NOT_INSPECTED);
    });
  });

  describe('payload.disposition is inert except for the REWORK guard', () => {
    it('a non-REWORK payload.disposition with no inspectionData writes nothing — only body.emiResult drives the column', async () => {
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.NOT_INSPECTED,
      });

      await service.updateChildReportSerialNumber(
        tenant.id,
        child.id,
        serial.id,
        { disposition: SerialDisposition.PASS },
      );

      const row = await readCrsn(child.id, serial.id);
      // payload.disposition never reaches the column; the disposition sync is gated on
      // payload.inspectionData, which is absent here.
      expect(row?.disposition).toBeNull();
      // No inspectionData => no auto-transition either.
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.NOT_INSPECTED);
      expect(row?.inspectionData).toBeNull();
    });

    it('inspectionData without a body.emiResult leaves disposition null but still auto-transitions', async () => {
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.NOT_INSPECTED,
      });

      await service.updateChildReportSerialNumber(
        tenant.id,
        child.id,
        serial.id,
        { inspectionData: { foo: 'bar' } },
      );

      const row = await readCrsn(child.id, serial.id);
      expect(row?.disposition).toBeNull();
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);
      expect(row?.inspectionData).toEqual({ foo: 'bar' });
    });
  });

  describe('auto-transition is one-directional and there is NO approval edit-guard', () => {
    it('an INSPECTED_DRAFT crsn stays INSPECTED_DRAFT (the promotion only fires from NOT_INSPECTED)', async () => {
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT,
      });

      await service.updateChildReportSerialNumber(
        tenant.id,
        child.id,
        serial.id,
        { inspectionData: { body: { emiResult: 'PASS' } } },
      );

      const row = await readCrsn(child.id, serial.id);
      expect(row?.approvalStatus).toBe(SerialApprovalStatus.INSPECTED_DRAFT);
      expect(row?.disposition).toBe(SerialDisposition.PASS);
    });

    it('a SUBMITTED_FOR_APPROVAL crsn is still editable — unlike serial-numbers, this path has no Lock-2 approval guard', async () => {
      const { tenant, serial, child } = await seedCrsnCase({
        approvalStatus: SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
      });

      await service.updateChildReportSerialNumber(
        tenant.id,
        child.id,
        serial.id,
        { inspectionData: { body: { emiResult: 'SCRAP' } } },
      );

      const row = await readCrsn(child.id, serial.id);
      // The edit goes through; approvalStatus is not NOT_INSPECTED so it is untouched.
      expect(row?.approvalStatus).toBe(
        SerialApprovalStatus.SUBMITTED_FOR_APPROVAL,
      );
      expect(row?.disposition).toBe(SerialDisposition.SCRAP);
    });
  });

  describe('rejection paths', () => {
    it('rejects a payload.disposition of REWORK with BadRequestException BEFORE any DB lookup', async () => {
      // Pure-input branch: fires on payload alone, so nonexistent ids still reject here
      // rather than surfacing NotFound.
      await expect(
        service.updateChildReportSerialNumber(
          'no-such-tenant',
          'no-such-child',
          'no-such-serial',
          { disposition: SerialDisposition.REWORK },
        ),
      ).rejects.toThrow(/disposition cannot be REWORK/);

      await expect(
        service.updateChildReportSerialNumber(
          'no-such-tenant',
          'no-such-child',
          'no-such-serial',
          { disposition: SerialDisposition.REWORK },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the crsn relation does not exist', async () => {
      const tenant = await seedTenant(prisma);

      await expect(
        service.updateChildReportSerialNumber(
          tenant.id,
          'no-such-child',
          'no-such-serial',
          { inspectionData: { body: { emiResult: 'PASS' } } },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the crsn belongs to another tenant (tenant isolation)', async () => {
      const { serial, child } = await seedCrsnCase();
      const otherTenant = await seedTenant(prisma, 'other tenant');

      await expect(
        service.updateChildReportSerialNumber(
          otherTenant.id,
          child.id,
          serial.id,
          { inspectionData: { body: { emiResult: 'PASS' } } },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The real owner's row is untouched.
      const row = await readCrsn(child.id, serial.id);
      expect(row?.disposition).toBeNull();
    });
  });
});
