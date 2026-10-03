-- Free-entry report statistics (label + value + optional serials), typed by the
-- inspector. Replaces the computed outcome KPIs. Purely additive nullable column.
-- AlterTable
ALTER TABLE "InspectionReport" ADD COLUMN "statistics" JSONB;
