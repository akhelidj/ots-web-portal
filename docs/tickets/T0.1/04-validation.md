# T0.1 Validation

## Prerequisites

- [ ] Node version is `20.19.3`.

## Configuration

- [ ] `.env` file exists in `apps/api` with required keys.
- [ ] `PORT` is set.
- [ ] `SESSION_TTL_DAYS` is set.
- [ ] `CORS_ALLOWED_ORIGINS` is set.

## API Validation

- [ ] API starts successfully.
- [ ] `GET /health` returns 200 OK.
- [ ] `GET /api/random` returns 403 Forbidden or 401 Unauthorized.

## Portal Validation

- [ ] Portal starts successfully.
- [ ] Portal can make requests to API (CORS working).

## Artifact Cleanup

- [ ] No `*.spec.ts` files exist.
- [ ] No e2e projects exist.
