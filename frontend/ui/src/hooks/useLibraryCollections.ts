import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, type Collection, type Keyword, type Library } from '../api/client';
import type { SortDirection } from '../components/SortControls';
import type { SortField } from './useLibraryViewPreferences';

export const LIBRARY_PAGE_SIZE = 50;

/** Ratings in the order a viewer expects to see them, not alphabetical. */
const CONTENT_RATING_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];

export interface LibraryCollectionsSnapshot {
  library: Library;
  collections: Collection[];
  page: number;
  hasMore: boolean;
  total: number;
  favoritedIds: string[];
  watchLaterIds: string[];
  availableContentRatings: string[];
}

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
 * It lives apart from the page because the page was a thousand lines in which
 * the fetching, the filter state and the markup were interleaved. Restoring a
 * previous visit is supported through `restored`: when the caller has a cached
 * snapshot it hands it in, and the first load is skipped.
 */
export function useLibraryCollections(
  libraryId: string | undefined,
  filters: LibraryCollectionsFilters,
  restored?: LibraryCollectionsSnapshot | null
) {
  const [library, setLibrary] = useState<Library | null>(restored?.library ?? null);
  const [collections, setCollections] = useState<Collection[]>(restored?.collections ?? []);
  const [isLoading, setIsLoading] = useState(!restored);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(restored?.page ?? 1);
  const [hasMore, setHasMore] = useState(restored?.hasMore ?? false);
  const [total, setTotal] = useState(restored?.total ?? 0);

  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set(restored?.favoritedIds ?? []));
  const [watchLaterIds, setWatchLaterIds] = useState<Set<string>>(new Set(restored?.watchLaterIds ?? []));
  const [availableContentRatings, setAvailableContentRatings] = useState<string[]>(
    restored?.availableContentRatings ?? []
  );

  const [availableKeywords, setAvailableKeywords] = useState<Keyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const keywordsLoadedRef = useRef(false);

  // A restored page must not fetch again on mount, and must not paginate until
  // the browser has finished putting the scroll position back.
  const restoredRef = useRef(restored != null || collections.length > 0);

  const { sortField, sortDirection, excludedRatings, selectedKeywords, nameFilter } = filters;

  const fetchPage = useCallback(
    async (pageNum: number, append = false) => {
      if (!libraryId) return;
      if (pageNum === 1) setIsLoading(true);
      else setIsLoadingMore(true);

      const result = await apiClient.getCollectionsByLibrary(libraryId, {
        page: pageNum,
        limit: LIBRARY_PAGE_SIZE,
        sortField,
        sortDirection,
        excludedRatings: excludedRatings.size > 0 ? Array.from(excludedRatings) : undefined,
        keywordIds: selectedKeywords.length > 0 ? selectedKeywords.map((k) => k.id) : undefined,
        nameFilter: nameFilter || undefined,
      });

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        const loaded = result.data.collections;
        setCollections((prev) => (append ? [...prev, ...loaded] : loaded));
        setTotal(result.data.total);
        setHasMore(result.data.hasMore);
        setPage(result.data.page);

        const newIds = loaded.map((c) => c.id);
        if (newIds.length > 0) {
          const [favResult, watchLaterResult] = await Promise.all([
            apiClient.checkFavorites(newIds),
            apiClient.checkWatchLater(newIds),
          ]);
          if (favResult.data) {
            setFavoritedIds((prev) => new Set([...prev, ...favResult.data!.collectionIds]));
          }
          if (watchLaterResult.data) {
            setWatchLaterIds((prev) => new Set([...prev, ...watchLaterResult.data!.collectionIds]));
          }
        }

        // Ratings accumulate as pages load; a film only present on page four
        // still belongs in the filter.
        if (!append) {
          const ratings = loaded.map((c) => c.filmDetails?.contentRating).filter((r): r is string => Boolean(r));
          setAvailableContentRatings((prev) => sortRatings([...prev, ...ratings]));
        }
      }

      setIsLoading(false);
      setIsLoadingMore(false);
    },
    [libraryId, sortField, sortDirection, excludedRatings, selectedKeywords, nameFilter]
  );

  // Initial load: the library itself, then its first page.
  useEffect(() => {
    if (!libraryId) return;
    if (restoredRef.current) return;

    let cancelled = false;

    // Clear the previous library at once so its contents do not flash under
    // the new name.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync clear on libraryId change
    setLibrary(null);
    setCollections([]);
    setAvailableKeywords([]);
    setAvailableContentRatings([]);
    setFavoritedIds(new Set());
    setWatchLaterIds(new Set());
    setPage(1);
    setTotal(0);
    setHasMore(false);
    keywordsLoadedRef.current = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const libraryResult = await apiClient.getLibrary(libraryId!);
      if (cancelled) return;

      if (libraryResult.error) {
        setError(libraryResult.error);
        setIsLoading(false);
        return;
      }
      if (libraryResult.data) setLibrary(libraryResult.data.library);

      // Keywords wait until the filter panel is opened.
      await fetchPage(1);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [libraryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sort or filter changed: fetch page one again, keeping what is on screen
  // visible until the new page arrives.
  useEffect(() => {
    if (!library) return;
    if (restoredRef.current) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync clear on filter change
    setFavoritedIds(new Set());
    setWatchLaterIds(new Set());
    fetchPage(1);
  }, [sortField, sortDirection, excludedRatings, selectedKeywords, nameFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restoration is done once the browser has had a moment to scroll.
  useEffect(() => {
    if (!restoredRef.current) return;
    const timeout = setTimeout(() => {
      restoredRef.current = false;
    }, 500);
    return () => clearTimeout(timeout);
  }, []);

  const loadMore = useCallback(() => {
    if (restoredRef.current || !hasMore || isLoadingMore) return;
    fetchPage(page + 1, true);
  }, [fetchPage, hasMore, isLoadingMore, page]);

  /** Fetch the keyword list, once, when the filter panel first opens. */
  const loadKeywords = useCallback(async () => {
    if (keywordsLoadedRef.current || !libraryId) return;
    keywordsLoadedRef.current = true;
    setKeywordsLoading(true);
    const result = await apiClient.getKeywordsByLibrary(libraryId);
    if (result.data) setAvailableKeywords(result.data.keywords);
    setKeywordsLoading(false);
  }, [libraryId]);

  /** What the caller stores for a later restore. Null until the library loads. */
  const snapshot = useCallback((): LibraryCollectionsSnapshot | null => {
    if (!library) return null;
    return {
      library,
      collections,
      page,
      hasMore,
      total,
      favoritedIds: Array.from(favoritedIds),
      watchLaterIds: Array.from(watchLaterIds),
      availableContentRatings,
    };
  }, [library, collections, page, hasMore, total, favoritedIds, watchLaterIds, availableContentRatings]);

  return {
    library,
    collections,
    isLoading,
    isLoadingMore,
    error,
    total,
    hasMore,
    favoritedIds,
    watchLaterIds,
    availableContentRatings,
    availableKeywords,
    keywordsLoading,
    loadKeywords,
    loadMore,
    snapshot,
  };
}
