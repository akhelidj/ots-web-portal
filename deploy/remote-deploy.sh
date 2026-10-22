#!/usr/bin/env bash
# Runs ON the server, started by .github/workflows/deploy.yml over SSH.
# Usage: remote-deploy.sh <release-id>      (release dir: /opt/ots/releases/<release-id>)
#
# Order matters: build the new image while the old API keeps serving, run migrations
# BEFORE swapping the API (a failing migration aborts with the old version untouched),
# swap, wait for the container healthcheck, and roll back to the previous image if the
# new one never becomes healthy.
set -euo pipefail

ID="${1:?release id required}"
ROOT=/opt/ots
REL="$ROOT/releases/$ID"
cd "$ROOT"

log() { echo "[deploy $ID] $*"; }

exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { log "another deploy is running"; exit 1; }

for p in api portal Dockerfile.api docker-compose.yml; do
  [ -e "$REL/$p" ] || { log "release incomplete: missing $p"; exit 1; }
done

restore_files() {
  if [ -d api_dist.prev ]; then rm -rf api_dist; mv api_dist.prev api_dist; fi
  if [ -f docker-compose.yml.prev ]; then cp docker-compose.yml.prev docker-compose.yml; fi
  return 0
}

# --- snapshot what is running now ---------------------------------------------------
rm -rf api_dist.prev
if [ -d api_dist ]; then cp -a api_dist api_dist.prev; fi
if [ -f docker-compose.yml ]; then cp docker-compose.yml docker-compose.yml.prev; fi
RUNNING_IMAGE="$(docker inspect -f '{{.Image}}' ots_api 2>/dev/null || true)"
if [ -n "$RUNNING_IMAGE" ]; then docker tag "$RUNNING_IMAGE" ots_api:previous; fi

# --- stage the new build ------------------------------------------------------------
rsync -a --delete "$REL/api/" api_dist/
cp "$REL/Dockerfile.api" api_dist/Dockerfile
cp "$REL/docker-compose.yml" docker-compose.yml

log "building images (the running API is untouched)"
docker compose --profile tools build api migrate

# --- migrations, before the API is swapped -------------------------------------------
log "applying database migrations"
if ! docker compose --profile tools run --rm migrate; then
  log "MIGRATION FAILED - old API left running, restoring files"
  restore_files
  exit 1
fi

# --- swap the API and wait for it to be healthy --------------------------------------
log "starting new API"
docker compose up -d api

healthy=""
for _ in $(seq 1 40); do
  state="$(docker inspect -f '{{.State.Health.Status}}' ots_api 2>/dev/null || echo none)"
  if [ "$state" = "healthy" ]; then healthy=yes; break; fi
  sleep 3
done

if [ -z "$healthy" ]; then
  log "NEW API NEVER BECAME HEALTHY - last logs:"
  docker logs --tail 40 ots_api 2>&1 || true
  if docker image inspect ots_api:previous >/dev/null 2>&1; then
    log "rolling back to the previous image"
    docker tag ots_api:previous ots_api:latest
    restore_files
    docker compose up -d --no-build api
  fi
  exit 1
fi

# --- portal (static files served by Caddy straight from the bind mount) ---------------
log "publishing portal"
rsync -a --delete-after "$REL/portal/" portal_dist/

# --- housekeeping ----------------------------------------------------------------------
ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
docker image prune -f >/dev/null 2>&1 || true
log "done"
