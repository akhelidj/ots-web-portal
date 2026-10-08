/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,inspectionReportId,serial]` on the table `SerialNumber` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SerialNumber_inspectionReportId_serial_key";

-- AlterTable
ALTER TABLE "SerialNumber" ADD COLUMN     "tenantId" TEXT;

-- Backfill data
UPDATE "SerialNumber" SET "tenantId" = (SELECT "tenantId" FROM "InspectionReport" WHERE "InspectionReport"."id" = "SerialNumber"."inspectionReportId");

-- AlterColumn
ALTER TABLE "SerialNumber" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "SerialNumber_tenantId_inspectionReportId_idx" ON "SerialNumber"("tenantId", "inspectionReportId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_tenantId_inspectionReportId_serial_key" ON "SerialNumber"("tenantId", "inspectionReportId", "serial");

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
