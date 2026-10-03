-- CreateEnum
CREATE TYPE "SerialApprovalStatus" AS ENUM ('NOT_INSPECTED', 'INSPECTED_DRAFT', 'SUBMITTED_FOR_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "InspectionApprovalBatchStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED');

-- AlterTable
ALTER TABLE "SerialNumber" ADD COLUMN     "approvalStatus" "SerialApprovalStatus" NOT NULL DEFAULT 'NOT_INSPECTED';

-- CreateTable
CREATE TABLE "InspectionApprovalBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionReportId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "InspectionApprovalBatchStatus" NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionApprovalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionApprovalBatchSerialNumber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionApprovalBatchId" TEXT NOT NULL,
    "serialNumberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionApprovalBatchSerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionApprovalBatch_tenantId_inspectionReportId_idx" ON "InspectionApprovalBatch"("tenantId", "inspectionReportId");

-- CreateIndex
CREATE INDEX "InspectionApprovalBatch_tenantId_status_idx" ON "InspectionApprovalBatch"("tenantId", "status");

-- CreateIndex
CREATE INDEX "InspectionApprovalBatchSerialNumber_inspectionApprovalBatch_idx" ON "InspectionApprovalBatchSerialNumber"("inspectionApprovalBatchId");

-- CreateIndex
CREATE INDEX "InspectionApprovalBatchSerialNumber_serialNumberId_idx" ON "InspectionApprovalBatchSerialNumber"("serialNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionApprovalBatchSerialNumber_tenantId_inspectionAppr_key" ON "InspectionApprovalBatchSerialNumber"("tenantId", "inspectionApprovalBatchId", "serialNumberId");

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatch" ADD CONSTRAINT "InspectionApprovalBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatch" ADD CONSTRAINT "InspectionApprovalBatch_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatch" ADD CONSTRAINT "InspectionApprovalBatch_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatch" ADD CONSTRAINT "InspectionApprovalBatch_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatchSerialNumber" ADD CONSTRAINT "InspectionApprovalBatchSerialNumber_inspectionApprovalBatc_fkey" FOREIGN KEY ("inspectionApprovalBatchId") REFERENCES "InspectionApprovalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatchSerialNumber" ADD CONSTRAINT "InspectionApprovalBatchSerialNumber_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "SerialNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
