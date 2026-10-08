# 02 Decisions

## 1. Inspection Data as JSON

**Decision**: The `inspectionData` field in `SerialNumber` is stored as a nullable JSON blob (`jsonb`).
**Rationale**: The structure of inspection data varies significantly based on the Template used for the IR. Using JSON allows for flexibility and template-driven validation logic (to be implemented later) without frequent schema migrations for new inspection types.

## 2. Template Versioning

**Decision**: `TemplateVersion` is an immutable model.
**Rationale**: Templates must not change once used. If a template is updated, a new `TemplateVersion` record is created.

## 3. Nullable Revision Number

**Decision**: `ir.revisionNumber` is nullable until the first approval.
**Rationale**: Draft IRs do not need strict revision control.

## 4. WSL Docker Connectivity

**Decision**: The API runs on Windows and connects to Postgres in WSL via `localhost:5432`.
**Rationale**: WSL 2 provides automatic port forwarding.
**Crucial Implementation Detail**: We use a **Docker Named Volume** (`ots_postgres_data`) instead of a bind mount to `C:\...` because Postgres requires strict filesystem permissions (chmod/chown) that are not fully supported on NTFS mounts in WSL.

## 5. Prisma Version

**Decision**: Downgraded to **Prisma 5.22.0** (from default v7).
**Rationale**: Prisma 7 introduced breaking changes to `schema.prisma` configuration (disallowing `url` in `datasource` block) and `PrismaClient` initialization which caused significant friction with the current setup. V5 is stable and works out of the box.
