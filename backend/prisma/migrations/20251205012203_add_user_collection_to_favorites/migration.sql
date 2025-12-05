-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userCollectionId" TEXT NOT NULL,
    "collectionId" TEXT,
    "mediaId" TEXT,
    "itemUserCollectionId" TEXT,
    CONSTRAINT "UserCollectionItem_userCollectionId_fkey" FOREIGN KEY ("userCollectionId") REFERENCES "UserCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCollectionItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCollectionItem_itemUserCollectionId_fkey" FOREIGN KEY ("itemUserCollectionId") REFERENCES "UserCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserCollectionItem" ("addedAt", "collectionId", "id", "mediaId", "position", "userCollectionId") SELECT "addedAt", "collectionId", "id", "mediaId", "position", "userCollectionId" FROM "UserCollectionItem";
DROP TABLE "UserCollectionItem";
ALTER TABLE "new_UserCollectionItem" RENAME TO "UserCollectionItem";
CREATE INDEX "UserCollectionItem_userCollectionId_idx" ON "UserCollectionItem"("userCollectionId");
CREATE UNIQUE INDEX "UserCollectionItem_userCollectionId_collectionId_key" ON "UserCollectionItem"("userCollectionId", "collectionId");
CREATE UNIQUE INDEX "UserCollectionItem_userCollectionId_mediaId_key" ON "UserCollectionItem"("userCollectionId", "mediaId");
CREATE UNIQUE INDEX "UserCollectionItem_userCollectionId_itemUserCollectionId_key" ON "UserCollectionItem"("userCollectionId", "itemUserCollectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
