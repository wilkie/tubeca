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
      } else if (
        entry.name.endsWith('.ts') ||
        // Fragmented-MP4 segments and the initialisation segment they share.
        entry.name.endsWith('.m4s') ||
        entry.name.endsWith('.mp4') ||
        entry.name.endsWith('.m3u8') ||
        // Extracted subtitles live beside the segments they belong to; they are
        // small, but the cap should still know about them.
        entry.name.endsWith('.vtt')
      ) {
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
  // Playlists are synthesised per request and never cached, so everything else
  // listed is something that took work to produce.
  const segments = listSegments(cacheRoot).filter((s) => !s.path.endsWith('.m3u8'));
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
 * Delete every cached segment. Returns the number deleted.
 *
 * Used when a setting changes the shape of a segment, such as its duration:
 * playlists are synthesised from that number, so every file on disk covers
 * the wrong span of the timeline and would play back as a stutter or a skip.
 */
export function purgeAllSegments(cacheRoot: string): number {
  let deleted = 0;
  for (const segment of listSegments(cacheRoot)) {
    try {
      fs.unlinkSync(segment.path);
      deleted++;
    } catch {
      // Already gone
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
  const segments = listSegments(cacheRoot).filter(
    (s) => s.path.endsWith('.ts') || s.path.endsWith('.vtt')
  );
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

/**
 * Codecs the `original` rung copies rather than re-encodes. The rung became
 * fragmented MP4 in 2026-09-05, so the container no longer limits this to what
 * MPEG-TS can carry; what still does is that the master playlist does not yet
 * declare CODECS, and a player that cannot decode HEVC or AV1 has no way to
 * skip a rung offering them.
 */
export const DIRECT_PLAY_VIDEO_CODECS = new Set(['h264']);
export const DIRECT_PLAY_AUDIO_CODECS = new Set(['aac', 'mp3']);

export interface CodecInfo {
  streamType: string
  codec: string | null
  /** Present when the caller knows it; needed to pick a named audio track. */
  streamIndex?: number
}

/**
 * Whether a file can be served as the "original" rung (stream copy into
 * MPEG-TS). Decided from probed stream codecs; when no stream information is
 * available, only `.mp4` is trusted, since its usual H.264/AAC payload is
 * the common case and other containers routinely carry codecs HLS cannot carry.
 */
/**
 * Whether the video can be copied rather than re-encoded.
 *
 * This is the expensive half by a wide margin: on a 1080p episode, copying the
 * video and encoding only the audio costs about a thirtieth of the CPU of
 * re-encoding both. Nearly half of a real library is H.264 video with audio no
 * browser will take — E-AC-3, AC-3, DTS — and re-encoding the picture to fix
 * the sound is most of the work for none of the reason.
 */
export function isVideoCopyable(streams: CodecInfo[], filePath: string): boolean {
  const video = streams.filter((s) => s.streamType === 'Video');
  if (video.length === 0) {
    return path.extname(filePath).toLowerCase() === '.mp4';
  }
  return DIRECT_PLAY_VIDEO_CODECS.has((video[0].codec ?? '').toLowerCase());
}

/** Whether the audio can be copied too, or has to be re-encoded to AAC. */
export function isAudioCopyable(streams: CodecInfo[], audioTrack?: number): boolean {
  const audio = streams.filter((s) => s.streamType === 'Audio');
  if (audio.length === 0) return true;
  const chosen =
    audioTrack === undefined
      ? audio[0]
      : audio.find((s) => s.streamIndex === audioTrack) ?? audio[0];
  return DIRECT_PLAY_AUDIO_CODECS.has((chosen.codec ?? '').toLowerCase());
}

/** Both halves: the file can be served with no encoding at all. */
export function isDirectPlayable(streams: CodecInfo[], filePath: string): boolean {
  return isVideoCopyable(streams, filePath) && isAudioCopyable(streams);
}
