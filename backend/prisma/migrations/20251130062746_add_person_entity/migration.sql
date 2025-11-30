-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "biography" TEXT,
    "birthDate" DATETIME,
    "deathDate" DATETIME,
    "birthPlace" TEXT,
    "knownFor" TEXT,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "imdbId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AlbumCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "albumDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "personId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlbumCredit_albumDetailsId_fkey" FOREIGN KEY ("albumDetailsId") REFERENCES "AlbumDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlbumCredit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AlbumCredit" ("albumDetailsId", "createdAt", "id", "name", "role", "updatedAt") SELECT "albumDetailsId", "createdAt", "id", "name", "role", "updatedAt" FROM "AlbumCredit";
DROP TABLE "AlbumCredit";
ALTER TABLE "new_AlbumCredit" RENAME TO "AlbumCredit";
CREATE INDEX "AlbumCredit_albumDetailsId_idx" ON "AlbumCredit"("albumDetailsId");
CREATE INDEX "AlbumCredit_personId_idx" ON "AlbumCredit"("personId");
CREATE TABLE "new_Credit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "creditType" TEXT NOT NULL,
    "order" INTEGER,
    "personId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Credit_videoDetailsId_fkey" FOREIGN KEY ("videoDetailsId") REFERENCES "VideoDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Credit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Credit" ("createdAt", "creditType", "id", "name", "order", "role", "updatedAt", "videoDetailsId") SELECT "createdAt", "creditType", "id", "name", "order", "role", "updatedAt", "videoDetailsId" FROM "Credit";
DROP TABLE "Credit";
ALTER TABLE "new_Credit" RENAME TO "Credit";
CREATE INDEX "Credit_videoDetailsId_idx" ON "Credit"("videoDetailsId");
CREATE INDEX "Credit_creditType_idx" ON "Credit"("creditType");
CREATE INDEX "Credit_personId_idx" ON "Credit"("personId");
CREATE TABLE "new_Image" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT,
    "collectionId" TEXT,
    "showCreditId" TEXT,
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
    CONSTRAINT "Image_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Image_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Image" ("collectionId", "createdAt", "creditId", "fileSize", "format", "height", "id", "imageType", "isPrimary", "mediaId", "path", "scraperId", "showCreditId", "sourceUrl", "updatedAt", "width") SELECT "collectionId", "createdAt", "creditId", "fileSize", "format", "height", "id", "imageType", "isPrimary", "mediaId", "path", "scraperId", "showCreditId", "sourceUrl", "updatedAt", "width" FROM "Image";
DROP TABLE "Image";
ALTER TABLE "new_Image" RENAME TO "Image";
CREATE INDEX "Image_mediaId_imageType_idx" ON "Image"("mediaId", "imageType");
CREATE INDEX "Image_collectionId_imageType_idx" ON "Image"("collectionId", "imageType");
CREATE INDEX "Image_showCreditId_idx" ON "Image"("showCreditId");
CREATE INDEX "Image_creditId_idx" ON "Image"("creditId");
CREATE INDEX "Image_personId_idx" ON "Image"("personId");
CREATE TABLE "new_ShowCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "showDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "creditType" TEXT NOT NULL,
    "order" INTEGER,
    "personId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShowCredit_showDetailsId_fkey" FOREIGN KEY ("showDetailsId") REFERENCES "ShowDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShowCredit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ShowCredit" ("createdAt", "creditType", "id", "name", "order", "role", "showDetailsId", "updatedAt") SELECT "createdAt", "creditType", "id", "name", "order", "role", "showDetailsId", "updatedAt" FROM "ShowCredit";
DROP TABLE "ShowCredit";
ALTER TABLE "new_ShowCredit" RENAME TO "ShowCredit";
CREATE INDEX "ShowCredit_showDetailsId_idx" ON "ShowCredit"("showDetailsId");
CREATE INDEX "ShowCredit_creditType_idx" ON "ShowCredit"("creditType");
CREATE INDEX "ShowCredit_personId_idx" ON "ShowCredit"("personId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Person_tmdbId_key" ON "Person"("tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_tvdbId_key" ON "Person"("tvdbId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_imdbId_key" ON "Person"("imdbId");

-- CreateIndex
CREATE INDEX "Person_name_idx" ON "Person"("name");
