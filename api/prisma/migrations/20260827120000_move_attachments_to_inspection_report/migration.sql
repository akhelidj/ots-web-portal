-- Attachments move from ChildReport to InspectionReport.
-- Dev data only: existing attachment rows are tied to childReportId and cannot be
-- remapped, so they are discarded (no production back-compat required).

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_childReportId_fkey";

-- Discard existing rows so the new required FK column can be added.
DELETE FROM "Attachment";

-- AlterTable
ALTER TABLE "Attachment" DROP COLUMN "childReportId",
ADD COLUMN     "inspectionReportId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
