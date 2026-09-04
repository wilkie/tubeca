import { prisma } from '../config/database';
import { scraperManager } from '../plugins/scraperLoader';
import { cachedCall, scrapeCacheKey } from './scrapeCache';
import { NotFoundError, ValidationError } from './errors';
import type { ImageType } from '@prisma/client';

/** One piece of artwork a provider offers, and whether we already have it. */
export interface ArtworkCandidate {
  url: string
  imageType: ImageType
  /** True when an image with this source URL is already saved for the entity. */
  saved: boolean
}

/** Where a collection's identity is recorded, by the kind of collection it is. */
async function identify(collectionId: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: { showDetails: true, filmDetails: true, seasonDetails: true },
  });
  if (!collection) {
    throw new NotFoundError('Collection not found');
  }

  const details = collection.showDetails ?? collection.filmDetails ?? collection.seasonDetails;
  if (!details?.scraperId || !details.externalId) {
    throw new ValidationError('This collection has not been identified with a scraper yet');
  }

  return { collection, scraperId: details.scraperId, externalId: details.externalId };
}

/**
 * The artwork a provider has for a collection, beyond the one it chose.
 *
 * A scrape downloads one image of each kind; a provider usually has a dozen.
 * This asks for the rest as URLs so a person can look at them and pick, and
 * nothing is fetched until they do — the alternative, downloading every
 * candidate for every title, would multiply a library's artwork by ten for
 * images almost none of which anyone will ever choose.
 *
 * The answer goes through the same ten-minute cache the scrape workers use, so
 * opening the dialog twice does not ask the provider twice.
 */
export async function getArtworkCandidates(collectionId: string): Promise<ArtworkCandidate[]> {
  const { collection, scraperId, externalId } = await identify(collectionId);

  const scraper = scraperManager.get(scraperId);
  if (!scraper) {
    throw new ValidationError(`Scraper "${scraperId}" is not configured`);
  }

  const isShow = collection.collectionType === 'Show';
  const metadata = isShow
    ? await scraper.getSeriesMetadata?.(externalId)
    : await scraper.getVideoMetadata?.(externalId);

  if (!metadata) {
    return [];
  }

  const saved = await prisma.image.findMany({
    where: { collectionId, sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  const have = new Set(saved.map((image) => image.sourceUrl));

  const groups: Array<[ImageType, string[] | undefined]> = [
    ['Poster', metadata.posterUrls],
    ['Backdrop', metadata.backdropUrls],
    ['Logo', metadata.logoUrls],
  ];

  return groups.flatMap(([imageType, urls]) =>
    (urls ?? []).map((url) => ({ url, imageType, saved: have.has(url) }))
  );
}

/** The cached form, keyed the way the scrape workers key their calls. */
export function getArtworkCandidatesCached(collectionId: string): Promise<ArtworkCandidate[]> {
  return cachedCall(scrapeCacheKey('artwork', 'collection', collectionId), () =>
    getArtworkCandidates(collectionId)
  );
}
