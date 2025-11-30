import { Worker, Job } from 'bullmq'
import { redisConnection } from '../config/redis'
import { prisma } from '../config/database'
import { scraperManager } from '../plugins/scraperLoader'
import { ImageService } from '../services/imageService'
import { PersonService } from '../services/personService'
import { addMetadataScrapeJob } from '../queues/metadataScrapeQueue'
import type { CollectionScrapeJobData } from '../queues/collectionScrapeQueue'
import type { SeriesMetadata, SeasonMetadata, VideoMetadata } from '@tubeca/scraper-types'

const imageService = new ImageService()
const personService = new PersonService()

interface ScrapeResult {
  success: boolean
  scraperId?: string
  externalId?: string
  error?: string
}

// Worker with rate limiting - process 1 job at a time with delays
export const collectionScrapeWorker = new Worker<CollectionScrapeJobData, ScrapeResult>(
  'collection-scrape',
  async (job: Job<CollectionScrapeJobData>) => {
    const { collectionId, collectionName, collectionType } = job.data

    console.log(`🔍 Scraping collection metadata for: ${collectionName} (${collectionType})`)

    try {
      // Verify collection still exists
      const collection = await prisma.collection.findUnique({
        where: { id: collectionId },
      })

      if (!collection) {
        return { success: false, error: 'Collection not found' }
      }

      switch (collectionType) {
        case 'Show':
          return await scrapeShowMetadata(job)
        case 'Season':
          return await scrapeSeasonMetadata(job)
        case 'Film':
          return await scrapeFilmMetadata(job)
        case 'Artist':
          return await scrapeArtistMetadata(job)
        case 'Album':
          return await scrapeAlbumMetadata(job)
        default:
          return { success: false, error: `Unsupported collection type: ${collectionType}` }
      }
    } catch (error) {
      console.error(`❌ Collection scrape failed for ${collectionName}:`, error)
      throw error
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: {
      max: 10,
      duration: 10000,
    },
  }
)

async function scrapeShowMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeResult> {
  const { collectionId, collectionName, scraperId, externalId, skipImages, imagesOnly } = job.data

  // If we have an external ID, fetch directly
  if (externalId && scraperId) {
    const scraper = scraperManager.get(scraperId)
    if (scraper?.getSeriesMetadata) {
      const metadata = await scraper.getSeriesMetadata(externalId)
      if (metadata) {
        await applyShowMetadata(collectionId, metadata, scraperId, skipImages, imagesOnly)
        return { success: true, scraperId, externalId }
      }
    }
  }

  // Get configured video scrapers
  const scrapers = scraperId
    ? [scraperManager.get(scraperId)].filter(Boolean)
    : scraperManager.getByMediaType('video').filter((s) => s.isConfigured())

  if (scrapers.length === 0) {
    return { success: false, error: 'No video scrapers configured' }
  }

  // Try to find a match
  for (const scraper of scrapers) {
    if (!scraper?.searchSeries || !scraper?.getSeriesMetadata) continue

    try {
      const searchResults = await scraper.searchSeries(collectionName)

      if (searchResults.length > 0) {
        const bestMatch = searchResults[0]
        const metadata = await scraper.getSeriesMetadata(bestMatch.externalId)

        if (metadata) {
          await applyShowMetadata(collectionId, metadata, scraper.id, skipImages, imagesOnly)
          console.log(`✅ Found show metadata for ${collectionName} via ${scraper.name}`)
          return { success: true, scraperId: scraper.id, externalId: metadata.externalId }
        }
      }
    } catch (error) {
      console.warn(`Scraper ${scraper.id} failed for show ${collectionName}:`, error)
    }
  }

  return { success: false, error: 'No metadata found from any scraper' }
}

async function scrapeSeasonMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeResult> {
  const { collectionId, collectionName, parentShowId, seasonNumber, skipImages, imagesOnly } = job.data
  let { parentExternalId, parentScraperId } = job.data

  // If we don't have parent info from the job, look it up from the database
  if ((!parentExternalId || !parentScraperId) && parentShowId) {
    const parentShowDetails = await prisma.showDetails.findUnique({
      where: { collectionId: parentShowId },
    })
    if (parentShowDetails?.externalId && parentShowDetails?.scraperId) {
      parentExternalId = parentShowDetails.externalId
      parentScraperId = parentShowDetails.scraperId
    }
  }

  if (!parentExternalId || !parentScraperId || seasonNumber === undefined) {
    return { success: false, error: 'Missing parent show info for season scrape' }
  }

  const scraper = scraperManager.get(parentScraperId)
  if (!scraper?.getSeasonMetadata) {
    return { success: false, error: 'Scraper does not support season metadata' }
  }

  try {
    const metadata = await scraper.getSeasonMetadata(parentExternalId, seasonNumber)

    if (metadata) {
      await applySeasonMetadata(collectionId, metadata, parentScraperId, skipImages, imagesOnly)
      console.log(`✅ Found season metadata for ${collectionName} via ${scraper.name}`)
      return { success: true, scraperId: parentScraperId, externalId: metadata.externalId }
    }
  } catch (error) {
    console.warn(`Failed to get season metadata for ${collectionName}:`, error)
  }

  return { success: false, error: 'No season metadata found' }
}

async function scrapeFilmMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeResult> {
  const { collectionId, collectionName, year, scraperId, externalId, skipImages, imagesOnly } = job.data

  // If we have an external ID, fetch directly
  if (externalId && scraperId) {
    const scraper = scraperManager.get(scraperId)
    if (scraper?.getVideoMetadata) {
      const metadata = await scraper.getVideoMetadata(externalId)
      if (metadata) {
        await applyFilmMetadata(collectionId, metadata, scraperId, skipImages, imagesOnly)
        return { success: true, scraperId, externalId }
      }
    }
  }

  // Get configured video scrapers
  const scrapers = scraperId
    ? [scraperManager.get(scraperId)].filter(Boolean)
    : scraperManager.getByMediaType('video').filter((s) => s.isConfigured())

  if (scrapers.length === 0) {
    return { success: false, error: 'No video scrapers configured' }
  }

  // Parse the movie title from the collection name (remove year if present)
  const titleMatch = collectionName.match(/^(.+?)\s*\(?\d{4}\)?$/)
  const searchTitle = titleMatch ? titleMatch[1].trim() : collectionName

  // Try to find a match
  for (const scraper of scrapers) {
    if (!scraper?.searchVideo || !scraper?.getVideoMetadata) continue

    try {
      const searchResults = await scraper.searchVideo(searchTitle, {
        year,
        videoType: 'movie',
      })

      if (searchResults.length > 0) {
        const bestMatch = searchResults[0]
        const metadata = await scraper.getVideoMetadata(bestMatch.externalId)

        if (metadata) {
          await applyFilmMetadata(collectionId, metadata, scraper.id, skipImages, imagesOnly)
          console.log(`✅ Found film metadata for ${collectionName} via ${scraper.name}`)
          return { success: true, scraperId: scraper.id, externalId: metadata.externalId }
        }
      }
    } catch (error) {
      console.warn(`Scraper ${scraper.id} failed for film ${collectionName}:`, error)
    }
  }

  return { success: false, error: 'No metadata found from any scraper' }
}

async function scrapeArtistMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeResult> {
  const { collectionName } = job.data
  // TODO: Implement when music scrapers are available
  console.log(`⏭️ Artist scraping not yet implemented for: ${collectionName}`)
  return { success: false, error: 'Artist scraping not yet implemented' }
}

async function scrapeAlbumMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeResult> {
  const { collectionName } = job.data
  // TODO: Implement when music scrapers are available
  console.log(`⏭️ Album scraping not yet implemented for: ${collectionName}`)
  return { success: false, error: 'Album scraping not yet implemented' }
}

/**
 * Apply show metadata to the database
 */
async function applyShowMetadata(
  collectionId: string,
  metadata: SeriesMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadCollectionImages(collectionId, metadata, scraperId)
    console.log(`📷 Refreshed images for show collection ${collectionId}`)
    return
  }

  // Upsert ShowDetails
  const showDetails = await prisma.showDetails.upsert({
    where: { collectionId },
    create: {
      collectionId,
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.firstAirDate,
      endDate: metadata.lastAirDate,
      status: metadata.status,
      rating: metadata.rating,
      genres: metadata.genres?.join(', '),
    },
    update: {
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.firstAirDate,
      endDate: metadata.lastAirDate,
      status: metadata.status,
      rating: metadata.rating,
      genres: metadata.genres?.join(', '),
    },
  })

  // Download images for collection (unless skipImages is set and collection already has images)
  if (!skipImages) {
    await downloadCollectionImages(collectionId, metadata, scraperId)
  } else {
    // Even with skipImages, download if collection has no images yet
    const existingImages = await prisma.image.count({ where: { collectionId } })
    if (existingImages === 0) {
      await downloadCollectionImages(collectionId, metadata, scraperId)
    }
  }

  // Add credits if available
  if (metadata.credits && metadata.credits.length > 0) {
    // Clear existing credits
    await prisma.showCredit.deleteMany({
      where: { showDetailsId: showDetails.id },
    })

    // Add new credits
    for (const credit of metadata.credits) {
      // Find or create person for this credit
      let personId: string | undefined
      try {
        const person = await personService.findOrCreatePerson({
          name: credit.name,
          type: credit.type,
          tmdbId: credit.tmdbId,
          tvdbId: credit.tvdbId,
          imdbId: credit.imdbId,
        })
        personId = person.id
      } catch (error) {
        console.warn(`Failed to link person for ${credit.name}:`, error)
      }

      await prisma.showCredit.create({
        data: {
          showDetailsId: showDetails.id,
          name: credit.name,
          role: credit.role,
          creditType: mapCreditType(credit.type),
          order: credit.order,
          personId,
        },
      })

      // Download credit photo to person if available and person doesn't have one yet
      if (credit.photoUrl && personId) {
        try {
          // Check if person already has a photo
          const existingPhoto = await prisma.image.findFirst({
            where: { personId, imageType: 'Photo', isPrimary: true },
          })
          if (!existingPhoto) {
            await imageService.downloadAndSaveImage(credit.photoUrl, {
              imageType: 'Photo',
              personId,
              isPrimary: true,
              scraperId,
            })
            console.log(`📷 Downloaded photo for ${credit.name}`)
          }
        } catch (error) {
          console.warn(`Failed to download photo for ${credit.name}:`, error)
        }
      }
    }
  }
}

