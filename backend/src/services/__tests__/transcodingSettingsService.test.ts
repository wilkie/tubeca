import { validateTranscodingSettings } from '../transcodingSettingsService';

/** Field names of the errors a body produced. */
function fieldsRejected(body: unknown): string[] {
  return validateTranscodingSettings(body).errors.map((e) => e.field);
}

describe('validateTranscodingSettings', () => {
  it('accepts a full, valid body', () => {
    const body = {
      enableHardwareAccel: true,
      preferredEncoder: 'h264_vaapi',
      preset: 'veryfast',
      enableLowLatency: false,
      threadCount: 4,
      maxConcurrentTranscodes: 3,
      segmentDuration: 4,
      prefetchSegments: 3,
      bitrate1080p: 8000,
      bitrate720p: 5000,
      bitrate480p: 2500,
      bitrate360p: 1000,
    };

    const { data, errors } = validateTranscodingSettings(body);

    expect(errors).toEqual([]);
    expect(data).toEqual(body);
  });

  it('leaves absent fields untouched', () => {
    const { data, errors } = validateTranscodingSettings({ preset: 'fast' });

    expect(errors).toEqual([]);
    expect(data).toEqual({ preset: 'fast' });
  });

  it('ignores fields it does not know', () => {
    const { data } = validateTranscodingSettings({ preset: 'fast', codec: 'av1', id: 'nice try' });

    expect(data).toEqual({ preset: 'fast' });
  });

  it('rejects a segment duration that would break playlist arithmetic', () => {
    expect(fieldsRejected({ segmentDuration: 0 })).toEqual(['segmentDuration']);
    expect(fieldsRejected({ segmentDuration: -6 })).toEqual(['segmentDuration']);
    expect(fieldsRejected({ segmentDuration: 6.5 })).toEqual(['segmentDuration']);
    expect(fieldsRejected({ segmentDuration: '6' })).toEqual(['segmentDuration']);
    expect(fieldsRejected({ segmentDuration: 600 })).toEqual(['segmentDuration']);
  });

  it('requires at least one transcode slot', () => {
    expect(fieldsRejected({ maxConcurrentTranscodes: 0 })).toEqual(['maxConcurrentTranscodes']);
    expect(validateTranscodingSettings({ maxConcurrentTranscodes: 1 }).errors).toEqual([]);
  });

  it('allows no prefetching but not a negative amount', () => {
    expect(validateTranscodingSettings({ prefetchSegments: 0 }).errors).toEqual([]);
    expect(fieldsRejected({ prefetchSegments: -1 })).toEqual(['prefetchSegments']);
  });

  it('bounds every bitrate', () => {
    expect(fieldsRejected({ bitrate1080p: 0, bitrate720p: 1e9 })).toEqual(['bitrate1080p', 'bitrate720p']);
  });

  it('only takes a preset FFmpeg knows', () => {
    expect(fieldsRejected({ preset: 'placebo' })).toEqual(['preset']);
    expect(fieldsRejected({ preset: 42 })).toEqual(['preset']);
    expect(validateTranscodingSettings({ preset: 'ultrafast' }).errors).toEqual([]);
  });

  it('takes an empty encoder choice as automatic', () => {
    expect(validateTranscodingSettings({ preferredEncoder: null }).data.preferredEncoder).toBeNull();
    expect(validateTranscodingSettings({ preferredEncoder: '' }).data.preferredEncoder).toBeNull();
  });

  it('rejects an encoder that is not one of ours', () => {
    expect(fieldsRejected({ preferredEncoder: 'h264_madeup' })).toEqual(['preferredEncoder']);
  });

  it('rejects a switch that is not a boolean', () => {
    expect(fieldsRejected({ enableHardwareAccel: 'yes', enableLowLatency: 1 })).toEqual([
      'enableHardwareAccel',
      'enableLowLatency',
    ]);
  });

  it('explains what was wrong with each field', () => {
    const { errors } = validateTranscodingSettings({ segmentDuration: 0 });

    expect(errors[0].message).toContain('between 1 and 30 seconds');
  });

  it('tolerates a missing or non-object body', () => {
    expect(validateTranscodingSettings(undefined)).toEqual({ data: {}, errors: [] });
    expect(validateTranscodingSettings(null)).toEqual({ data: {}, errors: [] });
  });
});
