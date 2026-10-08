# T0.2 Plan: Database “Operational Baseline”

## 1. Strategy

We established a production-grade database foundation using **Prisma** with a **Postgres** database running in WSL Docker.

### Key Components

1.  **Database**: Postgres 16 running in a Docker container on WSL 2.
2.  **ORM**: Prisma (Schema, Client, Migrations).
3.  **Application Integration**: NestJS `PrismaService` and `PrismaModule`.
4.  **Tenant Isolation**: All queries must be scoped by `tenantId`.
5.  **Provisioning**: Script to create the initial Tenant and Admin User.

### WSL Docker Approach (Option B)

The database runs inside the WSL 2 utility VM. The API runs on Windows.
Connectivity is achieved via `localhost:5432`, relying on WSL 2's automatic localhost forwarding.
**Crucial Fix**: Using a **named volume** for Postgres data to avoid filesystem permission issues associated with binding to Windows `/mnt/c` paths.

## 2. Model List

- `Tenant`: Multi-tenant root.
- `User`: Application users.
- `Customer`: Clients.
- `IR`: Inspection Requests.
- `SerialNumber`: Serial units.
- `ChildReport`: Sub-reports.
- `ChildReportSerialNumber`: Link table.
- `Attachment`: Files.
- `IRTransitionLog`: Audit trail.
- `ChildReportTransitionLog`: Audit trail.
- `AuditLog`: General audit log.
- `IRRevision`: Snapshots.
- `ChildReportRevision`: Snapshots.
- `TemplateVersion`: Immutable templates.

## 3. Execution Steps (Completed)

1.  Setup `docker-compose.yml` (using named volume).
2.  Install Prisma packages.
3.  Define `schema.prisma` and `prisma.config.ts`.
4.  Generate initial migration (`init`).
5.  Implement `PrismaService` in NestJS.
6.  Create and run `provision-tenant.ts` script.
