# CLAUDE.md — OTS Web Portal

Working reference for this monorepo: fast orientation that points into the authoritative documentation under `docs/`. Captures what prior discovery established so sessions don't re-derive it. `docs/` — the rebuilt architecture docs, ADRs, and `KNOWN-ISSUES.md` — is the source of truth; this file orients and links into it rather than duplicating it.

## Stack & Workspace

- **Nx** (`22.5.1`) over **npm workspaces** — no pnpm/yarn/turbo. Two apps, **no libs**.
- `api/` — **NestJS 11**, `portal/` — **Angular 21**. **Postgres 16** via **Prisma `5.22.0`** (both `prisma` and `@prisma/client`).
- **Node pinned `20.19.3`** (`.nvmrc` — enforced).
- **No shared DTO package.** Front/back agree on an HTTP contract only; types are duplicated, not shared. Path aliases: `@portal/*` → `portal/src/app/*`, `@app-env/*` → `portal/src/environments/*`.
- Frontend → backend over HTTP via `environment.apiUrl` (`http://localhost:3000` dev). JWT attached by an interceptor.
- **Routing quirk:** no global API prefix — every controller sits at root **except** `FilesController` which is under `/api/files`. Watch this when wiring the frontend or a proxy.
- Run: `npm run start:api`, `npm run start:portal`. DB: `npm run db:migrate` / `db:studio` / `db:seed`. Local Postgres via `docker-compose.yml`.

## Architecture Spine

