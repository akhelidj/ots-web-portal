/**
 * FROZEN IMPERATIVE ORACLE for the REWORK equivalence proof.
 *
 * A standalone, verbatim behavioral copy of ChildReportsService.syncReworkChildReport's
 * imperative body AS IT STOOD before retirement (child-reports.service.ts: the report read
 * + the three reconciliation arms + the interactive txn with the unconditional version bump
 * + the final re-read and response mapping). Frozen here so the equivalence harness keeps a
 * fixed, independent reference after the live imperative body is deleted and the service's
 * NULL arm becomes a 412 precondition.
 *
 * INDEPENDENCE (why this is not `import`ed from the service or interpreter): it carries its
 * OWN inline mapChildReportResponse (below) and shares NO code with either live path. If it
 * reused the service's or interpreter's mapper, a divergence in that shared code could never
 * be caught — the proof would be vacuous. This is a deliberate, fixed duplicate.
 *
 * DB-MUTATING (not pure): it replays the exact reads/writes so that a DB snapshot taken after
 * running it is byte-identical to one taken after the live method — that identity is what the
 * proof asserts. Do NOT "simplify" or refactor toward the live code; its whole value is being
 * a fixed, independent reference implementation.
 *
 * SCOPE: this reproduces the imperative (NULL-definition) path ONLY. It intentionally does NOT
 * read the Template gate — the gate's job (imperative vs interpreter routing) is not part of
 * the behavior under proof; the oracle IS the imperative behavior.
 */
import { NotFoundException } from '@nestjs/common';
import {
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../src/app/prisma/prisma.service';
import { InspectionData } from '../src/app/common/inspection-data.types';

/** Inline, independent copy of ChildReportsService.mapChildReportResponse (shares no code). */
function mapOracleChildReportResponse(
  cr: Prisma.ChildReportGetPayload<{
    include: {
      serialNumbers: { include: { serialNumber: true } };
    };
  }> | null,
) {
  if (!cr) return cr;
  return {
    ...cr,
    serialNumbers: cr.serialNumbers
      ? cr.serialNumbers.map((sn) => ({
          id: sn.serialNumberId,
          serial: sn.serialNumber?.serial || '',
          inspectionData: sn.inspectionData as InspectionData | null,
          disposition: sn.disposition,
          approvalStatus: sn.approvalStatus,
        }))
      : [],
  };
}

export async function imperativeReworkOracle(
  prisma: PrismaService,
  tenantId: string,
  inspectionReportId: string,
) {
  const report = await prisma.inspectionReport.findFirst({
    where: { id: inspectionReportId, tenantId },
    include: {
      serialNumbers: true,
      childReports: {
        where: { type: ChildReportType.REWORK },
      },
    },
  });

  if (!report) {
    throw new NotFoundException('Inspection Report not found');
  }

  const reworkSerials = report.serialNumbers.filter((sn) => {
    const data = (sn.inspectionData as InspectionData) || {};
    const disposition = data.body?.emiResult;
    return disposition === SerialDisposition.REWORK;
  });

  const existingChild = report.childReports[0];

  if (reworkSerials.length === 0) {
    if (existingChild) {
      if (existingChild.status === ChildReportStatus.DRAFT) {
        await prisma.$transaction([
          prisma.childReportSerialNumber.deleteMany({
            where: { childReportId: existingChild.id },
          }),
          prisma.childReport.delete({ where: { id: existingChild.id } }),
        ]);
        return null;
      } else {
        const [, updated] = await prisma.$transaction([
          prisma.childReportSerialNumber.deleteMany({
            where: { childReportId: existingChild.id },
          }),
          prisma.childReport.update({
            where: { id: existingChild.id },
            data: { version: { increment: 1 } },
            include: {
              serialNumbers: {
                include: { serialNumber: true },
              },
            },
          }),
        ]);
        return mapOracleChildReportResponse(updated);
      }
    }
    return null;
  }

  let crId: string;
  if (existingChild) {
    crId = existingChild.id;
  } else {
    let generatedChildReportNumber: string | undefined = undefined;
    if (report.reportNumber) {
      generatedChildReportNumber = `${report.reportNumber}_rework`;
    }
    const newCr = await prisma.childReport.create({
      data: {
        tenantId,
        inspectionReportId,
        reportNumber: generatedChildReportNumber,
        type: ChildReportType.REWORK,
        status: ChildReportStatus.DRAFT,
        version: 1,
      },
    });
    crId = newCr.id;
  }

  await prisma.$transaction(async (tx) => {
    // Load existing rows so we can preserve their inspectionData and disposition
    const existingRows = await tx.childReportSerialNumber.findMany({
      where: { childReportId: crId },
    });
    const existingMap = new Map(
      existingRows.map((r) => [r.serialNumberId, r]),
    );

    const reworkSnIds = new Set(reworkSerials.map((sn) => sn.id));

    // Delete rows whose serial is no longer REWORK
    const toDelete = existingRows.filter(
      (r) => !reworkSnIds.has(r.serialNumberId),
    );
    if (toDelete.length > 0) {
      await tx.childReportSerialNumber.deleteMany({
        where: { id: { in: toDelete.map((r) => r.id) } },
      });
    }

    // Create only rows that don't already exist (new additions to REWORK set)
    const toCreate = reworkSerials.filter((sn) => !existingMap.has(sn.id));
    if (toCreate.length > 0) {
      await tx.childReportSerialNumber.createMany({
        data: toCreate.map((sn) => ({
          childReportId: crId,
          serialNumberId: sn.id,
          // inspectionData and disposition intentionally omitted — start blank for new serials
        })),
      });
    }

    if (existingChild) {
      await tx.childReport.update({
        where: { id: crId },
        data: { version: { increment: 1 } },
      });
    }
  });

  const result = await prisma.childReport.findUnique({
    where: { id: crId },
    include: {
      serialNumbers: {
        include: { serialNumber: true },
      },
    },
  });
  return mapOracleChildReportResponse(result);
}
