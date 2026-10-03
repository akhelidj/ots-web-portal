# API Documentation

HTTP endpoint contracts for the OTS API (NestJS). These describe the request/response
shapes the portal depends on. There is no shared DTO package
([ADR-0008](../adr/0008-no-shared-dto-package.md)), so these docs are the contract of
record — verify against the controllers, since the two can drift.

> No global API prefix: every controller is mounted at root **except** `FilesController`
> (`/api/files`). Auth is default-deny: every route needs a JWT unless marked `@Public`
> (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/health`).

## Endpoints

- [Inspection Reports](inspection-reports-endpoints.md) — list, template picker, create, update (incl. statistics), attachments, approval batches.
- [Inspection Report Transitions](inspection-report-transitions.md) — workflow state machine, role matrix and transition rules.
- [Serial Numbers](serial-numbers-endpoints.md) — serial-number list, bulk create, update, delete.
- [Serial Number Inspection](serial-number-inspection.md) — inspection-data entry for a serial number.
- [Dispositions](dispositions.md) — the disposition contract (`PASS`/`REWORK`/`SCRAP`/`HOLD`) and approval gating.
- [Child Reports](child-reports.md) — rework / child-report endpoints.
- [Signatures](signatures-endpoints.md) — account signatures, the inspector gate, per-report field signatures.
- [Customers](customers-endpoints.md) — customer management.
- [Templates](template-endpoints.md) — template upload, definition and version endpoints.
- [Export](export.md) — xlsx / zip export endpoint.

## Other endpoints (no dedicated page)

- `auth`: `POST /auth/login`, `/auth/refresh`, `/auth/logout` (public); `POST /auth/change-password`; `GET /auth/me`.
- `users` (ADMIN only): `GET/POST /users`, `PATCH /users/:id`, `PATCH /users/:id/active`, `DELETE /users/:id`.
- `GET /api/files/attachments/:id` — attachment download; `GET /health`.
