# Inspection Report Lifecycle — End-to-End Trace

> **Status: verified ground-truth** (authored from a read-only code trace). Part of the `docs/internal/` namespace — kept separate from the inherited `docs/` content, which is only partially accurate. Citations are `path:line` and were correct at time of writing; verify against current code before relying on an exact line.

## Orientation: there are two write paths, chosen per-call

Every mutating method in the frontend `portal/src/app/features/inspections/services/inspection-reports.service.ts` branches on `this.canUseNetwork`:

- **Online → server-first:** call the API directly, then store the canonical response with `syncState: 'SYNCED'` (e.g. create at `inspection-reports.service.ts:401-420`).
- **Offline (or the request throws an "offline error") → queue:** write an optimistic local row with a temporary id + `syncState: 'PENDING'`, then enqueue an outbox item.

The trace below follows the **offline path**, which is the interesting one.

---

## Hop 1 — Create on device (offline)

`CreateInspectionReportComponent` → `InspectionReportsService.createReport()` at `portal/.../inspection-reports.service.ts:396`.

Offline branch (`:423-449`):

- Mints a **temporary client id**: `` `local-ir-` + crypto.randomUUID() `` (`:423`).
- Builds a `LocalInspectionReport` with `status: 'DRAFT'`, `version: 1`, and **placeholder template fields** — `templateVersion: 1` and `templateHash: ''` are explicitly marked `// Just dummy for offline` (`:429-431`). The real binding is filled in by the server on sync (Hop 7).
- Writes it locally, then enqueues.

## Hop 2 — IndexedDB via local repo

`irRepo.upsert(newReport)` at `:436` → `InspectionReportLocalRepo.upsert`, a raw IndexedDB `objectStore.put` into the `inspection_reports` store (`portal/src/app/core/offline/repos/inspection-report-local.repo.ts:40-53`). It fires a `changes$` `BehaviorSubject` so the UI reacts. DB handle/tenant scoping is owned by `DbService`.

## Hop 3 — Outbox enqueue

`this.outbox.enqueue({...})` at `inspection-reports.service.ts:438-449`:

- `entityType: 'INSPECTION_REPORT'`, `operation: 'CREATE'`, `entityId: tempId`, `payload: { customerId, poNumber, templateKey }`, plus **two independent UUIDs** — `id` and `idempotencyKey`.
- `OutboxService.enqueue` (`portal/src/app/core/offline/services/outbox.service.ts:66`) forces `status: 'PENDING'`, `attemptCount: 0`, persists via `OutboxLocalRepo.upsert` (`.../repos/outbox-local.repo.ts:53`) into the `outbox` store, and bumps the `pendingCount` signal.

> **Confirmed gap:** the `idempotencyKey` is generated (`inspection-reports.service.ts:440`) and stored, but **the dispatcher never sends it** to the API (no header/body carries it — see Hop 6). The documented idempotency guarantee is not wired end-to-end for this operation.

## Hop 4 — Sync trigger

Connectivity is signal-driven. `ConnectivityService` (`portal/src/app/core/offline/services/connectivity.service.ts:12`) tracks `browserOnline` (from `navigator.onLine` + window events) **and** `apiReachable`, combined into an `isOnline` computed, with a `refreshReachability()` probe (`:69`).

`SyncOrchestratorService` (`.../sync-orchestrator.service.ts:52`) runs an `effect` over `isOnline`, `isAuthenticated`, `hasConflict`, `pendingCount`. When online, authenticated, no conflicts, and `pendingCount > 0`, it calls `scheduleAutoSync()` (`:89`) — a debounced auto-run with a **2500 ms cooldown** (`:46, :96-128`). `runSyncSequence()` (`:130`) does: `refreshReachability()` → `outbox.processQueue()` → `hydration.hydrateAll({includeRemote:true, throwOnError:true})`.

## Hop 5 — Outbox drain (ordering + dependency gating)

`OutboxService.processQueue` (`outbox.service.ts:76`):

