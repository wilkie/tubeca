import * as path from 'path';
import { matchSidecars, parseSidecarName, SUBTITLE_EXTENSIONS } from '../subtitleSidecars';

describe('parseSidecarName', () => {
  it('accepts a bare sidecar with the same name as the video', () => {
    expect(parseSidecarName('Heat (1995)', 'Heat (1995).srt')).toMatchObject({
      codec: 'subrip',
      language: null,
      title: null,
      isForced: false,
    });
  });

  it('reads a two-letter, three-letter or spelled-out language the same way', () => {
    for (const name of ['Heat.en.srt', 'Heat.eng.srt', 'Heat.English.srt']) {
      expect(parseSidecarName('Heat', name)?.language).toBe('eng');
    }
    expect(parseSidecarName('Heat', 'Heat.fr.srt')?.language).toBe('fra');
    expect(parseSidecarName('Heat', 'Heat.ja.srt')?.language).toBe('jpn');
  });

  it('reads the forced and default markers', () => {
    expect(parseSidecarName('Heat', 'Heat.eng.forced.srt')).toMatchObject({
      language: 'eng',
      isForced: true,
      isDefault: false,
    });
    expect(parseSidecarName('Heat', 'Heat.eng.default.srt')?.isDefault).toBe(true);
  });

  it('labels a hearing-impaired track', () => {
    expect(parseSidecarName('Heat', 'Heat.en.sdh.srt')).toMatchObject({ language: 'eng', title: 'SDH' });
    expect(parseSidecarName('Heat', 'Heat.en.cc.srt')?.title).toBe('SDH');
  });

  it('keeps anything it does not recognise as the track title', () => {
    expect(parseSidecarName('Heat', 'Heat.eng.Commentary.srt')?.title).toBe('Commentary');
  });

  it('maps each extension to the codec ffmpeg names', () => {
    expect(parseSidecarName('Heat', 'Heat.srt')?.codec).toBe('subrip');
    expect(parseSidecarName('Heat', 'Heat.vtt')?.codec).toBe('webvtt');
    expect(parseSidecarName('Heat', 'Heat.ass')?.codec).toBe('ass');
    expect(parseSidecarName('Heat', 'Heat.ssa')?.codec).toBe('ass');
  });

  it('rejects a file belonging to a different video', () => {
    expect(parseSidecarName('Heat', 'Collateral.eng.srt')).toBeNull();
    // A longer name that merely starts with ours is not a sidecar of ours.
    expect(parseSidecarName('Heat', 'Heatwave.srt')).toBeNull();
  });

  it('rejects anything that is not a subtitle', () => {
    expect(parseSidecarName('Heat', 'Heat.nfo')).toBeNull();
    expect(parseSidecarName('Heat', 'Heat.mkv')).toBeNull();
    expect(SUBTITLE_EXTENSIONS).not.toContain('.sub');
  });
});

describe('matchSidecars', () => {
  const video = path.join('/media', 'Films', 'Heat (1995)', 'Heat (1995).mkv');

  it('finds every sidecar for the video and nothing else', () => {
    const found = matchSidecars(video, [
      'Heat (1995).mkv',
      'Heat (1995).srt',
      'Heat (1995).es.srt',
      'Heat (1995).eng.forced.srt',
      'Collateral.srt',
      'poster.jpg',
    ]);

    expect(found.map((s) => path.basename(s.path))).toEqual([
      'Heat (1995).eng.forced.srt',
      'Heat (1995).es.srt',
      'Heat (1995).srt',
    ]);
    expect(found.every((s) => s.path.startsWith(path.join('/media', 'Films', 'Heat (1995)')))).toBe(true);
  });

  it('finds nothing in an empty directory', () => {
    expect(matchSidecars(video, [])).toEqual([]);
  });
});
