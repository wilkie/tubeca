import { jest } from '@jest/globals';

const getAll = jest.fn<() => { imageHosts?: readonly string[] }[]>();
const getExtraImageHosts = jest.fn<() => string[]>();

jest.unstable_mockModule('../../plugins/scraperLoader', () => ({
  scraperManager: { getAll },
}));
const actualAppConfig = await import('../../config/appConfig');
jest.unstable_mockModule('../../config/appConfig', () => ({
  ...actualAppConfig,
  getExtraImageHosts,
}));

const { allowedImageHosts, imageHostRefusalReason } = await import('../imageHosts');

beforeEach(() => {
  jest.clearAllMocks();
  getAll.mockReturnValue([]);
  getExtraImageHosts.mockReturnValue([]);
});

describe('allowedImageHosts', () => {
  it('is the union of what the installed scrapers declare', () => {
    getAll.mockReturnValue([
      { imageHosts: ['image.tmdb.org'] },
      { imageHosts: ['artworks.thetvdb.com'] },
    ]);

    expect(allowedImageHosts()).toEqual(['image.tmdb.org', 'artworks.thetvdb.com']);
  });

  it('adds whatever the admin put in the config', () => {
    getAll.mockReturnValue([{ imageHosts: ['image.tmdb.org'] }]);
    getExtraImageHosts.mockReturnValue(['mirror.example.net']);

    expect(allowedImageHosts()).toEqual(['image.tmdb.org', 'mirror.example.net']);
  });

  it('says each host once, however many scrapers name it', () => {
    getAll.mockReturnValue([{ imageHosts: ['image.tmdb.org'] }, { imageHosts: ['image.tmdb.org'] }]);
    getExtraImageHosts.mockReturnValue(['image.tmdb.org']);

    expect(allowedImageHosts()).toEqual(['image.tmdb.org']);
  });

  it('ignores a scraper that declares nothing', () => {
    getAll.mockReturnValue([{ imageHosts: ['image.tmdb.org'] }, {}]);

    expect(allowedImageHosts()).toEqual(['image.tmdb.org']);
  });

  it('lowercases and trims, since a host is not case-sensitive', () => {
    getAll.mockReturnValue([{ imageHosts: ['  Image.TMDB.org '] }]);

    expect(allowedImageHosts()).toEqual(['image.tmdb.org']);
  });
});

describe('imageHostRefusalReason', () => {
  beforeEach(() => {
    getAll.mockReturnValue([
      { imageHosts: ['image.tmdb.org'] },
      { imageHosts: ['artworks.thetvdb.com'] },
    ]);
  });

  it('accepts a URL from a host a scraper named', () => {
    expect(imageHostRefusalReason('https://image.tmdb.org/t/p/w500/x.jpg')).toBeNull();
    expect(imageHostRefusalReason('https://artworks.thetvdb.com/banners/posters/1-1.jpg')).toBeNull();
  });

  it('does not care about the case a host was written in', () => {
    expect(imageHostRefusalReason('https://IMAGE.TMDB.ORG/t/p/w500/x.jpg')).toBeNull();
  });

  it('refuses a host nothing named, and says which ones it knows', () => {
    const reason = imageHostRefusalReason('https://example.com/poster.jpg');

    expect(reason).toContain('example.com');
    expect(reason).toContain('image.tmdb.org');
  });

  it('matches the whole host, not the end of it', () => {
    // The classic way an allowlist is walked past.
    expect(imageHostRefusalReason('https://image.tmdb.org.evil.example/x.jpg')).toContain(
      'not a host artwork comes from'
    );
    expect(imageHostRefusalReason('https://evil.example/image.tmdb.org/x.jpg')).toContain(
      'not a host artwork comes from'
    );
  });

  it('does not accept a subdomain of an allowed host', () => {
    expect(imageHostRefusalReason('https://sub.image.tmdb.org/x.jpg')).toContain(
      'not a host artwork comes from'
    );
  });

  it('refuses something that is not a URL', () => {
    expect(imageHostRefusalReason('not a url')).toBe('Not a URL');
  });

  it('checks nothing when nothing has been declared', () => {
    // A scraper predating `imageHosts` would otherwise have all its artwork
    // refused, which is a worse failure than not checking.
    getAll.mockReturnValue([{}]);
    getExtraImageHosts.mockReturnValue([]);

    expect(imageHostRefusalReason('https://anywhere.example/x.jpg')).toBeNull();
  });
});