- Pulls PENDING items **sorted by `createdAt` ascending** (`OutboxLocalRepo.getPendingItems:32-35`) — FIFO, so a report's CREATE precedes its children's ops.
- Builds a `skipEntities` set from existing CONFLICT items (`:91-94`).
- **Re-fetches each item fresh from DB before dispatch** (`:98`) — critical, because an earlier item's success rewrites later items' ids (Hop 8).
- If an item depends on a conflicted entity (either its `entityId` or its `payload.inspectionReportId` is in `skipEntities`), it's marked `CONFLICT` with `'Dependency is in CONFLICT'` and skipped (`:101-113`) — conflict **cascades** to dependents.
- Otherwise `dispatcher.dispatch(item)` (`:117`); on success `SYNCED`, on 409/`ConflictError` → `CONFLICT` + add to `skipEntities` (`:128-131`); other 4xx → `FAILED`; 5xx/unknown → back to `PENDING` (`:132-140`).

## Hop 6 — Dispatch → API

`SyncDispatcherService.dispatch` (`portal/src/app/core/offline/services/sync-dispatcher.service.ts:38`) switches on `` `${entityType}:${operation}` ``. For `INSPECTION_REPORT:CREATE` (`:185-228`) it does `POST ${apiUrl}/inspection-reports` with `item.payload`. (Bare payload — **no idempotency key header/body**, confirming the Hop 3 gap.)

## Hop 7 — NestJS create + template-version binding lock-in

Route: `api/src/app/inspection-reports/inspection-reports.controller.ts:36-38` → `InspectionReportsService.createReport()` at `.../inspection-reports.service.ts:82`.

This is where binding locks in, inside a `$transaction` (`:154`):

1. Validate customer ∈ tenant (`:96-105`); derive report-number prefix.
2. **Resolve the template** (`:124-141`): look up the `Template` row for this tenant with `status: 'ACTIVE'`, `orderBy templateVersion desc` (newest active).
3. **Copy the binding fields once** into the new report (`:161-164`): `templateKey`, `templateVersion` (Int), `templateHash` — plus `version: 1`, server-generated `reportNumber`, `status: DRAFT`.
4. Write an `auditLog` `CREATE` row in the same transaction (`:171-180`).

The binding is denormalized scalars, immutable after creation, and later **validated** on every snapshot (`api/src/app/revision/revision.service.ts:56-60`). The schema still carries a nullable `templateVersionId` FK, but the relation is named `legacyTemplateVersion` (`api/prisma/schema.prisma:126, :148`) — the old `TemplateVersion` model is legacy; live logic runs off the scalar fields. `Template` (with `fileBlob`) is authoritative; `TemplateVersion` (with `mappingJson`) is legacy.

> **Intentional constraint (not a bug):** the client sends `templateKey` in the payload (`inspection-reports.service.ts:445`), but this live method **ignores it and hardcodes** `const templateKey = 'DRILL_PIPE_REPORT'` (`api/.../inspection-reports.service.ts:125`). The system supports one template today; multi-template is planned. A **second, divergent create implementation** exists — `InspectionReportWorkflowService.create` (`api/src/app/workflow/inspection-report-workflow.service.ts:32-83`) — which _does_ honor `dto.templateKey` (`:39-45`) but generates **no `reportNumber`**, and is **not wired to any route** (the workflow controller only exposes transitions). It is the intended seam for multi-template expansion.

## Hop 8 — Temporal-ID remapping (the temp→real swap)

Back in the dispatcher after the 201 (`sync-dispatcher.service.ts:193-226`):

1. `irRepo.remapId(tempId, {...createRes, syncState:'SYNCED'})` — `remapId` deletes the `local-ir-…` row and puts the server row under its real UUID, in **one IndexedDB transaction** (`inspection-report-local.repo.ts:74-91`).
2. `snRepo.remapReportId(tempId, createRes.id)` (`sync-dispatcher.service.ts:201`) — repoints any already-local serial numbers to the real report id.
3. **Rewrites still-pending outbox items** (`:203-226`): any pending `INSPECTION_REPORT` item whose `entityId === tempId`, or `SERIAL_NUMBER` item whose `payload.inspectionReportId === tempId`, is updated to the new id. Combined with the fresh re-fetch in Hop 5, this is how child writes queued offline resolve their parent's real id.

