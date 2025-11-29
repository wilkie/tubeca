-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT,
    "collectionId" TEXT,
    "showCreditId" TEXT,
    "creditId" TEXT,
    "imageType" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "fileSize" INTEGER,
    "sourceUrl" TEXT,
    "scraperId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Image_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_showCreditId_fkey" FOREIGN KEY ("showCreditId") REFERENCES "ShowCredit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Image_mediaId_imageType_idx" ON "Image"("mediaId", "imageType");

-- CreateIndex
CREATE INDEX "Image_collectionId_imageType_idx" ON "Image"("collectionId", "imageType");

-- CreateIndex
CREATE INDEX "Image_showCreditId_idx" ON "Image"("showCreditId");

-- CreateIndex
CREATE INDEX "Image_creditId_idx" ON "Image"("creditId");
