import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { freezeSignatureForReport } from './freeze-signature';
import {
  bindsSignatureRole,
  SignatureDefinitionView,
  SignatureFieldSpec,
  signatureFieldsOf,
} from './signature-fields';
import { SUPERVISOR_SIGNATURE_SLOT } from './signature-slots';

/**
 * Approval-time handling of the approver's signature. A supervisor never draws per report:
 * approving applies their ACCOUNT signature to (a) the template's `supervisorSignature`
 * SYSTEM role, when it binds one, and (b) every legacy SUPERVISOR-signer `signature` field.
 * Shared by both paths that can flip a report to APPROVED (the direct transition and the
 * batch auto-approve) so they cannot drift.
 */

type ApprovalDb = Pick<Prisma.TransactionClient, 'template' | 'userSignature'>;

/** What approving a report must sign, resolved from the report's pinned template. */
export interface ApprovalSigning {
  /** Legacy user-defined SUPERVISOR-signer fields (none if legacy/seed). */
  fields: SignatureFieldSpec[];
  /** The template binds the `supervisorSignature` system role. */
  roleBound: boolean;
}

export const NO_APPROVAL_SIGNING: ApprovalSigning = { fields: [], roleBound: false };

/** The approval signing duties of the report's pinned template. */
export async function approvalSigningFor(
  db: Pick<Prisma.TransactionClient, 'template'>,
  report: { tenantId: string; templateKey: string; templateVersion: number },
): Promise<ApprovalSigning> {
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
  const definition = template?.definitionJson as SignatureDefinitionView | null;
  return {
    fields: signatureFieldsOf(definition).filter((f) => f.signer === 'SUPERVISOR'),
    roleBound: bindsSignatureRole(definition, SUPERVISOR_SIGNATURE_SLOT),
  };
}

/**
 * Refuse an approval that cannot be exported: the `supervisorSignature` role (always
 * required — like the inspector's) or a `required` SUPERVISOR field with no account
 * signature to apply would strand the report APPROVED. The 403 SIGNATURE_REQUIRED makes the
 * portal blur the app and ask the approver to register their signature. A non-required
 * legacy field just stays blank.
 */
export async function assertApproverCanSign(
  db: ApprovalDb,
  signing: ApprovalSigning,
  userId: string,
): Promise<void> {
  if (!signing.roleBound && !signing.fields.some((f) => f.required)) return;
  if ((await db.userSignature.count({ where: { userId } })) > 0) return;
  throw new ForbiddenException({
    code: 'SIGNATURE_REQUIRED',
    message:
      'This report needs your signature. Register it in Settings before approving.',
  });
}

/**
 * Apply the approver's account signature to the role slot and each legacy SUPERVISOR field,
 * tagged with the report's revision AS IT NOW STANDS (a snapshot in the same transaction may
 * just have bumped it). A reopen bumps the revision, so a re-approval signs afresh. Call
 * inside the transaction that flips the status.
 */
export async function applySupervisorSignatures(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    reportId: string;
    userId: string;
    signing: ApprovalSigning;
  },
): Promise<void> {
  const slots = [
    ...(args.signing.roleBound ? [SUPERVISOR_SIGNATURE_SLOT] : []),
    ...args.signing.fields.map((f) => f.slot),
  ];
  if (slots.length === 0) return;
  const { revisionNumber } = await tx.inspectionReport.findUniqueOrThrow({
    where: { id: args.reportId },
    select: { revisionNumber: true },
  });
  for (const slot of slots) {
    await freezeSignatureForReport(tx, {
      tenantId: args.tenantId,
      inspectionReportId: args.reportId,
      slot,
      userId: args.userId,
      revisionNumber,
    });
  }
}
