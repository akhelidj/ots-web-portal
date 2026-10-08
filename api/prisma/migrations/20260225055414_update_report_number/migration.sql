-- AlterTable
ALTER TABLE "InspectionReport" ADD COLUMN     "connection" TEXT,
ADD COLUMN     "equipmentUsed" JSONB,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "inspectionAddress" TEXT,
ADD COLUMN     "inspectionMethod" JSONB,
ADD COLUMN     "nomID" TEXT,
ADD COLUMN     "nomOD" TEXT,
ADD COLUMN     "nomWT" TEXT,
ADD COLUMN     "range" TEXT,
ADD COLUMN     "standardUsed" TEXT,
ADD COLUMN     "weight" TEXT;
