# ADR-0012 — Account signatures and per-report field signatures

**Status:** Accepted (standing decision)

## Context

Exported reports must carry the signatures of the people who vouched for them: the inspector who submitted, the supervisor who approved, and (on some templates) the customer who accepts the result. Signatures have to be tamper-evident for audit — a signature drawn later, or replaced later, must not change what a past revision exports.

## Decision

Two distinct mechanisms, both storing PNGs (`signature_pad`, 600×200) through the attachment-storage abstraction and validated server-side (PNG structure, bounded dimensions, ≤ 512 KB):

1. **Account signatures** (INSPECTOR, SUPERVISOR, ADMIN) — drawn once in the portal, replaceable in Settings. Each save writes a **new immutable object**; nothing is overwritten.
   - **Inspector:** a missing signature **gates the account**: a global `SignatureRequiredGuard` refuses every state-changing request from an INSPECTOR without one (`403 SIGNATURE_REQUIRED`); reads stay open and the shell shows a blocking "Register my signature" prompt. On `→ PENDING_APPROVAL` a **pointer** (storage key + hash) to their current signature is frozen onto the report (`ReportSignature`), so later re-registration cannot change what that submission exports.
   - **Supervisor:** approval (direct transition or batch auto-approval) freezes the approver's account signature into the `supervisorSignature` system role (like the inspector's, mandatory): an approver with no signature **refuses the approval** (`403 SIGNATURE_REQUIRED`). Pre-role templates carried this as a `SUPERVISOR`-signer field; `api/scripts/migrate-supervisor-signature-role.ts` rewrites those onto the role (see below).
2. **Per-report field signatures** — templates declare header-only `signature` fields, which are customer signatures (the field's presence is the opt-in, so it is always required; the inspector and supervisor signatures are the mandatory system roles, not fields — the validator rejects a `SUPERVISOR` signer on save; a stored legacy `SUPERVISOR` field is still read at runtime until migrated). A CUSTOMER draws theirs per report, only once the report is `APPROVED`/`CLOSED`, and only for their own customer's reports. Field signatures belong to a **revision**: a reopen starts a new revision with them cleared; older revisions keep theirs. An unsigned customer field **blocks export of the current revision** (`409 SIGNATURE_PENDING`); older revisions export with the cell blank.

Every template must map the `inspectorSignature` and `supervisorSignature` header roles (mandatory to save a definition) so the inspector and approver pictures have a home. The supervisor signature is a system role like the inspector's: the approver's account signature is frozen at approval and an approver without one is refused with `403 SIGNATURE_REQUIRED` (the portal shows the register-your-signature gate). A `signature` field with signer `SUPERVISOR` still works on already-saved templates but is no longer offered for new ones. Signature endpoints are online-only; the offline-sync core is untouched.

## Why not the alternatives

- *Store the signature image on each report:* duplicates data and lets a change leak into history; pointers to immutable objects are cheap and auditable.
- *Always use the live account signature at export time:* re-exporting an old report would silently change it.
- *Soft-warn instead of gating the inspector:* unsigned submissions would reach approval and fail only at export.

## Consequences

Past revisions are stable regardless of later signature changes. Costs: an INSPECTOR cannot work (offline queue included — the server gate fires on sync) until a signature exists; admins acting as inspector freeze nothing and their cell is left blank; signatures need a connection. See [`../api/signatures-endpoints.md`](../api/signatures-endpoints.md).

## Migration: legacy SUPERVISOR signature fields → `supervisorSignature` role

Run once per environment, **before** deploying the validator that rejects a `SUPERVISOR` signer. In production the script ships inside `api_dist` and runs in the API container, which already has Prisma and `DATABASE_URL`:

```
npm run build:api && npm run db:migrate:supervisor-role:build   # -> dist/api/scripts/migrate-supervisor-signature-role.js (build AFTER nx: it cleans dist/api)
# on the server: put the file in the running container's app dir (WORKDIR = `docker exec ots_api pwd`)
docker cp migrate-supervisor-signature-role.js ots_api:<WORKDIR>/
docker exec ots_api node migrate-supervisor-signature-role.js           # dry run (default)
docker exec ots_api node migrate-supervisor-signature-role.js --apply
```

Back up the database first (`pg_dump`). Locally: `npx -y tsx api/scripts/migrate-supervisor-signature-role.ts [--apply]`.

Per template with a legacy field: the field becomes the role field (same token/cell), the prior definition is appended to `TemplateDefinitionRevision`, and the report signatures already frozen under `field:<key>` are **copied** to the `supervisorSignature` slot (same revision, object and hash) for the reports pinned to that version, so past revisions export unchanged. Originals are never deleted; the script is idempotent. Runtime reads of an unmigrated `SUPERVISOR` field remain tolerant and can be removed once every environment is migrated. Note: a migrated template's approval now always requires the approver's account signature (the legacy field was optional).
