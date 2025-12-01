import { Person, Prisma } from '@prisma/client';
import type { CreditInfo, PersonMetadata } from '@tubeca/scraper-types';
import { prisma } from '../config/database';

export interface PersonWithFilmography extends Person {
  filmography: {
    shows: Array<{
      collection: {
        id: string
        name: string
        collectionType: string
        images: Array<{
          id: string
          imageType: string
          isPrimary: boolean
        }>
      }
      credit: {
        id: string
        role: string | null
        creditType: string
      }
    }>
    films: Array<{
      collection: {
        id: string
        name: string
        collectionType: string
        images: Array<{
          id: string
          imageType: string
          isPrimary: boolean
        }>
      }
      media: {
        id: string
        name: string
      }
      credit: {
        id: string
        role: string | null
        creditType: string
      }
    }>
    episodes: Array<{
      media: {
        id: string
        name: string
        videoDetails: {
          showName: string | null
          season: number | null
          episode: number | null
        } | null
        collection: {
          id: string
          name: string
          parent: {
            id: string
            name: string
          } | null
        } | null
        images: Array<{
          id: string
          imageType: string
          isPrimary: boolean
        }>
      }
      credit: {
        id: string
        role: string | null
        creditType: string
      }
    }>
  }
  images: Array<{
    id: string
    imageType: string
    isPrimary: boolean
  }>
}

export class PersonService {
  /**
   * Find or create a person, handling cross-scraper merging.
   * Priority: 1) IMDB ID, 2) TMDB ID, 3) TVDB ID, 4) Exact name match
   */
  async findOrCreatePerson(creditInfo: CreditInfo): Promise<Person> {
    // 1. Try to find by IMDB ID (most reliable cross-scraper identifier)
    if (creditInfo.imdbId) {
      const personByImdb = await prisma.person.findUnique({
        where: { imdbId: creditInfo.imdbId },
      });
      if (personByImdb) {
        // Update with any new external IDs
        return this.updateExternalIds(personByImdb, creditInfo);
      }
    }

    // 2. Try to find by TMDB ID
    if (creditInfo.tmdbId) {
      const personByTmdb = await prisma.person.findUnique({
        where: { tmdbId: creditInfo.tmdbId },
      });
      if (personByTmdb) {
        return this.updateExternalIds(personByTmdb, creditInfo);
      }
    }

    // 3. Try to find by TVDB ID
    if (creditInfo.tvdbId) {
      const personByTvdb = await prisma.person.findUnique({
        where: { tvdbId: creditInfo.tvdbId },
      });
      if (personByTvdb) {
        return this.updateExternalIds(personByTvdb, creditInfo);
      }
    }

    // 4. Try to find by exact name match (less reliable but helps with legacy data)
    const personByName = await prisma.person.findFirst({
      where: { name: creditInfo.name },
    });
    if (personByName) {
      return this.updateExternalIds(personByName, creditInfo);
    }

    // 5. No match found, create new person
    return prisma.person.create({
      data: {
        name: creditInfo.name,
        tmdbId: creditInfo.tmdbId,
        tvdbId: creditInfo.tvdbId,
        imdbId: creditInfo.imdbId,
      },
    });
  }

  /**
   * Update a person's external IDs if new ones are provided
   */
  private async updateExternalIds(
    person: Person,
    creditInfo: CreditInfo
  ): Promise<Person> {
    const updates: Prisma.PersonUpdateInput = {};

    if (creditInfo.tmdbId && !person.tmdbId) {
      updates.tmdbId = creditInfo.tmdbId;
    }
    if (creditInfo.tvdbId && !person.tvdbId) {
      updates.tvdbId = creditInfo.tvdbId;
    }
    if (creditInfo.imdbId && !person.imdbId) {
      updates.imdbId = creditInfo.imdbId;
    }

    if (Object.keys(updates).length > 0) {
      return prisma.person.update({
        where: { id: person.id },
        data: updates,
      });
    }

    return person;
  }

