-- CreateTable
CREATE TABLE "MediaStream" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "streamIndex" INTEGER NOT NULL,
    "streamType" TEXT NOT NULL,
    "codec" TEXT,
    "codecLong" TEXT,
    "language" TEXT,
    "title" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isForced" BOOLEAN NOT NULL DEFAULT false,
    "channels" INTEGER,
    "channelLayout" TEXT,
    "sampleRate" INTEGER,
    "bitRate" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "frameRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaStream_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MediaStream_mediaId_idx" ON "MediaStream"("mediaId");

-- CreateIndex
CREATE INDEX "MediaStream_streamType_idx" ON "MediaStream"("streamType");

-- CreateIndex
CREATE UNIQUE INDEX "MediaStream_mediaId_streamIndex_key" ON "MediaStream"("mediaId", "streamIndex");
