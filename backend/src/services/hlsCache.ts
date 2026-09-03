import * as fs from 'fs';
import * as path from 'path';
import { getHlsCachePath } from '../config/appConfig';

/**
 * Filesystem-only helpers for the HLS segment cache. Kept separate from
 * `HlsService` so callers that only need to evict or measure the cache (media
 * deletion, the cleanup timer, tests) do not pay for encoder detection.
 *
 * Layout: `<cacheRoot>/<mediaId>/a<audioTrack>/<quality>/<index>.ts`
 */

export interface CacheStats {
  totalSize: number
  mediaCount: number
  segmentCount: number
}

export function mediaCacheDir(cacheRoot: string, mediaId: string): string {
  return path.join(cacheRoot, mediaId);
}

/** Remove every cached segment for a media item. Returns true if anything was removed. */
export function evictMediaCache(mediaId: string, cacheRoot: string = getHlsCachePath()): boolean {
  const dir = mediaCacheDir(cacheRoot, mediaId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

interface SegmentFile {
  path: string
  size: number
  atimeMs: number
}

function listSegments(cacheRoot: string): SegmentFile[] {
  const segments: SegmentFile[] = [];
  if (!fs.existsSync(cacheRoot)) return segments;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.m3u8')) {
        try {
          const stat = fs.statSync(full);
          segments.push({ path: full, size: stat.size, atimeMs: stat.atimeMs });
        } catch {
          // Removed underneath us
        }
      }
    }
  };
  walk(cacheRoot);
  return segments;
}

/** Remove directories left empty under the cache root (but not the root itself). */
export function pruneEmptyDirs(cacheRoot: string): void {
  if (!fs.existsSync(cacheRoot)) return;
  const prune = (dir: string): boolean => {
    let hasContent = false;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (prune(full)) {
          hasContent = true;
        } else {
          try {
            fs.rmdirSync(full);
          } catch {
            hasContent = true;
          }
        }
      } else {
        hasContent = true;
      }
    }
    return hasContent;
  };
  prune(cacheRoot);
}

export function collectCacheStats(cacheRoot: string): CacheStats {
  const segments = listSegments(cacheRoot).filter((s) => s.path.endsWith('.ts'));
  let mediaCount = 0;
  if (fs.existsSync(cacheRoot)) {
    mediaCount = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  }
  return {
    totalSize: segments.reduce((sum, s) => sum + s.size, 0),
    mediaCount,
    segmentCount: segments.length,
  };
}

/** Delete segments not accessed within `ttlHours`. Returns the number deleted. */
export function sweepExpiredSegments(cacheRoot: string, ttlHours: number): number {
  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  let deleted = 0;
  for (const segment of listSegments(cacheRoot)) {
    if (segment.atimeMs < cutoff) {
      try {
        fs.unlinkSync(segment.path);
        deleted++;
      } catch {
        // Already gone
      }
    }
  }
  pruneEmptyDirs(cacheRoot);
  return deleted;
}

/**
 * Bring the cache under `maxBytes` by deleting the least recently accessed
 * segments first. Returns what was removed.
 */
export function enforceCacheSize(cacheRoot: string, maxBytes: number): { deleted: number; freedBytes: number } {
  const segments = listSegments(cacheRoot).filter((s) => s.path.endsWith('.ts'));
  let total = segments.reduce((sum, s) => sum + s.size, 0);
  const result = { deleted: 0, freedBytes: 0 };
  if (total <= maxBytes) return result;

  segments.sort((a, b) => a.atimeMs - b.atimeMs);
  for (const segment of segments) {
    if (total <= maxBytes) break;
    try {
      fs.unlinkSync(segment.path);
      total -= segment.size;
      result.deleted++;
      result.freedBytes += segment.size;
    } catch {
      // Already gone
    }
  }
  pruneEmptyDirs(cacheRoot);
  return result;
}

/** Codecs that browsers play from an MPEG-TS HLS segment without transcoding. */
export const DIRECT_PLAY_VIDEO_CODECS = new Set(['h264']);
export const DIRECT_PLAY_AUDIO_CODECS = new Set(['aac', 'mp3']);

export interface CodecInfo {
  streamType: string
  codec: string | null
}

/**
 * Whether a file can be served as the "original" rung (stream copy into
 * MPEG-TS). Decided from probed stream codecs; when no stream information is
 * available, only `.mp4` is trusted, since its usual H.264/AAC payload is
 * the common case and other containers routinely carry codecs HLS cannot carry.
 */
export function isDirectPlayable(streams: CodecInfo[], filePath: string): boolean {
  const video = streams.filter((s) => s.streamType === 'Video');
  const audio = streams.filter((s) => s.streamType === 'Audio');
  if (video.length === 0) {
    return path.extname(filePath).toLowerCase() === '.mp4';
  }
  const videoOk = DIRECT_PLAY_VIDEO_CODECS.has((video[0].codec ?? '').toLowerCase());
  const audioOk = audio.length === 0 || DIRECT_PLAY_AUDIO_CODECS.has((audio[0].codec ?? '').toLowerCase());
  return videoOk && audioOk;
}
