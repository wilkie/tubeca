import { getCollectionType, getMediaExtensions, isMediaFile } from '../libraryLayout';

describe('getCollectionType', () => {
  it.each([
    ['Television', 0, 'Show'],
    ['Television', 1, 'Season'],
    ['Television', 2, 'Generic'],
    ['Film', 0, 'Film'],
    ['Film', 1, 'Generic'],
    ['Music', 0, 'Artist'],
    ['Music', 1, 'Album'],
    ['Music', 3, 'Generic'],
  ] as const)('%s library at depth %d -> %s', (libraryType, depth, expected) => {
    expect(getCollectionType(libraryType, depth)).toBe(expected);
  });
});

describe('isMediaFile', () => {
  it('matches video extensions case-insensitively for video libraries', () => {
    expect(isMediaFile('Movie.MKV', 'Film')).toBe(true);
    expect(isMediaFile('episode.mp4', 'Television')).toBe(true);
    expect(isMediaFile('cover.jpg', 'Film')).toBe(false);
    expect(isMediaFile('track.flac', 'Film')).toBe(false);
  });

  it('matches audio extensions only for music libraries', () => {
    expect(isMediaFile('track.flac', 'Music')).toBe(true);
    expect(isMediaFile('video.mkv', 'Music')).toBe(false);
  });

  it('ignores sidecar files', () => {
    expect(isMediaFile('movie.srt', 'Film')).toBe(false);
    expect(isMediaFile('movie.nfo', 'Film')).toBe(false);
  });
});

describe('getMediaExtensions', () => {
  it('returns audio for Music and video otherwise', () => {
    expect(getMediaExtensions('Music')).toContain('.mp3');
    expect(getMediaExtensions('Television')).toContain('.mkv');
    expect(getMediaExtensions('Film')).not.toContain('.mp3');
  });
});
