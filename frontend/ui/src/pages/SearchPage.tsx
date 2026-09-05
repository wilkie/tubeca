import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScrollRestoration } from '../context/ScrollRestorationContext';
import { useApiInfiniteQuery, useApiQuery } from '../hooks/useApiQuery';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
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
import {
  Search,
  Movie,
  Tv,
  Album,
  VideoFile,
  AudioFile,
  FilterList,
  Clear,
  CheckBox,
  CheckBoxOutlineBlank,
  Person as PersonIcon,
} from '@mui/icons-material';
import { apiClient, type Collection, type Media, type Keyword } from '../api/client';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';
import { SelectionActionBar } from '../components/SelectionActionBar';
import { WatchBadge } from '../components/WatchBadge';
import { useWatchState } from '../hooks/useWatchState';

const ITEMS_PER_PAGE = 50;

// State that gets cached for scroll restoration
export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  // Coming back with the back button restores the scroll offset; the results
  // themselves come from the query cache.
  useScrollRestoration(`search-${initialQuery}`);

  const [query, setQuery] = useState(initialQuery);
  const [excludedRatings, setExcludedRatings] = useState<Set<string>>(new Set());
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [badgeHovered, setBadgeHovered] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());

  // Available filters (populated from first unfiltered load, persists for the session)
  // Filter options come from the server, so they cover every library rather
  // than whatever happened to be on the first page of results.
  const { data: facets } = useApiQuery(['search-facets'], () => apiClient.getSearchFacets());
  const allContentRatings = useMemo(() => {
    const order = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];
    return [...(facets?.contentRatings ?? [])].sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [facets]);
  const allKeywords: Keyword[] = facets?.keywords ?? [];

  // Ref for infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const searchQuery = initialQuery.trim();
  const keywordIds = useMemo(() => selectedKeywords.map((k) => k.id).sort(), [selectedKeywords]);
  const excluded = useMemo(() => Array.from(excludedRatings).sort(), [excludedRatings]);

  // Results page by page, held in the query cache: coming back to a search
  // that was scrolled some way down re-renders what was already fetched.
  const resultsQuery = useApiInfiniteQuery(
    ['search', searchQuery, keywordIds.join(','), excluded.join(',')],
    (page) =>
      apiClient.search({
        query: searchQuery || undefined,
        page,
        limit: ITEMS_PER_PAGE,
        keywordIds: keywordIds.length > 0 ? keywordIds : undefined,
        excludedRatings: excluded.length > 0 ? excluded : undefined,
      })
  );

  const collections: Collection[] = useMemo(
    () => resultsQuery.pages.flatMap((page) => page.collections),
    [resultsQuery.pages]
  );
  const media: Media[] = useMemo(
    () => resultsQuery.pages.flatMap((page) => page.media),
    [resultsQuery.pages]
  );
  // What has been watched, for the badges on the cards below. Search results
  // are the one place a viewer sees an episode without its season around it,
  // which is exactly where "have I seen this?" is hardest to answer.
  const mediaIds = useMemo(() => media.map((item) => item.id), [media]);
  const collectionIds = useMemo(() => collections.map((item) => item.id), [collections]);
  const { progress: watchProgress, summaries: watchSummaries } = useWatchState({
    mediaIds,
    collectionIds,
  });

  const totalCollections = resultsQuery.pages[0]?.totalCollections ?? 0;
  const totalMedia = resultsQuery.pages[0]?.totalMedia ?? 0;
  const isLoading = resultsQuery.isPending;
  const isLoadingMore = resultsQuery.isFetchingNextPage;
  const hasMore = Boolean(resultsQuery.hasNextPage);
  const error = resultsQuery.errorMessage;

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && !isLoadingMore) {
          void resultsQuery.fetchNextPage();
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
  }, [hasMore, isLoading, isLoadingMore, resultsQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    setSearchParams(trimmedQuery ? { q: trimmedQuery } : {});
  };

  // Live search: the box drives the query string once typing pauses. Replacing
  // rather than pushing keeps one history entry per search rather than one per
  // keystroke, so Back leaves the page instead of retyping it backwards.
  const debouncedQuery = useDebouncedValue(query, 400);
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === initialQuery.trim()) return;
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
  }, [debouncedQuery, initialQuery, setSearchParams]);

  // People are searched separately: they belong to no library, and the endpoint
  // is a name lookup rather than part of the content index.
  const personQuery = debouncedQuery.trim();
  const { data: personResults } = useApiQuery(
    ['person-search', personQuery],
    () => apiClient.searchPersons(personQuery),
    { enabled: personQuery.length >= 2 }
  );
  const persons = personResults?.persons ?? [];

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

      {!isLoading && totalResults === 0 && persons.length === 0 && (
        <Alert severity="info">{t('search.noResults')}</Alert>
      )}

      {persons.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.people', 'People')} ({persons.length})
          </Typography>
          <Grid container spacing={2}>
            {persons.map((person) => {
              const photo = person.images?.[0];
              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={person.id}>
                  <Card sx={{ height: '100%' }}>
                    <CardActionArea onClick={() => navigate(`/person/${person.id}`)}>
                      {photo ? (
                        <CardMedia
                          component="img"
                          image={apiClient.getImageUrl(photo.id, 'w200')}
                          alt={person.name}
                          sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
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
                          <PersonIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
                        </Box>
                      )}
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography variant="body2" noWrap title={person.name}>
                          {person.name}
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
                            image={apiClient.getImageUrl(primaryImage.id, 'w400')}
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
                        <WatchBadge kind="collection" summary={watchSummaries[collection.id]} />
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
                            image={apiClient.getImageUrl(primaryImage.id, 'w400')}
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
                        <WatchBadge kind="media" progress={watchProgress[item.id]} />
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
