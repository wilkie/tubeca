import { jest } from '@jest/globals';
import type { ScraperPlugin } from '@tubeca/scraper-types';

const tmdbInitialize = jest.fn<(config: unknown) => Promise<void>>();
const tvdbInitialize = jest.fn<(config: unknown) => Promise<void>>();

/** A plugin that does nothing but remember how it was set up. */
function fakePlugin(
  id: string,
  initialize: (config: unknown) => Promise<void>,
  overrides: Partial<ScraperPlugin> = {}
): ScraperPlugin {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} scraper`,
    version: '1.0.0',
    supportedTypes: ['video'],
    initialize,
    isConfigured: () => true,
    ...overrides,
  } as ScraperPlugin;
}

let tmdbPlugin: ScraperPlugin;
let tvdbPlugin: ScraperPlugin;

jest.unstable_mockModule('@tubeca/scraper-tmdb', () => ({ default: () => tmdbPlugin }));
jest.unstable_mockModule('@tubeca/scraper-tvdb', () => ({ default: () => tvdbPlugin }));

/** A registry of its own for each test; the module exports a singleton. */
async function loader() {
  jest.resetModules();
  return import('../scraperLoader');
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  tmdbInitialize.mockResolvedValue(undefined);
  tvdbInitialize.mockResolvedValue(undefined);
  tmdbPlugin = fakePlugin('tmdb', tmdbInitialize);
  tvdbPlugin = fakePlugin('tvdb', tvdbInitialize, { supportedTypes: ['video'] });
});

describe('loadScrapers', () => {
  it('loads only what the configuration names', async () => {
    const { loadScrapers, scraperManager } = await loader();

    await loadScrapers({ tmdb: { apiKey: 'k' } });

    expect(scraperManager.getAll().map((s) => s.id)).toEqual(['tmdb']);
    expect(tvdbInitialize).not.toHaveBeenCalled();
  });

  it('loads both when both are configured', async () => {
    const { loadScrapers, scraperManager } = await loader();

    await loadScrapers({ tmdb: { apiKey: 'k' }, tvdb: { apiKey: 'j' } });

    expect(scraperManager.getAll().map((s) => s.id).sort()).toEqual(['tmdb', 'tvdb']);
  });

  it('hands each plugin its own configuration', async () => {
    const { loadScrapers } = await loader();

    await loadScrapers({ tmdb: { apiKey: 'k', language: 'fr-FR' }, tvdb: { apiKey: 'j' } });

    expect(tmdbInitialize).toHaveBeenCalledWith({ apiKey: 'k', language: 'fr-FR' });
    expect(tvdbInitialize).toHaveBeenCalledWith({ apiKey: 'j' });
  });

  it('loads nothing at all when nothing is configured', async () => {
    const { loadScrapers, scraperManager } = await loader();

    await loadScrapers({});

    expect(scraperManager.getAll()).toEqual([]);
  });

  it('keeps the other scrapers when one fails to start up', async () => {
    const { loadScrapers, scraperManager } = await loader();
    tmdbInitialize.mockRejectedValue(new Error('TMDB rejected the key'));

    await loadScrapers({ tmdb: { apiKey: 'bad' }, tvdb: { apiKey: 'j' } });

    expect(scraperManager.getAll().map((s) => s.id).sort()).toEqual(['tmdb', 'tvdb']);
    expect(tvdbInitialize).toHaveBeenCalled();
  });

  it('initialises each plugin once, however often it is asked', async () => {
    const { loadScrapers } = await loader();

    await loadScrapers({ tmdb: { apiKey: 'k' } });
    await loadScrapers({ tmdb: { apiKey: 'k' } });

    expect(tmdbInitialize).toHaveBeenCalledTimes(1);
  });
});

describe('the registry', () => {
  it('hands back a scraper by id, and nothing for a name it does not know', async () => {
    const { loadScrapers, scraperManager } = await loader();
    await loadScrapers({ tmdb: { apiKey: 'k' } });

    expect(scraperManager.get('tmdb')?.id).toBe('tmdb');
    expect(scraperManager.get('imdb')).toBeUndefined();
  });

  it('filters by the media type a scraper supports', async () => {
    const { loadScrapers, scraperManager } = await loader();
    tvdbPlugin = fakePlugin('tvdb', tvdbInitialize, { supportedTypes: ['audio'] });
    await loadScrapers({ tmdb: { apiKey: 'k' }, tvdb: { apiKey: 'j' } });

    expect(scraperManager.getByMediaType('video').map((s) => s.id)).toEqual(['tmdb']);
    expect(scraperManager.getByMediaType('audio').map((s) => s.id)).toEqual(['tvdb']);
  });

  it('separates the ones that are ready to use from the ones that are not', async () => {
    const { loadScrapers, scraperManager } = await loader();
    tvdbPlugin = fakePlugin('tvdb', tvdbInitialize, { isConfigured: () => false });
    await loadScrapers({ tmdb: { apiKey: 'k' }, tvdb: {} });

    expect(scraperManager.getConfigured().map((s) => s.id)).toEqual(['tmdb']);
  });

  it('lists what it holds for the settings page', async () => {
    const { loadScrapers, scraperManager } = await loader();
    await loadScrapers({ tmdb: { apiKey: 'k' } });

    expect(scraperManager.list()).toEqual([
      {
        id: 'tmdb',
        name: 'TMDB',
        description: 'tmdb scraper',
        version: '1.0.0',
        supportedTypes: ['video'],
        configured: true,
      },
    ]);
  });

  it('replaces a scraper registered twice under the same id', async () => {
    const { loadScrapers, scraperManager } = await loader();

    await loadScrapers({ tmdb: { apiKey: 'k' } });
    scraperManager.register(() => fakePlugin('tmdb', tmdbInitialize, { name: 'TMDB v2' }));

    expect(scraperManager.getAll()).toHaveLength(1);
    expect(scraperManager.get('tmdb')?.name).toBe('TMDB v2');
  });
});
