import * as fs from 'fs';
import * as path from 'path';
import type { ScraperConfig } from '@tubeca/scraper-types';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The backend package directory, found by walking up from this file until the
 * backend's package.json appears. Works from `src/` under tsx and from the
 * bundled `dist/index.js` alike, so relative defaults do not depend on how
 * deep the compiled file sits.
 */
export function getBackendRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === '@tubeca/backend') return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** The monorepo root (parent of the backend package). */
export function getRepoRoot(): string {
  return path.dirname(getBackendRoot());
}

export interface ScraperPluginConfig {
  enabled?: boolean
  apiKey?: string
  /**
   * Language the provider should answer in. The code is the provider's own:
   * TMDB wants "en-US", TVDB wants "eng".
   */
  language?: string
  /** Region used to pick release dates and certifications, e.g. "US". */
  region?: string
  /** Artwork width to request, e.g. "w500" or "original" for TMDB. */
  imageSize?: string
  /** Override the provider's base URL, for a proxy or a mirror. */
  baseUrl?: string
  /** Anything else the plugin understands is passed through unchanged. */
  [key: string]: unknown
}

export interface FileWatcherConfig {
  enabled?: boolean
  usePolling?: boolean  // Use polling instead of native events (needed for WSL/mounted filesystems)
  pollInterval?: number // Polling interval in milliseconds (default: 30000). Keep this high for network mounts (SMB/CIFS): polling stats every file each cycle on the libuv threadpool.
}

export interface HlsCacheConfig {
  path?: string           // Path for HLS segment cache
  maxSizeGB?: number      // Maximum cache size in GB (default: 10)
  segmentTTLHours?: number // Hours before unused segments expire (default: 24)
  segmentDuration?: number // Segment duration in seconds (default: 6)
}

/** Hover-scrub preview sprites. */
export interface TrickplayConfig {
  /** Generate sprites for newly imported video without being asked (default: false). */
  auto?: boolean
  /** Seconds between frames (default: 10). */
  interval?: number
  /** Tile width in pixels; the height follows the source's aspect (default: 320). */
  width?: number
  /** Tiles per sprite sheet (default: 10 x 10). */
  columns?: number
  rows?: number
}

export interface ImagesConfig {
  /**
   * Extra hosts artwork may be downloaded from, beyond the ones the installed
   * scrapers declare. For a third-party plugin that does not declare its own,
   * or a local mirror of a provider's images.
   */
  allowedHosts?: string[]
}

export interface AppConfig {
  imagePath?: string  // Path for storing downloaded images
  images?: ImagesConfig
  hlsCache?: HlsCacheConfig
  trickplay?: TrickplayConfig
  fileWatcher?: FileWatcherConfig
  scrapers?: {
    tmdb?: ScraperPluginConfig
    tvdb?: ScraperPluginConfig
    [key: string]: ScraperPluginConfig | undefined
  }
}

const DEFAULT_CONFIG_FILENAME = 'tubeca.config.json';

/**
 * Load application configuration from file
 *
 * Configuration file location priority:
 * 1. TUBECA_CONFIG_PATH environment variable (absolute path)
 * 2. tubeca.config.json in repository root
 */
export function loadAppConfig(): AppConfig {
  const configPath = resolveConfigPath();

  if (!configPath) {
    console.warn('⚠️ No configuration file found. Using defaults.');
    return {};
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as AppConfig;
    console.log(`📄 Loaded configuration from: ${configPath}`);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`❌ Invalid JSON in configuration file: ${configPath}`);
    } else {
      console.error(`❌ Failed to read configuration file: ${configPath}`, error);
    }
    return {};
  }
}

/**
 * Resolve the configuration file path
 */
function resolveConfigPath(): string | null {
  // Check environment variable first
  const envConfigPath = process.env.TUBECA_CONFIG_PATH;
  if (envConfigPath) {
    if (fs.existsSync(envConfigPath)) {
      return envConfigPath;
    }
    console.warn(`⚠️ TUBECA_CONFIG_PATH set but file not found: ${envConfigPath}`);
  }

  // Look for config in repository root (parent of backend directory)
  const repoRoot = getRepoRoot();
  const defaultConfigPath = path.join(repoRoot, DEFAULT_CONFIG_FILENAME);

  if (fs.existsSync(defaultConfigPath)) {
    return defaultConfigPath;
  }

  return null;
}

/**
 * Get scraper configurations from app config
 * Returns only scrapers that have API keys configured
 */
