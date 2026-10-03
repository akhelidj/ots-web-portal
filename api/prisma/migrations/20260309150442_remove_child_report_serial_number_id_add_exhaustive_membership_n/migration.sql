/*
  Warnings:

  - You are about to drop the column `serialNumberId` on the `ChildReport` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tenantId,inspectionReportId,type]` on the table `ChildReport` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "ChildReport" DROP CONSTRAINT "ChildReport_serialNumberId_fkey";

-- AlterTable
ALTER TABLE "ChildReport" DROP COLUMN "serialNumberId";

-- AlterTable
ALTER TABLE "ChildReportSerialNumber" ADD COLUMN     "disposition" "SerialDisposition",
ADD COLUMN     "inspectionData" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ChildReport_tenantId_inspectionReportId_type_key" ON "ChildReport"("tenantId", "inspectionReportId", "type");
