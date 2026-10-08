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
- [ADR-0009 — Single-template hardcode with the multi-template seam](0009-single-template-hardcode-seam.md) — **superseded in part**: the `templateKey` hardcode is gone (template picker, multi-template live); the four drill-pipe behavior hardcodes are retired onto the definition engine. Kept as history.
- [ADR-0010 — REWORK child-report trigger becomes definition-driven](0010-rework-rules-consumer.md) — rules interpreter reads `definition.rules`; named action owns reconciliation, unknown rules fail loud.
- [ADR-0011 — Supervisors own template upload, behind an admin validation gate](0011-template-upload-supervisor-admin-validation.md) — SUPERVISOR uploads and defines; `approvalStatus` gates _usability for reports_, the deprecation handover is deferred to approval, rejection is terminal with a reason.
- [ADR-0012 — Account signatures and per-report field signatures](0012-signatures.md) — immutable PNG signatures, inspector gate, frozen pointers at submission, per-revision customer/supervisor field signatures.
- [ADR-0013 — Report statistics are free-entry](0013-free-entry-report-statistics.md) — typed per report, stored as JSON, offline via the report-update path; the computed outcome mapping is removed.
