import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCachedState, useScrollRestoration } from '../context/ScrollRestorationContext';
import {
  Box,
  Container,
  Typography,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Divider,
  Stack,
  IconButton,
  Collapse,
  Tooltip,
  Badge,
} from '@mui/material';
import { Search, Movie, Tv, Album, VideoFile, AudioFile, FilterList, Clear, CheckBox, CheckBoxOutlineBlank } from '@mui/icons-material';
import { apiClient, type Collection, type Media, type Keyword } from '../api/client';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';
import { SelectionActionBar } from '../components/SelectionActionBar';

const ITEMS_PER_PAGE = 50;

// State that gets cached for scroll restoration
interface CachedSearchState {
  collections: Collection[];
  media: Media[];
  page: number;
  hasMore: boolean;
  totalCollections: number;
  totalMedia: number;
  allContentRatings: string[];
  allKeywords: Keyword[];
  query: string;
}

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  // Check for cached state to restore on back navigation
  const cacheKey = `search-${initialQuery}`;
  const { cachedState } = useCachedState<CachedSearchState>(cacheKey);

  const [query, setQuery] = useState(cachedState?.query ?? initialQuery);
  const [collections, setCollections] = useState<Collection[]>(cachedState?.collections ?? []);
  const [media, setMedia] = useState<Media[]>(cachedState?.media ?? []);
  const [isLoading, setIsLoading] = useState(!cachedState);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excludedRatings, setExcludedRatings] = useState<Set<string>>(new Set());
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [badgeHovered, setBadgeHovered] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());

  // Pagination state
  const [page, setPage] = useState(cachedState?.page ?? 1);
  const [hasMore, setHasMore] = useState(cachedState?.hasMore ?? true);
  const [totalCollections, setTotalCollections] = useState(cachedState?.totalCollections ?? 0);
  const [totalMedia, setTotalMedia] = useState(cachedState?.totalMedia ?? 0);

  // Available filters (populated from first unfiltered load, persists for the session)
  const [allContentRatings, setAllContentRatings] = useState<string[]>(cachedState?.allContentRatings ?? []);
  const [allKeywords, setAllKeywords] = useState<Keyword[]>(cachedState?.allKeywords ?? []);

  // Ref for infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Track if we restored from cache - used to skip initial fetch and block infinite scroll
  // Check both cachedState AND results length because in StrictMode, cachedState might be
  // null on the second mount (if isBackNavigation changed), but state persists
  const restoredFromCacheRef = useRef(cachedState !== null || collections.length > 0 || media.length > 0);

  // Build current state for caching
  const getCurrentState = useCallback((): CachedSearchState => ({
    collections,
    media,
    page,
    hasMore,
    totalCollections,
    totalMedia,
    allContentRatings,
    allKeywords,
    query,
  }), [collections, media, page, hasMore, totalCollections, totalMedia, allContentRatings, allKeywords, query]);

  // Scroll restoration - handles saving state and restoring scroll position
  useScrollRestoration(cacheKey, getCurrentState);

  // Unblock infinite scroll after restoration is complete
  useEffect(() => {
    if (restoredFromCacheRef.current) {
      const timeout = setTimeout(() => {
        restoredFromCacheRef.current = false;
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, []);

  // Track current search params to detect changes
  // Initialize with current values if restored from cache to prevent unwanted refetch
  const searchParamsRef = useRef(
    cachedState
      ? { query: initialQuery.trim(), keywordIds: [] as string[], excludedRatings: [] as string[] }
      : { query: '', keywordIds: [] as string[], excludedRatings: [] as string[] }
  );

  // Build search params object
  const currentSearchParams = useMemo(() => ({
    query: initialQuery.trim(),
    keywordIds: selectedKeywords.map((k) => k.id),
    excludedRatings: Array.from(excludedRatings),
  }), [initialQuery, selectedKeywords, excludedRatings]);

  // Perform search
  const performSearch = useCallback(async (pageNum: number, append: boolean = false) => {
    const isFirstPage = pageNum === 1;

    if (isFirstPage) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);

    const result = await apiClient.search({
      query: currentSearchParams.query || undefined,
      page: pageNum,
      limit: ITEMS_PER_PAGE,
      keywordIds: currentSearchParams.keywordIds.length > 0 ? currentSearchParams.keywordIds : undefined,
      excludedRatings: currentSearchParams.excludedRatings.length > 0 ? currentSearchParams.excludedRatings : undefined,
    });

    if (result.error) {
      setError(result.error);
      if (isFirstPage) {
        setCollections([]);
        setMedia([]);
      }
    } else if (result.data) {
      if (append) {
        setCollections((prev) => [...prev, ...result.data!.collections]);
        setMedia((prev) => [...prev, ...result.data!.media]);
      } else {
        setCollections(result.data.collections);
        setMedia(result.data.media);
      }
      setTotalCollections(result.data.totalCollections);
      setTotalMedia(result.data.totalMedia);
      setHasMore(result.data.hasMore);
      setPage(pageNum);

      // When loading first page without filters, update available filter options
      const filtersApplied = currentSearchParams.keywordIds.length > 0 || currentSearchParams.excludedRatings.length > 0;
      if (isFirstPage && !filtersApplied) {
        // Extract content ratings from results
        const ratings = new Set<string>();
        result.data.collections.forEach((c) => {
          if (c.filmDetails?.contentRating) {
            ratings.add(c.filmDetails.contentRating);
          }
        });
        const ratingOrder = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];
        const sortedRatings = Array.from(ratings).sort((a, b) => {
          const aIndex = ratingOrder.indexOf(a);
          const bIndex = ratingOrder.indexOf(b);
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
          return a.localeCompare(b);
        });
        setAllContentRatings(sortedRatings);

        // Extract keywords from results
        const keywordMap = new Map<string, Keyword>();
        result.data.collections.forEach((c) => {
          c.keywords?.forEach((k) => {
            if (!keywordMap.has(k.id)) {
              keywordMap.set(k.id, k);
            }
          });
        });
        const sortedKeywords = Array.from(keywordMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        setAllKeywords(sortedKeywords);
      }
    }

    setIsLoading(false);
    setIsLoadingMore(false);
  }, [currentSearchParams]);

  // Load data when search params change (query or filters)
  useEffect(() => {
    const paramsChanged =
      searchParamsRef.current.query !== currentSearchParams.query ||
      JSON.stringify(searchParamsRef.current.keywordIds) !== JSON.stringify(currentSearchParams.keywordIds) ||
      JSON.stringify(searchParamsRef.current.excludedRatings) !== JSON.stringify(currentSearchParams.excludedRatings);

    if (paramsChanged) {
      searchParamsRef.current = { ...currentSearchParams };
      performSearch(1);
    }
  }, [currentSearchParams, performSearch]);

  // Load initial data on mount (skip if restored from cache)
  useEffect(() => {
    if (restoredFromCacheRef.current) return;
    performSearch(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Skip if we're still in the restoration period (prevents accidental pagination)
        if (restoredFromCacheRef.current) return;

        if (entries[0].isIntersecting && hasMore && !isLoading && !isLoadingMore) {
          performSearch(page + 1, true);
        }
      },
      { rootMargin: '200px' }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, isLoading, isLoadingMore, page, performSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      setSearchParams({ q: trimmedQuery });
    } else {
      // Clear query param to show all results
      setSearchParams({});
    }
  };

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const toggleCollectionSelection = (collectionId: string) => {
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  };

  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedCollectionIds(new Set());
    setSelectedMediaIds(new Set());
    setIsSelectionMode(false);
  };

  const selectAll = () => {
    setSelectedCollectionIds(new Set(collections.map((c) => c.id)));
    setSelectedMediaIds(new Set(media.map((m) => m.id)));
  };

  const handleCollectionItemClick = (collectionId: string) => {
    if (isSelectionMode) {
      toggleCollectionSelection(collectionId);
    } else {
      handleCollectionClick(collectionId);
    }
  };

  const handleMediaItemClick = (mediaId: string) => {
    if (isSelectionMode) {
      toggleMediaSelection(mediaId);
    } else {
      handleMediaClick(mediaId);
    }
  };

  const selectedCount = selectedCollectionIds.size + selectedMediaIds.size;
  const activeFilterCount = excludedRatings.size + selectedKeywords.length;
  const totalResults = collections.length + media.length;
  const showFilterButton = allContentRatings.length > 0 || allKeywords.length > 0 || activeFilterCount > 0;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        {t('search.title')}
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Box component="form" onSubmit={handleSearchSubmit} sx={{ flex: 1 }}>
          <TextField
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        <Tooltip title={isSelectionMode ? t('selection.exitMode') : t('selection.enterMode')}>
          <IconButton
            onClick={() => {
              if (isSelectionMode) {
                clearSelection();
              } else {
                setIsSelectionMode(true);
              }
            }}
            color={isSelectionMode ? 'primary' : 'default'}
          >
            {isSelectionMode ? <CheckBox /> : <CheckBoxOutlineBlank />}
          </IconButton>
        </Tooltip>
        {showFilterButton && (() => {
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
                  onClick={() => setShowFilters((prev) => !prev)}
                  color={showFilters ? 'primary' : 'default'}
                  aria-label={t('library.filter.toggle', 'Toggle filters')}
                >
                  <FilterList />
                </IconButton>
              </Badge>
            </Tooltip>
          );
        })()}
      </Stack>

      {/* Filter Section (collapsible) */}
      <Collapse in={showFilters}>
        {allContentRatings.length > 0 && (
          <FilterChips
            label={t('library.filter.rating', 'Rating')}
            options={allContentRatings}
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
            onSelectOnly={(rating) => setExcludedRatings(new Set(allContentRatings.filter((r) => r !== rating)))}
          />
        )}
        <KeywordFilter
          keywords={allKeywords}
          selectedKeywords={selectedKeywords}
          onSelectionChange={setSelectedKeywords}
        />
      </Collapse>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!isLoading && totalResults === 0 && (
        <Alert severity="info">{t('search.noResults')}</Alert>
      )}

      {!isLoading && collections.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.collections')} ({totalCollections})
          </Typography>
          <Grid container spacing={2}>
            {collections.map((collection) => {
              const primaryImage = collection.images?.[0];
              const hasImage = primaryImage != null;

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      ...(isSelectionMode && selectedCollectionIds.has(collection.id) && {
                        outline: '3px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: -3,
                      }),
                    }}
                  >
                    <CardActionArea
                      onClick={() => handleCollectionItemClick(collection.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <Box sx={{ position: 'relative' }}>
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
                            {collection.collectionType === 'Film' ? (
                              <Movie sx={{ fontSize: 64, color: 'text.secondary' }} />
                            ) : collection.collectionType === 'Show' ? (
                              <Tv sx={{ fontSize: 64, color: 'text.secondary' }} />
                            ) : collection.collectionType === 'Album' || collection.collectionType === 'Artist' ? (
                              <Album sx={{ fontSize: 64, color: 'text.secondary' }} />
                            ) : (
                              <Movie sx={{ fontSize: 64, color: 'text.secondary' }} />
                            )}
                          </Box>
                        )}
                        {/* Selection checkbox */}
                        {isSelectionMode && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              bgcolor: 'rgba(0, 0, 0, 0.6)',
                              borderRadius: '50%',
                              width: 28,
                              height: 28,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {selectedCollectionIds.has(collection.id) ? (
                              <CheckBox sx={{ color: 'primary.main', fontSize: 24 }} />
                            ) : (
                              <CheckBoxOutlineBlank sx={{ color: 'white', fontSize: 24 }} />
                            )}
                          </Box>
                        )}
                      </Box>
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography variant="body2" noWrap title={collection.name}>
                          {collection.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {collection.library?.name}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {!isLoading && collections.length > 0 && media.length > 0 && (
        <Divider sx={{ my: 3 }} />
      )}

      {!isLoading && media.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.media')} ({totalMedia})
          </Typography>
          <Grid container spacing={2}>
            {media.map((item) => {
              const primaryImage = item.images?.[0];
              const hasImage = primaryImage != null;

              // Build subtitle showing show/season/episode info
              let subtitle = '';
              if (item.videoDetails) {
                const { season, episode } = item.videoDetails;
                if (season != null && episode != null) {
                  subtitle = `S${season}E${episode}`;
                }
              } else if (item.audioDetails) {
                const { track, disc } = item.audioDetails;
                if (disc != null && track != null) {
                  subtitle = `Disc ${disc}, Track ${track}`;
                } else if (track != null) {
                  subtitle = `Track ${track}`;
                }
              }

              // Add collection/show name
              if (item.collection) {
                const collectionName = item.collection.parent?.name || item.collection.name;
                if (subtitle) {
                  subtitle = `${collectionName} - ${subtitle}`;
                } else {
                  subtitle = collectionName;
                }
              }

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      ...(isSelectionMode && selectedMediaIds.has(item.id) && {
                        outline: '3px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: -3,
                      }),
                    }}
                  >
                    <CardActionArea
                      onClick={() => handleMediaItemClick(item.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <Box sx={{ position: 'relative' }}>
                        {hasImage ? (
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(primaryImage.id)}
                            alt={item.name}
                            sx={{
                              aspectRatio: '16/9',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              aspectRatio: '16/9',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'action.hover',
                            }}
                          >
                            {item.type === 'Video' ? (
                              <VideoFile sx={{ fontSize: 48, color: 'text.secondary' }} />
                            ) : (
                              <AudioFile sx={{ fontSize: 48, color: 'text.secondary' }} />
                            )}
                          </Box>
                        )}
                        {/* Selection checkbox */}
                        {isSelectionMode && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              bgcolor: 'rgba(0, 0, 0, 0.6)',
                              borderRadius: '50%',
                              width: 28,
                              height: 28,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {selectedMediaIds.has(item.id) ? (
                              <CheckBox sx={{ color: 'primary.main', fontSize: 24 }} />
                            ) : (
                              <CheckBoxOutlineBlank sx={{ color: 'white', fontSize: 24 }} />
                            )}
                          </Box>
                        )}
                      </Box>
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography variant="body2" noWrap title={item.name}>
                          {item.name}
                        </Typography>
                        {subtitle && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {subtitle}
                          </Typography>
                        )}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* Infinite scroll sentinel */}
      {hasMore && !isLoading && (
        <Box ref={loadMoreRef} sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          {isLoadingMore && <CircularProgress />}
        </Box>
      )}

      {/* Selection Action Bar */}
      <SelectionActionBar
        selectedCount={selectedCount}
        selectedCollectionIds={Array.from(selectedCollectionIds)}
        selectedMediaIds={Array.from(selectedMediaIds)}
        onClear={clearSelection}
        onSelectAll={selectAll}
      />
    </Container>
  );
}
