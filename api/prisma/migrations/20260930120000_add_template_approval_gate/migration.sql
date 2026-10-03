-- Admin validation gate on template versions. Uploading templates is no longer
-- admin-only: a SUPERVISOR can upload and define one, but it stays PENDING_APPROVAL and
-- is excluded from `getAvailableTemplates` until an ADMIN approves it, so a report can
-- never be created against an unvalidated template. An ADMIN's own upload is born
-- APPROVED.
--
-- Backfill: the column DEFAULTs to 'APPROVED' and is added NOT NULL, so every
-- pre-existing row (all of which were necessarily admin-uploaded — the endpoint was
-- admin-only until now) keeps working untouched. No row becomes retroactively pending.
CREATE TYPE "TemplateApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

ALTER TABLE "Template"
  ADD COLUMN "approvalStatus" "TemplateApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;