export function getScraperConfigs(appConfig: AppConfig): Record<string, ScraperConfig> {
  const scraperConfigs: Record<string, ScraperConfig> = {};

  if (!appConfig.scrapers) {
    return scraperConfigs;
  }

  for (const [scraperId, config] of Object.entries(appConfig.scrapers)) {
    if (!config) continue;

    // Skip if explicitly disabled
    if (config.enabled === false) {
      console.log(`⏭️ Scraper '${scraperId}' is disabled in configuration`);
      continue;
    }

    // Warn if no API key
    if (!config.apiKey) {
      console.warn(`⚠️ Scraper '${scraperId}' has no API key configured - skipping`);
      continue;
    }

    // Everything the user set is handed to the plugin, so language, region and
    // image size come from the config file instead of the plugin's defaults.
    // `enabled` is ours, not the plugin's.
    const pluginConfig: ScraperConfig = { apiKey: config.apiKey };
    for (const [key, value] of Object.entries(config)) {
      if (key === 'enabled' || value === undefined) continue;
      pluginConfig[key] = value;
    }
    scraperConfigs[scraperId] = pluginConfig;
  }

  return scraperConfigs;
}

// Cached paths
let imageStoragePath: string | null = null;
let hlsCachePath: string | null = null;

/**
 * Get the image storage path from configuration
 * Creates the directory if it doesn't exist
 */
export function getImageStoragePath(appConfig?: AppConfig): string {
  if (imageStoragePath) {
    return imageStoragePath;
  }

  // Load config if not provided
  const config = appConfig ?? loadAppConfig();

  // Use configured path or default
  const configuredPath = config?.imagePath;
  if (configuredPath) {
    // Use absolute path if provided, otherwise resolve relative to repo root
    if (path.isAbsolute(configuredPath)) {
      imageStoragePath = configuredPath;
    } else {
      const repoRoot = getRepoRoot();
      imageStoragePath = path.resolve(repoRoot, configuredPath);
    }
  } else {
    // Default: ./data/images relative to backend directory
    imageStoragePath = path.join(getBackendRoot(), 'data', 'images');
  }

  // Create directory if it doesn't exist
  if (!fs.existsSync(imageStoragePath)) {
    fs.mkdirSync(imageStoragePath, { recursive: true });
    console.log(`📁 Created image storage directory: ${imageStoragePath}`);
  }

  return imageStoragePath;
}

/**
 * Get the HLS cache path from configuration
 * Creates the directory if it doesn't exist
 */
export function getHlsCachePath(appConfig?: AppConfig): string {
  if (hlsCachePath) {
    return hlsCachePath;
  }

  // Load config if not provided
  const config = appConfig ?? loadAppConfig();

  // Use configured path or default
  const configuredPath = config?.hlsCache?.path;
  if (configuredPath) {
    // Use absolute path if provided, otherwise resolve relative to repo root
    if (path.isAbsolute(configuredPath)) {
      hlsCachePath = configuredPath;
    } else {
      const repoRoot = getRepoRoot();
      hlsCachePath = path.resolve(repoRoot, configuredPath);
    }
  } else {
    // Default: ./data/hls-cache relative to backend directory
    hlsCachePath = path.join(getBackendRoot(), 'data', 'hls-cache');
  }

  // Create directory if it doesn't exist
  if (!fs.existsSync(hlsCachePath)) {
    fs.mkdirSync(hlsCachePath, { recursive: true });
    console.log(`📁 Created HLS cache directory: ${hlsCachePath}`);
  }

  return hlsCachePath;
}

/**
 * Get HLS cache configuration with defaults
 */
/**
 * Trickplay settings, with defaults.
 *
 * Generating sprites decodes the whole file, so it is off by default: a
 * library of thirty thousand episodes would spend days on it uninvited. Ten
 * seconds and 320px match what the serving route and the player already
 * assume.
 */
/** Hosts an admin has added to the artwork allowlist, lowercased. */
export function getExtraImageHosts(appConfig?: AppConfig): string[] {
  const configured = (appConfig ?? loadAppConfig()).images?.allowedHosts ?? [];
  return configured.map((host) => host.trim().toLowerCase()).filter(Boolean);
}

export function getTrickplayConfig(appConfig?: AppConfig): Required<TrickplayConfig> {
  const config = appConfig?.trickplay || {};
  return {
    auto: config.auto ?? false,
    interval: config.interval ?? 10,
    width: config.width ?? 320,
    columns: config.columns ?? 10,
    rows: config.rows ?? 10,
  };
}

export function getHlsCacheConfig(appConfig?: AppConfig): Required<HlsCacheConfig> {
  const config = appConfig?.hlsCache || {};
  return {
    path: getHlsCachePath(appConfig),
    maxSizeGB: config.maxSizeGB ?? 10,
    segmentTTLHours: config.segmentTTLHours ?? 24,
    segmentDuration: config.segmentDuration ?? 6,
  };
}
