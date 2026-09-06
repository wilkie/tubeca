import { jest } from '@jest/globals';
import {
  codecStringsFromInit,
  Fmp4Splitter,
  readFragmentDecodeTimes,
  readTrackTimescales,
  shiftFragmentDecodeTimes,
  topLevelBoxes,
} from '../fmp4';

/** A box with the given type and payload. */
function box(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

/** A full box: one version byte, three flag bytes, then the payload. */
function fullBox(type: string, version: number, payload: Buffer): Buffer {
  return box(type, Buffer.concat([Buffer.from([version, 0, 0, 0]), payload]));
}

function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value, 0);
  return b;
}

function u64(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(value), 0);
  return b;
}

/** An init segment describing two tracks with the given timescales. */
function init(tracks: { id: number; timescale: number }[]): Buffer {
  const traks = tracks.map((track) =>
    box(
      'trak',
      Buffer.concat([
        // version 0: 32-bit creation and modification times before the track id
        fullBox('tkhd', 0, Buffer.concat([u32(0), u32(0), u32(track.id)])),
        box('mdia', fullBox('mdhd', 0, Buffer.concat([u32(0), u32(0), u32(track.timescale), u32(0)]))),
      ])
    )
  );
  return Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', Buffer.concat(traks))]);
}

/** A fragment whose tracks start at the given decode times. */
function moof(tracks: { id: number; decodeTime: number; version?: number }[]): Buffer {
  const trafs = tracks.map((track) =>
    box(
      'traf',
      Buffer.concat([
        // tfhd: version/flags then the track id
        fullBox('tfhd', 0, Buffer.concat([u32(track.id)])),
        track.version === 0
          ? fullBox('tfdt', 0, u32(track.decodeTime))
          : fullBox('tfdt', 1, u64(track.decodeTime)),
      ])
    )
  );
  return box('moof', Buffer.concat([fullBox('mfhd', 0, u32(1)), ...trafs]));
}

describe('topLevelBoxes', () => {
  it('walks a stream of boxes in order', () => {
    const stream = Buffer.concat([box('ftyp'), box('moov'), box('moof'), box('mdat', Buffer.alloc(64))]);

    expect(topLevelBoxes(stream).map((b) => b.type)).toEqual(['ftyp', 'moov', 'moof', 'mdat']);
  });

  it('stops rather than looping on a box that claims an impossible size', () => {
    const broken = Buffer.alloc(12);
    broken.writeUInt32BE(2, 0); // smaller than its own header
    broken.write('junk', 4, 'latin1');

    expect(topLevelBoxes(broken)).toEqual([]);
  });

  it('treats a zero size as running to the end', () => {
    const rest = Buffer.alloc(20);
    rest.writeUInt32BE(0, 0);
    rest.write('mdat', 4, 'latin1');

    expect(topLevelBoxes(rest)).toEqual([{ type: 'mdat', start: 0, size: 20 }]);
  });
});

describe('readTrackTimescales', () => {
  it('reads the timescale of each track', () => {
    const timescales = readTrackTimescales(init([
      { id: 1, timescale: 90000 },
      { id: 2, timescale: 48000 },
    ]));

    expect([...timescales]).toEqual([
      [1, 90000],
      [2, 48000],
    ]);
  });

  it('is empty for something that is not an init segment', () => {
    expect([...readTrackTimescales(box('moof'))]).toEqual([]);
  });
});

describe('shiftFragmentDecodeTimes', () => {
  it('moves each track by its own offset, in its own timescale', () => {
    const fragment = moof([
      { id: 1, decodeTime: 0 },
      { id: 2, decodeTime: 0 },
    ]);

    shiftFragmentDecodeTimes(fragment, new Map([[1, 540000], [2, 288000]]));

    expect([...readFragmentDecodeTimes(fragment)]).toEqual([
      [1, 540000],
      [2, 288000],
    ]);
  });

  it('leaves a track alone when nothing says where to move it', () => {
    const fragment = moof([{ id: 1, decodeTime: 1234 }]);

    shiftFragmentDecodeTimes(fragment, new Map([[9, 500]]));

    expect(readFragmentDecodeTimes(fragment).get(1)).toBe(1234);
  });

  it('handles a 32-bit decode time, and refuses one that would overflow', () => {
    const small = moof([{ id: 1, decodeTime: 100, version: 0 }]);
    shiftFragmentDecodeTimes(small, new Map([[1, 900]]));
    expect(readFragmentDecodeTimes(small).get(1)).toBe(1000);

    const huge = moof([{ id: 1, decodeTime: 0xfffffff0, version: 0 }]);
    shiftFragmentDecodeTimes(huge, new Map([[1, 0x100]]));
    // The box cannot grow in place, so the value is left as it was.
    expect(readFragmentDecodeTimes(huge).get(1)).toBe(0xfffffff0);
  });
});

