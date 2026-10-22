# CI/CD (GitHub Actions)

Two workflows in `.github/workflows/`, plus the production definition in `deploy/`.

| What | Where |
|---|---|
| Checks on PRs and pushes to `develop` | `ci.yml` |
| Checks + deploy on every push to `master` (also manually runnable) | `deploy.yml` (calls `ci.yml`) |
| API image (Dockerfile, `app` + `migrate` targets) | `deploy/Dockerfile.api` |
| Production compose file | `deploy/docker-compose.yml` |
| Server-side deploy / rollback script | `deploy/remote-deploy.sh` |

## What CI runs

`check` job: `npm ci` → Prisma client generate → lint (`nx run-many -t lint`) → typecheck
API and portal (`tsc -p …/tsconfig.app.json --noEmit`) → unit tests (`nx run-many -t test`) →
production builds of both apps.
`api-integration` job: the `*.integration.spec.ts` suite against a disposable Postgres 16
service on port 5433 (settings from `api/.env.test.example`). Node comes from `.nvmrc`.

Note: spec files are not typechecked by `tsc` here (jest uses swc), matching local practice.

## What a deploy does (push to `master`)

1. CI must pass (`needs: ci`).
2. Build `dist/api` and `dist/portal/browser`, assemble a release, upload it to
   `/opt/ots/releases/<commit-sha>/` over SSH.
3. `remote-deploy.sh` on the server:
   1. snapshot the running state (`api_dist.prev`, `docker-compose.yml.prev`, image tagged
      `ots_api:previous`);
   2. replace `api_dist/` with the new build and copy in `Dockerfile` + `docker-compose.yml`;
   3. `docker compose --profile tools build api migrate` — the old API keeps serving;
   4. **run migrations** (`docker compose --profile tools run --rm migrate` →
      `prisma migrate deploy`). On failure: restore the files, leave the old API running, fail
      the deploy;
   5. `docker compose up -d api`, then wait up to ~2 min for the container healthcheck
      (`/health`). If it never becomes healthy: re-point `ots_api:latest` at `previous`,
      restore the files, restart the old image, fail the deploy;
   6. publish the portal (`rsync --delete-after` into `portal_dist/`, which Caddy serves);
   7. keep the 5 newest releases, prune dangling images.
4. Smoke test: `GET $PROD_API_URL/health` from the runner.

Migrations deliberately run as their own step, not at app start: a failing migration then
blocks the deploy instead of crash-looping the API, and the log shows exactly which one failed.

### Migration rules (important)

Migrations run **before** the new API starts, and a rollback restarts the OLD API against the
NEW schema. So every migration must be backward compatible with the previous release
(expand → deploy → contract in a later release): add columns nullable or with defaults, do not
rename or drop a column in the same release that stops using it.

## One-time setup

Done for production on 2026-10-22 (the values below are what was configured; secrets are
never written here). Use this section to rebuild the setup or onboard a new server.

### 1. Deploy key (on your own machine, not on the server)

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\ots-deploy" -C "github-actions-deploy" -N '""'
```

(Linux/macOS: `ssh-keygen -t ed25519 -f ots-deploy -C github-actions-deploy -N ""`.) This is a
dedicated key — never reuse a personal one. The private half goes only into the GitHub secret
`DEPLOY_SSH_KEY`; the `.pub` half goes on the server.

### 2. Server (Lightsail Ubuntu instance, `/opt/ots`)

- Append the contents of `ots-deploy.pub` to `~/.ssh/authorized_keys` of the deploy user (the
  user that owns `/opt/ots` and is in the `docker` group; here `ubuntu`), with `chmod 700 ~/.ssh`
  and `chmod 600 ~/.ssh/authorized_keys`.
- `rsync` must be installed (`rsync --version`; else `sudo apt-get install -y rsync`).
- The instance must have a **static IP** (Lightsail → instance → Networking); an ordinary
  Lightsail IP changes on stop/start and would break the deploy. If it changes, update
  `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`.
- Host key line for the `DEPLOY_KNOWN_HOSTS` secret, generated **on the server** (so it needs no
  trust-on-first-use over the network):

  ```bash
  echo "$(curl -s https://checkip.amazonaws.com) $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
  ```

- Back up what the first deploy replaces, once:

  ```bash
  cd /opt/ots && cp docker-compose.yml docker-compose.yml.orig && cp -a api_dist api_dist.orig
  ```

  The first deploy overwrites `docker-compose.yml` with `deploy/docker-compose.yml` and replaces
  `api_dist/` with the new build plus `deploy/Dockerfile.api` (as `Dockerfile`). Before the first
  deploy `api_dist/` held only `Dockerfile`, `assets/`, `main.js(.map)`, `package(-lock).json`,
  `prisma/` and `scripts/`, so nothing else is lost. It also recreates the API container once,
  because the image gets a name (`ots_api:latest`) and a build target (a short API blip).
- `Caddyfile`, `.env`, `caddy/` and `portal_dist/` are not touched except `portal_dist/`
  contents (replaced by each deploy).

### 3. Database baseline (check before the first deploy)

`prisma migrate deploy` only works if the production database has Prisma's migration history.
Run on the server (read-only):

```sql
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
```

It must equal the number of folders in `api/prisma/migrations/` (28 on 2026-10-22, matching
production). If the table is missing or the count is lower, do not deploy yet: the first
migrate step would try to re-apply old migrations and fail (safely — the deploy aborts and the
old API keeps running), and the history has to be baselined with `prisma migrate resolve`
first.

### 4. GitHub

Settings → **Secrets and variables** → **Actions** (repository level). GitHub environments are
not available on this repo/plan, so there is no required-reviewer gate: every merge to
`master` deploys. (On a paid plan, add `environment: production` to the deploy job and move
the secrets there to get an approval gate.)

| Kind | Name | Value |
|---|---|---|
| Secret | `DEPLOY_HOST` | the instance's static public IP |
| Secret | `DEPLOY_USER` | the SSH user (`ubuntu`) |
| Secret | `DEPLOY_SSH_KEY` | the full contents of the private key `ots-deploy` |
| Secret | `DEPLOY_KNOWN_HOSTS` | the host-key line from step 2 |
| Variable | `PROD_API_URL` | `https://api.oilfield-tubular-services.com` |

