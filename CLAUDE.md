# CLAUDE.md — OTS Web Portal

Working reference for this monorepo. Captures what prior discovery established so sessions don't re-derive it. Treat as ground truth for orientation; treat `docs/` as intent-to-verify (see Doc Drift). Verified documentation we author lives under `docs/internal/`.

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
- **Revision-snapshot engine** (`RevisionService`) fires on **first approval** and **reopen**, writing an immutable deterministic `snapshotJson` + incrementing `revisionNumber`. Snapshots validate template binding.
- **PENDING_APPROVAL gate:** transitions into approval require ≥1 serial, each with a disposition, and (for `DRILL_PIPE_REPORT`) all required inspection fields present — else a structured `VALIDATION_FAILED` 400.

## ⚠️ Offline-Sync Core — HIGHEST-RISK SUBSYSTEM

Location: `portal/src/app/core/offline/`. The most load-bearing and least-safe code in the repo.
**Full lifecycle trace: `docs/internal/report-lifecycle-trace.md`**

Flow: optimistic local write (IndexedDB) → **outbox** enqueue → **SyncOrchestrator** (auto-runs on reconnect, 2.5s cooldown) → **SyncDispatcher** → API → **temporal-ID remap** → hydrate.

- **Temporal-ID remap:** offline rows get temp ids (`local-ir-…`); on sync the server UUID replaces them and pending outbox items are rewritten to the real id. **Serials remap by `clientRef`** (server echoes `clientRef`→real id).
- **Drain is FIFO** by `createdAt`; a 409 marks the entity/outbox item `CONFLICT` and **cascades** to dependents.

**Three UNVERIFIED risks from the lifecycle trace — needs runtime verification. Do NOT modify sync code without a test first:**

1. **Stuck CONFLICT:** no code path resets a `CONFLICT` entity row back to `SYNCED`; hydration refuses to overwrite non-`SYNCED` rows. A conflicted report may stay stale/flagged forever.
2. **`clearConflicts` discards local edits** — it deletes the queued outbox item (server-wins, **no merge**, no diff UI). The user's offline edit is thrown away.
3. **`idempotencyKey` is generated but never transmitted** — a 5xx that actually committed, then auto-retries, can create a **duplicate**. No server-side dedup seen on the create path.

## Intentional Constraints (NOT bugs — do not "fix")

- **`templateKey` is deliberately hardcoded to `'DRILL_PIPE_REPORT'`** in the live create path (`InspectionReportsService.createReport`). The system supports one template today; **multi-template is planned future work**. `InspectionReportWorkflowService.create` is an **unwired** path that already honors `dto.templateKey` — the intended seam for that expansion.
- **`Template` (with `fileBlob`) is authoritative.** `TemplateVersion` (with `mappingJson`) is **legacy** — surfaced only via the nullable `legacyTemplateVersion` FK. Don't build new logic on it.

## Testing / CI Reality

- **Zero tests. Zero CI.** `unitTestRunner: none` / `e2eTestRunner: none` set at scaffold; `@nestjs/testing` installed but unused; no `.github/workflows`.
- Consequence: **every change needs manual verification.** Production has real clients and no automated safety net — be conservative, especially around sync, audited workflows, and migrations.

## Conventions & Tooling

- **Prefer the Graphify MCP tools over Grep/Glob for structural questions** (god nodes, dependencies, cross-boundary relationships). The graph is in `graphify-out/` — **keep it committed**; refresh with `/graphify . --update`.
- **Use Context7** for version-accurate NestJS 11 / Angular 21 / Prisma docs when changing framework internals.
- Match surrounding code style; this is read-then-write territory given no tests.

## Known Doc Drift (`docs/` is rich but partially stale)

Treat the inherited `docs/` as **intent-to-verify, not ground truth**, until a spec-vs-reality pass is done. (Our own verified docs go in `docs/internal/`.) Known gaps:

- `milestones.md` / `architecture/README.md` reference **T0.5.x tickets that don't exist** in `docs/tickets/`.
- README lists npm scripts that **don't exist** (`db:provision`, `verify:auth`).
- `architecture/pwa-offline-network-state-of-play.md` **predates current code** — several "broken" items (browser-only connectivity, missing PWA icons, `processQueue` auth bug) are already fixed; its "manual-sync V1" framing contradicts the actual auto-sync.
- Template-binding doc reads as if create honors the requested `templateKey`; the live path hardcodes it (see Intentional Constraints).
