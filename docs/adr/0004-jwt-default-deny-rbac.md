# ADR-0004 — JWT default-deny RBAC

**Status:** Accepted (standing decision)

## Context

The API has many routes and grows often; a forgotten auth decorator on a new endpoint
must not open a hole. Security must fail closed.

## Decision

A **global** `DefaultDenyGuard` authenticates every route via JWT by default; a route is
public only if explicitly marked `@Public`. Role restrictions are declarative via
`@Roles` + `RolesGuard`. Anchors: `common/guards/default-deny.guard.ts:10`,
`auth/strategies/jwt.strategy.ts:22`, `common/decorators/public.decorator.ts:3`,
`auth/roles.decorator.ts:5`, `auth/roles.guard.ts:7`, `auth/auth.module.ts`.

*Why not the alternatives:* opt-in per-controller guards make a forgotten decorator an
open endpoint; default-deny inverts that risk.

## Consequences

New routes are authenticated by default; the failure mode of a forgotten decorator is a
401, not a leak. Costs: a genuinely public route that isn't marked `@Public` silently
401s — the accepted tradeoff. Auth depends on a present, valid JWT secret, which
currently reaches the strict boundary as possibly-`undefined` and isn't validated at
boot (KNOWN-ISSUES #12, #6).
