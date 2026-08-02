# API Documentation

HTTP endpoint contracts for the OTS API (NestJS). These describe the request/response
shapes the portal depends on. There is no shared DTO package
([ADR-0008](../adr/0008-no-shared-dto-package.md)), so these docs are the contract of
record — verify against the controllers, since the two can drift.

> No global API prefix: every controller is mounted at root **except** `FilesController`
> (`/api/files`).

## Endpoints

- [Inspection Reports](inspection-reports-endpoints.md) — create, read, and update inspection reports.
- [Inspection Report Transitions](inspection-report-transitions.md) — workflow state machine and transition rules.
- [Serial Numbers](serial-numbers-endpoints.md) — serial-number CRUD and bulk create.
- [Serial Number Inspection](serial-number-inspection.md) — inspection-data entry for a serial number.
- [Dispositions](dispositions.md) — the disposition contract (`PASS`/`REWORK`/`SCRAP`/`HOLD`) and approval gating.
- [Child Reports](child-reports.md) — rework / child-report endpoints.
- [Customers](customers-endpoints.md) — customer management.
- [Templates](template-endpoints.md) — template upload and version endpoints.
- [Export](export.md) — xlsx / zip export endpoints.
