# Known Issues

Standing, verified technical issues in the OTS Web Portal. Each entry states current
behavior as fact with source anchors (`path:line` — correct at time of writing;
verify against current code before relying on an exact line). Only durable technical
facts are recorded here — not cleanup sequencing or counts.

## Offline-sync core (`portal/src/app/core/offline/`)

Confirmed defects in the sync engine (all three now resolved). Full flow: `docs/architecture/report-lifecycle.md`.

### 1. A conflicted entity row never returns to SYNCED — RESOLVED

A 409 still parks the edit and flags the row `CONFLICT`, and hydration still never overwrites a `CONFLICT` row (pinned by `conflict-terminal.spec.ts`) — that is deliberate, so the user's work is never silently replaced. Recovery is now explicit: the **Sync conflicts** screen (`features/sync-conflicts`, route `/sync-conflicts`, linked from the header when a conflict exists) driven by `ConflictResolutionService` (`core/offline/conflicts/`). For plain updates (report, serial inspection data, customer, child report) it fetches the server's current record and shows a field-by-field diff; the user keeps their values, the server's, or a mix. Other operations offer _Try again_ or _Discard my change_. Edits queued behind the conflict are released with their expected versions rebased. Covered by `conflict-merge.spec.ts` and `conflict-resolution.service.spec.ts`.

### 2. `clearConflicts` discards the local edit — RESOLVED

`OutboxService.clearConflicts()` only deletes `CONFLICT`/`FAILED` items (never retryable `PENDING` ones; pinned by `clear-conflicts.spec.ts`). Users are no longer pushed to it: the merge screen above resolves each conflict individually and preserves the local edit unless the server's version is chosen.

### 3. `idempotencyKey` is generated but never transmitted — RESOLVED

Every queued operation keeps the `idempotencyKey` minted at enqueue, and `SyncDispatcherService` sends it as the `Idempotency-Key` header on every retry (`sync-idempotency.spec.ts`). On the API, a global `IdempotencyInterceptor` (`api/src/app/common/idempotency/`) executes a mutating request once per `(tenant, user, key)` and answers repeats from the stored response (table `IdempotencyKey`, 7-day retention), so a 5xx or lost response that actually committed can no longer create a duplicate or surface as a phantom version conflict. Failed requests store nothing, so a genuine failure retries normally; an in-progress key answers a retryable 503 and an abandoned one (>2 min) is taken over. Requests without the header behave exactly as before.

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

These two string-coercion artifacts came from the retired legacy drill-pipe mapper and were carried into the engine's `objectListJoin` / `stringListJoin` transforms (`api/src/app/export/export-engine.ts`). Both are fixed.

### 13. `{{equipment}}` rendered the literal `"undefined"` for a name-less entry — RESOLVED

A name-less `equipmentUsed[]` entry now renders its number alone (`#3`) and an entry with neither name nor number is skipped. Pinned by `export-engine.equivalence.spec.ts` (G1b); well-formed entries are unchanged and still match the frozen golden output.

### 14. `{{methods}}` rendered `"[object Object]"` for a name-less object entry — RESOLVED

Objects contribute their `name`; one without a name is skipped. Same spec.

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

### 10-12. Spec typing and strict-null friction — RESOLVED

The spec tsconfigs resolve like the app and both apps' specs are type-checked in CI (`npm run typecheck`), which cleared the phantom errors (#10) and the latent spec type errors (#11). The JWT secret is read with `getOrThrow` and the export controller rejects a non-numeric `revisionNumber` (#12).

## Portal UI

### 16. Child-report route renders a blank page when no child exists — RESOLVED

When `GET /child-reports/:id` finds nothing, the page now shows a "Child report not found" state with a **Go back** button instead of an empty area.

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

### 19. Approval-batch auto-approval writes no revision snapshot — RESOLVED

`InspectionReportsService.approveBatch` now takes the same first-approval snapshot as the direct `APPROVED` transition when the parent flips to `APPROVED` with `revisionNumber === 0` (same transaction, after the transition log, before supervisor signatures are applied). Pinned by `revision-snapshot.integration.spec.ts`. **Not backfilled:** reports batch-approved before this fix still have `revisionNumber = 0` and export live, as before.
