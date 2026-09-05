import {
  getDecoderInputArgs,
  getEncoderArgs,
  getEncoderInputArgs,
  listEncoderOptions,
  parseEncoderList,
  testEncodeArgs,
  SOFTWARE_ENCODER,
  VAAPI_DEVICE,
  type HardwareEncoder,
} from '../hwaccel';

const vaapi: HardwareEncoder = { name: 'VAAPI', encoder: 'h264_vaapi', type: 'hardware', priority: 4 };
const nvenc: HardwareEncoder = { name: 'NVIDIA NVENC', encoder: 'h264_nvenc', type: 'hardware', priority: 1 };

/** Read the single filter chain an argument list carries. */
function filterOf(args: string[]): string {
  const index = args.indexOf('-vf');
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}

describe('parseEncoderList', () => {
  it('picks video encoder names out of the ffmpeg table', () => {
    const output = [
      'Encoders:',
      ' V..... libx264              libx264 H.264',
      ' V....D h264_vaapi           H.264/AVC (VAAPI)',
      ' A..... aac                  AAC',
      ' S..... webvtt               WebVTT subtitle',
    ].join('\n');

    const encoders = parseEncoderList(output);

    expect(encoders.has('libx264')).toBe(true);
    expect(encoders.has('h264_vaapi')).toBe(true);
    expect(encoders.has('aac')).toBe(false);
    expect(encoders.has('webvtt')).toBe(false);
  });

  it('returns nothing for empty output', () => {
    expect(parseEncoderList('').size).toBe(0);
  });
});

describe('listEncoderOptions', () => {
  it('offers hardware encoders before software', () => {
    const options = listEncoderOptions();

    expect(options[0].encoder).toBe('h264_nvenc');
    expect(options[options.length - 1].encoder).toBe('libx264');
    expect(options.map((o) => o.priority)).toEqual([...options.map((o) => o.priority)].sort((a, b) => a - b));
  });
});

describe('getEncoderInputArgs', () => {
  it('opens the render node for VAAPI', () => {
    expect(getEncoderInputArgs(vaapi)).toEqual(['-vaapi_device', VAAPI_DEVICE]);
  });

  it('needs nothing before the input for other encoders', () => {
    expect(getEncoderInputArgs(nvenc)).toEqual([]);
    expect(getEncoderInputArgs(SOFTWARE_ENCODER)).toEqual([]);
  });
});

describe('getEncoderArgs', () => {
  it('uploads scaled frames to the GPU for VAAPI', () => {
    const args = getEncoderArgs(vaapi, 5000, 1280, 720);

    expect(args).toContain('h264_vaapi');
    expect(filterOf(args)).toBe(
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=nv12,hwupload'
    );
  });

  it('leaves the filter chain in software for other encoders', () => {
    expect(filterOf(getEncoderArgs(SOFTWARE_ENCODER, 5000, 1280, 720))).toBe(
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2'
    );
    expect(filterOf(getEncoderArgs(nvenc, 5000, 1280, 720))).not.toContain('hwupload');
  });

  it('derives the rate control ceiling and buffer from the target bitrate', () => {
    const args = getEncoderArgs(SOFTWARE_ENCODER, 2500, 854, 480);

    expect(args[args.indexOf('-b:v') + 1]).toBe('2500k');
    expect(args[args.indexOf('-maxrate') + 1]).toBe('3750k');
    expect(args[args.indexOf('-bufsize') + 1]).toBe('5000k');
  });

  it('falls back to libx264 for an encoder it does not know', () => {
    const args = getEncoderArgs({ name: 'Odd', encoder: 'h264_odd', type: 'hardware', priority: 9 }, 1000, 640, 360);

    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
  });
});

describe('testEncodeArgs', () => {
  it('tests VAAPI the way it will actually be run', () => {
    const args = testEncodeArgs('h264_vaapi');

    // The device has to be open before the input, and the frames uploaded.
    expect(args.indexOf('-vaapi_device')).toBeLessThan(args.indexOf('-i'));
    expect(args.join(' ')).toContain('hwupload');
    expect(args.slice(-5)).toEqual(['-frames:v', '1', '-f', 'null', '-']);
  });

  it('encodes a single generated frame', () => {
    const args = testEncodeArgs('h264_nvenc');

    expect(args).toContain('lavfi');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args[args.length - 1]).toBe('-');
  });
});

describe('getDecoderInputArgs', () => {
  const nvenc = { name: 'NVENC', encoder: 'h264_nvenc', type: 'hardware' as const, priority: 1 };
  const vaapi = { name: 'VAAPI', encoder: 'h264_vaapi', type: 'hardware' as const, priority: 2 };
  const software = { name: 'x264', encoder: 'libx264', type: 'software' as const, priority: 100 };

  it('decodes on the card that is already encoding', () => {
    expect(getDecoderInputArgs(nvenc, 'hevc')).toEqual(['-hwaccel', 'cuda']);
    expect(getDecoderInputArgs(vaapi, 'h264')).toEqual(['-hwaccel', 'vaapi']);
  });

  it('leaves software encoding alone: the round trip costs more than it saves', () => {
    expect(getDecoderInputArgs(software, 'hevc')).toEqual([]);
  });

  it('will not ask a decoder for a codec it does not have', () => {
    // Pascal NVDEC has no VP6 or WMV1; asking fails the whole segment.
    expect(getDecoderInputArgs(nvenc, 'wmv1')).toEqual([]);
    expect(getDecoderInputArgs(nvenc, 'msmpeg4v3')).toEqual([]);
    // And VAAPI's list is shorter than NVDEC's.
    expect(getDecoderInputArgs(vaapi, 'mpeg4')).toEqual([]);
    expect(getDecoderInputArgs(nvenc, 'mpeg4')).toEqual(['-hwaccel', 'cuda']);
  });

  it('does not mind how the codec is capitalised', () => {
    expect(getDecoderInputArgs(nvenc, 'HEVC')).toEqual(['-hwaccel', 'cuda']);
  });

  it('asks for nothing when the codec was never probed', () => {
    expect(getDecoderInputArgs(nvenc, null)).toEqual([]);
    expect(getDecoderInputArgs(nvenc, undefined)).toEqual([]);
  });
});
