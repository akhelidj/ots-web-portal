# Known Issues

Standing, verified technical issues in the OTS Web Portal. Each entry states current
behavior as fact with source anchors (`path:line` — correct at time of writing;
verify against current code before relying on an exact line). Only durable technical
facts are recorded here — not cleanup sequencing or counts.

## Offline-sync core (`portal/src/app/core/offline/`)

Three confirmed defects in the sync engine. Full flow: `docs/architecture/report-lifecycle.md`.

### 1. A conflicted entity row never returns to SYNCED

When the server 409s a stale offline write, the dispatcher marks the local row
`syncState: 'CONFLICT'` (`sync-dispatcher.service.ts:751`). No code path ever resets
it to `'SYNCED'`: `pullAllAndCache` overwrites a row only when it is absent or already
`'SYNCED'`, explicitly skipping `CONFLICT`/`PENDING`/`ERROR`
(`inspection-reports.service.ts:299, :325`).
**Impact:** a conflicted report can stay stuck showing stale local data flagged
CONFLICT indefinitely.
**Confidence:** confirmed at code level; the end-to-end "stuck forever" outcome needs
runtime/device confirmation.

### 2. `clearConflicts` discards the local edit (over-delete FIXED)

The only resolution primitive — `OutboxService.clearConflicts()` (`outbox.service.ts`; UI trigger `shell.component.ts`) — hard-deletes every outbox item whose status is `CONFLICT` or `FAILED` (`outbox-local.repo.ts`). It no longer touches retryable `PENDING` items that merely recorded a transient error (that over-delete is fixed and pinned by `clear-conflicts.spec.ts`). Entity stores are left untouched.
**Impact (remaining):** server-wins with no merge or diff UI — the user's queued offline edit is thrown away, while the entity row remains CONFLICT (see #1).

### 3. `idempotencyKey` is generated but never transmitted — RESOLVED

Every queued operation keeps the `idempotencyKey` minted at enqueue, and `SyncDispatcherService` sends it as the `Idempotency-Key` header on every retry (`sync-idempotency.spec.ts`). On the API, a global `IdempotencyInterceptor` (`api/src/app/common/idempotency/`) executes a mutating request once per `(tenant, user, key)` and answers repeats from the stored response (table `IdempotencyKey`, 7-day retention), so a 5xx or lost response that actually committed can no longer create a duplicate or surface as a phantom version conflict. Failed requests store nothing, so a genuine failure retries normally; an in-progress key answers 409 and an abandoned one (>2 min) is taken over. Requests without the header behave exactly as before.

## API-side data / validation

### 4. Disposition source — RESOLVED (0de2e3f)

Resolved. Disposition is now resolved everywhere through one
shared `resolveDisposition(data, definition)` (`approval-gate.ts`), a first-truthy
coalesce over the template's declared `disposition.source`. The drill-pipe definition
was corrected from the phantom `["final.disposition","disposition"]` (plus a separate,
contradictory `syncedFrom: body.emiResult`) to the single true path
`source: ["body.emiResult"]`, and the gate, the serial/child disposition-column sync,
the revision snapshots (`revision.service.ts`), the export sort (`export.service.ts`),
and every portal surface (validation, serial tables) all read
through it — server and its portal mirror (`definition-to-form-schema.ts`) cannot
diverge on where disposition lives. Existing immutable snapshots recorded
`disposition: null` under the old read but embed the full `inspectionData`, so export
re-derives disposition at read time — no backfill. See #18 for the disposition /
required-field coupling this surfaced.

### 5. Global exception filter flattens structured HttpException bodies — RESOLVED

`AllExceptionsFilter` (`api/src/app/common/filters/all-exceptions.filter.ts`) now reads `.getResponse()`: `message` stays the exception's message string (what the portal reads) and the structured fields (`code`, `missingDispositionSerials`, `missingRequiredFields`, …) ride alongside it. In production an unexpected fault returns a generic message and no stack.

### 6. Environment variables are not validated at boot — RESOLVED

`ConfigModule` runs `validateEnv` (`api/src/app/config/env.validation.ts`) at startup: `DATABASE_URL` and `JWT_ACCESS_SECRET` are required, numeric settings must be positive integers, and `STORAGE_DRIVER` must be `local` or `s3` (with its bucket/region). All problems are reported in one error. A production JWT secret under 32 characters only logs a warning.

### 18. On drill-pipe the disposition source is also a required field — a missing disposition always reports as two failures

