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

### On the server (Lightsail instance)

```bash
sudo apt-get install -y rsync          # if missing
mkdir -p /opt/ots/releases
```

Create a dedicated deploy key **on your own machine** (not on the server):

```bash
ssh-keygen -t ed25519 -f ots-deploy -C "github-actions-deploy" -N ""
```

Append `ots-deploy.pub` to `~/.ssh/authorized_keys` of the deploy user on the server (the
user that owns `/opt/ots` and can run `docker`; currently `ubuntu`). Never reuse a personal key.

Also back up the current `/opt/ots/docker-compose.yml` once
(`cp docker-compose.yml docker-compose.yml.orig`): the first deploy overwrites it with
`deploy/docker-compose.yml`. The first deploy also recreates the API container, because the
image gets a name (`ots_api:latest`) and a build target.

### Database baseline (check before the first deploy)

`prisma migrate deploy` only works if the production database has Prisma's migration history.
Run on the server (read-only):

```sql
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
```

It should equal the number of folders in `api/prisma/migrations/`. If the table is missing or
the count is lower, tell whoever maintains the pipeline before deploying — the first migrate
step would try to re-apply old migrations and fail (safely: the deploy aborts and the old API
keeps running), and the history has to be baselined with `prisma migrate resolve` first.

### In GitHub

Settings → **Secrets and variables** → **Actions** (repository level — GitHub environments
are not available on private repos on the free plan; on a paid plan, add
`environment: production` to the deploy job and move these there to get a required-reviewer
approval gate). Every merge to `master` deploys immediately. Add:

| Kind | Name | Value |
|---|---|---|
| Secret | `DEPLOY_HOST` | the instance's public IP or DNS name |
| Secret | `DEPLOY_USER` | the SSH user (e.g. `ubuntu`) |
| Secret | `DEPLOY_SSH_KEY` | the full contents of the private key `ots-deploy` |
| Secret | `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <host>` (run it from your machine and verify the fingerprint) |
| Variable | `PROD_API_URL` | `https://api.oilfield-tubular-services.com` |

Settings → **Branches** (needs a paid plan on private repos; on the free plan, enforce it by
convention — never push straight to `master`) → protect `master` (and `develop`): require a pull request and the CI
checks (`Lint, typecheck, unit tests, build` and `API integration tests (Postgres)`) before
merging. Without this, "deploy on push to master" ships whatever is pushed.

SSH port 22 must be reachable from GitHub-hosted runners (their IPs change), so keep
password login off and key-only on, and use the dedicated key above.

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
