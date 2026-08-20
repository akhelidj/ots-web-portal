/*
  Warnings:

  - You are about to drop the column `connection` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `equipmentUsed` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `grade` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `inspectionAddress` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `inspectionMethod` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `inspectorComment` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `nomID` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `nomOD` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `nomWT` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `range` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `standardUsed` on the `InspectionReport` table. All the data in the column will be lost.
  - You are about to drop the column `weight` on the `InspectionReport` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InspectionReport" DROP COLUMN "connection",
DROP COLUMN "equipmentUsed",
DROP COLUMN "grade",
DROP COLUMN "inspectionAddress",
DROP COLUMN "inspectionMethod",
DROP COLUMN "inspectorComment",
DROP COLUMN "nomID",
DROP COLUMN "nomOD",
DROP COLUMN "nomWT",
DROP COLUMN "range",
DROP COLUMN "standardUsed",
DROP COLUMN "weight";
