# ADR-0002 — Optimistic concurrency everywhere

**Status:** Accepted (standing decision)

## Context

The system is offline-first and multi-client: the same entity can be edited on a device
and on the server concurrently. Pessimistic locks are impossible across the offline
boundary.

## Decision

Every mutable entity uses **read-compare-then-guarded-write**. The client sends its
last-known `version`; the server compares the freshly-read row (throws
`ConflictException`) **and** re-checks inside the transaction with
`updateMany({ where: { version } })`, throwing again if `count === 0`. Every successful
write does `version + 1`. Applied uniformly to reports, transitions, serials, and
approval batches. Anchors: `inspection-reports.service.ts:201,:252-265`;
`inspection-report-workflow.service.ts:203,:354-365`; `serial-numbers.service.ts:298`.

*Why not the alternatives:* pessimistic locking is unavailable offline; last-write-wins
loses data silently; field-level CRDT merge is complexity the domain doesn't need.

## Consequences

Stale writes are rejected deterministically as a 409; the double-check closes the
read-write (TOCTOU) race. Costs: reject-on-stale means **no automatic merge** — a
conflicted offline edit surfaces as CONFLICT and is currently discarded on resolution
(KNOWN-ISSUES #1, #2). The pattern is a standing contract: any new mutable entity must
carry `version` and honor both checks, or it silently loses the guarantee.
