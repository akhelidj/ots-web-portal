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

### 2. `clearConflicts` over-deletes and discards the local edit
The only resolution primitive — `OutboxService.clearConflicts()` (`outbox.service.ts:59`;
UI trigger `shell.component.ts:86`) — runs a cursor over the whole outbox store and
hard-deletes every item where
`status === 'CONFLICT' || status === 'FAILED' || item.lastError`
(`outbox-local.repo.ts:84`; the over-delete clause is `|| item.lastError` at `:87`).
That third clause also purges still-retryable `PENDING` items that merely recorded a
transient error. Entity stores are left untouched.
**Impact:** server-wins with no merge or diff UI — the user's queued offline edit is
thrown away, while the entity row remains CONFLICT (see #1).

### 3. `idempotencyKey` is generated but never transmitted
Every enqueue mints a `crypto.randomUUID()` idempotency key and stores it on the
`OutboxItem` (`inspection-reports.service.ts:116` and the other enqueue sites), but the
dispatcher never attaches it to any request — no header, not in the body
(`sync-dispatcher.service.ts:38`–`748`; the key is only logged at `:739`). A 5xx, or a
network error carrying no `status`, returns the item to `PENDING`
(`outbox.service.ts:135`) for a byte-identical retry.
**Impact:** a 5xx that actually committed server-side, then auto-retries, can create a
duplicate. No server-side dedup was found on the create paths.
**Confidence:** client-side facts confirmed; the "duplicate actually created" outcome
needs an integration/device scenario.

## API-side data / validation

### 4. PENDING_APPROVAL gate reads a disposition field production never writes
The approval gate decides disposition-presence from `inspectionData.final.disposition`
(falling back to top-level `inspectionData.disposition`)
(`inspection-report-workflow.service.ts:352`), and the same read builds the snapshot's
computed `disposition` (`revision.service.ts:111, :204`) and the export revision-0 build
(`export.service.ts:141`). But the live client schema (`drill-pipe-v1.schema.ts`) and the
app seed (`api/scripts/seed.ts`) write disposition into `inspectionData.body.emiResult`,
not `final.disposition` — the only producer of `final.disposition` is the test fixture
(`api/test/seed-helpers.ts`). The orphan fields are annotated with `// orphan:` comments
at `inspection-data.types.ts`.
**Impact (needs runtime confirmation):** for real data where both fields are absent, the
gate would flag every serial as missing a disposition despite `body.emiResult` being set.

### 5. Global exception filter flattens structured HttpException bodies
`AllExceptionsFilter` (`api/src/main.ts:18`) is a global catch-all that builds its
response from `.message`/`.stack`/`.getStatus()` and never reads `.getResponse()`
(`main.ts:25–31, :38`). NestJS collapses a structured response to its `message` string,
so a structured `{ code: 'VALIDATION_FAILED', missingDispositionSerials,
missingRequiredFields }` body from the approval gate is flattened to
`{ statusCode, message, stack }` in production. The integration suite has no HTTP/e2e
harness, so it never registers this filter and the structured body survives in tests
only. Fix: read `.getResponse()` to preserve structured bodies.

### 6. Environment variables are not validated at boot
`ConfigModule.forRoot({ ... })` (`api/src/app/app.module.ts:26`) is configured without a
`validationSchema`, so environment variables (e.g. `DATABASE_URL`, JWT secret, CORS
origins) are not checked at application startup. A missing or malformed value surfaces
only when first used at runtime, not as a fail-fast error at boot.
**Note:** observation from code — not tied to any particular validation library.

## Export mapping quirks

These two are string-coercion artifacts of the legacy drill-pipe export mapper
(`mappings/drill-pipe-report.v1.mapping.ts`). They are **deliberately preserved
byte-for-byte** by the definition-driven engine mapper (Phase B2) so the engine is
provably equivalent to legacy; they are to be corrected **post-migration as a
separate, deliberate change** (a fix would change export output and so must not ride
along inside an equivalence-preserving refactor). The engine's `objectListJoin` /
`stringListJoin` transforms reproduce them exactly.

### 13. `{{equipment}}` renders the literal `"undefined"` for a name-less entry
The equipment join is `` `${e.name}${e.number ? ' #'+e.number : ''}` ``
(`drill-pipe-report.v1.mapping.ts` `eqNames`). When an `equipmentUsed[]` entry has no
`name`, `${e.name}` coerces `undefined` to the string `"undefined"`, so the cell reads
e.g. `"undefined #3"` instead of omitting the name.
**Impact:** cosmetic — a malformed equipment entry surfaces `"undefined"` in the export.
Fix post-migration by guarding the name (`e.name ?? ''`).

### 14. `{{methods}}` renders `"[object Object]"` for a name-less object entry
The methods join is `map(m => typeof m === 'string' ? m : m.name || m).join(', ')`
(`drill-pipe-report.v1.mapping.ts` `mNames`). An object entry lacking `name` falls
through `m.name || m` to the object itself, which `join` coerces to `"[object Object]"`.
**Impact:** cosmetic — a malformed method entry surfaces `"[object Object]"`.
Fix post-migration by coercing the fallback to a string (`m.name ?? ''`).

## Type system / upstream friction

### 7. ExcelJS / JSZip buffer loads require `as unknown as` casts
Newer `@types/node` makes `Buffer` generic (`Buffer<ArrayBufferLike>`), while ExcelJS's
`load(buffer: Buffer)` and JSZip's `loadAsync` type defs have not caught up
([exceljs #2877](https://github.com/exceljs/exceljs/issues/2877)). Buffer loads are cast
as `as unknown as …` rather than plain-annotated. Sites: `export.service.ts:359, :387,
:413`; `mappings/drill-pipe-report.v1.mapping.ts:209, :428`. Upstream type lag, not a
code smell — the casts are the honest form until the defs update.

### 8. `@types/multer` is not installed
File-upload params cannot reference `Express.Multer.File` (unresolvable today):
`template.controller`, `template.service`, `template-validation.service`. Fix: install
`@types/multer`, or author a minimal `{ buffer: Buffer; originalname: string;
mimetype: string; size: number }` shape.

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

## Definition-driven cutover (`Template.definitionJson`)

### 15. REWORK rule is authored in the definition but not engine-consumed
The definition's `rules` block authors the REWORK child-report rule
(`rework-child-on-emi`), but no consumer reads it — `child-reports.service.ts`
(`syncReworkChildReport`) stays the sole authority via the hardcoded
`body.emiResult === 'REWORK'` check. See ADR-0009 ("the engine carries 3 of the 4
hardcoded locations"); Phase C must build the `rules` consumer before the hardcoded path
can be retired, or REWORK child creation would be silently dropped.
