# 03 Changes

## Infrastructure

- `docker-compose.yml`: Added Postgres service with named volume.

## API Configuration

- `api/package.json`: Added `prisma` and `@prisma/client`.
- `api/.env` and `api/.env.example`: Added `DATABASE_URL`.
- `api/prisma/schema.prisma`: Created comprehensive schema. Renamed `IR` to `InspectionReport` based on user feedback.

## Code

- `api/src/app/prisma/prisma.service.ts`: Implemented connection service.
- `api/src/app/prisma/prisma.module.ts`: Exported service globally.
- `api/src/app/app.module.ts`: Imported `PrismaModule` and fixed `.env` path.
- `api/scripts/provision-tenant.ts`: Added script for creating tenants.
- `package.json`: Added `db:migrate`, `db:provision`, `db:studio` scripts.

## Migrations

- `20260218..._init`: Initial schema creation.
- `20260218..._rename_ir_to_inspection_report`: Renaming IR to InspectionReport.
