-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TranscodingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enableHardwareAccel" BOOLEAN NOT NULL DEFAULT true,
    "preferredEncoder" TEXT,
    "preset" TEXT NOT NULL DEFAULT 'veryfast',
    "enableLowLatency" BOOLEAN NOT NULL DEFAULT true,
    "threadCount" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrentTranscodes" INTEGER NOT NULL DEFAULT 2,
    "segmentDuration" INTEGER NOT NULL DEFAULT 6,
    "prefetchSegments" INTEGER NOT NULL DEFAULT 2,
    "bitrate1080p" INTEGER NOT NULL DEFAULT 8000,
    "bitrate720p" INTEGER NOT NULL DEFAULT 5000,
    "bitrate480p" INTEGER NOT NULL DEFAULT 2500,
    "bitrate360p" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TranscodingSettings" ("bitrate1080p", "bitrate360p", "bitrate480p", "bitrate720p", "createdAt", "enableHardwareAccel", "enableLowLatency", "id", "preferredEncoder", "prefetchSegments", "preset", "segmentDuration", "threadCount", "updatedAt") SELECT "bitrate1080p", "bitrate360p", "bitrate480p", "bitrate720p", "createdAt", "enableHardwareAccel", "enableLowLatency", "id", "preferredEncoder", "prefetchSegments", "preset", "segmentDuration", "threadCount", "updatedAt" FROM "TranscodingSettings";
DROP TABLE "TranscodingSettings";
ALTER TABLE "new_TranscodingSettings" RENAME TO "TranscodingSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
