/*
  Warnings:

  - Added the required column `serialNumberId` to the `ChildReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ChildReport` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChildReportType" AS ENUM ('REWORK', 'SCRAP', 'HOLD');

-- DropForeignKey
ALTER TABLE "SerialNumber" DROP CONSTRAINT "SerialNumber_tenantId_fkey";

-- AlterTable
ALTER TABLE "ChildReport" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "serialNumberId" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "type" "ChildReportType" NOT NULL DEFAULT 'REWORK',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ChildReport_tenantId_idx" ON "ChildReport"("tenantId");

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReport" ADD CONSTRAINT "ChildReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReport" ADD CONSTRAINT "ChildReport_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "SerialNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