**Serials use a different remap key — `clientRef`.** `SERIAL_NUMBER:BULK_CREATE` (`sync-dispatcher.service.ts:295-346`) posts `{items:[{clientRef, serialNumber}]}`; the server (`api/src/app/serial-numbers/serial-numbers.service.ts:50-165`) creates each with `version: 1` (`:137`) and echoes back `{clientRef, id, serialNumber, version}` (`:156-160`); the client matches on `clientRef` to remap each local serial (`sync-dispatcher.service.ts:320-344`). Same pattern for USER, CUSTOMER, CHILD_REPORT, APPROVAL_BATCH creates.

## Hop 9 — Workflow transitions

Once the report has a real id, edits/transitions sync. `INSPECTION_REPORT:TRANSITION` (`sync-dispatcher.service.ts:252-293`) posts to `/inspection-reports/:id/transitions` → `InspectionReportWorkflowService.transition` (`api/src/app/workflow/inspection-report-workflow.service.ts:178`):

- **Version check** (`:203-205`) → 409 on mismatch.
- **Role/matrix** enforcement via `INSPECTION_REPORT_TRANSITIONS` + special ON_HOLD restore logic (`:207-260`).
- **PENDING_APPROVAL validation gate** (`:270-315`): requires ≥1 serial, each with a disposition, and for `DRILL_PIPE_REPORT` all 30 `DRILL_PIPE_REQUIRED_KEYS` present (`:18-28, :295-303`); otherwise a structured `VALIDATION_FAILED` 400.
- **Atomic commit** via guarded `updateMany where version` (`:354-365`), then transition-log + audit-log rows.
- **Revision snapshot** on first approval or reopen (`:389-405`) → `RevisionService.createInspectionReportSnapshot` (`api/src/app/revision/revision.service.ts:20`): builds a deterministic `snapshotJson` (sorted serials/child reports/logs, `:32-46, :69-109`), writes an immutable `InspectionReportRevision` with `revisionNumber = current+1` (`:112-123`), and bumps the parent's `revisionNumber` (`:128-131`).

## Hop 10 — Approval-batch pipeline

Client ops `APPROVAL_BATCH:SUBMIT/APPROVE/RETURN` (`sync-dispatcher.service.ts:514-735`) map to server methods in `api/src/app/inspection-reports/inspection-reports.service.ts`:

- `submitForApproval` (`:302`) — checks `reportVersion` (`:319-321`), moves serials to submitted, bumps report version (`:466-469`).
- `approveBatch` (`:489`) — checks **both** `batchVersion` (`:513-515`) **and** `reportVersion` (`:523-525`); on full approval bumps report version (`:666`); returns `{updatedReport, batch}` which the client re-caches (`sync-dispatcher.service.ts:610-637`).
- `returnBatch` (`:750`) — same dual version guard (`:780-792`).

---

## Optimistic concurrency — where `version` / 409 live (all confirmed)

The pattern is a **read-compare-then-guarded-write** (belt-and-suspenders):

- Client always sends the last-known `version` in the payload (e.g. update `inspection-reports.service.ts:496`, transition `:570`).
- Server compares against the freshly-read row → `ConflictException` (updateReport `api/.../inspection-reports.service.ts:201`), **and** re-checks inside the transaction with `updateMany({ where:{ version } })`, throwing again if `count === 0` (`:252-265`). The second check closes the read-write race window.
- Same dual pattern in `transition` (`inspection-report-workflow.service.ts:203` + `:354-365`) and serial updates (`serial-numbers.service.ts:298, :309`). Every successful write does `version + 1`.
- A **second, distinct 409**: duplicate serial values within a report raise `ConflictException` too (`serial-numbers.service.ts:99, :122`) — a uniqueness conflict, not an optimistic-lock conflict, but it surfaces to the client identically as a 409.

