# Offline-Sync Confirmed Risks — Characterization Index

Status: **confirmed by code trace** (Phase 2). Each risk below is a real defect in
the current offline-sync core (`portal/src/app/core/offline/`), verified against the
source at the anchors given. This file is the index that **Phase 3 (fixes) consults**:
each risk has a characterization test that pins _current_ (buggy) behavior. When a
Phase 3 fix lands, the corresponding assertion is **expected to flip** — a flipped
characterization assertion here reads as _"the fix worked,"_ not as a regression.

See the full trace narrative in [report-lifecycle-trace.md](report-lifecycle-trace.md).

## Conventions for characterization tests

- Test name states the current behavior as fact and tags the risk, e.g.
  `does NOT send idempotency key (KNOWN BUG: risk #3)`.
- The key assertion carries an inline comment:
  `// CHARACTERIZATION — pins current behavior. KNOWN BUG (risk #N), see docs/internal/sync-risks.md. Phase 3 fix will flip this.`
- These assertions are **designed to flip** in Phase 3. That is intended, not a break.

## The three confirmed risks

> Table cells avoid literal `|` characters so the Markdown table stays intact;
> the exact boolean conditions are quoted verbatim in the per-risk notes below.

| #   | Risk                              | Current behavior (fact)                                                                                                                                                                                                                                                                                                                                            | Anchor (file:line)                                                                                                                                                                                              | Char. test expected to FLIP in Phase 3 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | **CONFLICT is terminal**          | No code path resets an entity row from `syncState: 'CONFLICT'` back to `'SYNCED'`. Hydration skips any row whose local `syncState` is not `'SYNCED'`, so a conflicted row is fetched-but-never-overwritten and stays stale/flagged.                                                                                                                                | CONFLICT set: `sync-dispatcher.service.ts:751`; hydration skip guard: `inspection-reports.service.ts:299` and `:325`                                                                                            | **yes**                                |
| 2   | **`clearConflicts` over-deletes** | Cursor scans the whole outbox store and hard-deletes every item that is CONFLICT or FAILED, or that carries any truthy `lastError`. No merge, no diff. The `lastError` clause also purges still-`PENDING` items that merely recorded a transient error. Entity stores are untouched, so the local edit is discarded (never pushed) while the row stays `CONFLICT`. | delete condition: `outbox-local.repo.ts:84` (the `lastError` clause at `:87`); service wrapper: `outbox.service.ts:59`; UI trigger: `shell.component.ts:86`                                                     | **yes**                                |
| 3   | **Idempotency key not sent**      | A random `crypto.randomUUID()` is generated per operation and stored on `OutboxItem.idempotencyKey`, but the dispatcher never attaches it to any request (no header, not in the body). A 5xx retry re-sends a byte-identical request, so a 5xx that actually committed server-side creates a duplicate.                                                            | key generated: `inspection-reports.service.ts:116` (+ other enqueue sites); never attached in dispatch: `sync-dispatcher.service.ts:38`–748 (only logged at `:739`); 5xx→PENDING retry: `outbox.service.ts:135` | **yes**                                |

### Per-risk exact conditions (verbatim from source)

- **Risk #1 hydration guard** ([inspection-reports.service.ts:299/325](../../portal/src/app/features/inspections/services/inspection-reports.service.ts#L299)):
  `pullAllAndCache` only writes server truth over a local row when
  `!local || local.syncState === 'SYNCED'`, so a `CONFLICT` row is fetched but
  never overwritten. No path resets it to `SYNCED`. _Characterized by_
  `conflict-terminal.characterization.spec.ts` (real `fake-indexeddb` + real repos):
  a seeded `CONFLICT` row is left with its local values while fresh server truth is
  discarded. The spec also pins the dead reset path — `saveReportUpdates` PATCHing
  with the stale local version re-409s and rethrows rather than resetting (stable;
  documents "no reset" so a Phase 3 refactor does not mistake it for dead code).
