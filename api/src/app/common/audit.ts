import { Prisma } from '@prisma/client';

/** Anything that can write an AuditLog row: the PrismaService or a transaction client. */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

/**
 * The single place an audit row is written. Always pass the transaction client when the
 * audited change happens inside a transaction, so the row commits (or rolls back) with it.
 */
export function recordAudit(
  db: AuditClient,
  entry: Prisma.AuditLogUncheckedCreateInput,
) {
  return db.auditLog.create({ data: entry });
}
