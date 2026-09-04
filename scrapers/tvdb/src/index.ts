import type {
  ScraperPlugin,
  ScraperConfig,
  SearchResult,
  SeasonMetadata,
  SeriesMetadata,
  VideoMetadata,
  VideoSearchOptions,
  CreditInfo,
  CreditType,
  PersonMetadata,
} from '@tubeca/scraper-types'

const TVDB_API_URL = 'https://api4.thetvdb.com/v4'

interface TVDBAuthResponse {
  status: string
  data: {
    token: string
  }
}

interface TVDBSearchResult {
  objectID: string
  name: string
  year?: string
  overview?: string
  image_url?: string
  type: string
}

interface TVDBSearchResponse {
  status: string
  data: TVDBSearchResult[]
}

interface TVDBSeries {
  id: number
  name: string
  originalName?: string
  overview?: string
  firstAired?: string
  lastAired?: string
  /** v4 returns a record, not a string. */
  status?: { name?: string }
  score?: number
  image?: string
  artworks?: Array<{ image: string; type: number }>
  genres?: Array<{ name: string }>
  contentRatings?: Array<{ name: string; country: string }>
  /** Free-form tags; the display value is `name`. */
  tags?: Array<{ name?: string; tagName?: string }>
  seasons?: TVDBSeasonSummary[]
}

/** A season as it appears in the series' own record. */
interface TVDBSeasonSummary {
  id: number
  number: number
  image?: string
  type?: { type?: string }
}

/**
 * A season's own record. v4 keeps the name and overview in translations
 * rather than on the record, so both are optional here and fetched
 * separately when they are missing.
 */
interface TVDBSeasonExtended extends TVDBSeasonSummary {
  seriesId?: number
  name?: string
  overview?: string
  episodes?: TVDBEpisode[]
}

interface TVDBSeasonResponse {
  status: string
  data: TVDBSeasonExtended
}

interface TVDBTranslationResponse {
  status: string
  data: { name?: string; overview?: string }
}

interface TVDBEpisode {
  id: number
  name: string
  overview?: string
  aired?: string
  seasonNumber: number
  number: number
  runtime?: number
  image?: string
}

interface TVDBCharacter {
  id: number
  name: string
  peopleId: number
  personName: string
  image?: string
  sort?: number
  type: number // 3 = Actor, 1 = Director, etc.
}

interface TVDBSeriesExtendedResponse {
  status: string
  data: TVDBSeries & {
    characters?: TVDBCharacter[]
  }
}

interface TVDBEpisodeResponse {
  status: string
  data: TVDBEpisode
}

interface TVDBSeriesEpisodesResponse {
  status: string
  data: {
    series: TVDBSeries
    episodes: TVDBEpisode[]
  }
}

interface TVDBPerson {
  id: number
  name: string
  image?: string
  birth?: string
  death?: string
  birthPlace?: string
  biographies?: Array<{ biography: string; language: string }>
}

interface TVDBPersonResponse {
  status: string
  data: TVDBPerson
}

const REQUEST_TIMEOUT_MS = 10000
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Worth another attempt: a timeout, a dropped connection, a 5xx or a rate limit. */
function isRetryable(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('fetch failed') || message.includes('socket hang up')) return true
  const status = message.match(/tvdb api error: (\d{3})/)?.[1]
  return status ? status.startsWith('5') || status === '429' : false
}

/** Artwork ids TVDB uses on a series record. */
const ARTWORK_POSTER = 2
const ARTWORK_BACKDROP = 3
const ARTWORK_LOGO = 6

/** The first artwork of each kind the series carries. */
function pickArtwork(series: TVDBSeries): {
  poster?: string
  backdrop?: string
  logo?: string
} {
  const of = (type: number) => series.artworks?.find((a) => a.type === type)?.image
  return { poster: of(ARTWORK_POSTER), backdrop: of(ARTWORK_BACKDROP), logo: of(ARTWORK_LOGO) }
}

/**
 * The seasons in aired order.
 *
 * A show also carries DVD, absolute and regional orderings; mixing them in
 * would give a season number two records. A record with no type at all is
 * kept, since older entries predate the field.
 */
function officialSeasons(series: TVDBSeries): TVDBSeasonSummary[] {
  const seasons = series.seasons ?? []
  const official = seasons.filter((s) => s.type?.type === 'official')
  return official.length > 0 ? official : seasons.filter((s) => !s.type?.type)
}

class TVDBScraper implements ScraperPlugin {
  readonly id = 'tvdb'
  readonly name = 'TheTVDB'
  readonly description = 'Scrapes TV series and episode metadata from TheTVDB'
  readonly version = '1.0.0'
  readonly supportedTypes = ['video' as const]

  private apiKey: string | null = null
  private token: string | null = null
  private tokenExpiry: Date | null = null
  private language = 'eng'