The drill-pipe definition maps disposition from `body.emiResult`
(`disposition.source: ["body.emiResult"]`), and `body.emiResult` is _also_ a
`required: true` item field (the EMI-result `select`). So a drill-pipe serial with no
`body.emiResult` is, by construction, both (a) missing its disposition and (b) missing a
required field. `engineGate` (`approval-gate.ts`) runs those two checks independently, so
it reports such a serial in **both** `missingDispositionSerials` **and**
`missingRequiredFields` — there is no "missing disposition only" state for this template.
This is an inherent property of the template's field mapping (one field serves two roles),
**not a defect**; the two validations are simply coupled because they read the same field.
Confirmed live: a blank-EMI serial surfaces in both arrays of the `VALIDATION_FAILED` body.

**Converse (a template that maps disposition to a non-required field): the gate still
catches it.** The disposition check is gated solely on
`disposition.requiredForApproval` and reads the declared source through
`resolveDisposition` — it does **not** depend on the source path also being a required
field. So if a future template maps disposition to a field that is _not_ `required`,
a serial with no disposition still fails approval via `missingDispositionSerials`
whenever `requiredForApproval: true`, even though required-field validation passes. The
only way a disposition-less serial clears the gate is when `requiredForApproval` is
`false`/absent — the intended "disposition not required" semantics (e.g. the seeded
`SQUARE_KELLY` / `BOX_BOX_CROSSOVER` templates, which declare no disposition and gate on
required fields only), not a gap. Net: `requiredForApproval` is the real control; the
gate does not rely on drill-pipe's source doubling as a required field. See #4.

## Export mapping quirks

These two are string-coercion artifacts that originated in the retired legacy drill-pipe
mapper. They are **deliberately preserved** in the definition-driven engine's
`objectListJoin` / `stringListJoin` transforms (`api/src/app/export/export-engine.ts`),
which `export-engine.equivalence.spec.ts` pins. Correcting them changes export output, so
it must be a separate, deliberate change.

### 13. `{{equipment}}` renders the literal `"undefined"` for a name-less entry

The `objectListJoin` transform (`export-engine.ts`) joins `${e.name}` plus an optional
` #number` suffix. When an `equipmentUsed[]` entry has no
`name`, `${e.name}` coerces `undefined` to the string `"undefined"`, so the cell reads
e.g. `"undefined #3"` instead of omitting the name.
**Impact:** cosmetic — a malformed equipment entry surfaces `"undefined"` in the export.
Fix post-migration by guarding the name (`e.name ?? ''`).

### 14. `{{methods}}` renders `"[object Object]"` for a name-less object entry

The `stringListJoin` transform (`export-engine.ts`) maps `typeof m === 'string' ? m : m.name || m`. An object entry lacking `name` falls
through `m.name || m` to the object itself, which `join` coerces to `"[object Object]"`.
**Impact:** cosmetic — a malformed method entry surfaces `"[object Object]"`.
Fix post-migration by coercing the fallback to a string (`m.name ?? ''`).

## Type system / upstream friction

### 7. ExcelJS / JSZip buffer loads require `as unknown as` casts

