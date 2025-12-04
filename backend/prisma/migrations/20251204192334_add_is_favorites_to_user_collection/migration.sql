-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isFavorites" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserCollection" ("createdAt", "description", "id", "isPublic", "name", "updatedAt", "userId") SELECT "createdAt", "description", "id", "isPublic", "name", "updatedAt", "userId" FROM "UserCollection";
DROP TABLE "UserCollection";
ALTER TABLE "new_UserCollection" RENAME TO "UserCollection";
CREATE INDEX "UserCollection_userId_idx" ON "UserCollection"("userId");
CREATE INDEX "UserCollection_isPublic_idx" ON "UserCollection"("isPublic");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
