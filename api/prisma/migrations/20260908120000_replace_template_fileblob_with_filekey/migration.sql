-- Phase 2 of the S3 migration: template workbooks move off the Postgres-resident
-- `fileBlob` blob onto the storage abstraction, which persists a storage key on
-- the row instead of the bytes.
--
-- There is no production template data, and existing local templates are reseeded,
-- so no backfill is possible or needed. Because the new `fileKey` is NOT NULL and
-- cannot be derived from the dropped blob, any existing Template rows are cleared
-- first (along with their TemplateDefinitionRevision children, whose FK would
-- otherwise block the delete). On production the Template table is empty, so these
-- deletes affect zero rows and the migration applies cleanly via `migrate deploy`.

-- Clear reseeded template data (no-op on an empty prod table).
DELETE FROM "TemplateDefinitionRevision";
DELETE FROM "Template";

-- Swap the resident blob for a storage key reference. No dual column, no backfill.
ALTER TABLE "Template" DROP COLUMN "fileBlob";
ALTER TABLE "Template" ADD COLUMN "fileKey" TEXT NOT NULL;