Newer `@types/node` makes `Buffer` generic (`Buffer<ArrayBufferLike>`), while ExcelJS's
`load(buffer: Buffer)` and JSZip's `loadAsync` type defs have not caught up
([exceljs #2877](https://github.com/exceljs/exceljs/issues/2877)). Buffer loads are cast
as `as unknown as …` rather than plain-annotated. Sites: the `workbook.xlsx.load(...)` / `zip.file(...)` calls in
`export.service.ts` and the JSZip loads in `mappings/xlsx-token-engine.ts`. Upstream type lag, not a
code smell — the casts are the honest form until the defs update.

### 9. Prisma `JsonValue` is not directly indexable

`snapshotJson` and `inspectionData` are typed by Prisma as the recursive `JsonValue`
union, which cannot be indexed. Reads go through the authored `Snapshot` /
`InspectionData` interfaces (`api/src/app/common/inspection-data.types.ts`), not direct
property access.

## Build / test tooling

### 10. Portal spec tsconfig cannot type-check (phantom errors)

`portal/tsconfig.spec.json` uses `moduleResolution: node`, under which Angular's
package-`exports` entrypoints (`@angular/common/http`, `@angular/core/testing`, …) fail
to resolve (9× `TS2307`). That cascades into ~110 phantom errors (e.g. 81 in
`sync-dispatcher.service.ts`, 29 in a portal service — `TS2571`/`TS18046`/`TS2698`). The
app build (`moduleResolution: bundler`) compiles the same files at **0 errors**. These
are a spec-tsconfig misconfiguration, not real type violations. Fix: align spec
resolution with the app so the spec suite becomes type-checkable.

### 11. Two latent type errors invisible to Jest (swc transpile, not tsc)

Jest transpiles with swc, so neither fails tests today:
(a) `api/src/app/export/export.integration.spec.ts` — `TS2352` `cell.value` cast;
(b) `portal/src/test-setup.ts` — `TS2307` `node:v8` unresolved under app config
`types: []`.

### 12. JWT secret and revision number reach strict-null-check sites as possibly-undefined

`jwt.strategy` passes `secretOrKey: string | undefined`; `export.controller` parses a
possibly-`NaN`/`undefined` `revisionNumber`. Genuine `strictNullChecks` cases — read
the intended runtime contract before "fixing" either.

## Portal UI

### 16. Child-report route renders a blank page when no child exists

The child-report route — `reports/:id/child` (all roles;
`app.routes.ts:70, :92, :107, :122, :133`) → `ChildReportDetailComponent` — pulls
the child via `GET /child-reports/:id` (`child-report-detail.component.ts`). When the
parent has no generated child report, that request 404s; the component logs "Failed to
pull child report …" and leaves the main content area empty — no not-found or
empty-state UI. In practice the route is not linked while a serial's child is
"Not Generated", so it is reached only by a typed/stale URL.
**Impact:** cosmetic/edge — a customer (or any role) who lands on the route directly
sees a blank page rather than an explanatory empty state. Fix: render a not-found /
"no child report" state on the 404.

### 17. Serials-table column labels/group titles are only as good as the template definition

Both serials tables — the ops table and the customer document table — derive their
column headers and group bands entirely from the template's item-scope form sections
via the shared `buildSerialColumnGroups` (`sections/serial-matrix.ts`): a group band is
`section.title` and each column header is `field.label`, verbatim, with no fallback
prettifier. A well-authored definition (e.g. the seeded NOBLECORP template) renders
clean group titles ("Box Connection", "Pin Connection") and friendly labels ("Min OD").
A rough or under-authored definition renders exactly what it declares — raw field keys
as labels (`od_1`, `thread_type_1`, `summaru_results` [sic]) and an empty group-band
title when a section has no `title`. Observed on the hand-made drill-pipe test report
`NCO-260827-235132`.
**Impact:** none functional — this is authoring/data quality surfaced faithfully, not a
rendering fault, and because the derivation is shared it looks identical in the ops and
customer tables (so a customer sees the same raw keys an admin does). Recorded so a
raw-key header is not later mistaken for a rendering bug. Fix belongs in the template
definition (author section titles / field labels), not in the table components.

**Cross-template confirmation (customer document view).** Verified the customer
document surface against a _second_ seeded template (`NCO-260901-101413`), whose
definition is authored independently of the NOBLECORP one. The shared derivation
renders that template's own group bands ("Box", "Pin") and its own column labels
("OD", "CONDITION", "TONGUE SPACE", "THREAD TYPE", …) with no code change — the six
document sections (Identity, Specifications, Findings, Serials, Documents, History) and
the definition-driven serial columns are generic across templates. Its Specifications
block additionally renders the authored empty state ("This report's template has no
usable field definition yet…") when the definition declares no metadata fields — again
an authoring condition surfaced faithfully, not a rendering fault. Separately, that same
template's _export_ fails at the API with a `400` ("Repeating-row tokens span multiple
worksheet rows: row 41 … row 45"): its uploaded Excel template blob spreads row-scope
tokens across rows 41–45 instead of one repeating row (`export.service.ts:430`). That is
a template-blob authoring fault in the export mapper — a different subsystem from the
label derivation above, and likewise not a view/rendering fault.

## Revisions / export

### 19. Approval-batch auto-approval writes no revision snapshot

`InspectionReportsService.approveBatch` flips the parent to `APPROVED` once every serial and
batch is approved, but — unlike the direct `APPROVED` transition in
`InspectionReportWorkflowService.transition` — it never calls
`RevisionService.createInspectionReportSnapshot`. A report approved this way keeps
`revisionNumber = 0`, and `ExportService` then builds "revision 0" **live** from current rows
instead of from an immutable snapshot (`export.service.ts`, the `revisionNumber === 0` branch).
Re-approval after a reopen (`isFirstApproval` is only true while `revisionNumber === 0`) takes
no new snapshot on either path.
**Impact:** for batch-approved reports the export is not frozen at approval time — later edits
(e.g. after a reopen) show through; the audit guarantee of ADR-0001 only holds for the direct
transition and reopen snapshots. **Confidence:** confirmed at code level; verify end-to-end
before changing, since export, signatures and revision numbering all key off `revisionNumber`.
