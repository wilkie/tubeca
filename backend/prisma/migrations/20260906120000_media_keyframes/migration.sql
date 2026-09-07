-- Where a video file's keyframes are, so its HLS segments can be cut there
-- rather than on an even grid the file cannot honour.
--
-- Empty for every existing file: reading it means reading the whole file, so
-- a row appears the first time somebody plays one, and until then that file
-- streams on the even grid exactly as it did before.
CREATE TABLE "MediaKeyframes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "times" TEXT NOT NULL,
    "fileSize" REAL,
    "fileMtimeMs" REAL,
    "probedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaKeyframes_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MediaKeyframes_mediaId_key" ON "MediaKeyframes"("mediaId");
