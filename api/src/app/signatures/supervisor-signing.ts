import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { freezeSignatureForReport } from './freeze-signature';
import {
  SignatureDefinitionView,
  SignatureFieldSpec,
  signatureFieldsOf,
} from './signature-fields';

/**
 * Approval-time handling of SUPERVISOR-signed template fields. A supervisor never draws
 * per report: approving applies their ACCOUNT signature to every such field. Shared by both
 * paths that can flip a report to APPROVED (the direct transition and the batch auto-approve)
 * so they cannot drift.
 */

type ApprovalDb = Pick<Prisma.TransactionClient, 'template' | 'userSignature'>;

/** The SUPERVISOR-signer signature fields of the report's pinned template (none if legacy). */
export async function supervisorSignatureFields(
  db: Pick<Prisma.TransactionClient, 'template'>,
  report: { tenantId: string; templateKey: string; templateVersion: number },
): Promise<SignatureFieldSpec[]> {
  const template = await db.template.findUnique({
    where: {
      tenantId_templateKey_templateVersion: {
        tenantId: report.tenantId,
        templateKey: report.templateKey,
        templateVersion: report.templateVersion,
      },
    },
    select: { definitionJson: true },
  });
  return signatureFieldsOf(
    template?.definitionJson as SignatureDefinitionView | null,
  ).filter((f) => f.signer === 'SUPERVISOR');
}

/**
 * Refuse an approval that cannot be exported: a `required` SUPERVISOR field with no account
 * signature to apply would strand the report APPROVED. A non-required field just stays blank.
 */
export async function assertApproverCanSign(
  db: ApprovalDb,
  fields: SignatureFieldSpec[],
  userId: string,
): Promise<void> {
  if (!fields.some((f) => f.required)) return;
  if ((await db.userSignature.count({ where: { userId } })) > 0) return;
  throw new ForbiddenException({
    code: 'SIGNATURE_REQUIRED',
    message:
      'This report needs your signature. Register it in Settings before approving.',
  });
}

/**
 * Apply the approver's account signature to each SUPERVISOR field, tagged with the report's
 * revision AS IT NOW STANDS (a snapshot in the same transaction may just have bumped it).
 * A reopen bumps the revision, so a re-approval signs afresh. Call inside the transaction
 * that flips the status.
 */
export async function applySupervisorSignatures(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    reportId: string;
    userId: string;
    fields: SignatureFieldSpec[];
  },
): Promise<void> {
  if (args.fields.length === 0) return;
  const { revisionNumber } = await tx.inspectionReport.findUniqueOrThrow({
    where: { id: args.reportId },
    select: { revisionNumber: true },
  });
  for (const field of args.fields) {
    await freezeSignatureForReport(tx, {
      tenantId: args.tenantId,
      inspectionReportId: args.reportId,
      slot: field.slot,
      userId: args.userId,
      revisionNumber,
    });
  }
}
