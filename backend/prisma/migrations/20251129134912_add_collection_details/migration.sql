-- CreateTable
CREATE TABLE "ShowDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "scraperId" TEXT,
    "externalId" TEXT,
    "description" TEXT,
    "releaseDate" DATETIME,
    "endDate" DATETIME,
    "status" TEXT,
    "rating" REAL,
    "genres" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShowDetails_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShowCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "showDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "creditType" TEXT NOT NULL,
    "order" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShowCredit_showDetailsId_fkey" FOREIGN KEY ("showDetailsId") REFERENCES "ShowDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeasonDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "scraperId" TEXT,
    "externalId" TEXT,
    "seasonNumber" INTEGER,
    "description" TEXT,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonDetails_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtistDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "scraperId" TEXT,
    "externalId" TEXT,
    "biography" TEXT,
    "formedYear" INTEGER,
    "endedYear" INTEGER,
    "genres" TEXT,
    "country" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArtistDetails_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtistMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artistDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArtistMember_artistDetailsId_fkey" FOREIGN KEY ("artistDetailsId") REFERENCES "ArtistDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlbumDetails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "scraperId" TEXT,
    "externalId" TEXT,
    "releaseDate" DATETIME,
    "releaseType" TEXT,
    "genres" TEXT,
    "description" TEXT,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlbumDetails_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlbumCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "albumDetailsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlbumCredit_albumDetailsId_fkey" FOREIGN KEY ("albumDetailsId") REFERENCES "AlbumDetails" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShowDetails_collectionId_key" ON "ShowDetails"("collectionId");

-- CreateIndex
CREATE INDEX "ShowDetails_scraperId_externalId_idx" ON "ShowDetails"("scraperId", "externalId");

-- CreateIndex
CREATE INDEX "ShowCredit_showDetailsId_idx" ON "ShowCredit"("showDetailsId");

-- CreateIndex
CREATE INDEX "ShowCredit_creditType_idx" ON "ShowCredit"("creditType");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonDetails_collectionId_key" ON "SeasonDetails"("collectionId");

-- CreateIndex
CREATE INDEX "SeasonDetails_scraperId_externalId_idx" ON "SeasonDetails"("scraperId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistDetails_collectionId_key" ON "ArtistDetails"("collectionId");

-- CreateIndex
CREATE INDEX "ArtistDetails_scraperId_externalId_idx" ON "ArtistDetails"("scraperId", "externalId");

-- CreateIndex
CREATE INDEX "ArtistMember_artistDetailsId_idx" ON "ArtistMember"("artistDetailsId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumDetails_collectionId_key" ON "AlbumDetails"("collectionId");

-- CreateIndex
CREATE INDEX "AlbumDetails_scraperId_externalId_idx" ON "AlbumDetails"("scraperId", "externalId");

-- CreateIndex
CREATE INDEX "AlbumCredit_albumDetailsId_idx" ON "AlbumCredit"("albumDetailsId");
