# ADR-0006 — Offline-sync core

**Status:** Accepted (standing decision)

## Context

Inspectors work in the field without connectivity. Writes must succeed offline and later
reconcile in dependency order (a report's children can't sync before the report exists
server-side).

## Decision

Optimistic **local-first** writes to IndexedDB with temporary ids (`local-ir-…`) and
`syncState: 'PENDING'`, then an **outbox** enqueue. On reconnect the `SyncOrchestrator`
auto-runs (debounced, ~2.5s cooldown): refresh reachability → drain the outbox **FIFO by
`createdAt`** → hydrate. The dispatcher posts per `entityType:operation`; on success it
performs **temporal-ID remap** (temp → real server UUID; serials remap by `clientRef`)
and rewrites still-pending outbox items to the real id. A 409 marks the entity/item
CONFLICT and **cascades** to dependents. Anchors: `sync-dispatcher.service.ts`,
`outbox.service.ts:66,:76`, `sync-orchestrator.service.ts`, `offline/models/types.ts`.

*Why not the alternatives:* online-only is unusable in the field; a generic sync
framework is heavy and opinionated; last-write-wins loses data.

## Consequences

Full offline capability with deterministic drain ordering and dependency gating (parent
CREATE always precedes child ops; children can reference an unsynced parent via temp-ID
remap). Costs: this is the **highest-risk subsystem** and carries three standing defects
— terminal CONFLICT, over-deleting `clearConflicts`, and the untransmitted
`idempotencyKey` (KNOWN-ISSUES #1–#3). Any new synced entity must define its dispatch
case, remap key, and outbox dependencies or it desyncs.
