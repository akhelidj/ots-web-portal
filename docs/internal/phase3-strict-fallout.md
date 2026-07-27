# Phase 3 — Strict-flag + ESLint fallout inventory

**Status:** inventory only. **No fixes applied.** This document is the categorized
baseline that drives module-by-module sequencing for the actual cleanup steps.

**Config landed in this step (additive):**

- `tsconfig.base.json` → `"strict": true` (Tier 1 bundle: `noImplicitAny`,
  `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`,
  `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`,
  `alwaysStrict`). **No** Tier 3 flags (`noUncheckedIndexedAccess` etc.).
- `eslint.config.mjs` → explicit, version-anchored `typescript-eslint`
  `recommended` layered on top of the Nx flat config (scoped to `*.ts`), plus an
  explicit `reportUnusedDisableDirectives: 'warn'`.

Measured with TS 5.9.2, `typescript-eslint` 8.40, Nx 22.5.1. `tsc --noEmit` per
project tsconfig; `eslint . -f json` per project (each honours its own config).

---

## ⚠️ Read this first — five things the raw counts hide

1. **Portal is already `strict`.** `portal/tsconfig.json` set `strict: true` (plus
   extra Angular strictness) long before this step. Enabling `strict` in the base
   config is therefore a **no-op for portal** — its local override already won. **All
   genuine new strict fallout is in `api/`.**
2. **The "117 portal-spec errors" are a measurement artifact, not strict fallout.**
   Running `tsc` with `portal/tsconfig.spec.json` uses `moduleResolution: node`,
   under which Angular's package-`exports` entrypoints (`@angular/common/http`,
   `@angular/core/testing`, …) **fail to resolve** (9× `TS2307`). That turns
   `HttpClient` & friends into `unknown` and **cascades** into 81 errors in
   `sync-dispatcher.service.ts` and 29 in a portal service (TS2571/TS18046/TS2698 =
   "is of type unknown" / "spread of non-object"). The **app** config
   (`moduleResolution: bundler`, i.e. the real Angular build) compiles those exact
   files at **0 errors**. Treat this 117 as a pre-existing **spec-tsconfig**
   misconfiguration to fix separately — **not** 117 strict violations.
3. **The new ESLint layer promotes `no-explicit-any` and `no-unused-vars` from
   `warn` → `error`** (recommended defaults). Detections are unchanged; severities
   are not. `api` lint is now **red** (81 errors). There is **no CI** (see
   `CLAUDE.md`), so nothing automated breaks — this is the intended Phase 3 baseline.
4. **`no-explicit-any` under-counts the real `any` debt.** The 73 active `any`
   reports in `api` exclude every `any` already hidden behind an `eslint-disable`.
   Removing those disables (a later step) will surface more.
5. **Two latent, pre-existing, non-strict items in test scaffolding** (both authored
   in earlier phases, invisible to jest because it transpiles with swc, not tsc):
   `api/src/app/export/export.integration.spec.ts` (`TS2352` cast) and
   `portal/src/test-setup.ts` (`TS2307` `node:v8` — app config has `types: []`).

---

## A. TypeScript strict fallout (`tsc --noEmit`)

### Totals by tsconfig scope

