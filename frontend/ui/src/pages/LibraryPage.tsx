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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Stack,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { Folder, VideoFile, AudioFile, ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { apiClient, type Library, type Collection } from '../api/client';

type SortField = 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime';
type SortDirection = 'asc' | 'desc';

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

      // Fetch collections for this library
      const collectionsResult = await apiClient.getCollectionsByLibrary(libraryId!);
      if (cancelled) return;

      if (collectionsResult.error) {
        setError(collectionsResult.error);
      } else if (collectionsResult.data) {
        // Filter to only root collections (no parent)
        const rootCollections = collectionsResult.data.collections.filter(
          (c) => c.parentId === null
        );
        setCollections(rootCollections);
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  // Sort collections based on current sort settings
  const sortedCollections = useMemo(() => {
    const sorted = [...collections].sort((a, b) => {
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
  }, [collections, sortField, sortDirection]);

  const handleSortFieldChange = (event: SelectChangeEvent<SortField>) => {
    setSortField(event.target.value as SortField);
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const handleCollectionClick = (collectionId: string) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleMediaClick = (mediaId: string) => {
    navigate(`/media/${mediaId}`);
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
          <Stack direction="row" alignItems="center" spacing={1}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="sort-field-label">{t('library.sortBy')}</InputLabel>
              <Select
                labelId="sort-field-label"
                value={sortField}
                label={t('library.sortBy')}
                onChange={handleSortFieldChange}
              >
                <MenuItem value="name">{t('library.sort.name')}</MenuItem>
                <MenuItem value="dateAdded">{t('library.sort.dateAdded')}</MenuItem>
                <MenuItem value="releaseDate">{t('library.sort.releaseDate')}</MenuItem>
                <MenuItem value="rating">{t('library.sort.rating')}</MenuItem>
                <MenuItem value="runtime">{t('library.sort.runtime')}</MenuItem>
              </Select>
            </FormControl>
            <IconButton
              onClick={toggleSortDirection}
              size="small"
              aria-label={sortDirection === 'asc' ? t('library.sort.ascending') : t('library.sort.descending')}
              title={sortDirection === 'asc' ? t('library.sort.ascending') : t('library.sort.descending')}
            >
              {sortDirection === 'asc' ? <ArrowUpward /> : <ArrowDownward />}
            </IconButton>
          </Stack>
        )}
      </Stack>

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
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardActionArea
                    onClick={() => handleCollectionClick(collection.id)}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    {hasImage ? (
                      <>
                        <CardMedia
                          component="img"
                          image={apiClient.getImageUrl(primaryImage.id)}
                          alt={collection.name}
                          sx={{
                            aspectRatio: '2/3',
                            objectFit: 'cover',
                          }}
                        />
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
                      </>
                    ) : (
                      <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                        <Typography variant="body2" noWrap title={collection.name}>
                          {collection.name}
                        </Typography>
                        {collection._count && (
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
                    )}
                  </CardActionArea>
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
    </Container>
  );
}
