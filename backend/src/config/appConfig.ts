import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ScraperPluginConfig {
  enabled?: boolean
  apiKey?: string
}

export interface AppConfig {
  scrapers?: {
    tmdb?: ScraperPluginConfig
    tvdb?: ScraperPluginConfig
    [key: string]: ScraperPluginConfig | undefined
  }
}

const DEFAULT_CONFIG_FILENAME = 'tubeca.config.json'

/**
 * Load application configuration from file
 *
 * Configuration file location priority:
 * 1. TUBECA_CONFIG_PATH environment variable (absolute path)
 * 2. tubeca.config.json in repository root
 */
export function loadAppConfig(): AppConfig {
  const configPath = resolveConfigPath()

  if (!configPath) {
    console.warn('⚠️ No configuration file found. Using defaults.')
    return {}
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(configContent) as AppConfig
    console.log(`📄 Loaded configuration from: ${configPath}`)
    return config
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`❌ Invalid JSON in configuration file: ${configPath}`)
    } else {
      console.error(`❌ Failed to read configuration file: ${configPath}`, error)
    }
    return {}
  }
}

/**
 * Resolve the configuration file path
 */
function resolveConfigPath(): string | null {
  // Check environment variable first
  const envConfigPath = process.env.TUBECA_CONFIG_PATH
  if (envConfigPath) {
    if (fs.existsSync(envConfigPath)) {
      return envConfigPath
    }
    console.warn(`⚠️ TUBECA_CONFIG_PATH set but file not found: ${envConfigPath}`)
  }

  // Look for config in repository root (parent of backend directory)
  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const defaultConfigPath = path.join(repoRoot, DEFAULT_CONFIG_FILENAME)

  if (fs.existsSync(defaultConfigPath)) {
    return defaultConfigPath
  }

  return null
}

/**
 * Get scraper configurations from app config
 * Returns only scrapers that have API keys configured
 */
export function getScraperConfigs(appConfig: AppConfig): Record<string, { apiKey: string }> {
  const scraperConfigs: Record<string, { apiKey: string }> = {}

  if (!appConfig.scrapers) {
    return scraperConfigs
  }

  for (const [scraperId, config] of Object.entries(appConfig.scrapers)) {
    if (!config) continue

    // Skip if explicitly disabled
    if (config.enabled === false) {
      console.log(`⏭️ Scraper '${scraperId}' is disabled in configuration`)
      continue
    }

    // Warn if no API key
    if (!config.apiKey) {
      console.warn(`⚠️ Scraper '${scraperId}' has no API key configured - skipping`)
      continue
    }

    scraperConfigs[scraperId] = { apiKey: config.apiKey }
  }

  return scraperConfigs
}
