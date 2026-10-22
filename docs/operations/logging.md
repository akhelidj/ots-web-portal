# Production Logging

How the API logs, how to read those logs on the production host, and how to set it up. The
production stack runs under Docker Compose on a Lightsail Ubuntu instance (`/opt/ots`:
`api_dist/`, `portal_dist/`, `caddy/`, `.env`, `docker-compose.yml`). The API image is built
from `./api_dist` (the compose build context), so a deploy is "replace `main.js`, rebuild,
recreate".

## What the API logs

Everything goes to stdout/stderr (Docker captures it). Code: `api/src/main.ts` and
`api/src/app/common/logging/request-logging.middleware.ts`.

### Access log — one JSON line per request

```json
{"ts":"2026-10-22T19:30:11.204Z","level":"info","msg":"http","reqId":"8c1f…","method":"GET","path":"/inspection-reports/5e24…/export","status":200,"ms":412,"userId":"477c…","role":"SUPERVISOR","tenantId":"06b8…"}
```

- `level`: `info` (< 400) → stdout, `warn` (4xx) → warn, `error` (5xx) → stderr.
- `path` never includes the query string (it can carry tokens). Request bodies and headers
  are never logged.
- `userId` / `role` / `tenantId` are absent for unauthenticated calls (login, 401s).
- `/health` is not logged (it is polled constantly).

### Request id

Every request gets an id, returned in the `X-Request-Id` response header (exposed to the
browser via CORS). An incoming `X-Request-Id` is reused if it matches `[\w-]{8,64}`,
otherwise a UUID is generated. The same id appears in:

- the access-log line (`reqId`);
- the exception-filter log line (`[<id>]`);
- error response bodies (`requestId`).

So a user can quote the id from an error and you can find exactly that request.

### Errors

`AllExceptionsFilter` (in `main.ts`) logs 4xx as one `warn` line with the message and 5xx as
`===== FATAL SERVER ERROR [<id>] =====` followed by the exception and stack. The stack
trace **is not sent to clients when `NODE_ENV=production`** (it is outside production, which
keeps local debugging and the unit tests as they were). The webpack production build bakes
`NODE_ENV=production` in.

### Level control

`LOG_LEVELS=error,warn` (comma separated) in the API's environment restricts Nest's own
logger. The access log uses `console` directly and is **not** affected by it.

## One-time server setup

1. **Send container logs to the host journal** (survives container recreation, i.e. every
   deploy, and still works with `docker logs`). In `/opt/ots/docker-compose.yml`, inside the
   `api:` service, at the same indentation as `build:`:

   ```yaml
       logging:
         driver: journald
         options:
           tag: ots_api
   ```

   Validate: `docker compose config > /dev/null && echo OK`.

2. **Keep the journal on disk and cap it:**

   ```bash
   sudo mkdir -p /var/log/journal
   sudo sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=1G/' /etc/systemd/journald.conf
   sudo systemctl restart systemd-journald
   ```

3. Recreate the container so the driver applies: `cd /opt/ots && docker compose up -d api`.

(Alternative with no host journal: `driver: json-file` with
`options: { max-size: "10m", max-file: "5" }` caps disk use but the logs are lost whenever
the container is recreated.)

## Reading the logs

```bash
# last hour
journalctl CONTAINER_NAME=ots_api --since "1 hour ago" -o cat
# follow live
journalctl CONTAINER_NAME=ots_api -f -o cat
# only server errors / client errors
journalctl CONTAINER_NAME=ots_api -o cat | grep '"status":5'
journalctl CONTAINER_NAME=ots_api -o cat | grep '"level":"warn"'
# one request, from a request id a user quotes
journalctl CONTAINER_NAME=ots_api -o cat | grep <request-id>
# slow requests (ms >= 2000)
journalctl CONTAINER_NAME=ots_api -o cat | grep -E '"ms":[0-9]{4,}'
```

`docker logs ots_api` also works while the container exists. A user's browser shows the
request id in DevTools → Network → the failed request → Response Headers (`X-Request-Id`) or
in the error JSON (`requestId`).

## Deploying the API (manual flow)

1. Build locally: `npx nx build api` → `dist/api/main.js`.
2. Upload it to `/opt/ots/api_dist/main.js` (MobaXterm SFTP), overwriting.
3. `cd /opt/ots && docker compose build api && docker compose up -d api`.
4. Verify: `docker exec ots_api sh -c "grep -c <something-new> /app/main.js"` and a quick
   `journalctl CONTAINER_NAME=ots_api --since "5 min ago" -o cat | tail`.

`docker cp` into the container or `docker restart` does **not** deploy: the image is built
from `api_dist`, so a container recreated from the old image brings the old code back. The
compose service is `api` (container `ots_api`); use the service name with `docker compose`.

Rollback: put the previous `main.js` back and run step 3 again.

## Troubleshooting

- **A 4xx/5xx with no explanation** — take its request id, `grep` it in the journal; the
  `warn`/`FATAL` line has the message (and, for 5xx, the stack).
- **No logs after enabling journald** — confirm the container was recreated
  (`docker compose up -d api`) and that the driver took effect:
  `docker inspect ots_api --format '{{.HostConfig.LogConfig.Type}}'` → `journald`.
- **Disk filling up** — check `journalctl --disk-usage`; `SystemMaxUse` in
  `/etc/systemd/journald.conf` caps it.
- **API will not start after a deploy** — `docker compose logs api --tail 50`, then roll back.

## Known limits / next steps

- Logs live on the single host: a lost instance means lost logs. Shipping them to
  CloudWatch Logs (small free tier, paid beyond) would give search, longer retention and
  alarms on 5xx; deliberately not done yet.
- No alerting. A cheap start is a cron job that greps the journal for `"status":5` and
  notifies.
- The access log records who and what, not request/response payloads, by design.
