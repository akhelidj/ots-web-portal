/*
  Warnings:

  - You are about to drop the column `irId` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `irId` on the `ChildReport` table. All the data in the column will be lost.
  - You are about to drop the column `irId` on the `SerialNumber` table. All the data in the column will be lost.
  - You are about to drop the `IR` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `IRRevision` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `IRTransitionLog` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[inspectionReportId,serial]` on the table `SerialNumber` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `inspectionReportId` to the `ChildReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inspectionReportId` to the `SerialNumber` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "InspectionReportStatus" AS ENUM ('DRAFT', 'RECEIVED', 'READY_FOR_CLEANING', 'READY_FOR_INSPECTION', 'IN_INSPECTION', 'PENDING_APPROVAL', 'APPROVED', 'ON_HOLD', 'CLOSED');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_irId_fkey";

-- DropForeignKey
ALTER TABLE "ChildReport" DROP CONSTRAINT "ChildReport_irId_fkey";

-- DropForeignKey
ALTER TABLE "IR" DROP CONSTRAINT "IR_customerId_fkey";

-- DropForeignKey
ALTER TABLE "IR" DROP CONSTRAINT "IR_templateVersionId_fkey";

-- DropForeignKey
ALTER TABLE "IR" DROP CONSTRAINT "IR_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "IRRevision" DROP CONSTRAINT "IRRevision_irId_fkey";

-- DropForeignKey
ALTER TABLE "IRTransitionLog" DROP CONSTRAINT "IRTransitionLog_irId_fkey";

-- DropForeignKey
ALTER TABLE "SerialNumber" DROP CONSTRAINT "SerialNumber_irId_fkey";

-- DropIndex
DROP INDEX "SerialNumber_irId_serial_key";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "irId",
ADD COLUMN     "inspectionReportId" TEXT;

-- AlterTable
ALTER TABLE "ChildReport" DROP COLUMN "irId",
ADD COLUMN     "inspectionReportId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SerialNumber" DROP COLUMN "irId",
ADD COLUMN     "inspectionReportId" TEXT NOT NULL;

-- DropTable
DROP TABLE "IR";

-- DropTable
DROP TABLE "IRRevision";

-- DropTable
DROP TABLE "IRTransitionLog";

-- DropEnum
DROP TYPE "IRStatus";

-- CreateTable
CREATE TABLE "InspectionReport" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "reportNumber" TEXT,
    "revisionNumber" INTEGER,
    "status" "InspectionReportStatus" NOT NULL DEFAULT 'DRAFT',
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "templateVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionReportTransitionLog" (
    "id" TEXT NOT NULL,
    "fromStatus" "InspectionReportStatus" NOT NULL,
    "toStatus" "InspectionReportStatus" NOT NULL,
    "previousActiveStatus" "InspectionReportStatus",
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionReportId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "InspectionReportTransitionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionReportRevision" (
    "id" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionReportId" TEXT NOT NULL,

    CONSTRAINT "InspectionReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionReportRevision_inspectionReportId_revisionNumber_key" ON "InspectionReportRevision"("inspectionReportId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_inspectionReportId_serial_key" ON "SerialNumber"("inspectionReportId", "serial");

-- AddForeignKey
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReport" ADD CONSTRAINT "ChildReport_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionReportTransitionLog" ADD CONSTRAINT "InspectionReportTransitionLog_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionReportRevision" ADD CONSTRAINT "InspectionReportRevision_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
