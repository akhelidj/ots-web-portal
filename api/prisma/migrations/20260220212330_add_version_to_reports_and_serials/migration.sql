-- AlterTable
ALTER TABLE "InspectionReport" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SerialNumber" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
