-- Denormalised sort keys on Collection. The values live in whichever *Details
-- row a collection has; Prisma cannot order across a union of optional
-- relations, so sorting a paginated list needs them on the row itself.
-- Kept in step by syncCollectionSortFields() after every metadata write.

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN "sortReleaseDate" DATETIME;
ALTER TABLE "Collection" ADD COLUMN "sortRating" REAL;
ALTER TABLE "Collection" ADD COLUMN "sortRuntime" INTEGER;

-- Backfill from existing metadata (film > show > season > album, matching
-- the precedence in syncCollectionSortFields).
UPDATE "Collection" SET
  "sortReleaseDate" = COALESCE(
    (SELECT "releaseDate" FROM "FilmDetails"   WHERE "collectionId" = "Collection"."id"),
    (SELECT "releaseDate" FROM "ShowDetails"   WHERE "collectionId" = "Collection"."id"),
    (SELECT "releaseDate" FROM "SeasonDetails" WHERE "collectionId" = "Collection"."id"),
    (SELECT "releaseDate" FROM "AlbumDetails"  WHERE "collectionId" = "Collection"."id")
  ),
  "sortRating" = COALESCE(
    (SELECT "rating" FROM "FilmDetails" WHERE "collectionId" = "Collection"."id"),
    (SELECT "rating" FROM "ShowDetails" WHERE "collectionId" = "Collection"."id")
  ),
  "sortRuntime" = (SELECT "runtime" FROM "FilmDetails" WHERE "collectionId" = "Collection"."id");

-- CreateIndex
CREATE INDEX "Collection_libraryId_parentId_sortReleaseDate_idx" ON "Collection"("libraryId", "parentId", "sortReleaseDate");

-- CreateIndex
CREATE INDEX "Collection_libraryId_parentId_sortRating_idx" ON "Collection"("libraryId", "parentId", "sortRating");

-- CreateIndex
CREATE INDEX "Collection_libraryId_parentId_sortRuntime_idx" ON "Collection"("libraryId", "parentId", "sortRuntime");
