/**
 * Slot naming for `ReportSignature.slot` and the export placeholder. Dependency-free so the
 * template, export and workflow layers can all share it without importing each other.
 */

/** The mandatory inspector signature (the `inspectorSignature` template role). */
export const INSPECTOR_SIGNATURE_SLOT = 'inspectorSignature';

/** Who signs a "Signature" field: the customer (drawn per report) or the supervisor (account signature). */
export type SignatureSigner = 'CUSTOMER' | 'SUPERVISOR';

export const SIGNATURE_SIGNERS: readonly SignatureSigner[] = ['CUSTOMER', 'SUPERVISOR'];

const FIELD_SLOT_PREFIX = 'field:';

/** Slot of a template "Signature" field, keyed by the field's data key (e.g. `field:custSig`). */
export const fieldSignatureSlot = (fieldKey: string): string =>
  `${FIELD_SLOT_PREFIX}${fieldKey}`;

/** Whether `slot` belongs to a template signature field (vs. the inspector slot). */
export const isFieldSignatureSlot = (slot: string): boolean =>
  slot.startsWith(FIELD_SLOT_PREFIX);

/** Inverse of {@link fieldSignatureSlot}. */
export const fieldKeyOfSlot = (slot: string): string =>
  slot.slice(FIELD_SLOT_PREFIX.length);
