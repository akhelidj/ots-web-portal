-- CreateTable
CREATE TABLE "TemplateDefinitionRevision" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "tokenSetHash" TEXT NOT NULL,
    "tokensChanged" BOOLEAN NOT NULL,
    "revisedById" TEXT NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisionReason" TEXT,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TemplateDefinitionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateDefinitionRevision_tenantId_templateId_idx" ON "TemplateDefinitionRevision"("tenantId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateDefinitionRevision_templateId_revisionNumber_key" ON "TemplateDefinitionRevision"("templateId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "TemplateDefinitionRevision" ADD CONSTRAINT "TemplateDefinitionRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
