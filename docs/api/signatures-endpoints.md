# Signatures API

Two kinds of signature, both PNG images stored through the attachment storage abstraction (local or S3), validated server-side (PNG magic/IEND, bounded dimensions, ≤ 512 KB; the portal draws 600×200 with `signature_pad`).

## Account signature — `me/signature`

Roles: INSPECTOR, SUPERVISOR, ADMIN. These routes are exempt from the signature gate (`@AllowWithoutSignature`).

- `GET /me/signature` → `{ hasSignature, updatedAt }`
- `GET /me/signature/image` → the PNG (`Cache-Control: private, no-store`)
- `PUT /me/signature` — multipart `file`. Registers or replaces it; each save writes a **new, immutable** object, so reports that already froze an earlier signature are unaffected.

`GET /auth/me` exposes `hasSignature` on the profile.

### The inspector gate

`SignatureRequiredGuard` (global, after `DefaultDenyGuard`) rejects every state-changing request from an **INSPECTOR** with no registered signature: `403` `{ code: "SIGNATURE_REQUIRED" }`. Reads stay open; the portal shell blurs the workspace behind a "Register my signature" prompt. Other roles are never gated.

### How account signatures are used

- **Inspector** — on `→ PENDING_APPROVAL` a pointer (key + hash) to the submitter's current signature is frozen onto the report; re-submission after a return appends a new pointer, readers take the latest. A submitter without a signature (e.g. an admin) freezes nothing and the cell is left empty. The template's mandatory `inspectorSignature` header role receives it at export.
- **Supervisor** — approval (direct transition or batch auto-approval) applies the approver's account signature to every `SUPERVISOR`-signed template field; a `required` one with no registered signature **refuses the approval** (`403` `SIGNATURE_REQUIRED`).

## Per-report field signatures

Templates can declare header-only `signature` fields whose signer is `CUSTOMER` or `SUPERVISOR`, optionally `required`.

- `GET /inspection-reports/:id/signatures` (all roles; CUSTOMER only for their own customer's reports) →
  `{ reportId, revisionNumber, signable, fields: [{ key, label, signer, required, signed, signedAt, signedByName }] }`. `signable` is true when the report is `APPROVED` or `CLOSED`.
- `PUT /inspection-reports/:id/signatures/:fieldKey` — **CUSTOMER only**, multipart `file`; only while `signable`, only for a field whose signer is `CUSTOMER`.
- `GET /customer-signatures/pending` — **CUSTOMER only**: their reports still waiting on a customer signature (drives the "Signature pending" panel).

Field signatures belong to the report **revision**: a reopen starts a new revision with them cleared; earlier revisions keep theirs. An unsigned `required` field blocks the export of the current revision (`409 SIGNATURE_PENDING`, see [Export](export.md)).

All signature endpoints are online-only; the offline-sync core is untouched.
