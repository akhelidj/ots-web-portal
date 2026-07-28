# Phase 3 — `any`-purge inventory

**Status:** inventory only. **No `any` purged, no directive removed.** This is the
categorized baseline that drives purge sequencing — the lint-half analogue of
`phase3-strict-fallout.md`.

Measured with `eslint api` (typescript-eslint 8.40, the Phase-3 flat config) and
the installed type defs (ExcelJS 4.x, Prisma client 5.22, `@types/node`). Framework
type facts cross-checked against live upstream docs (Context7 not connected) —
citations inline.

---

## ⚠️ Read this first — five things the raw count hides

1. **It's 73 active + 20 _live_ directives, not "73 + 16".** The strict-fallout
   inventory estimated 16 live `eslint-disable`. Ground truth after Lint Wave 1
   removed the 17 dead ones: **20 live directives remain** (11 `export.service`,
   7 `mapping`, 2 `revision.service`), each suppressing ≥1 `any` on the line it
   covers. Total real `any` occurrences to purge ≈ **73 + ~21 = ~94** (one covered
   line — `export.service:294` — hides two). The "16" is superseded; work from 20.

2. **The controllers are annotation-only and dominate the count (~34 of 73).**
   Almost every controller `any` is `@Req() req: any` / `@Request() req: any` /
   `@Req() req: { user: any }`. Typing these changes _nothing at runtime_ — the
   value flows through untouched — exactly the Wave-2 `@Req()` precedent. An honest
   type already exists: **`AuthenticatedRequest`** (authored in Wave 2,
   `api/src/app/auth/authenticated-request.ts`). These need **no characterization**;
   they are the safe leading slice.

3. **One authored type — `Snapshot` (+ `InspectionData`) — is the linchpin.**
   The heaviest, highest-risk cluster (revision engine + export service + mapping +
   `workflow.service:350`) is all the same shape: the revision `snapshotJson` blob
   and the serial `inspectionData` blob, read with `as any` because Prisma types
   them as `JsonValue` (a recursive union that can't be indexed — confirmed in
   [Prisma JSON docs](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields)).
   Authoring `Snapshot`/`InspectionData` interfaces once unlocks ~30 sites across
   four files. This is the central **must-author** and should be its own step.

