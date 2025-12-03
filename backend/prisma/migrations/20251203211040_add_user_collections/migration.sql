-- CreateTable
CREATE TABLE "UserCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserCollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userCollectionId" TEXT NOT NULL,
    "collectionId" TEXT,
    "mediaId" TEXT,
    CONSTRAINT "UserCollectionItem_userCollectionId_fkey" FOREIGN KEY ("userCollectionId") REFERENCES "UserCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCollectionItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserCollection_userId_idx" ON "UserCollection"("userId");

-- CreateIndex
CREATE INDEX "UserCollection_isPublic_idx" ON "UserCollection"("isPublic");

-- CreateIndex
CREATE INDEX "UserCollectionItem_userCollectionId_idx" ON "UserCollectionItem"("userCollectionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCollectionItem_userCollectionId_collectionId_key" ON "UserCollectionItem"("userCollectionId", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCollectionItem_userCollectionId_mediaId_key" ON "UserCollectionItem"("userCollectionId", "mediaId");
