import { Prisma, ReportSignature } from '@prisma/client';
import {
  fieldSignatureSlot,
  isFieldSignatureSlot,
  SignatureSigner,
} from './signature-slots';

/** A template `signature` field, as the workflow/export/customer layers need it. */
export interface SignatureFieldSpec {
  /** The field's data key (token stripped of braces). */
  key: string;
  label: string;
  signer: SignatureSigner;
  /** Export is blocked until a `required` field is signed. */
  required: boolean;
  /** `ReportSignature.slot` for this field. */
  slot: string;
}

/** The slice of a stored `definitionJson` this module reads. */
export interface SignatureDefinitionView {
  fields?: {
    key?: string;
    label?: string;
    type?: string;
    required?: boolean;
    signer?: string;
  }[];
}

/**
 * The `signature` fields of a stored definition (null-safe: legacy/seed definitions have
 * none). Tolerant on read — a malformed entry is skipped, never thrown on, because stored
 * definitions are not re-validated when a report is exported or transitioned.
 */
export function signatureFieldsOf(
  definition: SignatureDefinitionView | null | undefined,
): SignatureFieldSpec[] {
  const out: SignatureFieldSpec[] = [];
  for (const f of definition?.fields ?? []) {
    if (f?.type !== 'signature' || !f.key) continue;
    if (f.signer !== 'CUSTOMER' && f.signer !== 'SUPERVISOR') continue;
    out.push({
      key: f.key,
      label: f.label ?? f.key,
      signer: f.signer,
      // A customer signature is always required (the field's presence is the opt-in); only
      // a supervisor signature can be optional. No field → no customer signature anywhere.
      required: f.signer === 'CUSTOMER' ? true : f.required === true,
      slot: fieldSignatureSlot(f.key),
    });
  }
  return out;
}

/** A client with `reportSignature` — the Prisma service or a transaction client. */
export type SignatureReader = Pick<Prisma.TransactionClient, 'reportSignature'>;

/**
 * The signature rows that are CURRENT for each report's revision, newest per slot. Per-field
 * signatures belong to the revision they were made on, so a reopen (which bumps the
 * revision) leaves the old rows as history and starts the new revision unsigned.
 *
 * Reads several reports in one query; the result is keyed by report id, then slot.
 */
export async function currentFieldSignatures(
  db: SignatureReader,
  args: {
    tenantId: string;
    reports: { id: string; revisionNumber: number }[];
  },
): Promise<Map<string, Map<string, ReportSignature>>> {
  const out = new Map<string, Map<string, ReportSignature>>();
  if (args.reports.length === 0) return out;

  const revisionOf = new Map(args.reports.map((r) => [r.id, r.revisionNumber]));
  const rows = await db.reportSignature.findMany({
    where: {
      tenantId: args.tenantId,
      inspectionReportId: { in: [...revisionOf.keys()] },
      slot: { startsWith: 'field:' },
    },
    orderBy: { signedAt: 'desc' },
  });
  for (const row of rows) {
    if (!isFieldSignatureSlot(row.slot)) continue;
    if (row.revisionNumber !== revisionOf.get(row.inspectionReportId)) continue;
    let slots = out.get(row.inspectionReportId);
    if (!slots) {
      slots = new Map();
      out.set(row.inspectionReportId, slots);
    }
    // Newest first, so the first row seen per slot wins.
    if (!slots.has(row.slot)) slots.set(row.slot, row);
  }
  return out;
}
