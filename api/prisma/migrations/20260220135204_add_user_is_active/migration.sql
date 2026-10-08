/*
  Warnings:

  - You are about to drop the column `createdAt` on the `ChildReportRevision` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `ChildReportRevision` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `InspectionReportRevision` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `InspectionReportRevision` table. All the data in the column will be lost.
  - Added the required column `revisedById` to the `ChildReportRevision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revisionReason` to the `ChildReportRevision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ChildReportRevision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `templateHash` to the `InspectionReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `templateKey` to the `InspectionReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `templateVersion` to the `InspectionReport` table without a default value. This is not possible if the table is not empty.
  - Made the column `revisionNumber` on table `InspectionReport` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `revisedById` to the `InspectionReportRevision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revisionReason` to the `InspectionReportRevision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `InspectionReportRevision` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "InspectionReport" DROP CONSTRAINT "InspectionReport_templateVersionId_fkey";

-- AlterTable
ALTER TABLE "ChildReport" ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChildReportRevision" DROP COLUMN "createdAt",
DROP COLUMN "reason",
ADD COLUMN     "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revisedById" TEXT NOT NULL,
ADD COLUMN     "revisionReason" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "InspectionReport" ADD COLUMN     "templateHash" TEXT NOT NULL,
ADD COLUMN     "templateKey" TEXT NOT NULL,
ADD COLUMN     "templateVersion" INTEGER NOT NULL,
ALTER COLUMN "revisionNumber" SET NOT NULL,
ALTER COLUMN "revisionNumber" SET DEFAULT 0,
ALTER COLUMN "templateVersionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InspectionReportRevision" DROP COLUMN "createdAt",
DROP COLUMN "reason",
ADD COLUMN     "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revisedById" TEXT NOT NULL,
ADD COLUMN     "revisionReason" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "ChildReportRevision_tenantId_childReportId_idx" ON "ChildReportRevision"("tenantId", "childReportId");

-- CreateIndex
CREATE INDEX "InspectionReportRevision_tenantId_inspectionReportId_idx" ON "InspectionReportRevision"("tenantId", "inspectionReportId");

-- AddForeignKey
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
