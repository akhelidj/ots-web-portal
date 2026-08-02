# ADR-0008 — No shared DTO package

**Status:** Accepted (standing decision)

## Context

The monorepo has two apps — a NestJS API and an Angular portal — with no shared
libraries. They communicate as JSON over HTTP.

## Decision

Front and back agree on an **HTTP contract only**; request/response types are
**duplicated** on each side rather than shared through a common DTO package. The portal
owns its own models (`LocalInspectionReport`, `LocalSerialNumber`, … in
`offline/models/types.ts`); the API owns its own DTOs. Anchors: contract note in
`CLAUDE.md`; `portal/src/app/core/offline/models/types.ts`; `api/**/dto`.

*Why not the alternatives:* a shared `@ots/dto` lib couples the two build graphs and
forces lockstep versioning, yet the portal types diverge anyway because of their
offline-only fields — duplication keeps each side honest to its own concerns.

## Consequences

Each app evolves its types independently, and the portal's types model offline reality
(`syncState`, temp ids, `clientRef`) that the server never sees. Costs: the HTTP contract
is the **only** source of truth and is **unenforced by the compiler** — a server field
rename won't fail the portal build; drift is caught at runtime or by manual verification,
not typecheck. The `docs/api/` contract docs partly fill this gap but can themselves
drift.
