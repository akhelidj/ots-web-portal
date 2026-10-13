/**
 * Slot naming for `ReportSignature.slot` and the export placeholder. Dependency-free so the
 * template, export and workflow layers can all share it without importing each other.
 */

/** The mandatory inspector signature (the `inspectorSignature` template role). */
export const INSPECTOR_SIGNATURE_SLOT = 'inspectorSignature';

/**
 * The approving supervisor's signature (the `supervisorSignature` template role): the
 * approver's account signature, frozen at approval, placed wherever the template binds it.
 */
export const SUPERVISOR_SIGNATURE_SLOT = 'supervisorSignature';

/** Who signs a "Signature" field: the customer (drawn per report); SUPERVISOR is legacy read-only (see `AUTHORABLE_SIGNERS`). */
export type SignatureSigner = 'CUSTOMER' | 'SUPERVISOR';

/** Every signer a STORED field may carry (reads stay tolerant of pre-role definitions). */
export const SIGNATURE_SIGNERS: readonly SignatureSigner[] = ['CUSTOMER', 'SUPERVISOR'];

/**
 * The signers a NEW/edited definition may declare. A template `signature` field is always a
 * customer signature; the supervisor's is the `supervisorSignature` system role.
 */
export const AUTHORABLE_SIGNERS: readonly SignatureSigner[] = ['CUSTOMER'];

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
