-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RECEIVER', 'INSPECTOR', 'SUPERVISOR', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "IRStatus" AS ENUM ('DRAFT', 'RECEIVED', 'READY_FOR_CLEANING', 'READY_FOR_INSPECTION', 'IN_INSPECTION', 'PENDING_APPROVAL', 'APPROVED', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChildReportStatus" AS ENUM ('DRAFT', 'IN_INSPECTION', 'PENDING_APPROVAL', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SerialDisposition" AS ENUM ('PASS', 'REWORK', 'SCRAP', 'HOLD');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "mappingJson" JSONB NOT NULL,
    "fileRef" TEXT,
    "status" TEXT NOT NULL,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IR" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "irNumber" TEXT,
    "revisionNumber" INTEGER,
    "status" "IRStatus" NOT NULL DEFAULT 'DRAFT',
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "templateVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialNumber" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "inspectionData" JSONB,
    "disposition" "SerialDisposition",
    "irId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildReport" (
    "id" TEXT NOT NULL,
    "reportNumber" TEXT,
    "status" "ChildReportStatus" NOT NULL DEFAULT 'DRAFT',
    "irId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildReportSerialNumber" (
    "id" TEXT NOT NULL,
    "childReportId" TEXT NOT NULL,
    "serialNumberId" TEXT NOT NULL,

    CONSTRAINT "ChildReportSerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "childReportId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IRTransitionLog" (
    "id" TEXT NOT NULL,
    "fromStatus" "IRStatus" NOT NULL,
    "toStatus" "IRStatus" NOT NULL,
    "previousActiveStatus" "IRStatus",
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "irId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "IRTransitionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildReportTransitionLog" (
    "id" TEXT NOT NULL,
    "fromStatus" "ChildReportStatus" NOT NULL,
    "toStatus" "ChildReportStatus" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "childReportId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "ChildReportTransitionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "irId" TEXT,
    "userId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IRRevision" (
    "id" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "irId" TEXT NOT NULL,

    CONSTRAINT "IRRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildReportRevision" (
    "id" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "childReportId" TEXT NOT NULL,

    CONSTRAINT "ChildReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateKey_templateVersion_key" ON "TemplateVersion"("templateKey", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_irId_serial_key" ON "SerialNumber"("irId", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "ChildReportSerialNumber_childReportId_serialNumberId_key" ON "ChildReportSerialNumber"("childReportId", "serialNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "IRRevision_irId_revisionNumber_key" ON "IRRevision"("irId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChildReportRevision_childReportId_revisionNumber_key" ON "ChildReportRevision"("childReportId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IR" ADD CONSTRAINT "IR_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IR" ADD CONSTRAINT "IR_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IR" ADD CONSTRAINT "IR_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_irId_fkey" FOREIGN KEY ("irId") REFERENCES "IR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReport" ADD CONSTRAINT "ChildReport_irId_fkey" FOREIGN KEY ("irId") REFERENCES "IR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReportSerialNumber" ADD CONSTRAINT "ChildReportSerialNumber_childReportId_fkey" FOREIGN KEY ("childReportId") REFERENCES "ChildReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReportSerialNumber" ADD CONSTRAINT "ChildReportSerialNumber_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "SerialNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_childReportId_fkey" FOREIGN KEY ("childReportId") REFERENCES "ChildReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IRTransitionLog" ADD CONSTRAINT "IRTransitionLog_irId_fkey" FOREIGN KEY ("irId") REFERENCES "IR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReportTransitionLog" ADD CONSTRAINT "ChildReportTransitionLog_childReportId_fkey" FOREIGN KEY ("childReportId") REFERENCES "ChildReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_irId_fkey" FOREIGN KEY ("irId") REFERENCES "IR"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IRRevision" ADD CONSTRAINT "IRRevision_irId_fkey" FOREIGN KEY ("irId") REFERENCES "IR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildReportRevision" ADD CONSTRAINT "ChildReportRevision_childReportId_fkey" FOREIGN KEY ("childReportId") REFERENCES "ChildReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