  /**
   * Get a person by ID with their filmography
   */
  async getPersonById(id: string): Promise<PersonWithFilmography | null> {
    const person = await prisma.person.findUnique({
      where: { id },
      include: {
        images: {
          select: {
            id: true,
            imageType: true,
            isPrimary: true,
          },
        },
      },
    });

    if (!person) {
      return null;
    }

    // Get show credits (ShowCredit -> ShowDetails -> Collection with collectionType='Show')
    const showCredits = await prisma.showCredit.findMany({
      where: { personId: id },
      include: {
        showDetails: {
          include: {
            collection: {
              include: {
                images: {
                  where: { imageType: 'Poster', isPrimary: true },
                  take: 1,
                  select: { id: true, imageType: true, isPrimary: true },
                },
              },
            },
          },
        },
      },
    });

    // Get video credits (Credit -> VideoDetails -> Media)
    const videoCredits = await prisma.credit.findMany({
      where: { personId: id },
      include: {
        videoDetails: {
          include: {
            media: {
              include: {
                images: {
                  where: {
                    OR: [
                      { imageType: 'Thumbnail', isPrimary: true },
                      { imageType: 'Backdrop', isPrimary: true },
                      { imageType: 'Poster', isPrimary: true },
                    ],
                  },
                  select: { id: true, imageType: true, isPrimary: true },
                },
                collection: {
                  include: {
                    parent: {
                      select: { id: true, name: true, collectionType: true },
                    },
                    images: {
                      where: { imageType: 'Poster', isPrimary: true },
                      take: 1,
                      select: { id: true, imageType: true, isPrimary: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Separate films from episodes
    const films: PersonWithFilmography['filmography']['films'] = [];
    const episodes: PersonWithFilmography['filmography']['episodes'] = [];

    for (const credit of videoCredits) {
      const media = credit.videoDetails.media;
      const collection = media.collection;

      // Determine if this is a film or episode based on collection type
      // Films: collection type is 'Film', or parent collection type is 'Film'
      // Episodes: collection type is 'Season', or has showName/season/episode info
      const isFilm = collection?.collectionType === 'Film' ||
        collection?.parent?.collectionType === 'Film';
      const isEpisode = collection?.collectionType === 'Season' ||
        (credit.videoDetails.showName && credit.videoDetails.season != null);

      if (isFilm && !isEpisode) {
        films.push({
          collection: {
            id: collection!.id,
            name: collection!.name,
            collectionType: collection!.collectionType,
            images: collection!.images,
          },
          media: {
            id: media.id,
            name: media.name,
          },
          credit: {
            id: credit.id,
            role: credit.role,
            creditType: credit.creditType,
          },
        });
      } else if (isEpisode) {
        // It's an episode
        // Prefer thumbnail, then backdrop, then poster from media, then poster from collection
        const thumbnailImage = media.images?.find((img) => img.imageType === 'Thumbnail');
        const backdropImage = media.images?.find((img) => img.imageType === 'Backdrop');
        const posterImage = media.images?.find((img) => img.imageType === 'Poster');
        const episodeImage = thumbnailImage || backdropImage || posterImage || collection?.images?.[0];

        episodes.push({
          media: {
            id: media.id,
            name: media.name,
            videoDetails: {
              showName: credit.videoDetails.showName,
              season: credit.videoDetails.season,
              episode: credit.videoDetails.episode,
            },
            collection: collection
              ? {
                  id: collection.id,
                  name: collection.name,
                  parent: collection.parent,
                }
              : null,
            images: episodeImage ? [episodeImage] : [],
          },
          credit: {
            id: credit.id,
            role: credit.role,
            creditType: credit.creditType,
          },
        });
      }
      // If neither film nor episode (e.g., orphaned media), skip it
    }

    return {
      ...person,
      filmography: {
        shows: showCredits.map((sc) => ({
          collection: {
            id: sc.showDetails.collection.id,
            name: sc.showDetails.collection.name,
            collectionType: sc.showDetails.collection.collectionType,
            images: sc.showDetails.collection.images,
          },
          credit: {
            id: sc.id,
            role: sc.role,
            creditType: sc.creditType,
          },
        })),
        films,
        episodes,
      },
    };
  }

  /**
   * Get a person by external ID
   */
  async getPersonByExternalId(
    tmdbId?: number,
    tvdbId?: number,
    imdbId?: string
  ): Promise<Person | null> {
    if (imdbId) {
      return prisma.person.findUnique({ where: { imdbId } });
    }
    if (tmdbId) {
      return prisma.person.findUnique({ where: { tmdbId } });
    }
    if (tvdbId) {
      return prisma.person.findUnique({ where: { tvdbId } });
    }
    return null;
  }

  /**
   * Update a person's metadata from scraper data
   */
  async updatePersonMetadata(
    personId: string,
    metadata: PersonMetadata
  ): Promise<Person> {
    return prisma.person.update({
      where: { id: personId },
      data: {
        name: metadata.name,
        biography: metadata.biography,
        birthDate: metadata.birthDate ? new Date(metadata.birthDate) : null,
        deathDate: metadata.deathDate ? new Date(metadata.deathDate) : null,
        birthPlace: metadata.birthPlace,
        knownFor: metadata.knownFor,
        tmdbId: metadata.tmdbId ?? undefined,
        tvdbId: metadata.tvdbId ?? undefined,
        imdbId: metadata.imdbId ?? undefined,
      },
    });
  }

  /**
   * Search for persons by name
   */
  async searchByName(query: string, limit = 20): Promise<Person[]> {
    return prisma.person.findMany({
      where: {
        name: {
          contains: query,
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });
  }
}
