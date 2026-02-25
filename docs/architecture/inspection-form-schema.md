# Inspection Form Schema Architecture

## Overview
The application handles complex, dynamic serial number inspections through a schema-driven reactive form architecture. This allows for entirely customizable, nested field inputs driven by a single canonical data structure, enabling offline synchronization, strong type checking, and generic UI rendering.

## Canonical Data Structure
Serial numbers transition from flat key-value metadata to a strictly defined JSON payload structure mapped against a template version. 

For example, Drill Pipe V1 schema defines fields grouped into sections:
- `box` (Box Connection fields)
- `pin` (Pin Connection fields)
- `body` (Body Connection fields)
- `final` (Disposition and Scrap decisions)
- `remarksSection` (Inspector remarks)

This structure ensures that the UI precisely predicts the shape of `inspectionData` saved to the database. 

## Key Core Components

### 1. The Schema Definition (`drill-pipe-v1.schema.ts`)
The schema definition specifies sections, input fields, labels, input types (`text`, `number`, `boolean`, `select`), and `required` flags. This file acts as the single source of truth for both form generation and logical validation.

### 2. The Generic Form Component (`app-serial-inspection-reactive-form`)
This standalone generic Angular component dynamically parses a specified `FormSchema` definition and constructs a reactive `FormGroup`.
- **Initialization:** Flattens the nested data using dot-notation keys (e.g., `box.minTongSpace`) into standard Angular FormControl properties.
- **Data Binding:** Detects dynamic changes to the `initialData` `@Input()` to repopulate fields automatically.
- **Validation:** Binds `Validators.required` directly based on the schema's `required: true` configuration.
- **Resolution:** Re-nests the flat form values back into a deep JSON tree before emitting the `(saveData)` event.
- **UX States:** Automatically handles disabling inputs and suppressing actions when `[isReadOnly]` is toggled on (e.g. for Approved reports).

### 3. Frontend Gating Logic (`ReportValidationService`)
To determine if an `IN_INSPECTION` report is eligible for passing to `PENDING_APPROVAL`, the `ReportValidationService` leverages the schema shape (`DRILL_PIPE_V1_SCHEMA`) to calculate completion logic across all serial numbers. 

It iterates through all `required` paths locally during offline operations to prompt users with instant UI feedback if any fields are missing.

### 4. Backend Gating Validation (`InspectionReportWorkflowService`)
To guarantee consistency across parallel clients or API tampering, the NestJS Backend applies symmetrical transition logic. The `INSPECTION_REPORT_TRANSITIONS` gateway intercepts `PENDING_APPROVAL` transition requests, pulling the canonical fields list to enforce validation against the payload.

### 5. Inspector Comments
Overall, manual narrative summaries are stored explicitly in the `InspectionReport` table as `inspectorComment`, separating unstructured text from the deterministic serial payload measurements. This field operates seamlessly via the same `IR_UPDATE` outbox item flow, keeping standard synchronization rules.
