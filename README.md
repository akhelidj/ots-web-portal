# OTS Web Portal

Monorepo for the Oilfield Tubular Services (OTS) inspection platform: an offline-first
Angular **portal** and a NestJS **API** over Postgres, managed with Nx.

## Stack

- **Portal** — Angular 21 (`portal/`)
- **API** — NestJS 11 (`api/`)
- **Database** — Postgres 16 via Prisma (`api/prisma/`)
- **Tooling** — Nx over npm workspaces
- **Node** — 20.19.3 (pinned in `.nvmrc`)

## Quick start

```bash
npm install
docker compose up -d     # local Postgres (docker-compose.yml)
npm run db:migrate       # apply migrations (reads api/.env)
npm run db:seed          # seed a default tenant + demo data
```

Run the two apps in separate terminals:

```bash
npm run start:api        # NestJS  → http://localhost:3000
npm run start:portal     # Angular → http://localhost:4200
```

## Scripts

| Script | Does |
| --- | --- |
| `start:api` / `start:portal` | Serve API / portal (`nx serve`) |
| `build:api` / `build:portal` | Production builds |
| `db:migrate` / `db:seed` / `db:studio` | Migrate / seed / open Prisma Studio |
| `db:generate` / `db:reset` | Regenerate Prisma client / force-reset the schema |
| `lint` | Lint all projects (`nx run-many -t lint`) |
| `format` / `format:check` | Prettier write / check |
| `test` / `test:api` / `test:portal` | Run tests |
| `test:api:integration` | API integration tests (needs the test DB up) |
| `test:db:up` / `test:db:down` | Start / stop the integration Postgres (`docker-compose.test.yml`) |
| `graph` | Visualize the Nx dependency graph (`nx graph`) |

Database scripts read `api/.env` — see the `.env.example` files under `api/` for the
required variables.

## Architecture

The portal is **offline-first**: writes land in IndexedDB and sync to the API when
connectivity returns. The API is a default-deny NestJS service over a single
multi-tenant Postgres schema.

- **[docs/architecture/](docs/architecture/README.md)** — system design: report
  lifecycle, revision-snapshot engine, form schema, export mapping, template binding.
- **[docs/adr/](docs/adr/README.md)** — the standing architectural decisions and their
  tradeoffs (offline-sync, optimistic concurrency, default-deny RBAC, and more).
- **[docs/api/](docs/api/README.md)** — HTTP endpoint contracts.
- **[docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)** — verified standing defects and constraints.
- **[CLAUDE.md](CLAUDE.md)** — working orientation and ground-truth notes for contributors.

> No global API prefix — controllers sit at root, **except** `FilesController`
> (`/api/files`).
