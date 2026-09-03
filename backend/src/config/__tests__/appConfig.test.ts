import { getScraperConfigs, type AppConfig } from '../appConfig';

/** getScraperConfigs logs about what it skips; keep the test output readable. */
function quietly<T>(run: () => T): T {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return run();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

describe('getScraperConfigs', () => {
  it('returns nothing when no scrapers are configured', () => {
    expect(getScraperConfigs({})).toEqual({});
  });

  it('passes the API key through', () => {
    const config: AppConfig = { scrapers: { tmdb: { apiKey: 'key-1' } } };

    expect(getScraperConfigs(config)).toEqual({ tmdb: { apiKey: 'key-1' } });
  });

  it('passes language, region and image size through to the plugin', () => {
    const config: AppConfig = {
      scrapers: {
        tmdb: { apiKey: 'key-1', language: 'fr-FR', region: 'FR', imageSize: 'original' },
      },
    };

    expect(getScraperConfigs(config).tmdb).toEqual({
      apiKey: 'key-1',
      language: 'fr-FR',
      region: 'FR',
      imageSize: 'original',
    });
  });

  it('keeps each scraper on its own language code', () => {
    const config: AppConfig = {
      scrapers: {
        tmdb: { apiKey: 'key-1', language: 'de-DE' },
        tvdb: { apiKey: 'key-2', language: 'deu' },
      },
    };

    const configs = getScraperConfigs(config);

    expect(configs.tmdb.language).toBe('de-DE');
    expect(configs.tvdb.language).toBe('deu');
  });

  it('passes through options it does not know about', () => {
    const config: AppConfig = { scrapers: { tmdb: { apiKey: 'key-1', includeAdult: true } } };

    expect(getScraperConfigs(config).tmdb.includeAdult).toBe(true);
  });

  it('does not hand the plugin our own enabled flag', () => {
    const config: AppConfig = { scrapers: { tmdb: { apiKey: 'key-1', enabled: true } } };

    expect(getScraperConfigs(config).tmdb).not.toHaveProperty('enabled');
  });

  it('skips a scraper that is turned off', () => {
    const config: AppConfig = {
      scrapers: { tmdb: { apiKey: 'key-1', enabled: false }, tvdb: { apiKey: 'key-2' } },
    };

    expect(Object.keys(quietly(() => getScraperConfigs(config)))).toEqual(['tvdb']);
  });

  it('skips a scraper with no API key', () => {
    const config: AppConfig = { scrapers: { tmdb: { language: 'en-US' } } };

    expect(quietly(() => getScraperConfigs(config))).toEqual({});
  });
});