/**
 * Apply season metadata to the database
 */
async function applySeasonMetadata(
  collectionId: string,
  metadata: SeasonMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    if (metadata.posterUrl) {
      try {
        await imageService.downloadAndSaveImage(metadata.posterUrl, {
          imageType: 'Poster',
          collectionId,
          isPrimary: true,
          scraperId,
        })
        console.log(`📷 Refreshed season poster for collection ${collectionId}`)
      } catch (error) {
        console.warn(`Failed to download season poster:`, error)
      }
    }
    return
  }

  await prisma.seasonDetails.upsert({
    where: { collectionId },
    create: {
      collectionId,
      scraperId,
      externalId: metadata.externalId,
      seasonNumber: metadata.seasonNumber,
      description: metadata.description,
      releaseDate: metadata.airDate,
    },
    update: {
      scraperId,
      externalId: metadata.externalId,
      seasonNumber: metadata.seasonNumber,
      description: metadata.description,
      releaseDate: metadata.airDate,
    },
  })

  // Download season poster if available (unless skipImages is set)
  if (metadata.posterUrl && !skipImages) {
    try {
      await imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      })
      console.log(`📷 Downloaded season poster for collection ${collectionId}`)
    } catch (error) {
      console.warn(`Failed to download season poster:`, error)
    }
  }
}