- **`PrismaService` is the single DB gateway** — every backend service depends on it; nothing else touches the DB.
- **Optimistic concurrency, everywhere:** read-compare-then-guarded-write. Client sends last-known `version`; server compares the freshly-read row (→ `ConflictException`) **and** re-checks inside the txn with `updateMany({ where: { version } })`, throwing again if `count === 0`. Every write does `version + 1`. Follow this pattern for any new mutable entity.
- **Auth is default-deny.** A global JWT guard — `DefaultDenyGuard` at `api/src/app/common/guards/default-deny.guard.ts` — authenticates every route; RBAC via `@Roles()` + `RolesGuard`. **New public routes must be marked `@Public`** or they silently 401.
- **Revision-snapshot engine** (`RevisionService`) fires on the **direct** `APPROVED` transition (first approval) and on **reopen**, writing an immutable deterministic `snapshotJson` + incrementing `revisionNumber`. Snapshots validate template binding. ⚠️ The approval-batch auto-approval path writes no snapshot ([KNOWN-ISSUES #19](docs/KNOWN-ISSUES.md)).
- **Template admin-validation gate:** `Template.approvalStatus` (`PENDING_APPROVAL` | `APPROVED` | `REJECTED`) is a **third axis**, orthogonal to `status` and `definitionJson`. A template is usable only when `ACTIVE && definitionJson != null && approvalStatus === APPROVED` — **any new consumption path must AND in all three**. ADMIN and SUPERVISOR both upload and define; a supervisor's upload lands `PENDING_APPROVAL` and its deprecation handover is **deferred to approval** so an unvalidated upload can't retire the live template. `approve`/`reject`/`deprecate` are ADMIN-only. See [ADR-0011](docs/adr/0011-template-upload-supervisor-admin-validation.md).
- **Role model on reports:** SUPERVISOR has the **same report powers as ADMIN** — `workflow.policy.ts` gives them the identical transition matrix (intake `DRAFT→RECEIVED`, early force-close and reopen included), they can create reports, manage serials and submit/approve batches. The difference is outside reports: users, customers (list read-only) and template approve/reject/deprecate/delete stay ADMIN-only. CUSTOMER sees every status of their own customer's reports, read-only (child reports included).
- **Signatures** ([ADR-0012](docs/adr/0012-signatures.md)): INSPECTOR accounts without a registered signature are blocked server-side (`SignatureRequiredGuard`, `403 SIGNATURE_REQUIRED`); the supervisor's account signature is applied at approval; customers sign per report once Approved. A required, unsigned field blocks export (`409 SIGNATURE_PENDING`). Online-only; the sync core is untouched.
- **Statistics** ([ADR-0013](docs/adr/0013-free-entry-report-statistics.md)) are free-entry per report (`InspectionReport.statistics`), carried by the normal report-update path (works offline). There is no computed outcome/pass-rate any more.
- **Customer branding:** an admin may give a Customer a `brandColor` and a logo (`logoKey`). `ThemeService` fetches `GET /me/branding` and writes the palette from `brand-palette.ts` as inline CSS vars on `<html>` (customer role only). With no colour, the customer accent is monochrome (white on dark, ink on light), never the OTS orange. With a logo, the customer header shows the logo and company name instead of OTS/Trackline. See [customers-endpoints.md §6](docs/api/customers-endpoints.md).
- **Storage:** attachments, signature images, customer logos and template workbooks go through the `AttachmentStorage` abstraction (`STORAGE_DRIVER=local|s3`, `api/src/app/storage/`); `Template` stores a `fileKey`, not bytes.
- **PENDING_APPROVAL gate:** transitions into approval require ≥1 serial, each with a disposition, and every item field the template definition marks `required` present — else a structured `VALIDATION_FAILED` 400.

## ⚠️ Offline-Sync Core — HIGHEST-RISK SUBSYSTEM

Location: `portal/src/app/core/offline/`. The most load-bearing and least-safe code in the repo.
**Full lifecycle trace: [`docs/architecture/report-lifecycle.md`](docs/architecture/report-lifecycle.md)**

Flow: optimistic local write (IndexedDB) → **outbox** enqueue → **SyncOrchestrator** (auto-runs on reconnect, 2.5s cooldown) → **SyncDispatcher** → API → **temporal-ID remap** → hydrate.

- **Temporal-ID remap:** offline rows get temp ids (`local-ir-…`); on sync the server UUID replaces them and pending outbox items are rewritten to the real id. **Serials remap by `clientRef`** (server echoes `clientRef`→real id).
- **Drain is FIFO** by `createdAt`; a 409 marks the entity/outbox item `CONFLICT` and **cascades** to dependents.

**Do NOT modify sync code without a test first.** Three confirmed standing defects live here — stuck `CONFLICT`, `clearConflicts` discarding local edits, and `idempotencyKey` never transmitted — documented with source anchors in [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) (#1–3). Read them before touching this subsystem.

## Intentional Constraints (NOT bugs — do not "fix")

- **Multi-template is live** (this used to be a hardcode — do not reintroduce it). `InspectionReportsService.createReport` requires the caller's `templateKey` (the portal picker, fed by `GET /inspection-reports/available-templates`) and binds the report to the newest ACTIVE + defined + APPROVED version of it. `InspectionReportWorkflowService.create` is an **unwired**, divergent create path — don't route to it. History: [ADR-0009](docs/adr/0009-single-template-hardcode-seam.md).
- **`Template` (workbook in storage via `fileKey`, definition in `definitionJson`) is authoritative.** `TemplateVersion` (with `mappingJson`) is **legacy** — surfaced only via the nullable `legacyTemplateVersion` FK. Don't build new logic on it.

## Testing / CI Reality

- **Tests exist; CI does not.** Unit (`*.spec.ts`) and integration (`*.integration.spec.ts`) suites run via `npm run test` / `test:api` / `test:portal`; API integration tests need the test Postgres (`npm run test:db:up`, then `test:api:integration`, via `docker-compose.test.yml`). Coverage is partial — concentrated on the audited, high-risk paths (revision snapshots, export, workflow transitions, offline-sync).
- **No CI.** There are no `.github/workflows`; nothing runs the suites automatically. With real production clients and no automated gate, **every change still needs manual verification** — be conservative, especially around sync, audited workflows, and migrations.

## Conventions & Tooling

- **Use Context7** for version-accurate NestJS 11 / Angular 21 / Prisma docs when changing framework internals.
- Match surrounding code style; read-then-write territory — verify manually given partial coverage and no CI.

## Documentation

Authoritative docs live under `docs/`:

- [`docs/architecture/`](docs/architecture/README.md) — system design (report lifecycle, revision-snapshot engine, form schema, export mapping, template binding).
- [`docs/adr/`](docs/adr/README.md) — standing architecture decisions and their tradeoffs.
- [`docs/api/`](docs/api/README.md) — HTTP endpoint contracts (can drift from the controllers — no shared DTO package, see ADR-0008; verify against code when it matters).
- [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) — verified standing defects and constraints.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost) — but **not right after a commit** (see the post-commit note below).
- **The post-commit hook does a FULL rebuild** (code and markdown/docs included), so running graphify manually right after a commit is redundant — don't. Let the hook finish; if you need to confirm, check that `built_at_commit` in `graphify-out/graph.json` matches HEAD.
- **Docs/markdown rebuilds need the graphify skill, not the bare CLI.** A bare `graphify . --update` over docs fails with "no LLM API key" (prose extraction needs an extractor). Run it through the installed **graphify skill** instead — there, Claude Code is the extractor via subagents, so no API key is required.
- `graphify-out/` generated artifacts (`graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`, `cost.json`) are **git-ignored, not committed** — they are machine-local and regenerable via `graphify update .`. Only `graphify-out/.gitignore` stays tracked. The graph does not ship with the repo; regenerate it locally.
