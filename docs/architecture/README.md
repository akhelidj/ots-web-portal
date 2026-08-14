# Architecture Documentation

High-level architecture for the OTS Web Portal. For the *decisions* behind these
designs and their tradeoffs, see [`../adr/`](../adr/README.md); for verified standing
defects and constraints, see [`../KNOWN-ISSUES.md`](../KNOWN-ISSUES.md).

## Current design docs

- [Report Lifecycle](report-lifecycle.md) — end-to-end trace of an inspection report
  from offline creation through sync, temporal-ID remap, transitions, revision
  snapshot, and approval batches. Verified ground-truth flow. (See ADR-0006.)
- [Revision Snapshot Engine](revision-snapshot-engine.md) — how immutable, deterministic
  snapshots are written on first approval and reopen. (See ADR-0001.)
- [Inspection Form Schema](inspection-form-schema.md) — the `DRILL_PIPE_V1` form schema
  and field structure.
- [Export Mapping: DRILL_PIPE_REPORT v1](export-mapping-drill-pipe-v1.md) — deterministic
  export mapping, multi-part ZIP behavior and limits. (See ADR-0005.)
- [Inspection Report Template Binding](inspection-report-template-binding.md) — how a
  report binds to a template at creation. ⚠️ Reads as if the requested `templateKey` is
  honored; the live path hardcodes `DRILL_PIPE_REPORT` — see
  [ADR-0009](../adr/0009-single-template-hardcode-seam.md).
- [Template Versioning](template-versioning.md) — ⚠️ **Legacy.** Describes the
  `TemplateVersion` / `mappingJson` model; the authoritative model today is `Template` /
  `fileBlob`. Retained for historical context only.
- [REWORK Rules Consumer](rework-rules-consumer.md) — ⚠️ **Design / not yet built.** Planned
  rules interpreter that makes the REWORK child-report trigger definition-driven, with its
  legacy-equivalence proof and mutation guards. Not ground truth. (See ADR-0010.)

## Superseded

- `pwa-offline-network-state-of-play.md` — **stale**; predates the current offline-sync
  implementation. Superseded by [Report Lifecycle](report-lifecycle.md) and
  [ADR-0006](../adr/0006-offline-sync-core.md). Kept pending removal.
