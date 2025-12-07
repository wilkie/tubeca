import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Stack,
  IconButton,
  Collapse,
  Tooltip,
  Badge,
} from '@mui/material';
import { Folder, Movie, Tv, Album, FilterList, Clear, PlayArrow } from '@mui/icons-material';
import { apiClient, type Library, type Collection, type Keyword } from '../api/client';
import { CardQuickActions } from '../components/CardQuickActions';
import { SortControls, type SortDirection, type SortOption } from '../components/SortControls';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';
import { AddToCollectionDialog } from '../components/AddToCollectionDialog';
import { ViewModeMenu, type ViewMode } from '../components/ViewModeMenu';

type SortField = 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';

const PAGE_SIZE = 50;

// Standard content ratings in order
const CONTENT_RATING_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];

export function LibraryPage() {
  const { t } = useTranslation();
  const { libraryId } = useParams<{ libraryId: string }>();
  const navigate = useNavigate();

  // Core state
  const [library, setLibrary] = useState<Library | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Sort/filter state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [excludedRatings, setExcludedRatings] = useState<Set<string>>(new Set());
  const [availableKeywords, setAvailableKeywords] = useState<Keyword[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [availableContentRatings, setAvailableContentRatings] = useState<string[]>([]);

  // UI state
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [watchLaterIds, setWatchLaterIds] = useState<Set<string>>(new Set());
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [selectedCollectionForAdd, setSelectedCollectionForAdd] = useState<Collection | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [badgeHovered, setBadgeHovered] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('poster');

  // Ref for infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Track if keywords have been loaded (lazy load on filter panel open)
  const keywordsLoadedRef = useRef(false);
  const [keywordsLoading, setKeywordsLoading] = useState(false);

  // Fetch collections with current filters/sort
  const fetchCollections = useCallback(async (
    pageNum: number,
    append: boolean = false
  ) => {
    if (!libraryId) return;

    if (pageNum === 1) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    const result = await apiClient.getCollectionsByLibrary(libraryId, {
      page: pageNum,
      limit: PAGE_SIZE,
      sortField,
      sortDirection,
      excludedRatings: excludedRatings.size > 0 ? Array.from(excludedRatings) : undefined,
      keywordIds: selectedKeywords.length > 0 ? selectedKeywords.map(k => k.id) : undefined,
    });

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      if (append) {
        setCollections(prev => [...prev, ...result.data!.collections]);
      } else {
        setCollections(result.data.collections);
      }
      setTotal(result.data.total);
      setHasMore(result.data.hasMore);
      setPage(result.data.page);

      // Fetch favorites/watch later for new collections
      const newIds = result.data.collections.map(c => c.id);
      if (newIds.length > 0) {
        const [favResult, watchLaterResult] = await Promise.all([
          apiClient.checkFavorites(newIds),
          apiClient.checkWatchLater(newIds),
        ]);

        if (favResult.data) {
          setFavoritedIds(prev => {
            const next = new Set(prev);
            favResult.data!.collectionIds.forEach(id => next.add(id));
            return next;
          });
        }
        if (watchLaterResult.data) {
          setWatchLaterIds(prev => {
            const next = new Set(prev);
            watchLaterResult.data!.collectionIds.forEach(id => next.add(id));
            return next;
          });
        }
      }

      // Extract content ratings from loaded collections (for Film libraries)
      if (!append) {
        const ratings = new Set<string>();
        result.data.collections.forEach(c => {
          if (c.filmDetails?.contentRating) {
            ratings.add(c.filmDetails.contentRating);
          }
        });
        // We'll accumulate ratings as we load more
        setAvailableContentRatings(prev => {
          const combined = new Set([...prev, ...ratings]);
          return Array.from(combined).sort((a, b) => {
            const aIndex = CONTENT_RATING_ORDER.indexOf(a);
            const bIndex = CONTENT_RATING_ORDER.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
          });
        });
      }
    }

    setIsLoading(false);
    setIsLoadingMore(false);
  }, [libraryId, sortField, sortDirection, excludedRatings, selectedKeywords]);

  // Initial load - fetch library details
  useEffect(() => {
    if (!libraryId) return;

    let cancelled = false;

    // Clear all previous library data immediately to prevent stale content flash
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync clear on libraryId change
    setLibrary(null);
    setCollections([]);
    setAvailableKeywords([]);
    setSelectedKeywords([]);
    setAvailableContentRatings([]);
    setExcludedRatings(new Set());
    setFavoritedIds(new Set());
    setWatchLaterIds(new Set());
    setPage(1);
    setTotal(0);
    setHasMore(false);
    keywordsLoadedRef.current = false;

    async function fetchInitialData() {
      setIsLoading(true);
      setError(null);

      // Fetch library details
      const libraryResult = await apiClient.getLibrary(libraryId!);
      if (cancelled) return;

      if (libraryResult.error) {
        setError(libraryResult.error);
        setIsLoading(false);
        return;
      }

      if (libraryResult.data) {
        setLibrary(libraryResult.data.library);
      }

      // Fetch first page of collections (keywords are lazy-loaded when filter panel opens)
      await fetchCollections(1);
    }

    fetchInitialData();

    return () => {
      cancelled = true;
    };
  }, [libraryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when sort/filter changes
  useEffect(() => {
    if (!library) return; // Don't refetch until initial load is done

    // Reset favorites/watchLater but keep collections visible until new data arrives
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync clear on filter change
    setFavoritedIds(new Set());
    setWatchLaterIds(new Set());
    fetchCollections(1);
  }, [sortField, sortDirection, excludedRatings, selectedKeywords]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          fetchCollections(page + 1, true);
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = loadMoreRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
    };
  }, [hasMore, isLoadingMore, page, fetchCollections]);

  // Sort options for the dropdown
  const sortOptions: SortOption[] = useMemo(() => [
    { value: 'name', label: t('library.sort.name') },
    { value: 'dateAdded', label: t('library.sort.dateAdded') },
    { value: 'releaseDate', label: t('library.sort.releaseDate') },
    { value: 'rating', label: t('library.sort.rating') },
    { value: 'runtime', label: t('library.sort.runtime') },
  ], [t]);

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleAddToCollection = (collection: Collection) => {
    setSelectedCollectionForAdd(collection);
    setAddToCollectionOpen(true);
  };

  const handlePlay = async (collectionId: string) => {
    // Fetch the collection to get its media
    const result = await apiClient.getCollection(collectionId);
    if (!result.data) return;

    const col = result.data.collection;
    let mediaId: string | null = null;

    // For films, play the first media item directly
    if (col.media && col.media.length > 0) {
      mediaId = col.media[0].id;
    }
    // For shows, get the first episode from the first season
    else if (col.children && col.children.length > 0) {
      // Sort seasons by name to get first season
      const sortedSeasons = [...col.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const firstSeason = sortedSeasons[0];

      // Fetch the season to get its episodes
      const seasonResult = await apiClient.getCollection(firstSeason.id);
      if (seasonResult.data?.collection.media && seasonResult.data.collection.media.length > 0) {
        // Sort episodes by episode number
        const sortedEpisodes = [...seasonResult.data.collection.media].sort((a, b) => {
          const aNum = a.videoDetails?.episode ?? 0;
          const bNum = b.videoDetails?.episode ?? 0;
          return aNum - bNum;
        });
        mediaId = sortedEpisodes[0].id;
      }
    }

    if (mediaId) {
      await apiClient.setPlaybackQueue([{ mediaId }]);
      navigate(`/play/${mediaId}`);
    }
  };

  // Lazy load keywords when filter panel is opened for the first time
  const handleToggleFilters = async () => {
    const willOpen = !showFilters;
    setShowFilters(willOpen);

    // Fetch keywords on first open
    if (willOpen && !keywordsLoadedRef.current && libraryId) {
      keywordsLoadedRef.current = true;
      setKeywordsLoading(true);
      const keywordsResult = await apiClient.getKeywordsByLibrary(libraryId);
      if (keywordsResult.data) {
        setAvailableKeywords(keywordsResult.data.keywords);
      }
      setKeywordsLoading(false);
    }
  };

  // Only show content rating filter for Film libraries
  const showContentRatingFilter = library?.libraryType === 'Film' && availableContentRatings.length > 0;

  // Only show full-page spinner during initial library load (when library is null)
  // For filter changes, keep the page visible and show inline loading
  if (!library && isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
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

  const activeFilterCount = excludedRatings.size + selectedKeywords.length;

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
        flexWrap="wrap"
        gap={2}
      >
        <Typography variant="h4" component="h1">
          {library.name}
          {total > 0 && (
            <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 2 }}>
              ({total})
            </Typography>
          )}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center">
          {(showContentRatingFilter || availableKeywords.length > 0) && (() => {
            const canClear = activeFilterCount > 0;
            return (
              <Tooltip title={canClear && badgeHovered ? t('library.filter.clearAll', 'Clear') : t('library.filter.toggle', 'Toggle filters')}>
                <Badge
                  badgeContent={canClear && badgeHovered ? <Clear sx={{ fontSize: 12 }} /> : activeFilterCount}
                  color={canClear && badgeHovered ? 'error' : 'primary'}
                  max={99}
                  slotProps={{
                    badge: {
                      onMouseEnter: () => canClear && setBadgeHovered(true),
                      onMouseLeave: () => setBadgeHovered(false),
                      onClick: (e: React.MouseEvent) => {
                        if (canClear) {
                          e.stopPropagation();
                          setExcludedRatings(new Set());
                          setSelectedKeywords([]);
                          setBadgeHovered(false);
                        }
                      },
                      style: {
                        width: 20,
                        height: 20,
                        ...(canClear ? { cursor: 'pointer' } : {}),
                      },
                    },
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={handleToggleFilters}
                    color={showFilters ? 'primary' : 'default'}
                  >
                    <FilterList />
                  </IconButton>
                </Badge>
              </Tooltip>
            );
          })()}
          <ViewModeMenu value={viewMode} onChange={setViewMode} />
          <SortControls
            options={sortOptions}
            value={sortField}
            direction={sortDirection}
            onValueChange={(v) => setSortField(v as SortField)}
            onDirectionChange={setSortDirection}
          />
        </Stack>
      </Stack>

      {/* Filter Section (collapsible) */}
      <Collapse in={showFilters}>
        {/* Content Rating Filter (Film libraries only) */}
        {showContentRatingFilter && (
          <FilterChips
            label={t('library.filter.rating', 'Rating')}
            options={availableContentRatings}
            excluded={excludedRatings}
            onToggle={(rating) => {
              setExcludedRatings((prev) => {
                const next = new Set(prev);
                if (next.has(rating)) {
                  next.delete(rating);
                } else {
                  next.add(rating);
                }
                return next;
              });
            }}
            onClear={() => setExcludedRatings(new Set())}
            onSelectOnly={(rating) => setExcludedRatings(new Set(availableContentRatings.filter((r) => r !== rating)))}
          />
        )}

        {/* Keyword/Tag Filter */}
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
            {/* Loading overlay for filter/sort changes */}
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
                {collections.map((collection) => {
                  const primaryImage = collection.images?.[0];
                  const hasImage = primaryImage && (collection.collectionType === 'Show' || library.libraryType === 'Film');

                  // Get rating info from showDetails or filmDetails
                  const rating = collection.filmDetails?.rating ?? collection.showDetails?.rating;
                  const contentRating = collection.filmDetails?.contentRating;
                  const hasRatingInfo = rating != null || contentRating != null;

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                      <Card
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          position: 'relative',
                          '&:hover .rating-overlay': {
                            opacity: 1,
                          },
                        }}
                      >
                        <CardActionArea
                          onClick={() => handleCollectionClick(collection.id)}
                          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                        >
                          {/* Rating overlay (visible on hover) */}
                          {hasRatingInfo && (
                            <Box
                              className="rating-overlay"
                              sx={{
                                position: 'absolute',
                                top: 8,
                                left: 8,
                                zIndex: 2,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0.5,
                                opacity: 0,
                                transition: 'opacity 0.2s ease-in-out',
                              }}
                            >
                              {contentRating && (
                                <Box
                                  sx={{
                                    bgcolor: 'rgba(0, 0, 0, 0.75)',
                                    color: 'white',
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: 0.5,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  {contentRating}
                                </Box>
                              )}
                              {rating != null && (
                                <Box
                                  sx={{
                                    bgcolor: 'rgba(0, 0, 0, 0.75)',
                                    color: 'white',
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: 0.5,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                  }}
                                >
                                  ★ {rating.toFixed(1)}
                                </Box>
                              )}
                            </Box>
                          )}
                          {hasImage ? (
                            <CardMedia
                              component="img"
                              image={apiClient.getImageUrl(primaryImage.id)}
                              alt={collection.name}
                              sx={{
                                aspectRatio: '2/3',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <Box
                              sx={{
                                aspectRatio: '2/3',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'action.hover',
                              }}
                            >
                              {library.libraryType === 'Film' ? (
                                <Movie sx={{ fontSize: 64, color: 'text.secondary' }} />
                              ) : library.libraryType === 'Television' ? (
                                <Tv sx={{ fontSize: 64, color: 'text.secondary' }} />
                              ) : library.libraryType === 'Music' ? (
                                <Album sx={{ fontSize: 64, color: 'text.secondary' }} />
                              ) : (
                                <Folder sx={{ fontSize: 64, color: 'text.secondary' }} />
                              )}
                            </Box>
                          )}
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="body2" noWrap title={collection.name}>
                              {collection.name}
                            </Typography>
                            {library.libraryType !== 'Film' && collection._count && (
                              <Typography variant="caption" color="text.secondary">
                                {collection._count.children > 0 &&
                                  (collection.collectionType === 'Show'
                                    ? t('library.seasons', { count: collection._count.children })
                                    : t('library.folders', { count: collection._count.children }))}
                                {collection._count.children > 0 && collection._count.media > 0 && ' | '}
                                {collection._count.media > 0 &&
                                  t('library.items', { count: collection._count.media })}
                              </Typography>
                            )}
                          </CardContent>
                        </CardActionArea>
                        <CardQuickActions
                          collectionId={collection.id}
                          initialFavorited={favoritedIds.has(collection.id)}
                          initialInWatchLater={watchLaterIds.has(collection.id)}
                          onAddToCollection={() => handleAddToCollection(collection)}
                        />
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            ) : (
              /* List View */
              <Stack spacing={1}>
                {collections.map((collection) => {
                  const primaryImage = collection.images?.[0];
                  const hasImage = primaryImage && (collection.collectionType === 'Show' || library.libraryType === 'Film');

                  // Get details from showDetails or filmDetails
                  const rating = collection.filmDetails?.rating ?? collection.showDetails?.rating;
                  const contentRating = collection.filmDetails?.contentRating;
                  const releaseYear = collection.filmDetails?.releaseDate?.slice(0, 4) ?? collection.showDetails?.releaseDate?.slice(0, 4);
                  const runtime = collection.filmDetails?.runtime;
                  const description = collection.filmDetails?.description ?? collection.showDetails?.description;

                  return (
                    <Card key={collection.id} sx={{ display: 'flex' }}>
                      {/* Image - fixed width based on 2:3 aspect ratio at max height of 188px */}
                      <CardActionArea
                        onClick={() => handleCollectionClick(collection.id)}
                        sx={{
                          width: 125,
                          flexShrink: 0,
                          flexGrow: 0,
                        }}
                      >
                        {hasImage ? (
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(primaryImage.id)}
                            alt={collection.name}
                            sx={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'action.hover',
                            }}
                          >
                            {library.libraryType === 'Film' ? (
                              <Movie sx={{ fontSize: 32, color: 'text.secondary' }} />
                            ) : library.libraryType === 'Television' ? (
                              <Tv sx={{ fontSize: 32, color: 'text.secondary' }} />
                            ) : library.libraryType === 'Music' ? (
                              <Album sx={{ fontSize: 32, color: 'text.secondary' }} />
                            ) : (
                              <Folder sx={{ fontSize: 32, color: 'text.secondary' }} />
                            )}
                          </Box>
                        )}
                      </CardActionArea>

                      {/* Details */}
                      <CardActionArea
                        onClick={() => handleCollectionClick(collection.id)}
                        sx={{ flexGrow: 1, display: 'flex', alignItems: 'flex-start' }}
                      >
                        <CardContent sx={{ py: 1.5, px: 2, flexGrow: 1 }}>
                          <Typography variant="subtitle1" fontWeight="medium">
                            {collection.name}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                            {releaseYear && (
                              <Typography variant="caption" color="text.secondary">
                                {releaseYear}
                              </Typography>
                            )}
                            {contentRating && (
                              <Typography
                                variant="caption"
                                sx={{
                                  bgcolor: 'action.selected',
                                  px: 0.5,
                                  borderRadius: 0.5,
                                }}
                              >
                                {contentRating}
                              </Typography>
                            )}
                            {runtime && (
                              <Typography variant="caption" color="text.secondary">
                                {Math.floor(runtime / 60)}h {runtime % 60}m
                              </Typography>
                            )}
                            {rating != null && (
                              <Typography variant="caption" color="text.secondary">
                                ★ {rating.toFixed(1)}
                              </Typography>
                            )}
                            {library.libraryType !== 'Film' && collection._count && (
                              <Typography variant="caption" color="text.secondary">
                                {collection._count.children > 0 &&
                                  (collection.collectionType === 'Show'
                                    ? t('library.seasons', { count: collection._count.children })
                                    : t('library.folders', { count: collection._count.children }))}
                                {collection._count.children > 0 && collection._count.media > 0 && ' • '}
                                {collection._count.media > 0 &&
                                  t('library.items', { count: collection._count.media })}
                              </Typography>
                            )}
                          </Stack>
                          {description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {description}
                            </Typography>
                          )}
                        </CardContent>
                      </CardActionArea>

                      {/* Actions */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
                        <IconButton
                          color="primary"
                          onClick={() => handlePlay(collection.id)}
                          sx={{ width: 40, height: 56, borderRadius: 0.5 }}
                        >
                          <PlayArrow sx={{ fontSize: 28 }} />
                        </IconButton>
                        <CardQuickActions
                          collectionId={collection.id}
                          initialFavorited={favoritedIds.has(collection.id)}
                          initialInWatchLater={watchLaterIds.has(collection.id)}
                          onAddToCollection={() => handleAddToCollection(collection)}
                          variant="inline"
                        />
                      </Box>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Box>

          {/* Infinite scroll sentinel */}
          <Box ref={loadMoreRef} sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
            {isLoadingMore && <CircularProgress size={32} />}
          </Box>
        </>
      )}

      {/* Add to Collection Dialog */}
      <AddToCollectionDialog
        open={addToCollectionOpen}
        onClose={() => {
          setAddToCollectionOpen(false);
          setSelectedCollectionForAdd(null);
        }}
        collectionId={selectedCollectionForAdd?.id}
        itemName={selectedCollectionForAdd?.name || ''}
      />
    </Container>
  );
}