  async initialize(config: ScraperConfig): Promise<void> {
    this.apiKey = config.apiKey ?? null
    this.language = (config.language as string) ?? 'eng'

    if (this.apiKey) {
      await this.authenticate()
    }
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.token !== null
  }

  private async authenticate(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('TVDB API key not configured')
    }

    const response = await fetch(`${TVDB_API_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apikey: this.apiKey }),
    })

    if (!response.ok) {
      throw new Error(`TVDB authentication failed: ${response.status}`)
    }

    const data = (await response.json()) as TVDBAuthResponse
    this.token = data.data.token
    // Token expires in 30 days, refresh after 29
    this.tokenExpiry = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000)
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token || (this.tokenExpiry && new Date() > this.tokenExpiry)) {
      await this.authenticate()
    }
  }

  private async request<T>(endpoint: string): Promise<T> {
    await this.ensureAuthenticated()

    // A scrape worker takes one job at a time, so a request with no deadline
    // stops every other job behind it. Server errors and rate limits are
    // worth another try; a 4xx is an answer.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(`${TVDB_API_URL}${endpoint}`, {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Accept-Language': this.language,
          },
        })

        if (!response.ok) {
          throw new Error(`TVDB API error: ${response.status}`)
        }

        return (await response.json()) as T
      } catch (error) {
        if (attempt === MAX_ATTEMPTS || !isRetryable(error)) {
          throw error
        }
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 1000)
      } finally {
        clearTimeout(timeout)
      }
    }

    // Unreachable: the loop either returns or throws on its last attempt.
    throw new Error('TVDB request failed')
  }

  async searchVideo(query: string, options?: VideoSearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ query, type: 'series' })
    if (options?.year) {
      params.set('year', options.year.toString())
    }

    const response = await this.request<TVDBSearchResponse>(`/search?${params}`)

    return response.data.map((result) => ({
      externalId: result.objectID,
      title: result.name,
      year: result.year ? parseInt(result.year, 10) : undefined,
      overview: result.overview,
      posterUrl: result.image_url,
      videoType: 'tv_series' as const,
    }))
  }

  async searchSeries(query: string): Promise<SearchResult[]> {
    return this.searchVideo(query, { videoType: 'tv_series' })
  }

  async getVideoMetadata(externalId: string): Promise<VideoMetadata | null> {
    try {
      // Extract numeric ID from "series-12345" format
      const seriesId = externalId.replace('series-', '')

      const response = await this.request<TVDBSeriesExtendedResponse>(
        `/series/${seriesId}/extended?meta=translations`
      )

      const series = response.data
      const credits = this.mapCharactersToCredits(series.characters ?? [])

      const { poster, backdrop, logo } = pickArtwork(series)

      return {
        externalId,
        title: series.name,
        originalTitle: series.originalName,
        description: series.overview,
        releaseDate: series.firstAired ? new Date(series.firstAired) : undefined,
        rating: series.contentRatings?.find((r) => r.country === 'usa')?.name,
        genres: series.genres?.map((g) => g.name),
        posterUrl: poster ?? series.image,
        backdropUrl: backdrop,
        logoUrl: logo,
        credits,
      }
    } catch {
      return null
    }
  }

  /**
   * A show's own record, for a Show collection.
   *
   * The same `/series/{id}/extended` call the video form uses; this shape
   * keeps the fields a collection cares about (when it ran, whether it has
   * ended, how many seasons) rather than the ones an item cares about.
   */
  async getSeriesMetadata(seriesId: string): Promise<SeriesMetadata | null> {
    try {
      const id = seriesId.replace('series-', '')
      const response = await this.request<TVDBSeriesExtendedResponse>(
        `/series/${id}/extended?meta=translations`
      )
      const series = response.data
      const { poster, backdrop, logo } = pickArtwork(series)

      return {
        externalId: `series-${series.id}`,
        title: series.name,
        originalTitle: series.originalName !== series.name ? series.originalName : undefined,
        description: series.overview,
        firstAirDate: series.firstAired ? new Date(series.firstAired) : undefined,
        lastAirDate: series.lastAired ? new Date(series.lastAired) : undefined,
        status: series.status?.name,
        rating: series.score,
        genres: series.genres?.map((g) => g.name),
        keywords: series.tags?.map((t) => t.name ?? t.tagName).filter((t): t is string => Boolean(t)),
        posterUrl: poster ?? series.image,
        backdropUrl: backdrop,
        logoUrl: logo,
        // Specials and alternative orderings are seasons too; only the aired
        // order counts towards the number a viewer would recognise.
        seasonCount: officialSeasons(series).filter((s) => s.number > 0).length,
        credits: this.mapCharactersToCredits(series.characters ?? []),
      }
    } catch {
      return null
    }
  }

  /**
   * One season of a show.
   *
   * Seasons are addressed by their own id, which only the series record
   * knows, so this resolves the number to an id first. The name and the
   * overview live in translations rather than on the record, and are fetched
   * only when the record does not carry them.
   */
  async getSeasonMetadata(seriesId: string, seasonNumber: number): Promise<SeasonMetadata | null> {
    try {
      const id = seriesId.replace('series-', '')
      const series = await this.request<TVDBSeriesExtendedResponse>(`/series/${id}/extended`)

      const summary = officialSeasons(series.data).find((s) => s.number === seasonNumber)
      if (!summary) {
        return null
      }

      const season = (await this.request<TVDBSeasonResponse>(`/seasons/${summary.id}/extended`)).data
      const { name, overview } = await this.seasonText(season)

      const episodes = season.episodes ?? []
      const firstAired = episodes
        .map((e) => e.aired)
        .filter((a): a is string => Boolean(a))
        .sort()[0]

      return {
        externalId: `season-${season.id}`,
        seasonNumber: season.number,
        // "Season 1" tells a viewer nothing they cannot see already.
        name: name && name !== `Season ${season.number}` ? name : undefined,
        description: overview || undefined,
        airDate: firstAired ? new Date(firstAired) : undefined,
        posterUrl: season.image ?? summary.image,
        episodeCount: episodes.length,
      }
    } catch {
      return null
    }
  }

  /** The season's name and overview, from the record or from its translation. */
  private async seasonText(
    season: TVDBSeasonExtended
  ): Promise<{ name?: string; overview?: string }> {
    if (season.name || season.overview) {
      return { name: season.name, overview: season.overview }
    }
    try {
      const translation = await this.request<TVDBTranslationResponse>(
        `/seasons/${season.id}/translations/${this.language}`
      )
      return { name: translation.data.name, overview: translation.data.overview }
    } catch {
      // A season with no translation in this language is still a season.
      return {}
    }
  }

  async getEpisodeMetadata(
    seriesId: string,
    season: number,
    episode: number
  ): Promise<VideoMetadata | null> {
    try {
      // Remove prefix if present
      const numericSeriesId = seriesId.replace('series-', '')

      // Get series info with episodes
      const response = await this.request<TVDBSeriesEpisodesResponse>(
        `/series/${numericSeriesId}/episodes/default?season=${season}`
      )

      const series = response.data.series
      const episodeData = response.data.episodes.find(
        (e) => e.seasonNumber === season && e.number === episode
      )

      if (!episodeData) {
        return null
      }

      // Get extended episode info if available
      let credits: CreditInfo[] = []
      try {
        const episodeExtended = await this.request<{
          status: string
          data: TVDBEpisode & { characters?: TVDBCharacter[] }
        }>(`/episodes/${episodeData.id}/extended`)

        credits = this.mapCharactersToCredits(episodeExtended.data.characters ?? [])
      } catch {
        // Episode extended info not available, continue without credits
      }

      return {
        externalId: `episode-${episodeData.id}`,
        title: episodeData.name,
        description: episodeData.overview,
        releaseDate: episodeData.aired ? new Date(episodeData.aired) : undefined,
        runtime: episodeData.runtime,
        posterUrl: episodeData.image,
        showName: series.name,
        season: episodeData.seasonNumber,
        episode: episodeData.number,
        episodeTitle: episodeData.name,
        credits,
      }
    } catch {
      return null
    }
  }

  private mapCharactersToCredits(characters: TVDBCharacter[]): CreditInfo[] {
    return characters
      .map((char) => {
        let type: CreditType
        switch (char.type) {
          case 1:
            type = 'director'
            break
          case 2:
            type = 'writer'
            break
          case 3:
            type = 'actor'
            break
          case 4:
            type = 'producer'
            break
          default:
            type = 'actor'
        }

        return {
          name: char.personName,
          role: char.name, // Character name for actors
          type,
          order: char.sort,
          photoUrl: char.image,
          tvdbId: char.peopleId,
        }
      })
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
  }

  async getPersonMetadata(personId: string): Promise<PersonMetadata | null> {
    try {
      // Remove 'tvdb-' prefix if present
      const tvdbId = parseInt(personId.replace('tvdb-', ''), 10)

      const response = await this.request<TVDBPersonResponse>(`/people/${tvdbId}/extended`)
      const person = response.data

      // Find English biography
      const englishBio = person.biographies?.find((b) => b.language === 'eng')

      return {
        externalId: `tvdb-${person.id}`,
        name: person.name,
        biography: englishBio?.biography || undefined,
        birthDate: person.birth || undefined,
        deathDate: person.death || undefined,
        birthPlace: person.birthPlace || undefined,
        photoUrl: person.image || undefined,
        tvdbId: person.id,
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
  return new TVDBScraper()
}

export { TVDBScraper }