---

## Conflict resolution when the same report is edited offline _and_ online

**Confirmed from code:**

1. **Detection is version-based only.** A stale offline edit reaches the server with an old `version`; the server 409s. There is **no field-level merge or three-way reconciliation** server-side — it's reject-on-stale.
2. **On 409 the dispatcher marks the local entity `syncState: 'CONFLICT'`** and rethrows a `{status:409}` error (`sync-dispatcher.service.ts:749-782`); `processQueue` marks the outbox item `CONFLICT` and cascades to dependents (`outbox.service.ts:101-113, :128-131`).
3. **Hydration will NOT clobber the local edit.** `pullAllAndCache` only overwrites rows that are absent or already `SYNCED` — it explicitly skips `PENDING`/`CONFLICT`/`ERROR` rows (`inspection-reports.service.ts:299, :325`). There is even a **field-level safeguard** that merges a locally-set disposition back onto server serial data if the server's is missing (`:328-358`).
4. **Resolution is manual and destructive-to-local.** The only resolution primitive is `OutboxService.clearConflicts()` (`outbox.service.ts:59-64`) → `OutboxLocalRepo.clearConflicts` (`outbox-local.repo.ts:74`), which **deletes** every `CONFLICT`/`FAILED` outbox item (`:84-90`). The queued local change is **discarded** — effectively **server-wins, with the user's offline edit thrown away**. There is no UI diff/merge step in the code traced.

**Uncertain — needs runtime verification:**

- **How a conflicted _entity row_ returns to `SYNCED`.** `clearConflicts` only touches the outbox and the `hasConflict` signal — it never resets the entity's `syncState`. And `pullAllAndCache` refuses to overwrite a non-`SYNCED` row (`:299, :325`). No code path was found that flips an entity from `CONFLICT` back to `SYNCED` or force-refetches server truth over it. A conflicted report row may stay stuck showing stale local data flagged `CONFLICT`. **Test this first on a real device.**
- **True concurrent-write timing.** Whether two near-simultaneous online writes can interleave between the read and the guarded `updateMany` — the double-check makes this very unlikely, but unproven without a DB-level test.
- **Idempotency on retry.** Because the `idempotencyKey` is never transmitted (Hop 3/6), a 5xx that actually committed server-side but failed to return would, on the automatic `PENDING` retry, create a **duplicate**. The key is confirmed not-sent; no server-side dedup for these routes was seen.

---

## Docs vs. reality — flagged for spec cross-check

1. **Template binding key is hardcoded.** `docs/architecture/inspection-report-template-binding.md:9` says creation "looks up the currently ACTIVE version of the requested Template (based on `templateKey`)." The live code hardcodes `'DRILL_PIPE_REPORT'` (`api/.../inspection-reports.service.ts:125`). This is intentional (single-template today), but the doc reads as if the requested key is honored. The doc's other claims — copy-at-creation, immutability, `templateVersionId` is legacy — match the code.
2. **Two create implementations, one dead.** The route uses `InspectionReportsService.createReport`; the `templateKey`-honoring `InspectionReportWorkflowService.create` is unwired. Docs describe one create flow.
3. **Idempotency claim not wired.** `docs/api/child-reports.md` and ticket F0.3.1 describe "idempotent POST via client-supplied UUID"; the client generates an `idempotencyKey`, but the dispatcher never sends it.
4. **`docs/architecture/pwa-offline-network-state-of-play.md` is stale (code advanced past it):** connectivity now has `apiReachable`/`refreshReachability`; `processQueue` calls the auth signal correctly (`outbox.service.ts:79`); PWA icons now exist in `portal/public/icons/`; the orchestrator auto-syncs (`sync-orchestrator.service.ts:96-128`) despite the doc's "manual-sync V1" framing.
5. **No doc specifies conflict-resolution semantics.** None of the architecture docs describe what happens to a conflicted entity after a 409. Given the "stuck CONFLICT" uncertainty above, that's a spec gap worth closing.