- **Risk #2 delete condition** ([outbox-local.repo.ts:84-88](../../portal/src/app/core/offline/repos/outbox-local.repo.ts#L84)):
  the cursor deletes when
  `item.status === 'CONFLICT' || item.status === 'FAILED' || item.lastError`.
  The third disjunct (`|| item.lastError`) is the over-deletion: any item carrying a
  transient error string is purged even if it is still retryable `PENDING`.
  _Characterized by_ `clear-conflicts.characterization.spec.ts` (real
  `fake-indexeddb` cursor sweep). Survivor matrix pinned: seeding a CONFLICT item,
  a FAILED item, a PENDING item with a `lastError`, and a clean PENDING item, only
  the clean PENDING item survives. The spec also pins that `clearConflicts` opens
  transactions on the `outbox` store only — a seeded CONFLICT entity row is left
  byte-for-byte unchanged (the queued edit is discarded, the entity row is not
  reverted and stays `CONFLICT`).
- **Risk #3 branch** ([outbox.service.ts:133-137](../../portal/src/app/core/offline/services/outbox.service.ts#L133)):
  a caught dispatch error sets `FAILED` only when
  `err?.status && err.status >= 400 && err.status < 500`; every other outcome
  (5xx, or a network error with no `status`) falls through to `PENDING`, keeping the
  item queued for an identical retry.

## Testability at the portal unit boundary

- **Risk #1** — code-level unit test (seed a `CONFLICT` row, run `pullAllAndCache`, assert it is skipped).
- **Risk #2** — code-level unit test (`fake-indexeddb`: seed mixed statuses, call `clearConflicts`, assert exactly which survive).
- **Risk #3** — code-level unit test for the client-side facts (key-not-sent, 5xx→`PENDING`, 4xx→`FAILED`, identical retry) via `HttpTestingController`. The end-to-end _"duplicate row actually created"_ consequence needs an integration/device scenario and is out of scope for the unit boundary.

Characterization status: **all three risks are characterized** — risk #1
(`conflict-terminal.characterization.spec.ts`), risk #2
(`clear-conflicts.characterization.spec.ts`), and risk #3 client-side
(`sync-idempotency.characterization.spec.ts`). The only piece left to the unit
boundary is risk #3's end-to-end "duplicate row actually created" outcome, which
needs an integration/device scenario (see above).

## Block 3d-ii — API-side `emiResult` → `disposition` fixes (FIXED)

These are **API-side** (`api/src/app/`) defects surfaced while purging the
`no-explicit-any` Cast B casts, not part of the portal offline-sync core above.
Both were characterized as baseline in Block 3b, then **fixed and flipped in Block
3d-ii**. The `disposition` enum column (`SerialDisposition`: PASS/REWORK/SCRAP/HOLD)
is written in exactly two places — `serial-numbers.service.ts` (parent serial) and
`child-reports.service.ts` (child-report serial) — each of which lifted the raw
string `inspectionData.body.emiResult` into the enum column via `disp as any`.

| Fix                                     | Was (buggy)                                                                                                                                                                                                                           | Now (fixed)                                                                                                                                                                                                                                                                                                        | Anchor                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Membership check (both files)**       | `dataToUpdate.disposition = disp as any` — an arbitrary `emiResult` string reached the enum column and was rejected only by Prisma at query time (opaque, server-attributed error).                                                   | Runtime `Object.values(SerialDisposition).includes(...)` check; a valid member is assigned cast-free (`as SerialDisposition`), an invalid value throws `BadRequestException('Invalid disposition value: …')` **before any write**. Outcome preserved (invalid → still rejected), now detected honestly in-service. | `serial-numbers.service.ts` disp-sync block; `child-reports.service.ts` disp-sync block |
| **Child REWORK guard-gap (child only)** | The top-level guard rejected only `payload.disposition === REWORK`, but the persisted value comes from `emiResult`, which the guard never inspected — so `emiResult: 'REWORK'` bypassed it and wrote REWORK to a child-report serial. | After the membership check resolves the value, a resolved `REWORK` re-throws the **same** `BadRequestException('Child Report disposition cannot be REWORK.')`. The original top-level guard stays in place (defence in depth).                                                                                     | `child-reports.service.ts` disp-sync block                                              |

