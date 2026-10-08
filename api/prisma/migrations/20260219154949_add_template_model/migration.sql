-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'DEPRECATED');

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL,
    "fileBlob" BYTEA NOT NULL,
    "hash" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_tenantId_templateKey_idx" ON "Template"("tenantId", "templateKey");

-- CreateIndex
CREATE UNIQUE INDEX "Template_tenantId_templateKey_templateVersion_key" ON "Template"("tenantId", "templateKey", "templateVersion");
