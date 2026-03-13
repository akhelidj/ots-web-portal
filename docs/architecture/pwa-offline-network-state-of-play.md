# PWA / Offline / Network State of Play

## Current architecture summary

- The frontend already uses Angular service worker registration in `portal/src/app/app.config.ts`, enabled only in production with `registerWhenStable:30000`.
- The PWA shell is only partially configured. `portal/ngsw-config.json` caches app shell assets and static assets, but has no `dataGroups`, so API traffic is not managed by the service worker.
- The manifest exists at `portal/src/manifest.webmanifest` and is linked from `portal/src/index.html`, but it only contains app name, colors, display, scope, and start URL.
- Offline domain storage is centered on IndexedDB via `DbService` and per-entity local repos under `portal/src/app/core/offline/repos`.
- Writes are queued in a centralized IndexedDB outbox (`outbox-local.repo.ts` / `outbox.service.ts`) and dispatched by `sync-dispatcher.service.ts`.
- Sync orchestration exists in `sync-orchestrator.service.ts`, but it auto-runs on reconnect/login and coexists with feature-level refresh/sync actions.

## What is inconsistent

- Connectivity detection is browser-only in `connectivity.service.ts` and uses `navigator.onLine` plus window events; it does not verify API reachability.
- Read behavior is mixed:
  - `AdminUsersService` and parts of inspection hydration are network-first with local cache refresh.
  - `AdminCustomersComponent` and multiple detail components manually decide when to fetch.
  - `ChildReportsService` is direct-online / queue-offline, while inspection flows are a mixture of queued writes, direct writes, and follow-up pulls.
- Write behavior is mixed:
  - Users and customers always enqueue local-first mutations, even when online.
  - Child reports use server-first when online and queue only when offline.
  - Approval batch actions in `InspectionReportsService` use server-first online, offline queue otherwise.
- Sync triggers are scattered:
  - Shell status area reflects orchestrator state.
  - `admin-customers.component.html` has a page-level `Sync Directory` button.
  - `inspection-report-detail.component.html` has a `Sync Rework Report` button.
  - Several components call `pullAllAndCache()`, `processQueue()`, or `runSyncSequence()` directly.
- Canonical server hydration is not consistently applied after successful online writes. Some flows refresh local data from server, others only update optimistic local state.

## What is broken or fragile

- `OutboxService` auto-processes immediately when `navigator.onLine` is true, which fights the stated V1 manual-sync model and duplicates orchestration decisions.
- `SyncOrchestratorService` silently maps many failures to `Offline`, which hides sync-error vs unreachable-api cases.
- `OutboxService.processQueue()` checks `if (!this.session.isAuthenticated)` instead of the signal value, so the auth guard there is effectively wrong.
- Detail components rely on `navigator.onLine` directly (`inspection-report-detail`, `child-report-detail`) instead of a single app connectivity source.
- Customer and user admin flows bypass a single network policy and manually call queue processing from the component layer.
- Service worker caching covers only shell/assets. Domain data freshness depends entirely on app code and not all online fetches consistently hydrate local IndexedDB.
- Feature UX leaks implementation details with per-page sync controls and mixed status language (`Offline`, `Syncing...`, `Up to date`, `Sync Error`, per-record `PENDING`, `CONFLICT`, `ERROR`).

## What works offline today

- Authenticated users with a valid stored token can reopen the app and continue using IndexedDB-backed data.
- IndexedDB is tenant-scoped and opened from the stored session via `SessionService`.
- Inspection reports, serial numbers, child reports, customers, users, approval batches, and outbox items have local stores.
- Offline writes already exist for customers, users, inspection reports, serial numbers, transitions, approval batches, and child report edits.

## What breaks or degrades offline today

- API reachability loss while the browser still reports online is not detected clearly.
- Some screens assume online fetch availability on init and only partially fall back to local data.
- Manual sync is not truly centralized because components can individually refresh, flush, or trigger sync behavior.
- Installability is incomplete due to manifest/icon gaps.

## Installability findings

### Present

- Manifest linked in `portal/src/index.html`.
- Service worker configured for production builds in `portal/project.json` and `portal/src/app/app.config.ts`.
- App is intended to be served as a standalone installable PWA.

### Missing / blockers

- `portal/src/manifest.webmanifest` has no `icons` array, including no `192x192` and `512x512` icons, which is a common installability blocker.
- No `maskable` icon is provided.
- `portal/src/index.html` does not declare `meta name="theme-color"`.
- Asset configuration only copies `portal/public/**/*` plus the manifest; current install assets need to be explicitly present in `portal/public` and referenced by the manifest.
- Install prompt will only appear in production-like conditions: HTTPS (or localhost), valid manifest, active service worker, and required icons.

## Recommended target model

- One central app connectivity/sync state service should own:
  - browser connectivity
  - lightweight API reachability
  - sync in progress
  - last sync error
  - pending outbox count
- Online reads should be network-first and always hydrate IndexedDB on success.
- Offline or unreachable-api reads should fall back to local IndexedDB.
- Online writes should be server-first, then persist the canonical server response locally.
- Offline writes should enqueue to the centralized outbox and update local state optimistically.
- Manual sync should be exposed once at shell level and orchestrate outbox flush plus server hydration.
- Feature-level refresh/sync buttons should be removed or routed through the central sync orchestrator.
- Service worker and manifest should be completed so the production build is installable and reliably offline-capable for the shell.

## Proposed implementation order

1. Stabilize PWA/installability: manifest icons, theme metadata, asset copying, production verification.
2. Replace browser-only connectivity with central connectivity state plus lightweight API reachability probing.
3. Refactor sync orchestration into one app-level service/store with explicit states: online, offline, syncing, sync error.
4. Remove direct component-level sync/refresh triggers where possible and route shell sync through the central orchestrator.
5. Normalize high-value feature reads to network-first with cache hydration (`users`, `customers`, `inspection reports`, `child reports`).
6. Normalize high-value writes to server-first-online / queue-offline without changing workflow semantics or API contracts.
7. Keep local repos and outbox primitives, but move orchestration decisions out of components.
