import { promises as fsp } from 'fs';
import * as path from 'path';

/** Subtitle formats that can be converted to WebVTT for the browser. */
export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

const CODEC_BY_EXTENSION: Record<string, string> = {
  '.srt': 'subrip',
  '.vtt': 'webvtt',
  '.ass': 'ass',
  '.ssa': 'ass',
};

/** Tags that describe the track rather than name it. */
const FORCED_TAGS = new Set(['forced']);
const HEARING_IMPAIRED_TAGS = new Set(['sdh', 'cc', 'hi']);
const DEFAULT_TAGS = new Set(['default']);

/**
 * Three-letter codes for the languages most likely to appear, mapped from the
 * two-letter code and the English name so `.en.srt`, `.eng.srt` and
 * `.english.srt` all mean the same track.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  en: 'eng', eng: 'eng', english: 'eng',
  es: 'spa', spa: 'spa', spanish: 'spa',
  fr: 'fra', fre: 'fra', fra: 'fra', french: 'fra',
  de: 'deu', ger: 'deu', deu: 'deu', german: 'deu',
  it: 'ita', ita: 'ita', italian: 'ita',
  pt: 'por', por: 'por', portuguese: 'por',
  nl: 'nld', dut: 'nld', nld: 'nld', dutch: 'nld',
  sv: 'swe', swe: 'swe', swedish: 'swe',
  no: 'nor', nor: 'nor', norwegian: 'nor',
  da: 'dan', dan: 'dan', danish: 'dan',
  fi: 'fin', fin: 'fin', finnish: 'fin',
  pl: 'pol', pol: 'pol', polish: 'pol',
  ru: 'rus', rus: 'rus', russian: 'rus',
  ja: 'jpn', jpn: 'jpn', japanese: 'jpn',
  ko: 'kor', kor: 'kor', korean: 'kor',
  zh: 'zho', chi: 'zho', zho: 'zho', chinese: 'zho',
  ar: 'ara', ara: 'ara', arabic: 'ara',
  he: 'heb', heb: 'heb', hebrew: 'heb',
  hi: 'hin', hin: 'hin', hindi: 'hin',
  tr: 'tur', tur: 'tur', turkish: 'tur',
  cs: 'ces', cze: 'ces', ces: 'ces', czech: 'ces',
  el: 'ell', gre: 'ell', ell: 'ell', greek: 'ell',
  hu: 'hun', hun: 'hun', hungarian: 'hun',
  ro: 'ron', rum: 'ron', ron: 'ron', romanian: 'ron',
  uk: 'ukr', ukr: 'ukr', ukrainian: 'ukr',
};

export interface SidecarSubtitle {
  /** Absolute path of the subtitle file. */
  path: string
  codec: string
  language: string | null
  title: string | null
  isForced: boolean
  isDefault: boolean
}

/**
 * Read the tags a sidecar's filename carries, or null when the name does not
 * belong to this video.
 *
 * The convention players share is `<video name>.<tags>.<ext>`, where the tags
 * are a language code and optional markers: `Heat.eng.forced.srt`,
 * `Heat.en.sdh.srt`, `Heat.srt`. Anything left over after the known tags
 * becomes the track's title, so `Heat.eng.Director Commentary.srt` is labelled
 * rather than discarded.
 */
export function parseSidecarName(videoBaseName: string, fileName: string): Omit<SidecarSubtitle, 'path'> | null {
  const ext = path.extname(fileName).toLowerCase();
  if (!SUBTITLE_EXTENSIONS.includes(ext)) return null;

  const withoutExt = fileName.slice(0, -ext.length);
  if (withoutExt !== videoBaseName && !withoutExt.startsWith(`${videoBaseName}.`)) return null;

  const tags = withoutExt
    .slice(videoBaseName.length)
    .split('.')
    .map((tag) => tag.trim())
    .filter(Boolean);

  let language: string | null = null;
  let isForced = false;
  let isDefault = false;
  const titleParts: string[] = [];

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (!language && LANGUAGE_ALIASES[lower]) {
      language = LANGUAGE_ALIASES[lower];
    } else if (FORCED_TAGS.has(lower)) {
      isForced = true;
    } else if (DEFAULT_TAGS.has(lower)) {
      isDefault = true;
    } else if (HEARING_IMPAIRED_TAGS.has(lower)) {
      titleParts.push('SDH');
    } else {
      titleParts.push(tag);
    }
  }

  return {
    codec: CODEC_BY_EXTENSION[ext],
    language,
    title: titleParts.length > 0 ? titleParts.join(' ') : null,
    isForced,
    isDefault,
  };
}

/**
 * Every subtitle file sitting next to a video that belongs to it.
 *
 * `entries` is the directory listing, passed in so a folder of episodes is
 * read once rather than once per episode.
 */
export function matchSidecars(videoPath: string, entries: string[]): SidecarSubtitle[] {
  const dir = path.dirname(videoPath);
  const videoBaseName = path.basename(videoPath, path.extname(videoPath));

  return entries
    .map((entry) => {
      const parsed = parseSidecarName(videoBaseName, entry);
      return parsed ? { ...parsed, path: path.join(dir, entry) } : null;
    })
    .filter((s): s is SidecarSubtitle => s !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Read a directory, returning an empty list if it cannot be read. */
export async function listDirectory(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}
