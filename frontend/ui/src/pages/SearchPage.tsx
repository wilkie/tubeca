import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { Search, Movie, Tv, Album, VideoFile, AudioFile, FilterList, Clear } from '@mui/icons-material';
import { apiClient, type Collection, type Media, type Keyword } from '../api/client';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [excludedRatings, setExcludedRatings] = useState<Set<string>>(new Set());
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [badgeHovered, setBadgeHovered] = useState(false);

  // Track the last searched query to avoid re-searching
  const lastSearchedQuery = useRef<string>('');

  // Perform search when query param changes (e.g., from URL or initial load)
  useEffect(() => {
    const searchQuery = initialQuery.trim();

    // Skip if empty or already searched this query
    if (!searchQuery || searchQuery === lastSearchedQuery.current) {
      return;
    }

    let cancelled = false;
    lastSearchedQuery.current = searchQuery;

    async function doSearch() {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      const result = await apiClient.search(searchQuery);

      if (cancelled) return;

      if (result.error) {
        setError(result.error);
        setCollections([]);
        setMedia([]);
      } else if (result.data) {
        setCollections(result.data.collections);
        setMedia(result.data.media);
      }

      setIsLoading(false);
    }

    doSearch();

    return () => {
      cancelled = true;
    };
  }, [initialQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // Reset last searched so the effect will trigger
      lastSearchedQuery.current = '';
      setSearchParams({ q: query.trim() });
    }
  };

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  // Extract available content ratings from collections
  const availableContentRatings = useMemo(() => {
    const ratings = new Set<string>();
    collections.forEach((c) => {
      if (c.filmDetails?.contentRating) {
        ratings.add(c.filmDetails.contentRating);
      }
    });
    const ratingOrder = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];
    return Array.from(ratings).sort((a, b) => {
      const aIndex = ratingOrder.indexOf(a);
      const bIndex = ratingOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [collections]);

  // Extract available keywords from collections
  const availableKeywords = useMemo(() => {
    const keywordMap = new Map<string, Keyword>();
    collections.forEach((c) => {
      c.keywords?.forEach((k) => {
        if (!keywordMap.has(k.id)) {
          keywordMap.set(k.id, k);
        }
      });
    });
    return Array.from(keywordMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [collections]);

  // Filter collections based on current filter settings
  const filteredCollections = useMemo(() => {
    let filtered = collections;

    // Filter by content rating
    if (excludedRatings.size > 0) {
      filtered = filtered.filter((c) => {
        const rating = c.filmDetails?.contentRating;
        return !rating || !excludedRatings.has(rating);
      });
    }

    // Filter by keywords (must have ALL selected keywords)
    if (selectedKeywords.length > 0) {
      const selectedKeywordIds = new Set(selectedKeywords.map((k) => k.id));
      filtered = filtered.filter((c) => {
        const collectionKeywordIds = new Set(c.keywords?.map((k) => k.id) || []);
        return [...selectedKeywordIds].every((id) => collectionKeywordIds.has(id));
      });
    }

    return filtered;
  }, [collections, excludedRatings, selectedKeywords]);

  const activeFilterCount = excludedRatings.size + selectedKeywords.length;
  const totalResults = filteredCollections.length + media.length;

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
        {hasSearched && (availableContentRatings.length > 0 || availableKeywords.length > 0) && (() => {
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
        {availableContentRatings.length > 0 && (
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
        <KeywordFilter
          keywords={availableKeywords}
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

      {!isLoading && hasSearched && totalResults === 0 && (
        <Alert severity="info">{t('search.noResults')}</Alert>
      )}

      {!isLoading && filteredCollections.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.collections')} ({filteredCollections.length})
          </Typography>
          <Grid container spacing={2}>
            {filteredCollections.map((collection) => {
              const primaryImage = collection.images?.[0];
              const hasImage = primaryImage != null;

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => handleCollectionClick(collection.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
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

      {!isLoading && filteredCollections.length > 0 && media.length > 0 && (
        <Divider sx={{ my: 3 }} />
      )}

      {!isLoading && media.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('search.media')} ({media.length})
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
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => handleMediaClick(item.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
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
    </Container>
  );
}
