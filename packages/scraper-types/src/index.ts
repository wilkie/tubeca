/**
 * Tubeca Scraper Plugin Types
 *
 * This package defines the interfaces that all metadata scrapers must implement.
 */

// ============================================================================
// Media Types
// ============================================================================

export type MediaType = 'video' | 'audio'
export type VideoType = 'movie' | 'tv_episode' | 'tv_series'

// ============================================================================
// Search Results
// ============================================================================

export interface SearchResult {
  /** Unique identifier from the scraper source */
  externalId: string
  /** Title of the media */
  title: string
  /** Year of release */
  year?: number
  /** Type of video content */
  videoType?: VideoType
  /** URL to poster/cover image */
  posterUrl?: string
  /** Brief description */
  overview?: string
  /** Confidence score (0-1) for match quality */
  confidence?: number
}

// ============================================================================
// Video Metadata
// ============================================================================

export interface VideoMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Title */
  title: string
  /** Original title (if different from localized title) */
  originalTitle?: string
  /** Plot summary / description */
  description?: string
  /** Release or air date */
  releaseDate?: Date
  /** Content rating (e.g., "PG-13", "TV-MA") */
  rating?: string
  /** Runtime in minutes */
  runtime?: number
  /** Genres */
  genres?: string[]
  /** URL to poster image */
  posterUrl?: string
  /** URL to backdrop/fanart image (highest rated overall) */
  backdropUrl?: string
  /** URL to thumbnail image (highest rated English backdrop) */
  thumbnailUrl?: string
  /** URL to logo image */
  logoUrl?: string

  // TV-specific fields
  /** Show name (for episodes) */
  showName?: string
  /** Season number */
  season?: number
  /** Episode number */
  episode?: number
  /** Episode title */
  episodeTitle?: string

  /** Cast and crew */
  credits?: CreditInfo[]
}

export interface CreditInfo {
  /** Person's name */
  name: string
  /** Role/character name (for actors) or job title (for crew) */
  role?: string
  /** Type of credit */
  type: CreditType
  /** Display order */
  order?: number
  /** URL to person's photo */
  photoUrl?: string
}

export type CreditType =
  | 'actor'
  | 'director'
  | 'writer'
  | 'producer'
  | 'composer'
  | 'cinematographer'
  | 'editor'

// ============================================================================
// Series (TV Show) Metadata
// ============================================================================

export interface SeriesMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Series title */
  title: string
  /** Original title (if different from localized title) */
  originalTitle?: string
  /** Plot summary / description */
  description?: string
  /** First air date */
  firstAirDate?: Date
  /** Last air date (if ended) */
  lastAirDate?: Date
  /** Status (e.g., "Continuing", "Ended", "Canceled") */
  status?: string
  /** Average rating */
  rating?: number
  /** Genres */
  genres?: string[]
  /** URL to poster image */
  posterUrl?: string
  /** URL to backdrop/fanart image (highest rated overall) */
  backdropUrl?: string
  /** URL to thumbnail image (highest rated English backdrop) */
  thumbnailUrl?: string
  /** URL to logo image */
  logoUrl?: string
  /** Number of seasons */
  seasonCount?: number
  /** Cast and crew */
  credits?: CreditInfo[]
}

export interface SeasonMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Season number */
  seasonNumber: number
  /** Season name (if different from "Season X") */
  name?: string
  /** Season overview */
  description?: string
  /** Air date of first episode */
  airDate?: Date
  /** URL to poster image */
  posterUrl?: string
  /** Episode count */
  episodeCount?: number
}

// ============================================================================
// Audio Metadata
// ============================================================================

export interface AudioMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Track title */
  title: string
  /** Primary artist */
  artist?: string
  /** Album artist (may differ from track artist) */
  albumArtist?: string
  /** Album name */
  album?: string
  /** Track number */
  track?: number
  /** Disc number */
  disc?: number
  /** Release year */
  year?: number
  /** Genre */
  genre?: string
  /** URL to album art */
  albumArtUrl?: string
}

// ============================================================================
// Artist Metadata
// ============================================================================

export interface ArtistMemberInfo {
  /** Member's name */
  name: string
  /** Instrument/role (e.g., "vocals", "guitar") */
  role?: string
  /** Whether currently active in the group */
  active?: boolean
}

