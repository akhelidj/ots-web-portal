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

`RolesGuard` resolves roles with `reflector.getAllAndOverride(ROLES_KEY, [handler,
class])`, so a **method-level `@Roles` overrides the class-level one** rather than
intersecting with it. That is deliberate and load-bearing: a controller can be opened to a
broader set of roles while individual endpoints re-narrow. Used by `TemplateController`
(open to ADMIN + SUPERVISOR, with `approve`/`reject`/`deprecate` back down to ADMIN — see
[ADR-0011](0011-template-upload-supervisor-admin-validation.md)). The flip side: widening a
class-level `@Roles` does **not** widen a method that declares its own, and narrowing a
method does not protect its siblings — each method's own decorator is the whole answer for
that route.

A second global guard, `SignatureRequiredGuard` (registered after `DefaultDenyGuard`), further refuses state-changing requests from an INSPECTOR with no registered signature (see [ADR-0012](0012-signatures.md)).

_Why not the alternatives:_ opt-in per-controller guards make a forgotten decorator an
open endpoint; default-deny inverts that risk.

## Consequences

New routes are authenticated by default; the failure mode of a forgotten decorator is a
401, not a leak. Costs: a genuinely public route that isn't marked `@Public` silently
401s — the accepted tradeoff. Auth depends on a present, valid JWT secret, which
currently reaches the strict boundary as possibly-`undefined` and isn't validated at
boot (KNOWN-ISSUES #12, #6).
