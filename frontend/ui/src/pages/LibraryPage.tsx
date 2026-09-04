import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, CircularProgress, Collapse, Container, Grid, Stack, Typography } from '@mui/material';
import { apiClient, type Collection } from '../api/client';
import { useScrollRestoration } from '../context/ScrollRestorationContext';
import { AddToCollectionDialog } from '../components/AddToCollectionDialog';
import { CollectionListCard, CollectionPosterCard } from '../components/CollectionCard';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';
import { LibraryToolbar } from '../components/LibraryToolbar';
import { QuickSearchOverlay } from '../components/QuickSearchOverlay';
import { SelectionActionBar } from '../components/SelectionActionBar';
import type { SortOption } from '../components/SortControls';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useLibraryCollections } from '../hooks/useLibraryCollections';
import { useLibraryViewPreferences, type SortField } from '../hooks/useLibraryViewPreferences';
import { useQuickSearch } from '../hooks/useQuickSearch';
import { useWatchState } from '../hooks/useWatchState';

/**
 * Browse one library: a paged, filterable grid or list of its collections.
 *
 * The page owns what the viewer is doing (filters, selection, which dialog is
 * open); the data lives in `useLibraryCollections` and the markup in
 * `LibraryToolbar` and the collection cards.
 */
export function LibraryPage() {
  const { t } = useTranslation();
  const { libraryId } = useParams<{ libraryId: string }>();
  const navigate = useNavigate();

  // Coming back with the back button restores the scroll offset; the rows
  // themselves come from the query cache.
  useScrollRestoration(`library-${libraryId}`);

  const {
    viewMode,
    sortField,
    sortDirection,
    excludedRatings: storedExcludedRatings,
    selectedKeywords,
    setViewMode,
    setSortField,
    setSortDirection,
    setExcludedRatings: storeExcludedRatings,
    setSelectedKeywords,
  } = useLibraryViewPreferences(libraryId);

  // The filter chips and the query work in sets; storage holds a list.
  const excludedRatings = useMemo(() => new Set(storedExcludedRatings), [storedExcludedRatings]);
  const setExcludedRatings = useCallback(
    (next: Set<string>) => storeExcludedRatings([...next]),
    [storeExcludedRatings]
  );

  const [showFilters, setShowFilters] = useState(false);

  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [selectedCollectionForAdd, setSelectedCollectionForAdd] = useState<Collection | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Server-side filtering by name, debounced so typing does not spam the API.
  const { query: quickSearchQuery, isActive: isQuickSearchActive } = useQuickSearch();
  const debouncedSearchQuery = useDebouncedValue(quickSearchQuery, 300);

  const {
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
  } = useLibraryCollections(libraryId, {
    sortField,
    sortDirection,
    excludedRatings,
    selectedKeywords,
    nameFilter: debouncedSearchQuery,
  });

  const collectionIds = useMemo(() => collections.map((c) => c.id), [collections]);
  const { summaries: watchSummaries } = useWatchState({ collectionIds });

  // Infinite scroll sentinel at the foot of the grid.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );

    const sentinel = loadMoreRef.current;
    if (sentinel) observer.observe(sentinel);
    return () => {
      if (sentinel) observer.unobserve(sentinel);
    };
  }, [hasMore, isLoadingMore, loadMore]);

  const sortOptions: SortOption[] = useMemo(
    () => [
      { value: 'name', label: t('library.sort.name') },
      { value: 'dateAdded', label: t('library.sort.dateAdded') },
      { value: 'releaseDate', label: t('library.sort.releaseDate') },
      { value: 'rating', label: t('library.sort.rating') },
      { value: 'runtime', label: t('library.sort.runtime') },
    ],
    [t]
  );

  const toggleSelection = useCallback((collectionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const handleItemClick = useCallback(
    (collectionId: string) => {
      if (isSelectionMode) toggleSelection(collectionId);
      else navigate(`/collection/${collectionId}`);
    },
    [isSelectionMode, navigate, toggleSelection]
  );

  const handleAddToCollection = useCallback((collection: Collection) => {
    setSelectedCollectionForAdd(collection);
    setAddToCollectionOpen(true);
  }, []);

  /** Play a collection: the film itself, or the first episode of its first season. */
  const handlePlay = useCallback(
    async (collectionId: string) => {
      const result = await apiClient.getCollection(collectionId);
      if (!result.data) return;

      const col = result.data.collection;
      let mediaId: string | null = null;

      if (col.media && col.media.length > 0) {
        mediaId = col.media[0].id;
      } else if (col.children && col.children.length > 0) {
        const sortedSeasons = [...col.children].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        );
        const seasonResult = await apiClient.getCollection(sortedSeasons[0].id);
        const episodes = seasonResult.data?.collection.media;
        if (episodes && episodes.length > 0) {
          const sortedEpisodes = [...episodes].sort(
            (a, b) => (a.videoDetails?.episode ?? 0) - (b.videoDetails?.episode ?? 0)
          );
          mediaId = sortedEpisodes[0].id;
        }
      }

      if (mediaId) {
        await apiClient.setPlaybackQueue([{ mediaId }]);
        navigate(`/play/${mediaId}`);
      }
    },
    [navigate]
  );

  const handleToggleFilters = useCallback(() => {
    const willOpen = !showFilters;
    setShowFilters(willOpen);
    if (willOpen) void loadKeywords();
  }, [showFilters, loadKeywords]);

  const clearFilters = useCallback(() => {
    setExcludedRatings(new Set());
    setSelectedKeywords([]);
  }, [setExcludedRatings, setSelectedKeywords]);

  // Content ratings only mean something for films.
  const showContentRatingFilter = library?.libraryType === 'Film' && availableContentRatings.length > 0;
  const activeFilterCount = excludedRatings.size + selectedKeywords.length;

  // A full-page spinner only before anything is known; filter changes keep the
  // page on screen with an overlay instead.
  if (!library && isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && collections.length === 0) {
    return (
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!library) {
    return (
      <Container maxWidth={false} sx={{ py: 4 }}>
        <Alert severity="warning">{t('library.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <LibraryToolbar
        libraryName={library.name}
        total={total}
        showFilterButton={showContentRatingFilter || availableKeywords.length > 0}
        activeFilterCount={activeFilterCount}
        filtersOpen={showFilters}
        onToggleFilters={handleToggleFilters}
        onClearFilters={clearFilters}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={() => (isSelectionMode ? clearSelection() : setIsSelectionMode(true))}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortOptions={sortOptions}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={(value) => setSortField(value as SortField)}
        onSortDirectionChange={setSortDirection}
      />

      <Collapse in={showFilters}>
        {showContentRatingFilter && (
          <FilterChips
            label={t('library.filter.rating', 'Rating')}
            options={availableContentRatings}
            excluded={excludedRatings}
            onToggle={(rating) => {
              const next = new Set(excludedRatings);
              if (next.has(rating)) next.delete(rating);
              else next.add(rating);
              setExcludedRatings(next);
            }}
            onClear={() => setExcludedRatings(new Set())}
            onSelectOnly={(rating) => setExcludedRatings(new Set(availableContentRatings.filter((r) => r !== rating)))}
          />
        )}

        {keywordsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              {t('library.filter.loadingKeywords', 'Loading keywords...')}
            </Typography>
          </Box>
        ) : (
          <KeywordFilter
            keywords={availableKeywords}
            selectedKeywords={selectedKeywords}
            onSelectionChange={setSelectedKeywords}
          />
        )}
      </Collapse>

      {collections.length === 0 && !isLoading ? (
        <Alert severity="info">{t('library.empty')}</Alert>
      ) : (
        <>
          <Box sx={{ position: 'relative' }}>
            {/* Dim what is on screen while a filter or sort change loads. */}
            {isLoading && collections.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  bgcolor: 'rgba(0, 0, 0, 0.3)',
                  zIndex: 1,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  pt: 8,
                  borderRadius: 1,
                }}
              >
                <CircularProgress />
              </Box>
            )}

            {viewMode === 'poster' ? (
              <Grid container spacing={2}>
                {collections.map((collection) => (
                  <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                    <CollectionPosterCard
                      collection={collection}
                      libraryType={library.libraryType}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedIds.has(collection.id)}
                      favorited={favoritedIds.has(collection.id)}
                      inWatchLater={watchLaterIds.has(collection.id)}
                      watchSummary={watchSummaries[collection.id]}
                      onClick={handleItemClick}
                      onAddToCollection={handleAddToCollection}
                    />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Stack spacing={1}>
                {collections.map((collection) => (
                  <CollectionListCard
                    key={collection.id}
                    collection={collection}
                    libraryType={library.libraryType}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedIds.has(collection.id)}
                    favorited={favoritedIds.has(collection.id)}
                    inWatchLater={watchLaterIds.has(collection.id)}
                    watchSummary={watchSummaries[collection.id]}
                    onClick={handleItemClick}
                    onAddToCollection={handleAddToCollection}
                    onPlay={handlePlay}
                  />
                ))}
              </Stack>
            )}
          </Box>

          <Box ref={loadMoreRef} sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
            {isLoadingMore && <CircularProgress size={32} />}
          </Box>
        </>
      )}

      <AddToCollectionDialog
        open={addToCollectionOpen}
        onClose={() => {
          setAddToCollectionOpen(false);
          setSelectedCollectionForAdd(null);
        }}
        collectionId={selectedCollectionForAdd?.id}
        itemName={selectedCollectionForAdd?.name || ''}
      />

      <QuickSearchOverlay query={quickSearchQuery} matchCount={isQuickSearchActive ? total : undefined} />

      <SelectionActionBar
        selectedCount={selectedIds.size}
        selectedCollectionIds={Array.from(selectedIds)}
        onClear={clearSelection}
        onSelectAll={() => setSelectedIds(new Set(collections.map((c) => c.id)))}
      />
    </Container>
  );
}
