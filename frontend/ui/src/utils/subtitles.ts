/**
 * Which subtitle codecs the server can turn into WebVTT.
 *
 * `hdmv_pgs_subtitle`, `dvd_subtitle` and friends are pictures: converting one
 * to text needs OCR, not a remux. Offering such a track gives a viewer a
 * choice that produces nothing and explains nothing, so the menu leaves them
 * out. Kept in step with `backend/src/services/subtitleService.ts`, which
 * refuses the same codecs with a 415.
 */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'vtt',
  'mov_text',
  'text',
  'stl',
  'subviewer',
  'microdvd',
]);

export function isTextSubtitle(codec: string | null | undefined): boolean {
  // Unknown: offer it and let the server decide, rather than hiding a track
  // that might well work.
  if (!codec) return true;
  return TEXT_SUBTITLE_CODECS.has(codec.toLowerCase());
}
