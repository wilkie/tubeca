-- sha256 of an image's stored bytes.
--
-- Existing rows are left null: the hash is filled in the next time each image
-- is downloaded, and a null simply means "not known yet, so write the file".
ALTER TABLE "Image" ADD COLUMN "contentHash" TEXT;
