# Contributing

## Setup

- Node `20.19.3` (see `.nvmrc`), then `npm ci` (this also installs the git hooks).
- `docker compose up -d` for the dev Postgres; copy `api/.env.example` to `api/.env`; `npm run db:migrate`.
- `npm run start:api` and `npm run start:portal`.

## Before you push

The git hooks run most of this for you; CI runs all of it.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
```

API integration tests need the disposable test database:

```bash
npm run test:db:up
cp api/.env.test.example api/.env.test
npm run test:api:integration
```

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) (`feat(api): ...`, `fix(portal): ...`, `chore: ...`), enforced by commitlint. Keep behaviour changes and mechanical changes (formatting, renames) in separate commits.

## Rules of the road

Read `CLAUDE.md` and `docs/` first. In particular: never change the offline-sync core (`portal/src/app/core/offline/`) without a test first, follow the optimistic-concurrency pattern for any mutable entity, and mark new public routes `@Public`.