4. **The ExcelJS/JSZip buffer `as any` casts are upstream friction, not laziness.**
   `templateBuffer` is already declared `Buffer`, yet `workbook.xlsx.load(
templateBuffer as any)` still needs the cast: newer `@types/node` makes `Buffer`
   generic (`Buffer<ArrayBufferLike>`) and ExcelJS's `load(buffer: Buffer)` /
   JSZip's `loadAsync` type defs haven't caught up (known issue,
   [exceljs #2877](https://github.com/exceljs/exceljs/issues/2877)). The honest
   purge is `as unknown as Buffer`, not a plain annotation — and these sit inside
   the characterized export path, so they're **high** risk despite "the type
   existing."

5. **`@types/multer` is NOT installed.** The three `file: any` sites
   (`template.controller`, `template.service`, `template-validation.service`) can't
   just reach for `Express.Multer.File` — that type isn't resolvable today. Purging
   them requires either installing `@types/multer` or authoring a minimal
   `{ buffer: Buffer; originalname: string; mimetype: string; size: number }`
   shape. Counted as **must-author/install**.

---

## A. Full catalog

Legend — **Char?**: `path` = under a characterization _test path_ (tripwire named);
`module` = in a characterized module but no test on this line (the Wave-4 distinction,
e.g. `export.controller`); `no` = uncharacterized. **Risk**: L/M/H. **Type**: `exists`
(reach for it) / `author` (must model first) / `friction` (type exists but upstream
mismatch needs a deliberate cast).

### Leaf controllers — `@Req()`/`@Body()`/`@UploadedFile()` request shapes

| Location                                                            | `any` stands for                                                       | Char?  | Risk | Type                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ | ---- | ------------------------------- |
| `auth/auth.controller.ts:22`                                        | `@Body() body` = login credentials                                     | no     | L    | author `LoginDto`               |
| `child-reports/child-reports.controller.ts:33,47,60,66,84,103` (×6) | `@Request() req`                                                       | no     | L    | exists (`AuthenticatedRequest`) |
| `customers/customers.controller.ts:29,36,45,57,68` (×5)             | `@Req() req`                                                           | no     | L    | exists                          |
| `files/files.controller.ts:11`                                      | `@Request() req`                                                       | no     | L    | exists                          |
| `serial-numbers/serial-numbers.controller.ts:32,39,54,82` (×4)      | `@Req() req`                                                           | no     | L    | exists                          |
| `serial-numbers/serial-numbers.controller.ts:57`                    | `inspectionData?: any` in body literal                                 | no     | L→M  | author `InspectionData`         |
| `template/template.controller.ts:30,57,63` (×3)                     | `@Req() req`                                                           | no     | L    | exists                          |
| `template/template.controller.ts:32`                                | `@UploadedFile() file`                                                 | no     | M    | author/install multer           |
| `users/users.controller.ts:42,49,57,68,78` (×5)                     | `@Req() req`                                                           | no     | L    | exists                          |
| `workflow/child-report-workflow.controller.ts:18,32` (×2)           | `@Req() req: { user: any }`                                            | no     | L    | exists                          |
| `workflow/inspection-report-workflow.controller.ts:19,33,39` (×3)   | `@Req() req`                                                           | no     | L    | exists                          |
| `export/export.controller.ts:11`                                    | `@Req() req` — **characterized module, no test on path** (Wave-4 case) | module | L    | exists                          |

### Services / strategies / bootstrap

| Location                                                                | `any` stands for                                                                             | Char?                       | Risk | Type                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------- | ---- | ------------------------------------------------ |
| `main.ts:18`                                                            | `catch(exception: any, host)` in global filter                                               | no                          | L    | exists (`unknown`)                               |
| `scripts/seed.ts:112,162` (×2)                                          | `tenant: any` — a Prisma `Tenant` row                                                        | no                          | L    | exists (Prisma `Tenant`)                         |
| `auth/auth.service.ts:21`                                               | `validateUser(): Promise<any>` = user minus `passwordHash`                                   | no                          | M    | author (Prisma `Omit`)                           |
| `auth/auth.service.ts:41`                                               | `login(user: any)`                                                                           | no                          | M    | author (reuse `AuthenticatedUser`)               |
| `auth/strategies/jwt.strategy.ts:16`                                    | `validate(payload: any)` = decoded JWT                                                       | no                          | M    | author `JwtPayload`                              |
| `child-reports/child-reports.service.ts:286`                            | `payload.inspectionData as any` → Prisma JSON write                                          | **no**                      | M    | exists (`Prisma.InputJsonValue`)                 |
| `child-reports/child-reports.service.ts:296`                            | `disp as any` assigned to disposition                                                        | **no**                      | M    | author/`InputJsonValue`                          |
| `serial-numbers/serial-numbers.service.ts:171`                          | `payload.inspectionData?: any`                                                               | **no**                      | M    | author `InspectionData`                          |
| `serial-numbers/serial-numbers.service.ts:202,203,206,267,286,334` (×6) | `(serialToUpdate as any).approvalStatus` — **gates the edit-forbidden guard (control flow)** | **no**                      | M-H  | exists (Prisma `SerialNumber`) but logic-bearing |
| `serial-numbers/serial-numbers.service.ts:260`                          | `disp as any`                                                                                | **no**                      | M    | `InputJsonValue`                                 |
| `workflow/inspection-report-workflow.service.ts:108`                    | `catch(error: any)`                                                                          | path (workflow-transitions) | L    | exists (`unknown`)                               |
| `workflow/inspection-report-workflow.service.ts:350`                    | `data: any = sn.inspectionData` in field-validation                                          | path (workflow-transitions) | H    | author `InspectionData`                          |
| `template/template.service.ts:25`                                       | `file: any` upload                                                                           | module (binding only)       | M    | author/install multer                            |
| `template/template-validation.service.ts:18`                            | `validateTemplate(file: any)`                                                                | no                          | M    | author/install multer                            |

### Revision engine — **tripwire: `revision-snapshot.integration.spec.ts`**

| Location                                                  | `any` stands for                                                                  | Char?       | Risk | Type                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- | ---- | ------------------------- |
| `revision/revision.service.ts:111,112`                    | `(sn.inspectionData as any)?.final?.disposition`                                  | path        | H    | author `InspectionData`   |
| `revision/revision.service.ts:204,205`                    | `(s.serialNumber.inspectionData as any)?…`                                        | path        | H    | author `InspectionData`   |
| `revision/revision.service.ts:130,222` (directive-hidden) | `snapshotJson: snapshotData as any` — Prisma JSON write                           | path        | H    | exists (`InputJsonValue`) |
| `revision/revision-snapshot.integration.spec.ts:176,254`  | `rev.snapshotJson as any` then `.header.status` — **in the tripwire test itself** | path (test) | M    | author `Snapshot`         |
| `revision/revision-snapshot.integration.spec.ts:188`      | `(l: any) => l.toStatus` transition-log element                                   | path (test) | M    | author                    |

### Export service — **tripwire: `export.integration.spec.ts`**

| Location                                    | `any` stands for                                               | Char? | Risk | Type                    |
| ------------------------------------------- | -------------------------------------------------------------- | ----- | ---- | ----------------------- |
| `export/export.service.ts:89` (hidden)      | `let snapshot: any` — the revision snapshot blob               | path  | H    | author `Snapshot`       |
| `export/export.service.ts:136` (hidden)     | `.map((sn: any) => …)` serial element                          | path  | H    | author                  |
| `export/export.service.ts:141,142`          | `(sn.inspectionData as any)?…disposition`                      | path  | H    | author `InspectionData` |
| `export/export.service.ts:163` (directive)  | `revision.snapshotJson as any`                                 | path  | H    | author `Snapshot`       |
| `export/export.service.ts:171`              | `.map((l: any) => l.userId)` transition log                    | path  | H    | author                  |
| `export/export.service.ts:294` (hidden, ×2) | `.sort((a: any, b: any) => …)` parent serials                  | path  | H    | author                  |
| `export/export.service.ts:363` (hidden)     | `zip.file(f.filename, f.buffer as any)`                        | path  | H    | friction (Buffer)       |
| `export/export.service.ts:377,379,446,447`  | `snapshot: any`, `serialNumbers: any[]`, `chunk: any[]` params | path  | H    | author `Snapshot`       |
| `export/export.service.ts:392,417` (hidden) | `workbook.xlsx.load(templateBuffer as any)`                    | path  | H    | friction (Buffer)       |
| `export/export.service.ts:397,427` (hidden) | `catch(err: any)`                                              | path  | L    | exists (`unknown`)      |

### Export mapping — **tripwire: `export.integration.spec.ts`** (mapper is called by it)

| Location                                                            | `any` stands for                                                     | Char? | Risk              | Type              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- | ----------------- | ----------------- | --- | ----------------- |
| `mappings/drill-pipe-report.v1.mapping.ts:138,140,446-eqv` (hidden) | `snapshot: any`, `serialNumbersChunk: any[]` params                  | path  | H                 | author `Snapshot` |
| `mappings/…:143` (hidden)                                           | `const h = (snapshot.header                                          |       | snapshot) as any` | path              | H   | author `Snapshot` |
| `mappings/…:153,158`                                                | `(… as any[])` equipmentUsed / inspectionMethod arrays               | path  | H                 | author            |
| `mappings/…:155,160` (hidden)                                       | `.map((e: any)…)`, `.map((m: any)…)`                                 | path  | H                 | author            |
| `mappings/…:168` (×2),172,177,183,186                               | transition-log `sort`/`find`/user `find` element params              | path  | H                 | author            |
| `mappings/…:219,438` (hidden)                                       | `JSZip.loadAsync(rawBuffer as any)`, `xlsx.load(finalBuffer as any)` | path  | H                 | friction (Buffer) |

---

## B. Aggregates

### By module (active `any` + directive-hidden `any`)

| Module              | Active | Hidden  | Total   | Dominant kind                 | Char?       |
| ------------------- | ------ | ------- | ------- | ----------------------------- | ----------- |
| export/mapping      | 8      | 7       | 15      | snapshot + Buffer             | **path**    |
| export/service      | 5      | 12      | 17      | snapshot + Buffer + catch     | **path**    |
| revision/service    | 4      | 2       | 6       | inspectionData + JSON write   | **path**    |
| revision/spec       | 3      | 0       | 3       | snapshot (test)               | path (test) |
| serial-numbers      | 13     | 0       | 13      | approvalStatus row-cast + req | **no**      |
| child-reports       | 8      | 0       | 8       | req + JSON cast               | **no**      |
| workflow (ctrl+svc) | 7      | 0       | 7       | req + inspectionData + catch  | mixed       |
| template            | 6      | 0       | 6       | req + file upload             | mixed       |
| customers           | 5      | 0       | 5       | req                           | no          |
| users               | 5      | 0       | 5       | req                           | no          |
| auth                | 4      | 0       | 4       | body/payload/return           | no          |
| files               | 1      | 0       | 1       | req                           | no          |
| export/controller   | 1      | 0       | 1       | req                           | module      |
| seed                | 2      | 0       | 2       | Prisma row                    | no          |
| main                | 1      | 0       | 1       | catch                         | no          |
| **Total**           | **73** | **~21** | **~94** |                               |             |

### By risk

| Risk       | Count (approx, incl. hidden) | Where                                                                                                   |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Low**    | ~40                          | all `@Req()`/`{user:any}` controllers, `catch` clauses, `seed`, `main`                                  |
| **Medium** | ~20                          | auth service/strategy, child-reports svc, serial-numbers svc, template file:any                         |
| **High**   | ~34                          | export.service + mapping + revision.service + workflow.service:350 (snapshot/Buffer, all characterized) |

### By "type exists vs must author"

| Bucket                                                                 | Count | Notes                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **exists** (reach for it)                                              | ~42   | `AuthenticatedRequest` (~34 req sites), `unknown` (catch ~4), Prisma `SerialNumber`/`Tenant` rows, `Prisma.InputJsonValue` (JSON writes)                                                             |
| **friction** (type exists, upstream mismatch → `as unknown as Buffer`) | ~5    | ExcelJS/JSZip buffer loads (export.service 363/392/417, mapping 219/438)                                                                                                                             |
| **must author**                                                        | ~45   | **`Snapshot` + `InspectionData`** (the linchpin, ~40 sites across revision/export/mapping/workflow/specs), `LoginDto` (1), `JwtPayload` (1), multer `file` shape (3), auth `validateUser` return (2) |

---

## C. Suggested sequencing (ascending risk, leaf/uncharacterized first)

1. **Leaf request typing — no characterization needed** (annotation-only, reuse
   `AuthenticatedRequest`): all `@Req()`/`@Request()`/`{ user: any }` across
   child-reports, customers, users, serial-numbers, template, files, workflow, and
   `export.controller` controllers. ~34 sites, mechanical. `catch` clauses
   (`main.ts`, `workflow.service:108`, `export.service:397/427`) → `unknown` in the
   same slice. `seed.ts` → Prisma `Tenant`.
2. **`auth` cluster** — author `LoginDto` (`auth.controller:22`), `JwtPayload`
   (`jwt.strategy:16`), and `validateUser`/`login` return/param (reuse
   `AuthenticatedUser`). Uncharacterized but annotation-shaped; low blast radius.
3. **`template` file handling** — install `@types/multer` (or author a minimal file
   shape); type `file` in controller/service/validation. **Verify** upload
   validation behavior is unchanged (see §D — not characterized).
4. **`child-reports.service`** JSON casts — **characterize first** (§D), then type
   `inspectionData`/`disp` via `InputJsonValue` + `InspectionData`.
5. **`serial-numbers.service`** — **characterize first** (§D, highest concern: the
   `approvalStatus` casts gate the edit-forbidden guard). Then type against Prisma
   `SerialNumber`.
6. **Author the `Snapshot` + `InspectionData` model** — a dedicated type-modeling
   step (from the `snapshotJson` structure the revision engine writes). This is the
   prerequisite for steps 7–8 and unlocks ~40 sites at once.
7. **`revision.service` + `revision-snapshot.integration.spec`** — under the
   revision tripwire; apply `Snapshot`/`InspectionData`; purge the two directive
   `snapshotJson as any` writes via `InputJsonValue`.
8. **`export.service` + `mapping`** — the heaviest, last. Under the export tripwire.
   Apply `Snapshot`; resolve the Buffer friction with `as unknown as Buffer`
   ([exceljs #2877](https://github.com/exceljs/exceljs/issues/2877)); type the
   transition-log/serial element params. `workflow.service:350` rides along with the
   `InspectionData` model, under the workflow tripwire.

---

## D. Not-yet-characterized modules the purge will touch

Standing rule: **characterize before touching behavior.** These modules carry
`any` that is _logic-bearing_ (control flow / JSON access, not pure annotation) and
have **no characterization test**. Schedule a characterization step before purging:

1. **`serial-numbers.service`** — ⚠️ highest priority. The six
   `(serialToUpdate as any).approvalStatus` casts drive the **edit-forbidden guard**
   (throws if `SUBMITTED_FOR_APPROVAL`/`APPROVED`). Typing against the real Prisma
   `SerialNumber` could surface a narrowing that changes when the guard fires. No
   integration spec exercises serial edit/approval directly.
2. **`child-reports.service`** — the `inspectionData`/`disposition` JSON casts on the
   child-serial update path. No child-reports spec exists.
3. **`template.service` / `template-validation.service`** — file upload + template
   validation. `create-template-binding.integration.spec` covers _report-creation
   binding_, **not** upload/validation. At minimum verify; ideally characterize the
   `validateTemplate` path before changing `file: any`.

**Explicitly NOT requiring characterization** (to avoid over-scoping): the leaf
controllers and `catch` clauses (steps 1–2) are annotation-only — typing a `@Req()`
param or a caught error changes no runtime behavior, the same basis on which Wave 2
safely typed `@Req()`. `auth.service`/`jwt.strategy` are uncharacterized but also
annotation-shaped (return/param typing); low concern, noted for the record.

The characterized clusters (revision, export, mapping, workflow.service) already have
tripwires — no new characterization needed there, but each purge step must keep its
named spec green.
