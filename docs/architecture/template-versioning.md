# Template Versioning Architecture

## Overview

OTS uses a strict, immutable versioning system for Excel templates. This ensures that historical reports can always be reproduced exactly as they were created, using the specific version of the template that was active at the time.

## Data Model

Templates are stored in the `Template` table (Postgres).
The `TemplateVersion` table is legacy and currently unused but retained for compatibility.

### Template Entity

- **tenantId**: Scopes the template to a specific tenant.
- **templateKey**: Unique identifier for the report type (e.g., `DRILL_PIPE_REPORT`).
- **templateVersion**: Integer, strictly incrementing (1, 2, 3...).
- **status**: `ACTIVE` or `DEPRECATED`.
- **fileBlob**: Raw binary content of the `.xlsx` file.
- **hash**: SHA-256 hash of the file content for integrity verification.
- **changeNote**: Description of changes in this version.

## Versioning Rules

1.  **Immutability**: Once a version is created, its file and metadata (except `status`) cannot be changed.
2.  **Incrementing**: New versions for a `(tenantId, templateKey)` are assigned `max(version) + 1`.
3.  **Deprecation**: When a new version is created, the previous `ACTIVE` version is automatically set to `DEPRECATED`.
4.  **Concurrency**: Version assignment is protected by database transactions and unique constraints.

## Validation

Strict validation logic enforces:

- **File Type**: Only `.xlsx` (OpenXML) is allowed. `.xls` is rejected.
- **Structure**:
  - Must contain sheets: `ok`, `Drill Pipe Inspection Report`.
- **Markers**:
  - Specific standard cells in the `ok` sheet must match expected text (e.g., A4 = "DMMT Work Ordre N°:").
  - Comparison is case-insensitive and trimmed.

## Storage Strategy

Currently, file bytes are stored directly in the `Template` table (`fileBlob` column).
The architecture uses a `TemplateFileStoreService` abstraction to allow seamless migration to S3/BlobStorage in the future without changing business logic.

## Field Mapping

**Important**: Template upload does _not_ define field mapping.
Field mapping is implemented in code per `(templateKey, templateVersion)`.
Changing the mapping requires a code deployment. This ensures deterministic and auditable export behavior.

## InspectionReport Binding Model

Inspection Reports are permanently bound to a specific Template Version at creation.

- **Binding Fields**: `templateKey`, `templateVersion`, `templateHash`.
- **Logic**:
  1.  User requests `CREATE` with `templateKey`.
  2.  System finds active version.
  3.  System copies version/hash to `InspectionReport`.
- **Immutability**: These fields never change for the life of the report.
