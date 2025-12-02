-- CreateTable
CREATE TABLE "FilmDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "scraperId" TEXT,
    "externalId" TEXT,
    "description" TEXT,
    "tagline" TEXT,
    "releaseDate" DATETIME,
    "runtime" INTEGER,
    "contentRating" TEXT,
    "rating" REAL,
    "genres" TEXT,
    "originalTitle" TEXT,
    "status" TEXT,
    "budget" INTEGER,
    "revenue" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FilmDetails_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FilmCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filmDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "creditType" TEXT NOT NULL,
    "order" INTEGER,
    "personId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FilmCredit_filmDetailsId_fkey" FOREIGN KEY ("filmDetailsId") REFERENCES "FilmDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FilmCredit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Image" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT,
    "collectionId" TEXT,
    "showCreditId" TEXT,
    "filmCreditId" TEXT,
    "creditId" TEXT,
    "personId" TEXT,
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
    CONSTRAINT "Image_filmCreditId_fkey" FOREIGN KEY ("filmCreditId") REFERENCES "FilmCredit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Image" ("collectionId", "createdAt", "creditId", "fileSize", "format", "height", "id", "imageType", "isPrimary", "mediaId", "path", "personId", "scraperId", "showCreditId", "sourceUrl", "updatedAt", "width") SELECT "collectionId", "createdAt", "creditId", "fileSize", "format", "height", "id", "imageType", "isPrimary", "mediaId", "path", "personId", "scraperId", "showCreditId", "sourceUrl", "updatedAt", "width" FROM "Image";
DROP TABLE "Image";
ALTER TABLE "new_Image" RENAME TO "Image";
CREATE INDEX "Image_mediaId_imageType_idx" ON "Image"("mediaId", "imageType");
CREATE INDEX "Image_collectionId_imageType_idx" ON "Image"("collectionId", "imageType");
CREATE INDEX "Image_showCreditId_idx" ON "Image"("showCreditId");
CREATE INDEX "Image_filmCreditId_idx" ON "Image"("filmCreditId");
CREATE INDEX "Image_creditId_idx" ON "Image"("creditId");
CREATE INDEX "Image_personId_idx" ON "Image"("personId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FilmDetails_collectionId_key" ON "FilmDetails"("collectionId");

-- CreateIndex
CREATE INDEX "FilmDetails_scraperId_externalId_idx" ON "FilmDetails"("scraperId", "externalId");

-- CreateIndex
CREATE INDEX "FilmCredit_filmDetailsId_idx" ON "FilmCredit"("filmDetailsId");

-- CreateIndex
CREATE INDEX "FilmCredit_creditType_idx" ON "FilmCredit"("creditType");

-- CreateIndex
CREATE INDEX "FilmCredit_personId_idx" ON "FilmCredit"("personId");
