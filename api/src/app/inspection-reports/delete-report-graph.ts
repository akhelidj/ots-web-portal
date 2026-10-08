import { Prisma } from '@prisma/client';

/**
 * Delete reports and everything hanging off them, children first. Audit-log rows are
 * kept (their report link is nulled) so the history of what happened survives the delete.
 *
 * Shared by the admin template delete (cascade over every report of a version) and the
 * admin single-report delete. Rows only: callers remove the attachment binaries from
 * storage after the transaction commits.
 */
export async function deleteReportGraph(
  tx: Prisma.TransactionClient,
  reportIds: string[],
): Promise<void> {
  const inReports = { inspectionReportId: { in: reportIds } };
  const [children, batches, serials] = await Promise.all([
    tx.childReport.findMany({ where: inReports, select: { id: true } }),
    tx.inspectionApprovalBatch.findMany({
      where: inReports,
      select: { id: true },
    }),
    tx.serialNumber.findMany({ where: inReports, select: { id: true } }),
  ]);
  const childIds = children.map((c) => c.id);
  const batchIds = batches.map((b) => b.id);
  const serialIds = serials.map((s) => s.id);

  await tx.inspectionApprovalBatchSerialNumber.deleteMany({
    where: {
      OR: [
        { inspectionApprovalBatchId: { in: batchIds } },
        { serialNumberId: { in: serialIds } },
      ],
    },
  });
  await tx.inspectionApprovalBatch.deleteMany({
    where: { OR: [inReports, { childReportId: { in: childIds } }] },
  });
  await tx.childReportSerialNumber.deleteMany({
    where: {
      OR: [
        { childReportId: { in: childIds } },
        { serialNumberId: { in: serialIds } },
      ],
    },
  });
  await tx.childReportRevision.deleteMany({
    where: { childReportId: { in: childIds } },
  });
  await tx.childReportTransitionLog.deleteMany({
    where: { childReportId: { in: childIds } },
  });
  await tx.childReport.deleteMany({ where: inReports });
  await tx.serialNumber.deleteMany({ where: inReports });
  await tx.inspectionReportRevision.deleteMany({ where: inReports });
  await tx.inspectionReportTransitionLog.deleteMany({ where: inReports });
  await tx.attachment.deleteMany({ where: inReports });
  await tx.reportSignature.deleteMany({ where: inReports });
  await tx.auditLog.updateMany({
    where: inReports,
    data: { inspectionReportId: null },
  });
  await tx.inspectionReport.deleteMany({ where: { id: { in: reportIds } } });
}
