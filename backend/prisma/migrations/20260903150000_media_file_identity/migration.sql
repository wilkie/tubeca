-- AlterTable
ALTER TABLE "Media" ADD COLUMN "fileMtimeMs" REAL;
ALTER TABLE "Media" ADD COLUMN "fileSize" REAL;

-- CreateIndex
CREATE INDEX "Media_fileSize_fileMtimeMs_idx" ON "Media"("fileSize", "fileMtimeMs");
