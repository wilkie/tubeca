-- Sessions are invalidated by bumping this: tokens carry the version they were
-- issued with, and `authenticate` rejects a token whose version is behind.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