/**
 * Download images for a collection (show/series)
 */
async function downloadCollectionImages(
  collectionId: string,
  metadata: SeriesMetadata,
  scraperId: string
): Promise<void> {
  const imagePromises: Promise<void>[] = []

  // Download poster
  if (metadata.posterUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded poster for collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download poster:`, error)
      })
    )
  }

  // Download backdrop
  if (metadata.backdropUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.backdropUrl, {
        imageType: 'Backdrop',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded backdrop for collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download backdrop:`, error)
      })
    )
  }

  // Download thumbnail (highest rated English backdrop)
  if (metadata.thumbnailUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.thumbnailUrl, {
        imageType: 'Thumbnail',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded thumbnail for collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download thumbnail:`, error)
      })
    )
  }

  // Download logo
  if (metadata.logoUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.logoUrl, {
        imageType: 'Logo',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded logo for collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download logo:`, error)
      })
    )
  }

  // Wait for all image downloads
  await Promise.all(imagePromises)
}

/**
 * Apply film metadata to the collection and its media items
 */
async function applyFilmMetadata(
  collectionId: string,
  metadata: VideoMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadFilmImages(collectionId, metadata, scraperId)
    console.log(`📷 Refreshed images for film collection ${collectionId}`)

    // Also refresh images for media items in this collection
    const mediaItems = await prisma.media.findMany({
      where: { collectionId },
      select: { id: true, name: true, type: true },
    })

    for (const media of mediaItems) {
      if (media.type === 'Video') {
        await addMetadataScrapeJob({
          mediaId: media.id,
          mediaName: metadata.title || media.name,
          mediaType: 'Video',
          scraperId,
          externalId: metadata.externalId,
          imagesOnly: true, // Only refresh images for media items
        })
        console.log(`📋 Queued image refresh for film media: ${media.name}`)
      }
    }
    return
  }

  // Download images for the collection (unless skipImages is set)
  if (!skipImages) {
    await downloadFilmImages(collectionId, metadata, scraperId)
  }

  // For films, the actual metadata (description, credits) is stored on the Media item's VideoDetails
  // Queue metadata scrape jobs for all media items in this collection
  const mediaItems = await prisma.media.findMany({
    where: { collectionId },
    select: { id: true, name: true, type: true },
  })

  for (const media of mediaItems) {
    if (media.type === 'Video') {
      await addMetadataScrapeJob({
        mediaId: media.id,
        mediaName: metadata.title || media.name, // Use the scraped title for better matching
        mediaType: 'Video',
        scraperId,
        externalId: metadata.externalId,
        skipImages, // Pass through the skipImages flag
      })
      console.log(`📋 Queued metadata scrape for film media: ${media.name}`)
    }
  }
}

