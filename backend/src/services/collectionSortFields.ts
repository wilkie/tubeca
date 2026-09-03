import { prisma } from '../config/database';

/**
 * Keep `Collection.sortReleaseDate` / `sortRating` / `sortRuntime` in step with
 * the collection's detail row.
 *
 * The values a user sorts a library by live in four different tables
 * (`FilmDetails`, `ShowDetails`, `SeasonDetails`, `AlbumDetails`), and Prisma
 * cannot order across a union of optional relations. Copying them onto the
 * collection lets the database do the ordering, so a page of results is a page
 * of the globally sorted list rather than a locally sorted page.
 *
 * Precedence matches the read path that preceded this: film, then show, then
 * season, then album. Call after any write to a details row.
 */
export async function syncCollectionSortFields(collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: {
      filmDetails: { select: { releaseDate: true, rating: true, runtime: true } },
      showDetails: { select: { releaseDate: true, rating: true } },
      seasonDetails: { select: { releaseDate: true } },
      albumDetails: { select: { releaseDate: true } },
    },
  });
  if (!collection) return;

  const { filmDetails, showDetails, seasonDetails, albumDetails } = collection;

  await prisma.collection.update({
    where: { id: collectionId },
    data: {
      sortReleaseDate:
        filmDetails?.releaseDate ??
        showDetails?.releaseDate ??
        seasonDetails?.releaseDate ??
        albumDetails?.releaseDate ??
        null,
      sortRating: filmDetails?.rating ?? showDetails?.rating ?? null,
      sortRuntime: filmDetails?.runtime ?? null,
    },
  });
}
