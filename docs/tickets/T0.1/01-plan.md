# T0.1 Plan: Baseline Hardening

## Folder Structure

We will establish a `docs` folder at the root of the repository to house all project documentation.

- `docs/architecture`: High-level architectural decisions and diagrams.
- `docs/tickets`: Per-ticket documentation to track changes and decisions.

## Config Strategy

- **API**: All configuration will be driven by environment variables loaded from a `.env` file. We will use `@nestjs/config` for this.
- **Portal**: Configuration will be driven by Angular's `environment.ts` files, which will be replaced at build time for production.

## Security Enforcement

- **Default Deny**: A global guard will be implemented in the API to block all routes by default.
- **Exception**: The `/health` endpoint will be explicitly whitelisted.
- **CORS**: CORS will be enabled and configured via environment variables to allow cross-origin requests from the Portal.

## Node Version Locking

- We will enforce Node.js version `20.19.3` using an `.nvmrc` file and documentation in `README.md`.
- This is to avoid a known issue with Nx and Angular dev server.
