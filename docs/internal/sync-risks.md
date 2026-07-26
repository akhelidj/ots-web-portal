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

Characterization status: **risk #3** (client-side) and **risk #2** are characterized
(`sync-idempotency.characterization.spec.ts`, `clear-conflicts.characterization.spec.ts`).
**Risk #1** remains indexed here and will be characterized in a subsequent step.
