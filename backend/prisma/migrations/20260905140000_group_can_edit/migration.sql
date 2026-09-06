-- Whether Editors in a group may change the libraries it grants.
--
-- Defaults to true so every existing group keeps doing exactly what it did:
-- an Editor could edit anything they could see, and still can until an admin
-- turns this off for a particular group.
ALTER TABLE "Group" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT true;