export interface ArtistMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Artist/band name */
  name: string
  /** Biography */
  biography?: string
  /** Year formed/born */
  formedYear?: number
  /** Year disbanded (if applicable) */
  endedYear?: number
  /** Genres */
  genres?: string[]
  /** Country of origin */
  country?: string
  /** URL to artist image */
  imageUrl?: string
  /** Band members (for groups) */
  members?: ArtistMemberInfo[]
}

// ============================================================================
// Album Metadata
// ============================================================================

export interface AlbumCreditInfo {
  /** Person's name */
  name: string
  /** Role (e.g., "Producer", "Mixing Engineer") */
  role?: string
}

export interface AlbumMetadata {
  /** External ID from the scraper source */
  externalId: string
  /** Album title */
  title: string
  /** Artist name */
  artist?: string
  /** Release date */
  releaseDate?: Date
  /** Release type (e.g., "Album", "EP", "Single", "Compilation") */
  releaseType?: string
  /** Genres */
  genres?: string[]
  /** Album description/review */
  description?: string
  /** Record label */
  label?: string
  /** URL to album art */
  albumArtUrl?: string
  /** Track count */
  trackCount?: number
  /** Production credits */
  credits?: AlbumCreditInfo[]
}

// ============================================================================
// Scraper Configuration
// ============================================================================

export interface ScraperConfig {
  /** API key or other authentication */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
  /** Language preference (e.g., "en", "es") */
  language?: string
  /** Additional scraper-specific options */
  [key: string]: unknown
}

// ============================================================================
// Scraper Plugin Interface
// ============================================================================

export interface ScraperPlugin {
  /** Unique identifier for this scraper */
  readonly id: string
  /** Human-readable name */
  readonly name: string
  /** Description of the scraper */
  readonly description: string
  /** Version of the scraper */
  readonly version: string
  /** Types of media this scraper supports */
  readonly supportedTypes: MediaType[]

  /**
   * Initialize the scraper with configuration
   */
  initialize(config: ScraperConfig): Promise<void>

  /**
   * Check if the scraper is properly configured and can make requests
   */
  isConfigured(): boolean

  /**
   * Search for video metadata by title
   */
  searchVideo?(query: string, options?: VideoSearchOptions): Promise<SearchResult[]>

  /**
   * Get detailed video metadata by external ID
   */
  getVideoMetadata?(externalId: string): Promise<VideoMetadata | null>

  /**
   * Search for TV series
   */
  searchSeries?(query: string): Promise<SearchResult[]>

  /**
   * Get series (TV show) metadata by external ID
   */
  getSeriesMetadata?(seriesId: string): Promise<SeriesMetadata | null>

  /**
   * Get season metadata for a series
   */
  getSeasonMetadata?(seriesId: string, seasonNumber: number): Promise<SeasonMetadata | null>

  /**
   * Get episode metadata for a series
   */
  getEpisodeMetadata?(seriesId: string, season: number, episode: number): Promise<VideoMetadata | null>

  /**
   * Search for audio metadata by title/artist
   */
  searchAudio?(query: string, options?: AudioSearchOptions): Promise<SearchResult[]>

  /**
   * Get detailed audio metadata by external ID
   */
  getAudioMetadata?(externalId: string): Promise<AudioMetadata | null>

  /**
   * Search for artists
   */
  searchArtist?(query: string): Promise<SearchResult[]>

  /**
   * Get artist metadata by external ID
   */
  getArtistMetadata?(artistId: string): Promise<ArtistMetadata | null>

  /**
   * Search for albums
   */
  searchAlbum?(query: string, options?: AlbumSearchOptions): Promise<SearchResult[]>

  /**
   * Get album metadata by external ID
   */
  getAlbumMetadata?(albumId: string): Promise<AlbumMetadata | null>
}

export interface VideoSearchOptions {
  /** Filter by year */
  year?: number
  /** Filter by video type */
  videoType?: VideoType
}

export interface AudioSearchOptions {
  /** Filter by artist */
  artist?: string
  /** Filter by album */
  album?: string
}

export interface AlbumSearchOptions {
  /** Filter by artist */
  artist?: string
  /** Filter by year */
  year?: number
}

// ============================================================================
// Plugin Registration
// ============================================================================

/**
 * Function signature for plugin entry point
 * Each scraper package should export a default function matching this signature
 */
export type ScraperPluginFactory = () => ScraperPlugin
