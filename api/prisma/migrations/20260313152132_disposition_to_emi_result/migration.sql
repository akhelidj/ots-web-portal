-- AlterTable
ALTER TABLE "ChildReportSerialNumber" ADD COLUMN     "approvalStatus" "SerialApprovalStatus" NOT NULL DEFAULT 'NOT_INSPECTED';

-- AlterTable
ALTER TABLE "InspectionApprovalBatch" ADD COLUMN     "childReportId" TEXT;

-- AddForeignKey
ALTER TABLE "InspectionApprovalBatch" ADD CONSTRAINT "InspectionApprovalBatch_childReportId_fkey" FOREIGN KEY ("childReportId") REFERENCES "ChildReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
