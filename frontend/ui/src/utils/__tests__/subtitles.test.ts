import { isTextSubtitle } from '../subtitles';

describe('isTextSubtitle', () => {
  it('accepts the text formats a player can show', () => {
    for (const codec of ['subrip', 'ass', 'mov_text', 'webvtt']) {
      expect(isTextSubtitle(codec)).toBe(true);
    }
  });

  it('rejects the picture formats that would need OCR', () => {
    for (const codec of ['hdmv_pgs_subtitle', 'dvd_subtitle', 'xsub', 'dvb_subtitle']) {
      expect(isTextSubtitle(codec)).toBe(false);
    }
  });

  it('does not mind how the codec is capitalised', () => {
    expect(isTextSubtitle('SubRip')).toBe(true);
    expect(isTextSubtitle('HDMV_PGS_SUBTITLE')).toBe(false);
  });

  it('offers a track whose codec nobody recorded, rather than hiding it', () => {
    expect(isTextSubtitle(null)).toBe(true);
    expect(isTextSubtitle(undefined)).toBe(true);
  });
});
