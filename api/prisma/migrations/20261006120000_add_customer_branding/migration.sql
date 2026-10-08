-- Optional per-customer branding: a brand colour that re-themes the customer portal
-- and a logo stored through AttachmentStorage (key persisted here, bytes in storage).
ALTER TABLE "Customer" ADD COLUMN "brandColor" TEXT;
ALTER TABLE "Customer" ADD COLUMN "logoKey" TEXT;
ALTER TABLE "Customer" ADD COLUMN "logoMimeType" TEXT;
