import { useCallback, useMemo, useState } from 'react';
import { apiClient, type Collection, type Keyword, type Library } from '../api/client';
import type { SortDirection } from '../components/SortControls';
import { queryKeys, useApiInfiniteQuery, useApiQuery } from './useApiQuery';
import type { SortField } from './useLibraryViewPreferences';

export const LIBRARY_PAGE_SIZE = 50;

/** Ratings in the order a viewer expects to see them, not alphabetical. */
const CONTENT_RATING_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];

export interface LibraryCollectionsFilters {
  sortField: SortField;
  sortDirection: SortDirection;
  excludedRatings: Set<string>;
  selectedKeywords: Keyword[];
  nameFilter: string;
}

function sortRatings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => {
    const aIndex = CONTENT_RATING_ORDER.indexOf(a);
    const bIndex = CONTENT_RATING_ORDER.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Everything a library page needs to show its collections: the library itself,
 * a page at a time of its contents, which of them the viewer has favourited or
 * saved for later, and the filter values the contents imply.
 *
 * Paging is `useInfiniteQuery`, so the loaded pages live in the query cache
 * rather than in component state. Coming back to a library that was scrolled
 * some way down re-renders what was already fetched instead of starting again
 * at page one, which is what the page's own snapshot used to be for.
 */
export function useLibraryCollections(libraryId: string | undefined, filters: LibraryCollectionsFilters) {
  const { sortField, sortDirection, excludedRatings, selectedKeywords, nameFilter } = filters;

  const excluded = useMemo(() => Array.from(excludedRatings).sort(), [excludedRatings]);
  const keywordIds = useMemo(() => selectedKeywords.map((k) => k.id).sort(), [selectedKeywords]);

  const libraryQuery = useApiQuery(
    queryKeys.library(libraryId ?? ''),
    () => apiClient.getLibrary(libraryId!),
    { enabled: Boolean(libraryId) }
  );
  const library: Library | null = libraryQuery.data?.library ?? null;

  const collectionsQuery = useApiInfiniteQuery(
    queryKeys.libraryCollections(libraryId ?? '', {
      sortField,
      sortDirection,
      excluded,
      keywordIds,
      nameFilter,
    }),
    (page) =>
      apiClient.getCollectionsByLibrary(libraryId!, {
        page,
        limit: LIBRARY_PAGE_SIZE,
        sortField,
        sortDirection,
        excludedRatings: excluded.length > 0 ? excluded : undefined,
        keywordIds: keywordIds.length > 0 ? keywordIds : undefined,
        nameFilter: nameFilter || undefined,
      }),
    { enabled: Boolean(libraryId) }
  );

  const collections: Collection[] = useMemo(
    () => collectionsQuery.pages.flatMap((page) => page.collections),
    [collectionsQuery.pages]
  );
  const total = collectionsQuery.pages[0]?.total ?? 0;

  // Favourites and watch-later for what is on screen. Keyed on the ids, so
  // loading another page asks about the whole set once rather than merging
  // answers into a Set the component has to keep.
  const idsKey = collections.map((c) => c.id).join(',');
  const favoritesQuery = useApiQuery(
    ['library-favorites', idsKey],
    () => apiClient.checkFavorites(idsKey.split(',')),
    { enabled: idsKey.length > 0 }
  );
  const watchLaterQuery = useApiQuery(
    ['library-watch-later', idsKey],
    () => apiClient.checkWatchLater(idsKey.split(',')),
    { enabled: idsKey.length > 0 }
  );

  const favoritedIds = useMemo(
    () => new Set(favoritesQuery.data?.collectionIds ?? []),
    [favoritesQuery.data]
  );
  const watchLaterIds = useMemo(
    () => new Set(watchLaterQuery.data?.collectionIds ?? []),
    [watchLaterQuery.data]
  );

  // Derived from what has loaded, so a rating that only appears on page four
  // joins the filter when page four arrives.
  const availableContentRatings = useMemo(
    () =>
      sortRatings(
        collections.map((c) => c.filmDetails?.contentRating).filter((r): r is string => Boolean(r))
      ),
    [collections]
  );

  // Keywords are a separate list, fetched the first time the filter panel opens.
  const [keywordsWanted, setKeywordsWanted] = useState(false);
  const keywordsQuery = useApiQuery(
    queryKeys.libraryKeywords(libraryId ?? ''),
    () => apiClient.getKeywordsByLibrary(libraryId!),
    { enabled: keywordsWanted && Boolean(libraryId) }
  );
  const loadKeywords = useCallback(() => setKeywordsWanted(true), []);

  const loadMore = useCallback(() => {
    if (collectionsQuery.hasNextPage && !collectionsQuery.isFetchingNextPage) {
      void collectionsQuery.fetchNextPage();
    }
  }, [collectionsQuery]);

  return {
    library,
    collections,
    // The page shows a spinner only before anything is known.
    isLoading: libraryQuery.isPending || collectionsQuery.isPending,
    isLoadingMore: collectionsQuery.isFetchingNextPage,
    error: libraryQuery.errorMessage ?? collectionsQuery.errorMessage,
    total,
    hasMore: Boolean(collectionsQuery.hasNextPage),
    favoritedIds,
    watchLaterIds,
    availableContentRatings,
    availableKeywords: keywordsQuery.data?.keywords ?? [],
    keywordsLoading: keywordsWanted && keywordsQuery.isPending,
    loadKeywords,
    loadMore,
  };
}
