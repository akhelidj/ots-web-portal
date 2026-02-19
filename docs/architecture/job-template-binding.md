# Job Template Binding Architecture

## Overview
Every Inspection Report (Job) in OTS is permanently bound to a specific version of a Template. This binding happens at the moment of creation and is immutable. This ensures that a Job always references the exact template definition (structure, validation rules, field mappings) that was used when the job was started.

## Key Principles

### 1. Snapshot at Creation
When a Receiver creates a new Inspection Report, the system looks up the currently **ACTIVE** version of the requested Template (based on `templateKey`).
The binding fields from that Active Template are **copied** into the Inspection Report record.

### 2. Field-Based Binding (No Foreign Key)
We explicitly store the template details as scalar fields on the `InspectionReport` entity, rather than relying solely on a foreign key to a `Template` table.
**Rationale**:
-   **Immutability**: Even if the `Template` record is later modified (which shouldn't happen, but as a safeguard) or if data archival moves templates, the Inspection Report retains its historical context self-contained.
-   **Determinism**: The `templateHash` guarantees we know exactly what file was used.

### 3. Active-Only Selection
Jobs can ONLY be created from a Template that is in `ACTIVE` status.
-   If a template is `DEPRECATED`, it cannot be used for new jobs.
-   If no active version exists, creation fails.

## Data Model (Prisma)
The `InspectionReport` model includes:

```prisma
model InspectionReport {
  // ...
  templateKey     String   // e.g. "DRILL_PIPE_REPORT"
  templateVersion Int      // e.g. 1, 2, 3
  templateHash    String   // SHA-256 hash of the .xlsx file
  
  // Legacy field support (optional)
  templateVersionId String? 
  // ...
}
```

## Immutability Rules
-   `templateKey`, `templateVersion`, and `templateHash` are written **ONCE** during the `CREATE` transaction.
-   No `UPDATE` endpoint allows modifying these fields.
-   The Service layer enforces this by simply not exposing these fields in any Update DTOs.
-   Any attempt to force-update these fields via direct DB access (if bypassed) would violate the business integrity, but the application code strictly prevents it.

## Legacy Handling
The system previously used a `TemplateVersion` entity and `templateVersionId`. This field remains in the schema as `templateVersionId` (nullable) to support legacy data visibility, but new bindings drive logic primarily via the new scalar fields.
