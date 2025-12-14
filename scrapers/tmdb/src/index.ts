import type {
  ScraperPlugin,
  ScraperConfig,
  SearchResult,
  VideoMetadata,
  VideoSearchOptions,
  CreditInfo,
  CreditType,
  VideoType,
  SeriesMetadata,
  SeasonMetadata,
  PersonMetadata,
} from '@tubeca/scraper-types'
import { Agent } from 'undici'

const TMDB_API_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// Custom HTTP agent with longer timeouts and no keepalive
// This helps with WSL2/network issues where long-running processes have stale connections
const httpAgent = new Agent({
  connect: {
    timeout: 30000, // 30 second connect timeout
  },
  bodyTimeout: 30000,
  headersTimeout: 30000,
  keepAliveTimeout: 1000, // Short keepalive to avoid stale connections
  keepAliveMaxTimeout: 5000,
})

// TMDB API response types
interface TMDBSearchResult {
  id: number
  title?: string // Movies
  name?: string // TV shows
  original_title?: string
  original_name?: string
  overview?: string
  release_date?: string // Movies
  first_air_date?: string // TV shows
  poster_path?: string | null
  backdrop_path?: string | null
  media_type?: string
  vote_average?: number
}

interface TMDBSearchResponse {
  page: number
  results: TMDBSearchResult[]
  total_pages: number
  total_results: number
}

interface TMDBMovieDetails {
  id: number
  title: string
  original_title: string
  overview: string
  release_date: string
  runtime: number
  poster_path: string | null
  backdrop_path: string | null
  genres: Array<{ id: number; name: string }>
  vote_average: number
  credits?: {
    cast: TMDBCast[]
    crew: TMDBCrew[]
  }
  release_dates?: {
    results: Array<{
      iso_3166_1: string
      release_dates: Array<{ certification: string }>
    }>
  }
}

interface TMDBTVDetails {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  last_air_date?: string
  status?: string
  episode_run_time: number[]
  poster_path: string | null
  backdrop_path: string | null
  genres: Array<{ id: number; name: string }>
  vote_average: number
  number_of_seasons: number
  number_of_episodes: number
  credits?: {
    cast: TMDBCast[]
    crew: TMDBCrew[]
  }
  content_ratings?: {
    results: Array<{
      iso_3166_1: string
      rating: string
    }>
  }
}

interface TMDBSeason {
  id: number
  name: string
  overview: string
  air_date: string
  season_number: number
  episode_count: number
  poster_path: string | null
}

interface TMDBEpisode {
  id: number
  name: string
  overview: string
  air_date: string
  episode_number: number
  season_number: number
  runtime: number
  still_path: string | null
  vote_average: number
  credits?: {
    cast: TMDBCast[]
    crew: TMDBCrew[]
    guest_stars: TMDBCast[]
  }
}

interface TMDBCast {
  id: number
  name: string
  character: string
  order: number
  profile_path: string | null
}

interface TMDBCrew {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

interface TMDBImage {
  aspect_ratio: number
  height: number
  width: number
  file_path: string
  iso_639_1: string | null
  vote_average: number
  vote_count: number
}

interface TMDBImagesResponse {
  id: number
  backdrops: TMDBImage[]
  logos: TMDBImage[]
  posters: TMDBImage[]
}

interface TMDBPersonDetails {
  id: number
  name: string
  biography: string
  birthday: string | null
  deathday: string | null
  place_of_birth: string | null
  known_for_department: string
  profile_path: string | null
  imdb_id: string | null
}

interface TMDBKeyword {
  id: number
  name: string
}

interface TMDBKeywordsResponse {
  id: number
  keywords?: TMDBKeyword[] // For movies
  results?: TMDBKeyword[] // For TV shows
}

class TMDBScraper implements ScraperPlugin {
  readonly id = 'tmdb'
  readonly name = 'The Movie Database'
  readonly description = 'Scrapes movie and TV metadata from TMDB'
  readonly version = '1.0.0'
  readonly supportedTypes = ['video' as const]

