import { Prisma } from '@prisma/client';
import { INSPECTOR_SIGNATURE_SLOT } from './signature-slots';

/** Re-exported: callers historically import the slot name from here. */
export { INSPECTOR_SIGNATURE_SLOT };

/** A signature pointer frozen onto a report (see `ReportSignature`). */
export interface FrozenSignature {
  storageKey: string;
  hash: string;
  signedById: string;
  signedAt: Date;
}

/**
 * Freeze a pointer to `userId`'s CURRENT signature onto a report for `slot`. Copies the
 * object key + hash, never the file: signature objects are immutable, so the pointer
 * keeps resolving to the exact bytes in force at this moment even after the user
 * registers a new signature.
 *
 * Returns `null` and writes nothing when the user has no signature — the caller decides
 * whether that matters. Takes the caller's transaction client so the freeze commits
 * atomically with the transition that triggered it, and needs no injected service.
 */
export async function freezeSignatureForReport(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    inspectionReportId: string;
    slot: string;
    userId: string;
    /** The report's revision at this moment — only per-field slots read it back. */
    revisionNumber?: number;
  },
): Promise<FrozenSignature | null> {
  const current = await tx.userSignature.findUnique({
    where: { userId: args.userId },
  });
  if (!current) {
    return null;
  }
  const row = await tx.reportSignature.create({
    data: {
      tenantId: args.tenantId,
      inspectionReportId: args.inspectionReportId,
      slot: args.slot,
      signedById: args.userId,
      storageKey: current.storageKey,
      hash: current.hash,
      revisionNumber: args.revisionNumber ?? 0,
    },
  });
  return {
    storageKey: row.storageKey,
    hash: row.hash,
    signedById: row.signedById,
    signedAt: row.signedAt,
  };
}
