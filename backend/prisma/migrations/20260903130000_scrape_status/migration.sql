-- AlterTable
ALTER TABLE "Collection" ADD COLUMN "scrapeMessage" TEXT;
ALTER TABLE "Collection" ADD COLUMN "scrapeStatus" TEXT;
ALTER TABLE "Collection" ADD COLUMN "scrapedAt" DATETIME;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "scrapeMessage" TEXT;
ALTER TABLE "Media" ADD COLUMN "scrapeStatus" TEXT;
ALTER TABLE "Media" ADD COLUMN "scrapedAt" DATETIME;
