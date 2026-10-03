-- Inspector handwritten signatures.
--
-- "UserSignature": at most ONE per account (unique userId). Holds only a reference
-- (storageKey -> the storage abstraction, local or S3) plus metadata; the PNG bytes
-- never live in Postgres. Each (re)registration writes a NEW immutable object under a
-- fresh key and repoints this row, so objects already referenced by a report stay valid.
--
-- "ReportSignature": a pointer frozen onto a report at submission (the signature "en
-- vigueur" at that moment). It copies the key + hash, not the file, so re-exporting an
-- old report keeps the signature it was submitted with even if the signer later changes
-- theirs. "slot" names what it fills (e.g. the inspector role today, per-field later).
--
-- Purely additive: two new tables, no existing row is touched.
-- CreateTable
CREATE TABLE "UserSignature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSignature" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionReportId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSignature_userId_key" ON "UserSignature"("userId");

-- CreateIndex
CREATE INDEX "UserSignature_tenantId_idx" ON "UserSignature"("tenantId");

-- CreateIndex
CREATE INDEX "ReportSignature_tenantId_inspectionReportId_slot_idx" ON "ReportSignature"("tenantId", "inspectionReportId", "slot");

-- AddForeignKey
ALTER TABLE "UserSignature" ADD CONSTRAINT "UserSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSignature" ADD CONSTRAINT "ReportSignature_inspectionReportId_fkey" FOREIGN KEY ("inspectionReportId") REFERENCES "InspectionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