describe('Fmp4Splitter', () => {
  function split(stream: Buffer, startSeconds: number, chunkSize = stream.length) {
    const media: Buffer[] = [];
    const inits: Buffer[] = [];
    const splitter = new Fmp4Splitter({
      startSeconds,
      onInit: (b) => inits.push(b),
      onMedia: (c) => media.push(c),
    });
    for (let offset = 0; offset < stream.length; offset += chunkSize) {
      splitter.write(stream.subarray(offset, offset + chunkSize));
    }
    splitter.end();
    return { init: inits, media: Buffer.concat(media) };
  }

  const stream = (decodeTimes = [0, 0]) =>
    Buffer.concat([
      init([
        { id: 1, timescale: 90000 },
        { id: 2, timescale: 48000 },
      ]),
      moof([
        { id: 1, decodeTime: decodeTimes[0] },
        { id: 2, decodeTime: decodeTimes[1] },
      ]),
      box('mdat', Buffer.alloc(200, 7)),
      box('mfra', Buffer.alloc(16)),
    ]);

  it('reports the header once and keeps it out of the media segment', () => {
    const { init: headers, media } = split(stream(), 0);

    expect(headers).toHaveLength(1);
    expect(topLevelBoxes(headers[0]).map((b) => b.type)).toEqual(['ftyp', 'moov']);
    expect(topLevelBoxes(media).map((b) => b.type)).toEqual(['moof', 'mdat']);
  });

  it('puts the segment where the playlist says it is', () => {
    const { media } = split(stream(), 12);

    expect([...readFragmentDecodeTimes(media)]).toEqual([
      [1, 12 * 90000],
      [2, 12 * 48000],
    ]);
  });

  it('rebases rather than adds, so a run that does not start at zero still lands', () => {
    // FFmpeg numbers a run from zero, but nothing guarantees it.
    const { media } = split(stream([9000, 4800]), 12);

    expect([...readFragmentDecodeTimes(media)]).toEqual([
      [1, 12 * 90000],
      [2, 12 * 48000],
    ]);
  });

  it('shifts every track together, so their offsets survive', () => {
    // A muxer that starts two tracks at different decode times must not have
    // them dragged to the same instant: that is a lip-sync error by
    // construction. Video a tenth of a second behind audio stays behind it.
    const offsetTracks = Buffer.concat([
      init([
        { id: 1, timescale: 90000 },
        { id: 2, timescale: 48000 },
      ]),
      moof([
        { id: 1, decodeTime: 9000 }, // 0.1s
        { id: 2, decodeTime: 0 }, //    0.0s
      ]),
      box('mdat', Buffer.alloc(64, 1)),
    ]);

    const { media } = split(offsetTracks, 12);
    const times = readFragmentDecodeTimes(media);

    expect(times.get(1)! / 90000).toBeCloseTo(12.1, 5);
    expect(times.get(2)! / 48000).toBeCloseTo(12.0, 5);
  });

  it('keeps later fragments the same distance along the run', () => {
    const withSecond = Buffer.concat([
      stream(),
      moof([
        { id: 1, decodeTime: 90000 },
        { id: 2, decodeTime: 48000 },
      ]),
      box('mdat', Buffer.alloc(64, 3)),
    ]);

    const { media } = split(withSecond, 12);
    const fragments = topLevelBoxes(media).filter((b) => b.type === 'moof');
    const second = media.subarray(fragments[1].start, fragments[1].start + fragments[1].size);

    expect([...readFragmentDecodeTimes(second)]).toEqual([
      [1, 13 * 90000],
      [2, 13 * 48000],
    ]);
  });

  it('drops the fragment index written at the end of a run', () => {
    const { media } = split(stream(), 0);

    expect(topLevelBoxes(media).map((b) => b.type)).not.toContain('mfra');
  });

  it('does not care where the chunk boundaries fall', () => {
    const whole = split(stream(), 6);

    for (const chunkSize of [1, 3, 7, 64, 199]) {
      const piecemeal = split(stream(), 6, chunkSize);
      expect(piecemeal.media.equals(whole.media)).toBe(true);
      expect(piecemeal.init[0].equals(whole.init[0])).toBe(true);
    }
  });

  it('hands a large mdat on in pieces rather than holding it', () => {
    const chunks: number[] = [];
    const splitter = new Fmp4Splitter({
      startSeconds: 0,
      onInit: () => {},
      onMedia: (c) => chunks.push(c.length),
    });
    const s = stream();
    for (let offset = 0; offset < s.length; offset += 64) {
      splitter.write(s.subarray(offset, offset + 64));
    }
    splitter.end();

    // The 208-byte mdat arrives as several writes, not one.
    expect(chunks.length).toBeGreaterThan(2);
  });
});