**Not applied to the parent path on purpose:** `serial-numbers.service.ts` has **no**
REWORK rejection. A parent serial marked REWORK via `emiResult` is the **sanctioned
trigger** `ChildReportsService.syncReworkChildReport` keys on (it filters parent
serials by `body.emiResult === REWORK` to spawn the rework child report). Guarding it
would break the entire rework workflow. This "REWORK accepted on the parent" baseline
is pinned by `serial-numbers-edit-guard.integration.spec.ts` (class-C, no-flip).

Flipped assertions (now assert the FIXED behavior as fact) in
`child-reports-serial-update.integration.spec.ts`:

- **REWORK-via-emiResult bypass** → now `rejects.toThrow(/disposition cannot be REWORK/)`,
  nothing persisted.
- **invalid emiResult** → now `rejects.toBeInstanceOf(BadRequestException)` (was a generic
  Prisma query-time throw), nothing persisted.

## Block 3c — `final.disposition` semantic orphan (LOGGED, not fixed)

Surfaced while authoring the shared `InspectionData` type
(`api/src/app/common/inspection-data.types.ts`) for the Block 3 Cast-B purge.
**API-side, not part of the portal offline-sync core above. Logged for the owner —
no behavior change in Block 3c.**

The PENDING_APPROVAL gate decides a serial's disposition-presence from
`inspectionData.final.disposition` (falling back to a top-level
`inspectionData.disposition`), but **neither field is written by the live client or
the app seed** — the real disposition is carried in `inspectionData.body.emiResult`
(the value both serial write paths actually persist to the `SerialDisposition`
column). So the gate reads a field production never produces.

| Fact                                                                                                                 | Anchor                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate reads `data.final?.disposition \|\| data.disposition` for the missing-disposition check                         | [inspection-report-workflow.service.ts:352](../../api/src/app/workflow/inspection-report-workflow.service.ts#L352)                          |
| Same `final.disposition \|\| disposition` read builds the snapshot's computed `disposition` sibling (parent + child) | [revision.service.ts:111](../../api/src/app/revision/revision.service.ts#L111), [:204](../../api/src/app/revision/revision.service.ts#L204) |
| Same read in the export revision-0 live-build                                                                        | [export.service.ts:141](../../api/src/app/export/export.service.ts#L141)                                                                    |
| Client form schema's `final` section defines only `isNew/isPremium/isC2/isScrap` — **no `disposition`**              | `portal/src/app/features/templates/schemas/drill-pipe-v1.schema.ts`                                                                         |
| App seed writes disposition into `body.emiResult`; its `final` has no `disposition`                                  | `api/scripts/seed.ts`                                                                                                                       |
| The **only** producer of `final.disposition` is the test fixture, written expressly to satisfy the gate              | `api/test/seed-helpers.ts`                                                                                                                  |

**Consequence (needs runtime confirmation, per repo convention for unverified risks):**
for real production data where `final.disposition` and top-level `disposition` are
both absent, the gate's `if (!disposition) missingDispositionSerials.push(...)` arm
would flag every serial as missing a disposition — even though `body.emiResult` is
populated. Whether real reports reach PENDING_APPROVAL by some other means, or the
client secretly emits `final.disposition` outside its declared schema, was not
verified at runtime; the code-level fact (gate reads a client-unwritten field) is
confirmed. The three orphan fields are annotated at the type definition
(`inspection-data.types.ts`, `final.disposition` / `final.condition_notes` /
top-level `disposition`) with `// orphan:` comments naming these read sites, so the
finding travels with the type. **Not fixed here** — the correct behavior (gate on
`body.emiResult`, or align the client to write `final.disposition`) is an owner
decision, not a mechanical Cast-B purge.
