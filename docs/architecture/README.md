# Architecture Documentation

High-level architecture for the OTS Web Portal. For the *decisions* behind these
designs and their tradeoffs, see [`../adr/`](../adr/README.md); for verified standing
defects and constraints, see [`../KNOWN-ISSUES.md`](../KNOWN-ISSUES.md).

## Design docs

- [Report Lifecycle](report-lifecycle.md) — end-to-end trace of an inspection report
  from offline creation through sync, temporal-ID remap, transitions, revision
  snapshot, and approval batches. (See ADR-0006.)
- [Revision Snapshot Engine](revision-snapshot-engine.md) — how immutable, deterministic
  snapshots are written on first approval and reopen. (See ADR-0001.)
- [Template Definition](template-definition.md) — the `definitionJson` contract that drives
  the form, the approval gate, the export, rework rules and signatures; and how it is authored.
- [Template Versioning](template-versioning.md) — template versions, storage, and the admin
  validation gate. (See ADR-0011.)
- [Inspection Report Template Binding](inspection-report-template-binding.md) — how a
  report binds to a template version at creation (template picker, immutable binding).
- [Inspection Form Schema](inspection-form-schema.md) — how the form and the gate are
  derived from the definition.
- [Export Engine](export-engine.md) — definition-driven export, chunking, signatures,
  naming. (See ADR-0005.)
- [REWORK Rules Consumer](rework-rules-consumer.md) — the rules interpreter behind
  rework child reports and its equivalence proof. (See ADR-0010.)

Signatures ([ADR-0012](../adr/0012-signatures.md)) and free-entry statistics
([ADR-0013](../adr/0013-free-entry-report-statistics.md)) are documented in their ADRs and
in the API docs.
