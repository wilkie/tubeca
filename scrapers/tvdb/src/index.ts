import type {
  ScraperPlugin,
  ScraperConfig,
  SearchResult,
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
  image?: string
  artworks?: Array<{ image: string; type: number }>
  genres?: Array<{ name: string }>
  contentRatings?: Array<{ name: string; country: string }>
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

    const response = await fetch(`${TVDB_API_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Accept-Language': this.language,
      },
    })

    if (!response.ok) {
      throw new Error(`TVDB API error: ${response.status}`)
    }

    return response.json() as Promise<T>
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

      // Find artwork by type: poster (2), backdrop (3), logo (6)
      const backdrop = series.artworks?.find((a) => a.type === 3)
      const poster = series.artworks?.find((a) => a.type === 2)
      const logo = series.artworks?.find((a) => a.type === 6)

      return {
        externalId,
        title: series.name,
        originalTitle: series.originalName,
        description: series.overview,
        releaseDate: series.firstAired ? new Date(series.firstAired) : undefined,
        rating: series.contentRatings?.find((r) => r.country === 'usa')?.name,
        genres: series.genres?.map((g) => g.name),
        posterUrl: poster?.image ?? series.image,
        backdropUrl: backdrop?.image,
        logoUrl: logo?.image,
        credits,
      }
    } catch {
      return null
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
