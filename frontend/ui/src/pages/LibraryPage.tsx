import { useState, useEffect, useMemo } from 'react';
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
import { Folder, VideoFile, AudioFile, Movie, Tv, Album, FilterList } from '@mui/icons-material';
import { apiClient, type Library, type Collection, type Keyword } from '../api/client';
import { CardQuickActions } from '../components/CardQuickActions';
import { SortControls, type SortDirection, type SortOption } from '../components/SortControls';
import { FilterChips } from '../components/FilterChips';
import { KeywordFilter } from '../components/KeywordFilter';
import { AddToCollectionDialog } from '../components/AddToCollectionDialog';

type SortField = 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
}

// Helper to extract sortable values from collection metadata
function getSortableValue(collection: Collection, field: SortField): string | number | null {
  switch (field) {
    case 'name':
      return collection.name.toLowerCase();
    case 'dateAdded':
      return collection.createdAt;
    case 'releaseDate':
      return collection.filmDetails?.releaseDate
        ?? collection.showDetails?.releaseDate
        ?? collection.albumDetails?.releaseDate
        ?? null;
    case 'rating':
      return collection.filmDetails?.rating
        ?? collection.showDetails?.rating
        ?? null;
    case 'runtime':
      return collection.filmDetails?.runtime ?? null;
    default:
      return null;
  }
}

export function LibraryPage() {
  const { t } = useTranslation();
  const { libraryId } = useParams<{ libraryId: string }>();
  const navigate = useNavigate();
  const [library, setLibrary] = useState<Library | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [watchLaterIds, setWatchLaterIds] = useState<Set<string>>(new Set());
  const [excludedRatings, setExcludedRatings] = useState<Set<string>>(new Set());
  const [availableKeywords, setAvailableKeywords] = useState<Keyword[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Keyword[]>([]);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [selectedCollectionForAdd, setSelectedCollectionForAdd] = useState<Collection | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!libraryId) return;

    let cancelled = false;

    async function fetchData() {
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

      // Fetch collections and keywords for this library
      const [collectionsResult, keywordsResult] = await Promise.all([
        apiClient.getCollectionsByLibrary(libraryId!),
        apiClient.getKeywordsByLibrary(libraryId!),
      ]);
      if (cancelled) return;

      if (keywordsResult.data) {
        setAvailableKeywords(keywordsResult.data.keywords);
      }

      if (collectionsResult.error) {
        setError(collectionsResult.error);
      } else if (collectionsResult.data) {
        // Filter to only root collections (no parent)
        const rootCollections = collectionsResult.data.collections.filter(
          (c) => c.parentId === null
        );
        setCollections(rootCollections);

        // Fetch favorites and watch later status for all collections
        const collectionIds = rootCollections.map((c) => c.id);
        if (collectionIds.length > 0) {
          const [favResult, watchLaterResult] = await Promise.all([
            apiClient.checkFavorites(collectionIds),
            apiClient.checkWatchLater(collectionIds),
          ]);
          if (cancelled) return;

          if (favResult.data) {
            setFavoritedIds(new Set(favResult.data.collectionIds));
          }
          if (watchLaterResult.data) {
            setWatchLaterIds(new Set(watchLaterResult.data.collectionIds));
          }
        }
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  // Extract unique content ratings for film libraries
  const availableContentRatings = useMemo(() => {
    if (library?.libraryType !== 'Film') return [];
    const ratings = new Set<string>();
    collections.forEach((c) => {
      if (c.filmDetails?.contentRating) {
        ratings.add(c.filmDetails.contentRating);
      }
    });
    // Sort ratings in a logical order
    const ratingOrder = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR', 'Unrated'];
    return Array.from(ratings).sort((a, b) => {
      const aIndex = ratingOrder.indexOf(a);
      const bIndex = ratingOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [collections, library?.libraryType]);

  // Filter and sort collections based on current settings
  const sortedCollections = useMemo(() => {
    // First filter by content rating (for film libraries)
    let filtered = collections;
    if (library?.libraryType === 'Film' && excludedRatings.size > 0) {
      filtered = filtered.filter((c) => {
        const rating = c.filmDetails?.contentRating;
        // Include items with no rating, or items whose rating is not excluded
        return !rating || !excludedRatings.has(rating);
      });
    }

    // Filter by selected keywords (must have ALL selected keywords)
    if (selectedKeywords.length > 0) {
      const selectedKeywordIds = new Set(selectedKeywords.map((k) => k.id));
      filtered = filtered.filter((c) => {
        const collectionKeywordIds = new Set(c.keywords?.map((k) => k.id) || []);
        // Check if collection has all selected keywords
        return [...selectedKeywordIds].every((id) => collectionKeywordIds.has(id));
      });
    }

    // Then sort
    const sorted = [...filtered].sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);

      // Handle null values - push them to the end
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        // For mixed types (shouldn't happen but handle gracefully)
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortDirection === 'desc' ? -comparison : comparison;
    });
    return sorted;
  }, [collections, sortField, sortDirection, library?.libraryType, excludedRatings, selectedKeywords]);

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

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
  };

  const handleAddToCollection = (collection: Collection) => {
    setSelectedCollectionForAdd(collection);
    setAddToCollectionOpen(true);
  };

  if (isLoading) {
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

  if (error) {
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

  // Get media items from collections that have collectionId === null (root level media)
  // For now, we'll show collections. Media at root level would need a separate API call.
  const rootMedia: MediaItem[] = [];

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
        </Typography>

        {collections.length > 0 && (
          <Stack direction="row" spacing={1} alignItems="center">
            {(availableContentRatings.length > 0 || availableKeywords.length > 0) && (
              <Tooltip title={t('library.filter.toggle', 'Toggle filters')}>
                <Badge
                  badgeContent={excludedRatings.size + selectedKeywords.length}
                  color="primary"
                  max={99}
                >
                  <IconButton
                    size="small"
                    onClick={() => setShowFilters((prev) => !prev)}
                    color={showFilters ? 'primary' : 'default'}
                  >
                    <FilterList />
                  </IconButton>
                </Badge>
              </Tooltip>
            )}
            <SortControls
              options={sortOptions}
              value={sortField}
              direction={sortDirection}
              onValueChange={(v) => setSortField(v as SortField)}
              onDirectionChange={setSortDirection}
            />
          </Stack>
        )}
      </Stack>

      {/* Filter Section (collapsible) */}
      <Collapse in={showFilters}>
        {/* Content Rating Filter (Film libraries only) */}
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

        {/* Keyword/Tag Filter */}
        <KeywordFilter
          keywords={availableKeywords}
          selectedKeywords={selectedKeywords}
          onSelectionChange={setSelectedKeywords}
        />
      </Collapse>

      {collections.length === 0 && rootMedia.length === 0 ? (
        <Alert severity="info">{t('library.empty')}</Alert>
      ) : (
        <Grid container spacing={2}>
          {/* Collections (folders) */}
          {sortedCollections.map((collection) => {
            const primaryImage = collection.images?.[0];
            // Show images for Shows and for Film library collections (movies)
            const hasImage = primaryImage && (collection.collectionType === 'Show' || library.libraryType === 'Film');

            return (
              <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={collection.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
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
                      {/* Don't show counts for Film library - they're movies, not folders */}
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

          {/* Media items */}
          {rootMedia.map((media) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={media.id}>
              <Card>
                <CardActionArea onClick={() => handleMediaClick(media.id)}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    {media.type === 'Video' ? (
                      <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    ) : (
                      <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                    )}
                    <Typography variant="body2" noWrap title={media.name}>
                      {media.name}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
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
