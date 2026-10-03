# Template Versioning Architecture

## Overview

OTS uses a strict, immutable versioning system for Excel templates, so historical reports can always be reproduced from the exact version they were created with.

## Data Model

Templates live in the `Template` table (Postgres). The `TemplateVersion` table and the nullable `legacyTemplateVersion` FK on reports are **legacy** — retained for old data only; do not build on them.

### Template entity

- **tenantId**, **templateKey** (report type, e.g. `DRILL_PIPE_REPORT`), **templateVersion** (strictly incrementing integer).
- **status**: `ACTIVE` | `DEPRECATED` — the lifecycle axis.
- **approvalStatus**: `PENDING_APPROVAL` | `APPROVED` | `REJECTED` — the admin validation gate, orthogonal to `status`; with **approvedById** / **approvedAt** / **rejectionReason**.
- **fileKey**: storage key of the `.xlsx` workbook (see Storage). The API never returns it.
- **hash**: SHA-256 of the workbook, for integrity.
- **changeNote**: description of the version.
- **definitionJson**: the form/gate/export/rules definition, `NULL` until defined — see [Template Definition](template-definition.md). Edit history is kept in `TemplateDefinitionRevision`.

## Versioning rules

1. **Immutability:** a version's workbook and metadata never change (only `status`, the approval fields and, via the define endpoint, `definitionJson`).
2. **Incrementing:** a new version for `(tenantId, templateKey)` is `max(version) + 1`.
3. **Deprecation:** when a new version is born `APPROVED` (an admin upload) the previous `ACTIVE` one becomes `DEPRECATED`. A version that lands `PENDING_APPROVAL` leaves the live version in service; the handover is deferred to the moment an admin approves it.
4. **Concurrency:** version assignment is protected by transactions and the `(tenantId, templateKey, templateVersion)` unique constraint.

## Who can upload, and the validation gate

**ADMIN and SUPERVISOR** can both upload a version and define its form. The uploader's role, read from the JWT and never the body, decides the gate:

| Uploader     | `approvalStatus` on creation | Retires the previous ACTIVE version? |
| ------------ | ---------------------------- | ------------------------------------ |
| `ADMIN`      | `APPROVED` (self-stamped)    | Immediately                          |
| `SUPERVISOR` | `PENDING_APPROVAL`           | No — deferred to admin approval      |

**Only an `APPROVED` version can be consumed.** "Usable" = `status == ACTIVE && definitionJson != null && approvalStatus == APPROVED`, enforced as a server-side WHERE in every consumption path (the available-templates picker and the create path), so a client cannot bypass it by naming a key.

A supervisor uploads **and** defines freely while pending. Rejection requires a reason (shown on the templates list), is terminal for that version and leaves the live version untouched — retry means uploading a **new** version. `approve` / `reject` / `deprecate` are ADMIN-only.

Rationale: [ADR-0011](../adr/0011-template-upload-supervisor-admin-validation.md). Endpoints: [`../api/template-endpoints.md`](../api/template-endpoints.md).

## Upload validation

Structural validation at upload time (`template-validation.service.ts`), separate from and prior to the admin gate: the file extension must be `.xlsx`; the MIME type must be a known xlsx variant (browsers on Windows are inconsistent, so extension + a successful ExcelJS parse are the real test); the workbook must parse and contain at least one worksheet. Everything template-specific (tokens, fields, roles) is validated later, when the definition is written.

## Storage

Workbook bytes are **not** stored in Postgres. They go through the `AttachmentStorage` abstraction (`api/src/app/storage/`), selected by `STORAGE_DRIVER` (`local` default, or `s3`; see `api/.env.example`). The canonical key is built from tenant / templateKey / version. The row is committed first and the bytes written to storage after commit. The same abstraction stores report attachments and signature images.

## Field mapping

Field mapping is **data, not code**: it lives in the version's `definitionJson` (`export` / `transforms` / `regions`) and is authored in the portal's definition wizard. See [Template Definition](template-definition.md) and [Export Engine](export-engine.md).

## Report binding

A report is permanently bound to one template version at creation (`templateKey`, `templateVersion`, `templateHash`) — see [Template Binding](inspection-report-template-binding.md).