Branch protection on `master`/`develop` (require a PR and the CI checks `Lint, typecheck, unit
tests, build` and `API integration tests (Postgres)`) is not enforceable on the free plan for
private repos. By convention: **never push straight to `master`**; merge `develop` into it
through a pull request after CI is green, because anything on `master` deploys immediately.

SSH port 22 must be reachable from GitHub-hosted runners (their IPs change), so keep password
login off and key-only on, and use only the dedicated key.

## Shipping a release

1. Work on `develop`; CI runs on every push and PR (`ci.yml`).
2. Open a pull request `develop` → `master` on GitHub, wait for the checks to go green, merge
   (regular merge commit).
3. The merge starts **Deploy** (`deploy.yml`): Actions tab → *Deploy* → `ci`, then `deploy`
   (build, upload, deploy on the server, smoke test). About 8–10 minutes the first time.
4. Verify: the smoke-test step is green; optionally `docker ps` on the server shows `ots_api`
   `healthy`, and `journalctl CONTAINER_NAME=ots_api --since "10 min ago" -o cat | tail` shows the
   JSON access lines (see [logging.md](logging.md)).

A failed migration or an API that never becomes healthy is rolled back by the script and the
run fails; read the failing step's log in Actions. Nothing else is needed to undo it.

### Troubleshooting a failed run

- **`ci` fails** — nothing was deployed. Fix and push; same as a failing local run.
- **Upload / SSH step fails** — check the secrets, that the public key is in
  `authorized_keys`, and that `DEPLOY_KNOWN_HOSTS` matches the host (`Host key verification
  failed` means the line or the IP is wrong).
- **`remote-deploy.sh` fails at migrations** — the log shows the Prisma error; the old API is
  still running. Fix with a corrective migration; do not edit applied ones.
- **Fails at "never became healthy"** — the script prints the last API log lines and rolls
  back to `ots_api:previous`.
- **Smoke test fails but the server step passed** — check `PROD_API_URL`, Caddy and DNS; the API
  itself passed its container healthcheck.

## Rollback

- **Automatic:** failed migration or unhealthy API → handled by the script (see above).
- **Manual, after a bad release that passed the healthcheck:** on the server

  ```bash
  cd /opt/ots
  docker tag ots_api:previous ots_api:latest
  docker compose up -d --no-build api
  ```

  `ots_api:previous` is the image that ran just before the latest deploy. Then revert the
  change on `master` and let the pipeline redeploy. Migrations are not undone (see the
  migration rules).
- Portal: the previous releases are kept under `/opt/ots/releases/`; re-run
  `rsync -a --delete <release>/portal/ /opt/ots/portal_dist/` from the one you want.

## Known limits

- No staging environment: `master` is production.
- The Caddyfile and `.env` stay on the server and are not managed by the pipeline.
- The pre-commit hook (`lint-staged`) is separate from CI and currently has no config; CI is
  the first automated gate.
- Deploys are one at a time (`concurrency` group); a second push waits.
