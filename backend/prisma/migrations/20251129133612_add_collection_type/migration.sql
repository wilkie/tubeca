-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "collectionType" TEXT NOT NULL DEFAULT 'Generic',
    "libraryId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Collection" ("createdAt", "id", "libraryId", "name", "parentId", "updatedAt") SELECT "createdAt", "id", "libraryId", "name", "parentId", "updatedAt" FROM "Collection";
DROP TABLE "Collection";
ALTER TABLE "new_Collection" RENAME TO "Collection";
CREATE INDEX "Collection_libraryId_idx" ON "Collection"("libraryId");
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");
CREATE INDEX "Collection_collectionType_idx" ON "Collection"("collectionType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