/**
 * Download images for a film collection
 */
async function downloadFilmImages(
  collectionId: string,
  metadata: VideoMetadata,
  scraperId: string
): Promise<void> {
  const imagePromises: Promise<void>[] = []

  // Download poster
  if (metadata.posterUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded poster for film collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download film poster:`, error)
      })
    )
  }

  // Download backdrop
  if (metadata.backdropUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.backdropUrl, {
        imageType: 'Backdrop',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded backdrop for film collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download film backdrop:`, error)
      })
    )
  }

  // Download thumbnail (highest rated English backdrop)
  if (metadata.thumbnailUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.thumbnailUrl, {
        imageType: 'Thumbnail',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded thumbnail for film collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download film thumbnail:`, error)
      })
    )
  }

  // Download logo
  if (metadata.logoUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.logoUrl, {
        imageType: 'Logo',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded logo for film collection ${collectionId}`)
        }
      }).catch((error) => {
        console.warn(`Failed to download film logo:`, error)
      })
    )
  }

  // Wait for all image downloads
  await Promise.all(imagePromises)
}

/**
 * Map scraper credit type to Prisma enum
 */
function mapCreditType(
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

// Worker event handlers
collectionScrapeWorker.on('completed', (job, result) => {
  if (result.success) {
    console.log(`✅ Collection scrape ${job.id} completed via ${result.scraperId}`)
  } else {
    console.log(`⚠️ Collection scrape ${job.id} completed but no metadata found`)
  }
})

collectionScrapeWorker.on('failed', (job, error) => {
  console.error(`❌ Collection scrape ${job?.id} failed:`, error.message)
})

collectionScrapeWorker.on('error', (error) => {
  console.error('Collection scrape worker error:', error)
})

collectionScrapeWorker.on('ready', () => {
  console.log('🎬 Collection scrape worker is ready')
})