| Scope                                       | Pre-strict | Post-strict | New (strict-attributable)    |
| ------------------------------------------- | ---------- | ----------- | ---------------------------- |
| `api/tsconfig.app.json` (production source) | 0          | **22**      | **22**                       |
| `api/tsconfig.spec.json`                    | 1          | 3           | 2\*                          |
| `portal/tsconfig.app.json`                  | 1          | 1           | 0 (already strict)           |
| `portal/tsconfig.spec.json`                 | 117        | 117         | 0 (already strict; see ⚠️#2) |

\* The 2 new spec-scope errors are the **same** `create-inspection-report.dto`
`TS2564`s already counted in the app scope, re-surfaced through the spec import
graph — **not** additional files. The remaining spec error (`TS2352`) is
pre-existing (⚠️#5). **Net unique new strict errors to fix: 22, all in `api` source.**

### `api` strict fallout by error kind (which flag)

| Code     | Count | Strict flag                    | Meaning                                                     |
| -------- | ----- | ------------------------------ | ----------------------------------------------------------- |
| `TS2564` | 15    | `strictPropertyInitialization` | class property has no initializer / not definitely assigned |
| `TS7006` | 5     | `noImplicitAny`                | parameter implicitly `any`                                  |
| `TS2345` | 2     | `strictNullChecks`             | `undefined` not assignable to non-optional param            |

### `api` strict fallout by module

| Module                   | Count  | Breakdown                       | Files                                                                                                                |
| ------------------------ | ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `inspection-reports/dto` | 9      | TS2564 ×9                       | `create-inspection-report.dto` (2), `return-batch.dto` (3), `create-approval-batch.dto` (2), `approve-batch.dto` (2) |
| `auth`                   | 5      | TS2564 ×2, TS7006 ×2, TS2345 ×1 | `dto/change-password.dto` (2), `auth.controller` (2, `req`), `strategies/jwt.strategy` (1)                           |
| `customers/dto`          | 4      | TS2564 ×4                       | `create-customer.dto` (1), `update-customer.dto` (3)                                                                 |
| `common/guards`          | 3      | TS7006 ×3                       | `default-deny.guard` (`err`/`info`/`user`)                                                                           |
| `export`                 | 1      | TS2345 ×1                       | `export.controller` (`revisionNumber: number \| undefined`)                                                          |
| **Total**                | **22** |                                 |                                                                                                                      |

**Shape of the work:** two-thirds is `TS2564` on **request/response DTO classes**
(NestJS validation DTOs written without initializers or `!`). Mechanical, low-risk,
one module at a time. The `TS7006`s are untyped `req`/passport callback params. The
two `TS2345`s are genuine `strictNullChecks` narrowing (`export.controller` parses a
possibly-`NaN`/`undefined` revision; `jwt.strategy` passes `secretOrKey:
string | undefined`) — read these before "fixing".

### Latent / pre-existing (NOT attributable to this change)

| Location                                        | Code           | Note                                                                            |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `portal/src/test-setup.ts`                      | TS2307         | `node:v8` unresolved under app config `types: []`; app-build only, pre-existing |
| `api/src/app/export/export.integration.spec.ts` | TS2352         | `cell.value` cast; pre-existing (present pre-strict), not a strict flag         |
| `portal/tsconfig.spec.json` (110 in source)     | TS2307→cascade | spec-tsconfig `moduleResolution: node` artifact (⚠️#2), **not** strict fallout  |

---

## B. ESLint fallout (`typescript-eslint` recommended, this step's config)

### Totals by project

| Project  | Errors | Warnings | Notes                                              |
| -------- | ------ | -------- | -------------------------------------------------- |
| `api`    | **81** | 19       | errors = `no-explicit-any` 73 + `no-unused-vars` 8 |
| `portal` | 1      | 2        | mostly clean                                       |

### By rule

| Rule                                       | api | portal | Severity | Axis                |
| ------------------------------------------ | --- | ------ | -------- | ------------------- |
| `@typescript-eslint/no-explicit-any`       | 73  | 0      | error    | the `any` purge     |
| `@typescript-eslint/no-unused-vars`        | 8   | 0      | error    | dead bindings       |
| (unused `eslint-disable` directive)        | 17  | 1      | warn     | the disable cleanup |
| `@typescript-eslint/no-non-null-assertion` | 2   | 1      | warn     | `!` assertions      |
| `@angular-eslint/no-output-native`         | 0   | 1      | error    | Angular             |

### `api` ESLint by module (drives the `any`-purge sequencing)

| Module               | Total | `no-explicit-any` | `no-unused-vars` | `no-non-null` | unused-disable |
| -------------------- | ----- | ----------------- | ---------------- | ------------- | -------------- |
| `export`             | 25    | 14                | 1                | 0             | 10             |
| `serial-numbers`     | 13    | 13                | 0                | 0             | 0              |
| `workflow`           | 10    | 7                 | 1                | 2             | 0              |
| `child-reports`      | 9     | 8                 | 0                | 0             | 1              |
| `revision`           | 9     | 7                 | 0                | 0             | 2              |
| `template`           | 9     | 6                 | 3                | 0             | 0              |
| `auth`               | 5     | 4                 | 1                | 0             | 0              |
| `customers`          | 5     | 5                 | 0                | 0             | 0              |
| `users`              | 5     | 5                 | 0                | 0             | 0              |
| `(other)`            | 5     | 3                 | 0                | 0             | 2              |
| `common`             | 1     | 0                 | 1                | 0             | 0              |
| `files`              | 1     | 1                 | 0                | 0             | 0              |
| `inspection-reports` | 1     | 0                 | 1                | 0             | 0              |
| `(api root cfg)`     | 2     | 0                 | 0                | 0             | 2              |

### Raw `eslint-disable` directive census (grep, whole `src`)

| Project  | `eslint-disable` comments | of which unused (dead) |
| -------- | ------------------------- | ---------------------- |
| `api`    | 33                        | 17                     |
| `portal` | 1                         | 1                      |

> **51% of `api`'s disable directives are already dead** — they suppress nothing and
> can be removed with zero behavioural risk as the first, safest slice of the disable
> cleanup. The other 16 are live suppressions (mostly `no-explicit-any` in `export`,
> `revision`, `child-reports`); removing each will surface the `any` beneath it.

---

## C. Suggested sequencing (informational — no work done here)

1. **Delete the 18 dead `eslint-disable` directives** (17 api + 1 portal) — zero risk.
2. **`api` strict DTOs** (`TS2564` ×15) module by module: `inspection-reports/dto`,
   `customers/dto`, `auth/dto` — mechanical (`!` or initializer + validation intact).
3. **`api` `TS7006`** (5): type `req` (`Request` + `req.user`) and the passport
   `err/info/user` callback in `default-deny.guard`.
4. **`api` `TS2345`** (2): read `export.controller` + `jwt.strategy` — real null cases.
5. **`api` `no-explicit-any`** (73) by module, heaviest first: `export` (14),
   `serial-numbers` (13), `child-reports` (8), `workflow`/`revision` (7 each).
6. **Separately**, fix the `portal/tsconfig.spec.json` module-resolution
   misconfiguration (align spec resolution with the app: `bundler`/proper types) so
   the 110 cascade errors evaporate and the spec suite becomes type-checkable.

## Housekeeping note (not part of this step)

`eslint-output.json` is committed at the repo root but points at
`C:\Dev\ots\portal\…` (a different, stale checkout path) and is dated Jul 26. It
appears to be an accidentally-committed lint dump, unrelated to this config. Flagged
for removal in a later cleanup.
