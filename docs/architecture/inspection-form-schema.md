# Inspection Form Schema Architecture

## Overview

Serial inspections are entered through a **schema-driven reactive form**. The schema is derived from the report's bound template definition (`Template.definitionJson`), so every template — not just drill pipe — gets its own form, with no per-template component. Offline sync, type checking and the generic UI all rest on one canonical data structure. See [Template Definition](template-definition.md).

## Canonical data structure

Per-serial values are a JSON tree in `SerialNumber.inspectionData` (and `ChildReportSerialNumber.inspectionData`), shaped by the definition's item-scope `fields`, grouped by `sections`. Dotted keys address nested values (`box.minTongSpace`). For the seeded drill-pipe template the sections are `box`, `pin`, `body`, `final` and `remarksSection`; the per-serial disposition lives at `body.emiResult` (declared by the definition's `disposition.source`, never assumed by code). Report-level (header-scope) values live in `InspectionReport.headerData`, keyed by field key.

## Key components

### 1. Definition → form schema (`definition-to-form-schema.ts`)

Converts a template definition into the portal's `FormSchema`: item-scope fields become the inspection form; header-scope fields feed the Specs/header surfaces (roled header fields are system-derived and shown read-only). The adapter reads `regions.length` as the explicit flat/region discriminator. `drill-pipe-v1.schema.ts` (`DRILL_PIPE_V1_SCHEMA`) survives only as the soft-NULL fallback for reports whose template has no definition.

### 2. The generic form component (`app-serial-inspection-reactive-form`)

Parses a `FormSchema` and builds a reactive `FormGroup`: flattens nested data to dot-notation controls, repopulates on `initialData` changes, binds `Validators.required` from `required: true`, re-nests values before emitting `(saveData)`, and disables everything when `[isReadOnly]` (submitted/approved serials, locked reports). Used for parent serials and for child-report serials.

### 3. Frontend gating (`ReportValidationService`, `core/validation/`)

Derives the required-field set from `definitionJson` (the same transform the form uses) and checks completion across all serials locally, so offline users get instant feedback before attempting `PENDING_APPROVAL`. Falls back to `DRILL_PIPE_V1_SCHEMA` only for a null definition (soft-NULL, never throws).

### 4. Backend gating (`InspectionReportWorkflowService`, `approval-gate.ts`)

The server applies the symmetric rule when a report transitions to `PENDING_APPROVAL`: `engineGate(definition, serials)` checks dispositions (when `requiredForApproval`) and every `required` item field, returning a structured `VALIDATION_FAILED`. Server and portal both read disposition through `resolveDisposition` so they cannot diverge. See [Dispositions](../api/dispositions.md).

### 5. Report statistics and comments

- **Statistics** are free-entry, typed per report (label + value + optional serials) and stored in `InspectionReport.statistics` — not part of the form schema and not computed. See [ADR-0013](../adr/0013-free-entry-report-statistics.md).
- The overall **inspector comment** is just another header-scope value (`headerData.inspectorComment`), saved through the normal report-update path and outbox flow.
- The serial tables show a badge only for serials flagged by the template's rework trigger rule.
