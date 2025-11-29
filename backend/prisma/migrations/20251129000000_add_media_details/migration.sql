-- CreateTable
CREATE TABLE "VideoDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "showName" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "description" TEXT,
    "releaseDate" DATETIME,
    "rating" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoDetails_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "creditType" TEXT NOT NULL,
    "order" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Credit_videoDetailsId_fkey" FOREIGN KEY ("videoDetailsId") REFERENCES "VideoDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AudioDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "artist" TEXT,
    "albumArtist" TEXT,
    "album" TEXT,
    "track" INTEGER,
    "disc" INTEGER,
    "year" INTEGER,
    "genre" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AudioDetails_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "thumbnails" TEXT,
    "collectionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Media_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("collectionId", "createdAt", "duration", "id", "name", "path", "thumbnails", "type", "updatedAt") SELECT "collectionId", "createdAt", "duration", "id", "name", "path", "thumbnails", "type", "updatedAt" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_type_idx" ON "Media"("type");
CREATE INDEX "Media_collectionId_idx" ON "Media"("collectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "VideoDetails_mediaId_key" ON "VideoDetails"("mediaId");

-- CreateIndex
CREATE INDEX "Credit_videoDetailsId_idx" ON "Credit"("videoDetailsId");

-- CreateIndex
CREATE INDEX "Credit_creditType_idx" ON "Credit"("creditType");

-- CreateIndex
CREATE UNIQUE INDEX "AudioDetails_mediaId_key" ON "AudioDetails"("mediaId");

