import type {
  SearchResult,
  VideoMetadata,
  AudioMetadata,
  VideoSearchOptions,
  AudioSearchOptions,
} from '@tubeca/scraper-types'
import { scraperManager } from '../plugins/scraperLoader'
import { prisma } from '../config/database'

/**
 * Service for scraping and applying metadata to media items
 */
export class ScraperService {
  /**
   * Search for video metadata across all configured scrapers
   */
  async searchVideo(
    query: string,
    options?: VideoSearchOptions
  ): Promise<Array<SearchResult & { scraperId: string }>> {
    const results: Array<SearchResult & { scraperId: string }> = []
    const scrapers = scraperManager.getByMediaType('video').filter((s) => s.isConfigured())

    for (const scraper of scrapers) {
      if (scraper.searchVideo) {
        try {
          const scraperResults = await scraper.searchVideo(query, options)
          results.push(...scraperResults.map((r) => ({ ...r, scraperId: scraper.id })))
        } catch (error) {
          console.error(`Search failed for scraper ${scraper.id}:`, error)
        }
      }
    }

    // Sort by confidence if available
    return results.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  }

  /**
   * Search for TV series
   */
  async searchSeries(query: string): Promise<Array<SearchResult & { scraperId: string }>> {
    const results: Array<SearchResult & { scraperId: string }> = []
    const scrapers = scraperManager.getByMediaType('video').filter((s) => s.isConfigured())

    for (const scraper of scrapers) {
      if (scraper.searchSeries) {
        try {
          const scraperResults = await scraper.searchSeries(query)
          results.push(...scraperResults.map((r) => ({ ...r, scraperId: scraper.id })))
        } catch (error) {
          console.error(`Series search failed for scraper ${scraper.id}:`, error)
        }
      }
    }

    return results
  }

  /**
   * Get detailed video metadata from a specific scraper
   */
  async getVideoMetadata(
    scraperId: string,
    externalId: string
  ): Promise<VideoMetadata | null> {
    const scraper = scraperManager.get(scraperId)
    if (!scraper || !scraper.getVideoMetadata) {
      return null
    }

    return scraper.getVideoMetadata(externalId)
  }

  /**
   * Get episode metadata from a specific scraper
   */
  async getEpisodeMetadata(
    scraperId: string,
    seriesId: string,
    season: number,
    episode: number
  ): Promise<VideoMetadata | null> {
    const scraper = scraperManager.get(scraperId)
    if (!scraper || !scraper.getEpisodeMetadata) {
      return null
    }

    return scraper.getEpisodeMetadata(seriesId, season, episode)
  }

  /**
   * Search for audio metadata across all configured scrapers
   */
  async searchAudio(
    query: string,
    options?: AudioSearchOptions
  ): Promise<Array<SearchResult & { scraperId: string }>> {
    const results: Array<SearchResult & { scraperId: string }> = []
    const scrapers = scraperManager.getByMediaType('audio').filter((s) => s.isConfigured())

    for (const scraper of scrapers) {
      if (scraper.searchAudio) {
        try {
          const scraperResults = await scraper.searchAudio(query, options)
          results.push(...scraperResults.map((r) => ({ ...r, scraperId: scraper.id })))
        } catch (error) {
          console.error(`Audio search failed for scraper ${scraper.id}:`, error)
        }
      }
    }

    return results
  }

  /**
   * Get detailed audio metadata from a specific scraper
   */
  async getAudioMetadata(
    scraperId: string,
    externalId: string
  ): Promise<AudioMetadata | null> {
    const scraper = scraperManager.get(scraperId)
    if (!scraper || !scraper.getAudioMetadata) {
      return null
    }

    return scraper.getAudioMetadata(externalId)
  }

  /**
   * Apply video metadata to a media item
   */
  async applyVideoMetadata(mediaId: string, metadata: VideoMetadata): Promise<void> {
    // Create or update VideoDetails
    await prisma.videoDetails.upsert({
      where: { mediaId },
      create: {
        mediaId,
        showName: metadata.showName,
        season: metadata.season,
        episode: metadata.episode,
        description: metadata.description,
        releaseDate: metadata.releaseDate,
        rating: metadata.rating,
      },
      update: {
        showName: metadata.showName,
        season: metadata.season,
        episode: metadata.episode,
        description: metadata.description,
        releaseDate: metadata.releaseDate,
        rating: metadata.rating,
      },
    })

    // Update media name if we have episode info
    if (metadata.episodeTitle) {
      await prisma.media.update({
        where: { id: mediaId },
        data: { name: metadata.episodeTitle },
      })
    }

    // Add credits if available
    if (metadata.credits && metadata.credits.length > 0) {
      const videoDetails = await prisma.videoDetails.findUnique({
        where: { mediaId },
      })

      if (videoDetails) {
        // Clear existing credits
        await prisma.credit.deleteMany({
          where: { videoDetailsId: videoDetails.id },
        })

        // Add new credits
        await prisma.credit.createMany({
          data: metadata.credits.map((credit) => ({
            videoDetailsId: videoDetails.id,
            name: credit.name,
            role: credit.role,
            creditType: this.mapCreditType(credit.type),
            order: credit.order,
          })),
        })
      }
    }
  }

  /**
   * Apply audio metadata to a media item
   */
  async applyAudioMetadata(mediaId: string, metadata: AudioMetadata): Promise<void> {
    // Create or update AudioDetails
    await prisma.audioDetails.upsert({
      where: { mediaId },
      create: {
        mediaId,
        artist: metadata.artist,
        albumArtist: metadata.albumArtist,
        album: metadata.album,
        track: metadata.track,
        disc: metadata.disc,
        year: metadata.year,
        genre: metadata.genre,
      },
      update: {
        artist: metadata.artist,
        albumArtist: metadata.albumArtist,
        album: metadata.album,
        track: metadata.track,
        disc: metadata.disc,
        year: metadata.year,
        genre: metadata.genre,
      },
    })

    // Update media name if we have a title
    if (metadata.title) {
      await prisma.media.update({
        where: { id: mediaId },
        data: { name: metadata.title },
      })
    }
  }

  /**
   * Map scraper credit type to Prisma CreditType enum
   */
  private mapCreditType(
    type: string
  ): 'Actor' | 'Director' | 'Writer' | 'Producer' | 'Composer' | 'Cinematographer' | 'Editor' {
    const mapping: Record<string, 'Actor' | 'Director' | 'Writer' | 'Producer' | 'Composer' | 'Cinematographer' | 'Editor'> = {
      actor: 'Actor',
      director: 'Director',
      writer: 'Writer',
      producer: 'Producer',
      composer: 'Composer',
      cinematographer: 'Cinematographer',
      editor: 'Editor',
    }
    return mapping[type] ?? 'Actor'
  }

  /**
   * Get list of available scrapers
   */
  listScrapers() {
    return scraperManager.list()
  }
}
