/**
 * Pieces shared by the two scrape workers.
 *
 * Shows, seasons, films, episodes and tracks all store their metadata in
 * different tables, but the artwork and the cast are handled identically for
 * every one of them. Those two loops used to be copied five times between
 * `collectionScrapeWorker` and `metadataScrapeWorker`, so a fix such as
 * "honour skipImages for cast photos" had to be made in every copy. They live
 * here once instead; callers pass the table-specific writes as callbacks.
 */

import type { ImageType, CreditType as PrismaCreditType } from '@prisma/client';
import type { CreditInfo } from '@tubeca/scraper-types';
import { ImageService } from './imageService';
import { PersonService } from './personService';
import { prisma } from '../config/database';

const imageService = new ImageService();
const personService = new PersonService();

/** Which entity the artwork belongs to. Exactly one field is set. */
export interface ArtworkTarget {
  collectionId?: string
  mediaId?: string
}

/** The artwork URLs a scraper may return; absent fields are skipped. */
export interface ArtworkSource {
  posterUrl?: string
  backdropUrl?: string
  thumbnailUrl?: string
  logoUrl?: string
  albumArtUrl?: string
}

const ARTWORK_FIELDS: Array<[keyof ArtworkSource, ImageType]> = [
  ['posterUrl', 'Poster'],
  ['backdropUrl', 'Backdrop'],
  ['thumbnailUrl', 'Thumbnail'],
  ['logoUrl', 'Logo'],
  ['albumArtUrl', 'AlbumArt'],
];

export interface DownloadArtworkOptions {
  /** Keep the file already on disk when the provider still points at the same URL. */
  reuseExisting?: boolean
  /** Appears in the log line, e.g. "film collection". */
  label?: string
}

/**
 * Download every artwork URL the scraper returned for one entity.
 *
 * Downloads run together and a failure on one never fails the others: missing
 * artwork should not fail an otherwise good scrape.
 */
export async function downloadArtwork(
  target: ArtworkTarget,
  source: ArtworkSource,
  scraperId: string | undefined,
  options: DownloadArtworkOptions = {}
): Promise<void> {
  const entityId = target.collectionId ?? target.mediaId;
  const label = options.label ?? (target.collectionId ? 'collection' : 'media');

  const downloads = ARTWORK_FIELDS.filter(([field]) => Boolean(source[field])).map(([field, imageType]) =>
    imageService
      .downloadAndSaveImage(source[field] as string, {
        imageType,
        ...target,
        isPrimary: true,
        scraperId,
        reuseExisting: options.reuseExisting,
      })
      .then((result) => {
        if (result.success && !result.reused) {
          console.log(`📷 Downloaded ${imageType.toLowerCase()} for ${label} ${entityId}`);
        }
      })
      .catch((error) => {
        console.warn(`Failed to download ${imageType.toLowerCase()} for ${label} ${entityId}:`, error);
      })
  );

  await Promise.all(downloads);
}

/**
 * Whether a scrape should fetch artwork at all.
 *
 * `skipImages` means "this is a metadata refresh, leave the artwork alone",
 * but an entity that has no artwork yet still needs some.
 */
export async function shouldDownloadArtwork(target: ArtworkTarget, skipImages?: boolean): Promise<boolean> {
  if (!skipImages) return true;
  const existing = await prisma.image.count({ where: target });
  return existing === 0;
}

/** Map a scraper credit type onto the Prisma enum. Unknown types are cast. */
export function mapCreditType(type: string): PrismaCreditType {
  const mapping: Record<string, PrismaCreditType> = {
    actor: 'Actor',
    director: 'Director',
    writer: 'Writer',
    producer: 'Producer',
    composer: 'Composer',
    cinematographer: 'Cinematographer',
    editor: 'Editor',
  };
  return mapping[type] ?? 'Actor';
}

/** The columns every credit table shares. */
export interface CreditRow {
  name: string
  role?: string
  creditType: PrismaCreditType
  order?: number
  personId?: string
}

export interface ApplyCreditsOptions {
  credits: CreditInfo[]
  scraperId?: string
  /** Remove the rows from a previous scrape before writing the new ones. */
  deleteExisting: () => Promise<unknown>
  /** Write one credit row into the table that belongs to this entity. */
  createCredit: (row: CreditRow) => Promise<unknown>
  /** Fetch cast photos for people who have none yet. */
  downloadPhotos?: boolean
}

/**
 * Replace an entity's credits and link each one to a Person.
 *
 * A person who cannot be linked still gets a credit row, so the cast list
 * stays complete even when person matching fails.
 */
export async function applyCredits(options: ApplyCreditsOptions): Promise<void> {
  const { credits, scraperId, deleteExisting, createCredit, downloadPhotos = true } = options;
  if (credits.length === 0) return;

  await deleteExisting();

  for (const credit of credits) {
    let personId: string | undefined;
    try {
      const person = await personService.findOrCreatePerson({
        name: credit.name,
        type: credit.type,
        tmdbId: credit.tmdbId,
        tvdbId: credit.tvdbId,
        imdbId: credit.imdbId,
      });
      personId = person.id;
    } catch (error) {
      console.warn(`Failed to link person for ${credit.name}:`, error);
    }

    await createCredit({
      name: credit.name,
      role: credit.role,
      creditType: mapCreditType(credit.type),
      order: credit.order,
      personId,
    });

    if (downloadPhotos && credit.photoUrl && personId) {
      await downloadPersonPhoto(personId, credit.name, credit.photoUrl, scraperId);
    }
  }
}

/** Fetch a cast photo, but only for a person who does not have one yet. */
async function downloadPersonPhoto(
  personId: string,
  name: string,
  photoUrl: string,
  scraperId?: string
): Promise<void> {
  try {
    const existingPhoto = await prisma.image.findFirst({
      where: { personId, imageType: 'Photo', isPrimary: true },
    });
    if (existingPhoto) return;

    await imageService.downloadAndSaveImage(photoUrl, {
      imageType: 'Photo',
      personId,
      isPrimary: true,
      scraperId,
    });
    console.log(`📷 Downloaded photo for ${name}`);
  } catch (error) {
    console.warn(`Failed to download photo for ${name}:`, error);
  }
}
