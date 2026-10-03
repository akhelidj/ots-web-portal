# Inspection Report Template Binding Architecture

## Overview

Every Inspection Report is permanently bound to a specific version of a Template. The binding happens at creation and is immutable, so a report always references the exact definition (form, gate rules, export mapping) in force when it was started.

## Key principles

### 1. Chosen at creation, snapshot-bound

The create form offers a **template picker** fed by `GET /inspection-reports/available-templates` (newest version per key that is `ACTIVE`, defined, and admin-`APPROVED`). `POST /inspection-reports` carries the chosen `templateKey`; the server resolves the **newest ACTIVE + APPROVED + defined version of that key** in the create transaction and copies its binding fields into the report. The key is required — there is no default or hardcoded template. A key whose newest active version is pending/rejected/undefined is refused (`400`), even if a client names it directly.

### 2. Field-based binding (no foreign key)

`templateKey`, `templateVersion` and `templateHash` are stored as scalar fields on `InspectionReport`, not only as a relation, so the report stays self-contained even if template rows are archived, and `templateHash` pins exactly which workbook was used. They are validated against the template on every revision snapshot.

### 3. Active, approved, defined only

New reports can only be created from a `Template` that is `ACTIVE`, has a non-null `definitionJson`, and has `approvalStatus == APPROVED`. If none exists for the key, creation fails.

## Data model (Prisma)

```prisma
model InspectionReport {
  // ...
  templateKey     String   // e.g. "DRILL_PIPE_REPORT"
  templateVersion Int
  templateHash    String   // SHA-256 of the .xlsx workbook
  headerData      Json?    // definition-keyed header values
  statistics      Json?    // free-entry [{ id, label, value, serials[] }]
  templateVersionId String? // legacy, nullable — relation `legacyTemplateVersion`
}
```

## Immutability

- The three binding fields are written once, in the `CREATE` transaction.
- No update endpoint accepts them (`PATCH /inspection-reports/:id` takes only `poNumber`, `headerData`, `statistics`, `status`).
- Consumers that need the definition look it up by `(tenantId, templateKey, templateVersion)`; `GET` endpoints graft `definitionJson` onto the report payload so the portal can render offline.

## Legacy

The old `TemplateVersion` entity / `templateVersionId` stays in the schema (nullable) for legacy data visibility only. Logic runs off the scalar fields.

## Two create paths

The live path is `InspectionReportsService.createReport`. `InspectionReportWorkflowService.create` is a second, divergent implementation (it generates no `reportNumber`) that is **not wired to any route**; do not route to it.