  private apiKey: string | null = null
  private language = 'en-US'
  private imageSize = 'w500'

  async initialize(config: ScraperConfig): Promise<void> {
    this.apiKey = config.apiKey ?? null
    this.language = (config.language as string) ?? 'en-US'
    this.imageSize = (config.imageSize as string) ?? 'w500'
  }

  isConfigured(): boolean {
    return this.apiKey !== null
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('TMDB API key not configured')
    }

    const url = new URL(`${TMDB_API_URL}${endpoint}`)
    url.searchParams.set('api_key', this.apiKey)
    url.searchParams.set('language', this.language)

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const maxRetries = 3
    const baseDelay = 3000 // 3 seconds
    const requestTimeout = 30000 // 30 second timeout per request

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout)

      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          // @ts-expect-error - dispatcher is valid for Node.js fetch but not in types
          dispatcher: httpAgent,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          // Don't retry on client errors (4xx) except rate limiting (429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new Error(`TMDB API error: ${response.status}`)
          }
          // Retry on server errors (5xx) and rate limiting (429)
          throw new Error(`TMDB API error: ${response.status}`)
        }

        return response.json() as Promise<T>
      } catch (error) {
        clearTimeout(timeoutId)

        const isLastAttempt = attempt === maxRetries
        const isRetryable = this.isRetryableError(error)

        if (isLastAttempt || !isRetryable) {
          throw error
        }

        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000
        console.log(`TMDB request failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms...`)
        await this.sleep(delay)
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error('TMDB request failed after all retries')
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // AbortError from AbortController timeout
      if (error.name === 'AbortError') {
        return true
      }

      const message = error.message.toLowerCase()
      // Retry on network errors, timeouts, and server errors
      if (message.includes('fetch failed') ||
          message.includes('timeout') ||
          message.includes('aborted') ||
          message.includes('econnreset') ||
          message.includes('econnrefused') ||
          message.includes('enotfound') ||
          message.includes('socket hang up') ||
          message.includes('network') ||
          message.includes('api error: 5') || // 5xx errors
          message.includes('api error: 429')) { // rate limiting
        return true
      }
      // Check for undici/Node.js fetch error codes
      const cause = (error as { cause?: { code?: string } }).cause
      if (cause?.code?.startsWith('UND_ERR_') || cause?.code?.startsWith('ECONN')) {
        return true
      }
    }
    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private getImageUrl(path: string | null | undefined, size?: string): string | undefined {
    if (!path) return undefined
    return `${TMDB_IMAGE_BASE}/${size ?? this.imageSize}${path}`
  }

  /**
   * Get image URLs from the images endpoint
   * Returns backdrop (highest rated overall), thumbnail (highest rated English backdrop), and logo
   */
  private async getImageUrls(
    type: 'movie' | 'tv',
    id: number,
    fallbackPath: string | null
  ): Promise<{ backdropUrl?: string; thumbnailUrl?: string; logoUrl?: string }> {
    try {
      const images = await this.request<TMDBImagesResponse>(
        `/${type}/${id}/images`,
        { include_image_language: 'en,null' }
      )

      let backdropUrl: string | undefined
      let thumbnailUrl: string | undefined

      if (!images.backdrops || images.backdrops.length === 0) {
        // Fall back to the default backdrop_path from main response
        const fallbackUrl = this.getImageUrl(fallbackPath, 'original')
        backdropUrl = fallbackUrl
        thumbnailUrl = fallbackUrl
      } else {
        // Sort by vote_average descending
        const sortedBackdrops = [...images.backdrops].sort((a, b) => b.vote_average - a.vote_average)

        // Highest rated overall for backdrop
        backdropUrl = this.getImageUrl(sortedBackdrops[0].file_path, 'original')

        // Highest rated English for thumbnail
        const englishBackdrop = sortedBackdrops.find((img) => img.iso_639_1 === 'en')
        thumbnailUrl = englishBackdrop
          ? this.getImageUrl(englishBackdrop.file_path, 'original')
          : backdropUrl // Fall back to highest rated overall if no English
      }

      // Get logo - prefer English, then highest rated
      let logoUrl: string | undefined
      if (images.logos && images.logos.length > 0) {
        const sortedLogos = [...images.logos].sort((a, b) => b.vote_average - a.vote_average)
        const englishLogo = sortedLogos.find((img) => img.iso_639_1 === 'en')
        logoUrl = englishLogo
          ? this.getImageUrl(englishLogo.file_path, 'original')
          : this.getImageUrl(sortedLogos[0].file_path, 'original')
      }

      return { backdropUrl, thumbnailUrl, logoUrl }
    } catch {
      // If images endpoint fails, fall back to backdrop_path
      const fallbackUrl = this.getImageUrl(fallbackPath, 'original')
      return { backdropUrl: fallbackUrl, thumbnailUrl: fallbackUrl, logoUrl: undefined }
    }
  }

  async searchVideo(query: string, options?: VideoSearchOptions): Promise<SearchResult[]> {
    const params: Record<string, string> = { query }
    if (options?.year) {
      params.year = options.year.toString()
    }

    // Determine search type
    let endpoint: string
    if (options?.videoType === 'movie') {
      endpoint = '/search/movie'
    } else if (options?.videoType === 'tv_series' || options?.videoType === 'tv_episode') {
      endpoint = '/search/tv'
    } else {
      // Search both movies and TV
      endpoint = '/search/multi'
    }

    const response = await this.request<TMDBSearchResponse>(endpoint, params)

    return response.results
      .filter((r) => r.media_type !== 'person') // Exclude person results from multi search
      .map((result) => {
        const isMovie = result.media_type === 'movie' || result.title !== undefined
        const title = isMovie ? result.title! : result.name!
        const year = isMovie ? result.release_date : result.first_air_date

        return {
          externalId: `${isMovie ? 'movie' : 'tv'}-${result.id}`,
          title,
          year: year ? parseInt(year.substring(0, 4), 10) : undefined,
          overview: result.overview,
          posterUrl: this.getImageUrl(result.poster_path),
          videoType: (isMovie ? 'movie' : 'tv_series') as VideoType,
          confidence: result.vote_average ? result.vote_average / 10 : undefined,
        }
      })
  }

  async searchSeries(query: string): Promise<SearchResult[]> {
    return this.searchVideo(query, { videoType: 'tv_series' })
  }

  async getVideoMetadata(externalId: string): Promise<VideoMetadata | null> {
    try {
      const [type, id] = externalId.split('-')

      if (type === 'movie') {
        return this.getMovieMetadata(parseInt(id, 10))
      } else if (type === 'tv') {
        return this.getTVMetadata(parseInt(id, 10))
      }

      return null
    } catch {
      return null
    }
  }

  private async getMovieMetadata(movieId: number): Promise<VideoMetadata> {
    const movie = await this.request<TMDBMovieDetails & { keywords?: { keywords: TMDBKeyword[] } }>(
      `/movie/${movieId}`,
      { append_to_response: 'credits,release_dates,keywords' }
    )

    // Get US certification
    const usRating = movie.release_dates?.results
      .find((r) => r.iso_3166_1 === 'US')
      ?.release_dates.find((rd) => rd.certification)?.certification

    const credits = this.mapCredits(movie.credits?.cast ?? [], movie.credits?.crew ?? [])

    // Get images (backdrop, thumbnail, logo)
    const { backdropUrl, thumbnailUrl, logoUrl } = await this.getImageUrls('movie', movieId, movie.backdrop_path)

    // Extract keywords
    const keywords = movie.keywords?.keywords?.map((k) => k.name)

    return {
      externalId: `movie-${movie.id}`,
      title: movie.title,
      originalTitle: movie.original_title !== movie.title ? movie.original_title : undefined,
      description: movie.overview,
      releaseDate: movie.release_date ? new Date(movie.release_date) : undefined,
      rating: usRating,
      voteAverage: movie.vote_average,
      runtime: movie.runtime,
      genres: movie.genres.map((g) => g.name),
      keywords,
      posterUrl: this.getImageUrl(movie.poster_path),
      backdropUrl,
      thumbnailUrl,
      logoUrl,
      credits,
    }
  }

  private async getTVMetadata(tvId: number): Promise<VideoMetadata> {
    const tv = await this.request<TMDBTVDetails>(
      `/tv/${tvId}`,
      { append_to_response: 'credits,content_ratings' }
    )

    // Get US content rating
    const usRating = tv.content_ratings?.results.find((r) => r.iso_3166_1 === 'US')?.rating

    const credits = this.mapCredits(tv.credits?.cast ?? [], tv.credits?.crew ?? [])

    // Get images (backdrop, thumbnail, logo)
    const { backdropUrl, thumbnailUrl, logoUrl } = await this.getImageUrls('tv', tvId, tv.backdrop_path)

    return {
      externalId: `tv-${tv.id}`,
      title: tv.name,
      originalTitle: tv.original_name !== tv.name ? tv.original_name : undefined,
      description: tv.overview,
      releaseDate: tv.first_air_date ? new Date(tv.first_air_date) : undefined,
      rating: usRating,
      runtime: tv.episode_run_time[0], // Average episode runtime
      genres: tv.genres.map((g) => g.name),
      posterUrl: this.getImageUrl(tv.poster_path),
      backdropUrl,
      thumbnailUrl,
      logoUrl,
      showName: tv.name,
      credits,
    }
  }

  async getEpisodeMetadata(
    seriesId: string,
    season: number,
    episode: number
  ): Promise<VideoMetadata | null> {
    try {
      // Remove prefix if present
      const tvId = seriesId.replace('tv-', '')

      // Get series info for show name
      const series = await this.request<TMDBTVDetails>(`/tv/${tvId}`)

      // Get episode details
      const episodeData = await this.request<TMDBEpisode>(
        `/tv/${tvId}/season/${season}/episode/${episode}`,
        { append_to_response: 'credits' }
      )

      // Combine regular cast with guest stars
      const cast = [
        ...(episodeData.credits?.cast ?? []),
        ...(episodeData.credits?.guest_stars ?? []),
      ]
      const credits = this.mapCredits(cast, episodeData.credits?.crew ?? [])

      return {
        externalId: `episode-${episodeData.id}`,
        title: episodeData.name,
        description: episodeData.overview,
        releaseDate: episodeData.air_date ? new Date(episodeData.air_date) : undefined,
        runtime: episodeData.runtime,
        posterUrl: this.getImageUrl(episodeData.still_path),
        showName: series.name,
        season: episodeData.season_number,
        episode: episodeData.episode_number,
        episodeTitle: episodeData.name,
        credits,
      }
    } catch {
      return null
    }
  }

  async getSeriesMetadata(seriesId: string): Promise<SeriesMetadata | null> {
    try {
      // Remove prefix if present
      const tvId = parseInt(seriesId.replace('tv-', ''), 10)

      const tv = await this.request<TMDBTVDetails & { keywords?: { results: TMDBKeyword[] } }>(
        `/tv/${tvId}`,
        { append_to_response: 'credits,content_ratings,keywords' }
      )

      const credits = this.mapCredits(tv.credits?.cast ?? [], tv.credits?.crew ?? [])

      // Get images (backdrop, thumbnail, logo)
      const { backdropUrl, thumbnailUrl, logoUrl } = await this.getImageUrls('tv', tvId, tv.backdrop_path)

      // Extract keywords (TV uses 'results' instead of 'keywords')
      const keywords = tv.keywords?.results?.map((k) => k.name)

      return {
        externalId: `tv-${tv.id}`,
        title: tv.name,
        originalTitle: tv.original_name !== tv.name ? tv.original_name : undefined,
        description: tv.overview,
        firstAirDate: tv.first_air_date ? new Date(tv.first_air_date) : undefined,
        lastAirDate: tv.last_air_date ? new Date(tv.last_air_date) : undefined,
        status: tv.status,
        rating: tv.vote_average,
        genres: tv.genres.map((g) => g.name),
        keywords,
        posterUrl: this.getImageUrl(tv.poster_path),
        backdropUrl,
        thumbnailUrl,
        logoUrl,
        seasonCount: tv.number_of_seasons,
        credits,
      }
    } catch {
      return null
    }
  }

  async getSeasonMetadata(seriesId: string, seasonNumber: number): Promise<SeasonMetadata | null> {
    try {
      // Remove prefix if present
      const tvId = seriesId.replace('tv-', '')

      const season = await this.request<TMDBSeason>(`/tv/${tvId}/season/${seasonNumber}`)

      return {
        externalId: `season-${season.id}`,
        seasonNumber: season.season_number,
        name: season.name !== `Season ${season.season_number}` ? season.name : undefined,
        description: season.overview || undefined,
        airDate: season.air_date ? new Date(season.air_date) : undefined,
        posterUrl: this.getImageUrl(season.poster_path),
        episodeCount: season.episode_count,
      }
    } catch {
      return null
    }
  }

  private mapCredits(cast: TMDBCast[], crew: TMDBCrew[]): CreditInfo[] {
    const credits: CreditInfo[] = []

    // Add cast members
    for (const person of cast.slice(0, 20)) { // Limit to top 20 cast
      credits.push({
        name: person.name,
        role: person.character,
        type: 'actor',
        order: person.order,
        photoUrl: this.getImageUrl(person.profile_path, 'w185'),
        tmdbId: person.id,
      })
    }

    // Add key crew members
    const importantJobs: Record<string, CreditType> = {
      Director: 'director',
      Writer: 'writer',
      Screenplay: 'writer',
      Producer: 'producer',
      'Executive Producer': 'producer',
      'Original Music Composer': 'composer',
      'Director of Photography': 'cinematographer',
      Editor: 'editor',
    }

    for (const person of crew) {
      const creditType = importantJobs[person.job]
      if (creditType) {
        // Check if this person is already added with this role
        const exists = credits.some(
          (c) => c.name === person.name && c.type === creditType
        )
        if (!exists) {
          credits.push({
            name: person.name,
            role: person.job,
            type: creditType,
            photoUrl: this.getImageUrl(person.profile_path, 'w185'),
            tmdbId: person.id,
          })
        }
      }
    }

    return credits
  }

  async getPersonMetadata(personId: string): Promise<PersonMetadata | null> {
    try {
      // Remove 'tmdb-' prefix if present
      const tmdbId = parseInt(personId.replace('tmdb-', ''), 10)

      const person = await this.request<TMDBPersonDetails>(`/person/${tmdbId}`)

      return {
        externalId: `tmdb-${person.id}`,
        name: person.name,
        biography: person.biography || undefined,
        birthDate: person.birthday || undefined,
        deathDate: person.deathday || undefined,
        birthPlace: person.place_of_birth || undefined,
        knownFor: person.known_for_department || undefined,
        photoUrl: this.getImageUrl(person.profile_path, 'w500'),
        tmdbId: person.id,
        imdbId: person.imdb_id || undefined,
      }
    } catch {
      return null
    }
  }
}

/**
 * Factory function - default export for plugin discovery
 */
export default function createPlugin(): ScraperPlugin {
  return new TMDBScraper()
}

export { TMDBScraper }
