# ADR-0003 — Multi-tenant model (tenantId scoping, single DB gateway)

**Status:** Accepted (standing decision)

## Context

Multiple customer organizations share one deployment and one database, and offline
caches live on shared field devices. Cross-tenant data leakage is unacceptable.

## Decision

A single shared schema with `tenantId` scoping. `PrismaService` is the **single DB
gateway** — every backend service depends on it and nothing else touches the database —
so tenant scoping is enforced in one place. The server derives the tenant from the
authenticated JWT and scopes queries; the client partitions IndexedDB per tenant
(`ots_{tenantId}`). Anchors: `api/src/app/prisma/prisma.service.ts:5`; per-tenant
partitioning from the tenant-isolation work.

*Why not the alternatives:* DB-per-tenant multiplies operational and migration overhead;
schema-per-tenant fights Prisma; shared-schema-with-gateway keeps enforcement in one
auditable place.

## Consequences

One migration path, one connection pool, scoping centralized. Costs: isolation is
**application-enforced, not DB-enforced** — a query that forgets `tenantId` leaks across
tenants, with no row-level-security backstop. The single-gateway rule is load-bearing:
bypassing `PrismaService` bypasses the isolation convention.
