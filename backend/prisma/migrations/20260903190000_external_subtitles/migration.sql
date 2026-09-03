-- Subtitles that live in a sidecar file next to the video.
-- Existing rows are all embedded streams, so the column stays NULL for them.
ALTER TABLE "MediaStream" ADD COLUMN "externalPath" TEXT;
