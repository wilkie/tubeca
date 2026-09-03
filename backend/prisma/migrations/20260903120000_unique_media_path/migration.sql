-- Media.path becomes unique. Earlier versions could insert the same file twice
-- when a scan raced the file watcher; keep the oldest row per path and remove
-- the children of the duplicates explicitly (SQLite may run migrations with
-- foreign-key enforcement off, so cascades cannot be relied on here).
DELETE FROM "Media" WHERE "rowid" NOT IN (SELECT MIN("rowid") FROM "Media" GROUP BY "path");

DELETE FROM "MediaStream" WHERE "mediaId" NOT IN (SELECT "id" FROM "Media");
DELETE FROM "VideoDetails" WHERE "mediaId" NOT IN (SELECT "id" FROM "Media");
DELETE FROM "AudioDetails" WHERE "mediaId" NOT IN (SELECT "id" FROM "Media");
DELETE FROM "Image" WHERE "mediaId" IS NOT NULL AND "mediaId" NOT IN (SELECT "id" FROM "Media");
DELETE FROM "UserCollectionItem" WHERE "mediaId" IS NOT NULL AND "mediaId" NOT IN (SELECT "id" FROM "Media");
DELETE FROM "WatchProgress" WHERE "mediaId" NOT IN (SELECT "id" FROM "Media");

-- CreateIndex
CREATE UNIQUE INDEX "Media_path_key" ON "Media"("path");
