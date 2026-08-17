# Architecture Decision Records

Standing architectural decisions for the OTS Web Portal — the "why this, why not the
alternatives" behind the load-bearing choices. Each ADR states a decision that is still
in force, with its context, tradeoffs, and costs. Known downsides are tracked in
[`../KNOWN-ISSUES.md`](../KNOWN-ISSUES.md).

- [ADR-0001 — Revision-snapshot engine](0001-revision-snapshot-engine.md) — immutable deterministic snapshots on approval/reopen.
- [ADR-0002 — Optimistic concurrency everywhere](0002-optimistic-concurrency.md) — version-guarded `updateMany`, reject-on-stale.
- [ADR-0003 — Multi-tenant model](0003-multi-tenant-model.md) — `tenantId` scoping with `PrismaService` as the single DB gateway.
- [ADR-0004 — JWT default-deny RBAC](0004-jwt-default-deny-rbac.md) — global guard, `@Public`/`@Roles` opt-outs.
- [ADR-0005 — Export determinism is structural-only](0005-export-determinism-structural-only.md) — deliberately excludes timestamps/bytes.
- [ADR-0006 — Offline-sync core](0006-offline-sync-core.md) — local-first write → outbox → FIFO drain → temporal-ID remap.
- [ADR-0007 — REWORK asymmetry](0007-rework-asymmetry.md) — parent accepts REWORK as the trigger; child rejects it.
- [ADR-0008 — No shared DTO package](0008-no-shared-dto-package.md) — types duplicated across the HTTP contract, by choice.
- [ADR-0009 — Single-template hardcode with the multi-template seam](0009-single-template-hardcode-seam.md) — the `templateKey` single-template hardcode (still standing) + unwired `workflow.create` seam; the four drill-pipe *behavior* hardcodes it tracked are now retired onto the engine (see the ADR's cutover-status update).
- [ADR-0010 — REWORK child-report trigger becomes definition-driven](0010-rework-rules-consumer.md) — rules interpreter reads `definition.rules`; named action owns reconciliation, unknown rules fail loud.
