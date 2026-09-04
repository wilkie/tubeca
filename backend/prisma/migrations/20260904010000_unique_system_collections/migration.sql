-- One system collection per user and type.
--
-- Before this, two requests arriving together could each find no Favorites row
-- and each create one. Any duplicates that already exist are merged into the
-- oldest row before the index is created, so no items are lost.

-- Move items from the duplicates onto the keeper, unless the keeper already
-- has that exact item.
UPDATE "UserCollectionItem"
SET "userCollectionId" = (
  SELECT keeper.id
  FROM "UserCollection" keeper
  WHERE keeper."userId" = (
      SELECT dup."userId" FROM "UserCollection" dup
      WHERE dup.id = "UserCollectionItem"."userCollectionId"
    )
    AND keeper."systemType" = (
      SELECT dup."systemType" FROM "UserCollection" dup
      WHERE dup.id = "UserCollectionItem"."userCollectionId"
    )
    AND keeper."isSystem" = 1
  ORDER BY keeper."createdAt" ASC, keeper.id ASC
  LIMIT 1
)
WHERE "userCollectionId" IN (
  SELECT c.id FROM "UserCollection" c
  WHERE c."isSystem" = 1
    AND c."systemType" IS NOT NULL
    AND c.id <> (
      SELECT keeper.id FROM "UserCollection" keeper
      WHERE keeper."userId" = c."userId" AND keeper."systemType" = c."systemType" AND keeper."isSystem" = 1
      ORDER BY keeper."createdAt" ASC, keeper.id ASC
      LIMIT 1
    )
)
AND NOT EXISTS (
  SELECT 1 FROM "UserCollectionItem" existing
  WHERE existing."userCollectionId" = (
      SELECT keeper.id FROM "UserCollection" keeper
      WHERE keeper."userId" = (
          SELECT dup."userId" FROM "UserCollection" dup WHERE dup.id = "UserCollectionItem"."userCollectionId"
        )
        AND keeper."systemType" = (
          SELECT dup."systemType" FROM "UserCollection" dup WHERE dup.id = "UserCollectionItem"."userCollectionId"
        )
        AND keeper."isSystem" = 1
      ORDER BY keeper."createdAt" ASC, keeper.id ASC
      LIMIT 1
    )
    AND existing."collectionId" IS "UserCollectionItem"."collectionId"
    AND existing."mediaId" IS "UserCollectionItem"."mediaId"
    AND existing."itemUserCollectionId" IS "UserCollectionItem"."itemUserCollectionId"
);

-- Whatever is left in a duplicate is a copy of something the keeper has.
DELETE FROM "UserCollection"
WHERE "isSystem" = 1
  AND "systemType" IS NOT NULL
  AND id <> (
    SELECT keeper.id FROM "UserCollection" keeper
    WHERE keeper."userId" = "UserCollection"."userId"
      AND keeper."systemType" = "UserCollection"."systemType"
      AND keeper."isSystem" = 1
    ORDER BY keeper."createdAt" ASC, keeper.id ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "UserCollection_userId_systemType_key" ON "UserCollection"("userId", "systemType");
