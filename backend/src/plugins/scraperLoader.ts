import type {
  ScraperPlugin,
  ScraperConfig,
  ScraperPluginFactory,
} from '@tubeca/scraper-types'

interface LoadedScraper {
  plugin: ScraperPlugin
  config: ScraperConfig
}

/**
 * Manages loading and accessing metadata scraper plugins
 */
class ScraperManager {
  private scrapers: Map<string, LoadedScraper> = new Map()
  private initialized = false

  /**
   * Register a scraper plugin
   */
  register(factory: ScraperPluginFactory, config: ScraperConfig = {}): void {
    const plugin = factory()
    this.scrapers.set(plugin.id, { plugin, config })
    console.log(`📦 Registered scraper: ${plugin.name} (${plugin.id})`)
  }

  /**
   * Initialize all registered scrapers with their configurations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    for (const [id, { plugin, config }] of this.scrapers) {
      try {
        await plugin.initialize(config)
        console.log(`✅ Initialized scraper: ${plugin.name}`)
      } catch (error) {
        console.error(`❌ Failed to initialize scraper ${id}:`, error)
      }
    }

    this.initialized = true
  }

  /**
   * Get a scraper by ID
   */
  get(id: string): ScraperPlugin | undefined {
    return this.scrapers.get(id)?.plugin
  }

  /**
   * Get all registered scrapers
   */
  getAll(): ScraperPlugin[] {
    return Array.from(this.scrapers.values()).map((s) => s.plugin)
  }

  /**
   * Get all scrapers that support a specific media type
   */
  getByMediaType(type: 'video' | 'audio'): ScraperPlugin[] {
    return this.getAll().filter((s) => s.supportedTypes.includes(type))
  }

  /**
   * Get all configured (ready to use) scrapers
   */
  getConfigured(): ScraperPlugin[] {
    return this.getAll().filter((s) => s.isConfigured())
  }

  /**
   * List all scrapers with their status
   */
  list(): Array<{
    id: string
    name: string
    description: string
    version: string
    supportedTypes: string[]
    configured: boolean
  }> {
    return this.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version,
      supportedTypes: [...s.supportedTypes],
      configured: s.isConfigured(),
    }))
  }
}

// Singleton instance
export const scraperManager = new ScraperManager()

/**
 * Load scraper plugins from configuration
 * This is called during server startup
 */
export async function loadScrapers(
  scraperConfigs: Record<string, ScraperConfig>
): Promise<void> {
  // Dynamically import enabled scrapers
  // In the future, this could scan a directory or read from a config file

  // Load TMDB scraper if configured
  if (scraperConfigs.tmdb) {
    try {
      const tmdbModule = await import('@tubeca/scraper-tmdb')
      const factory = tmdbModule.default as ScraperPluginFactory
      scraperManager.register(factory, scraperConfigs.tmdb)
    } catch (error) {
      console.warn('TMDB scraper not available:', error)
    }
  }

  // Load TVDB scraper if configured
  if (scraperConfigs.tvdb) {
    try {
      const tvdbModule = await import('@tubeca/scraper-tvdb')
      const factory = tvdbModule.default as ScraperPluginFactory
      scraperManager.register(factory, scraperConfigs.tvdb)
    } catch (error) {
      console.warn('TVDB scraper not available:', error)
    }
  }

  // Initialize all scrapers
  await scraperManager.initialize()

  console.log(`📚 Loaded ${scraperManager.getAll().length} scraper(s)`)
}