describe('codecStringsFromInit', () => {
  /** A sample description containing one entry with one configuration box. */
  function initWith(sampleEntry: Buffer): Buffer {
    const stsd = fullBox('stsd', 0, Buffer.concat([u32(1), sampleEntry]));
    return Buffer.concat([
      box('ftyp', Buffer.from('isom')),
      box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd))))),
    ]);
  }
  const visual = (type: string, config: Buffer) =>
    box(type, Buffer.concat([Buffer.alloc(78), config]));
  const audio = (type: string, config: Buffer) =>
    box(type, Buffer.concat([Buffer.alloc(28), config]));

  it('spells H.264 as profile, constraints and level', () => {
    // High profile (0x64), no constraints, level 4.0 (0x28)
    const avcC = box('avcC', Buffer.from([1, 0x64, 0x00, 0x28]));

    expect(codecStringsFromInit(initWith(visual('avc1', avcC)))).toEqual(['avc1.640028']);
  });

  it('spells HEVC as profile, compatibility, tier and level', () => {
    // Main profile, main tier, compatibility flags 0x60000000, level 120 (4.0)
    const hvcC = box(
      'hvcC',
      Buffer.concat([
        Buffer.from([1, 0x01]),
        Buffer.from([0x60, 0x00, 0x00, 0x00]),
        Buffer.from([0xb0, 0, 0, 0, 0, 0]),
        Buffer.from([120]),
      ])
    );

    expect(codecStringsFromInit(initWith(visual('hvc1', hvcC)))).toEqual(['hvc1.1.6.L120.B0']);
  });

  it('marks the high tier and a Main 10 profile', () => {
    const hvcC = box(
      'hvcC',
      Buffer.concat([
        // profile_space 0, tier 1, profile 2
        Buffer.from([1, 0x22]),
        Buffer.from([0x20, 0x00, 0x00, 0x00]),
        Buffer.from([0xb0, 0, 0, 0, 0, 0]),
        Buffer.from([150]),
      ])
    );

    expect(codecStringsFromInit(initWith(visual('hvc1', hvcC)))).toEqual(['hvc1.2.4.H150.B0']);
  });

  it('spells AV1 as profile, level, tier and bit depth', () => {
    // seq_profile 0, seq_level_idx 8; main tier, high bit depth
    const av1C = box('av1C', Buffer.from([0x81, 0x08, 0x40, 0x00]));

    expect(codecStringsFromInit(initWith(visual('av01', av1C)))).toEqual(['av01.0.08M.10']);
  });

  it('reads an AAC track and an MP3 track from their descriptors', () => {
    // ES_Descriptor -> DecoderConfigDescriptor -> DecoderSpecificInfo
    const aacEsds = fullBox(
      'esds',
      0,
      Buffer.concat([
        Buffer.from([0x03, 0x19, 0x00, 0x01, 0x00]),
        Buffer.from([0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        // AudioSpecificConfig: object type 2 in the top five bits
        Buffer.from([0x05, 0x02, 0x11, 0x90]),
      ])
    );
    const mp3Esds = fullBox(
      'esds',
      0,
      Buffer.concat([
        Buffer.from([0x03, 0x15, 0x00, 0x01, 0x00]),
        Buffer.from([0x04, 0x0d, 0x6b, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ])
    );

    expect(codecStringsFromInit(initWith(audio('mp4a', aacEsds)))).toEqual(['mp4a.40.2']);
    expect(codecStringsFromInit(initWith(audio('mp4a', mp3Esds)))).toEqual(['mp4a.6B']);
  });

  it('names AC-3 and Opus by their sample entry alone', () => {
    expect(codecStringsFromInit(initWith(audio('ac-3', Buffer.alloc(0))))).toEqual(['ac-3']);
    expect(codecStringsFromInit(initWith(audio('Opus', Buffer.alloc(0))))).toEqual(['opus']);
  });

  it('leaves out a track it does not recognise rather than guessing', () => {
    expect(codecStringsFromInit(initWith(visual('mp4v', Buffer.alloc(0))))).toEqual([]);
    expect(codecStringsFromInit(Buffer.alloc(0))).toEqual([]);
  });

  it('says nothing when the configuration box is missing', () => {
    expect(codecStringsFromInit(initWith(visual('avc1', Buffer.alloc(0))))).toEqual([]);
  });
});

describe('Fmp4Splitter against FFmpeg', () => {
  // Guarded because it shells out; the box handling above is covered without it.
  const ffmpeg = process.env.TUBECA_TEST_FFMPEG === '1';
  const maybe = ffmpeg ? it : it.skip;

  maybe('splits a real fragmented MP4 and places it on the timeline', async () => {
    jest.setTimeout(30000);
    const { spawnSync, spawn } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-fmp4-'));
    const source = path.join(dir, 'source.mp4');
    spawnSync('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '50', '-preset', 'ultrafast',
      '-c:a', 'aac', '-shortest', source, '-y',
    ]);

    const media: Buffer[] = [];
    let header: Buffer | null = null;
    const splitter = new Fmp4Splitter({
      startSeconds: 6,
      onInit: (b) => { header = b; },
      onMedia: (c) => media.push(c),
    });

    await new Promise<void>((resolve) => {
      const child = spawn('ffmpeg', [
        '-v', 'error', '-ss', '6', '-i', source, '-t', '6',
        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
        '-f', 'mp4', '-movflags', '+empty_moov+default_base_moof+frag_keyframe', 'pipe:1',
      ]);
      child.stdout.on('data', (c: Buffer) => splitter.write(c));
      child.on('close', () => { splitter.end(); resolve(); });
    });

    const joined = path.join(dir, 'joined.mp4');
    fs.writeFileSync(joined, Buffer.concat([header!, ...media]));
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', joined,
    ]);

    expect(probe.stdout.toString().trim()).toBe('6.000000');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
