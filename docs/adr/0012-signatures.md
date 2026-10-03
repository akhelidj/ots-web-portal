# ADR-0012 — Account signatures and per-report field signatures

**Status:** Accepted (standing decision)

## Context

Exported reports must carry the signatures of the people who vouched for them: the inspector who submitted, the supervisor who approved, and (on some templates) the customer who accepts the result. Signatures have to be tamper-evident for audit — a signature drawn later, or replaced later, must not change what a past revision exports.

## Decision

Two distinct mechanisms, both storing PNGs (`signature_pad`, 600×200) through the attachment-storage abstraction and validated server-side (PNG structure, bounded dimensions, ≤ 512 KB):

1. **Account signatures** (INSPECTOR, SUPERVISOR, ADMIN) — drawn once in the portal, replaceable in Settings. Each save writes a **new immutable object**; nothing is overwritten.
   - **Inspector:** a missing signature **gates the account**: a global `SignatureRequiredGuard` refuses every state-changing request from an INSPECTOR without one (`403 SIGNATURE_REQUIRED`); reads stay open and the shell shows a blocking "Register my signature" prompt. On `→ PENDING_APPROVAL` a **pointer** (storage key + hash) to their current signature is frozen onto the report (`ReportSignature`), so later re-registration cannot change what that submission exports.
   - **Supervisor:** approval (direct transition or batch auto-approval) applies the approver's account signature to every `SUPERVISOR`-signed template field. A `required` one with no signature **refuses the approval**.
2. **Per-report field signatures** — templates declare header-only `signature` fields with a signer of `CUSTOMER` or `SUPERVISOR` and an optional `required`. A CUSTOMER draws theirs per report, only once the report is `APPROVED`/`CLOSED`, and only for their own customer's reports. Field signatures belong to a **revision**: a reopen starts a new revision with them cleared; older revisions keep theirs. A `required` field that is unsigned **blocks export of the current revision** (`409 SIGNATURE_PENDING`); older revisions and optional fields export with the cell blank.

Every template must map the `inspectorSignature` header role (mandatory to save a definition) so the inspector picture has a home. Signature endpoints are online-only; the offline-sync core is untouched.

## Why not the alternatives

- *Store the signature image on each report:* duplicates data and lets a change leak into history; pointers to immutable objects are cheap and auditable.
- *Always use the live account signature at export time:* re-exporting an old report would silently change it.
- *Soft-warn instead of gating the inspector:* unsigned submissions would reach approval and fail only at export.

## Consequences

Past revisions are stable regardless of later signature changes. Costs: an INSPECTOR cannot work (offline queue included — the server gate fires on sync) until a signature exists; admins acting as inspector freeze nothing and their cell is left blank; signatures need a connection. See [`../api/signatures-endpoints.md`](../api/signatures-endpoints.md).
