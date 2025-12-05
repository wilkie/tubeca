import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
  IconButton,
  Tooltip,
  Stack,
} from '@mui/material';
import { Favorite, Movie, Tv, Album, Folder, VideoFile, AudioFile, List } from '@mui/icons-material';
import { apiClient, type UserCollection, type UserCollectionItem } from '../api/client';
import { SortControls, type SortDirection, type SortOption } from '../components/SortControls';
import { FilterChips } from '../components/FilterChips';

type SortField = 'name' | 'dateAdded' | 'type';

// Get the item type for filtering/sorting
function getItemType(item: UserCollectionItem): string {
  if (item.itemUserCollection) {
    return 'Collection';
  }
  if (item.collection) {
    return item.collection.collectionType || 'Collection';
  }
  if (item.media) {
    return item.media.type === 'Video' ? 'Episode' : 'Track';
  }
  return 'Unknown';
}

// Get sortable value from item
function getSortableValue(item: UserCollectionItem, field: SortField): string | number {
  switch (field) {
    case 'name': {
      const content = item.itemUserCollection || item.collection || item.media;
      return content?.name.toLowerCase() || '';
    }
    case 'dateAdded':
      return item.addedAt || '';
    case 'type':
      return getItemType(item);
    default:
      return '';
  }
}

export function FavoritesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('dateAdded');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set());

  // Sort options for the dropdown
  const sortOptions: SortOption[] = useMemo(() => [
    { value: 'name', label: t('library.sort.name') },
    { value: 'dateAdded', label: t('library.sort.dateAdded') },
    { value: 'type', label: t('userCollections.filter.type', 'Type') },
  ], [t]);

  const items = useMemo(() => favorites?.items ?? [], [favorites?.items]);

  // Extract unique item types for filtering
  const availableTypes = useMemo(() => {
    if (items.length === 0) return [];
    const types = new Set<string>();
    items.forEach((item) => {
      types.add(getItemType(item));
    });
    // Sort types: collections first, then media
    const typeOrder = ['Show', 'Film', 'Album', 'Season', 'Artist', 'Collection', 'Episode', 'Track'];
    return Array.from(types).sort((a, b) => {
      const aIndex = typeOrder.indexOf(a);
      const bIndex = typeOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  // Filter and sort items
  const sortedItems = useMemo(() => {
    if (items.length === 0) return [];

    // First filter by type
    let filtered = items;
    if (excludedTypes.size > 0) {
      filtered = items.filter((item) => {
        const itemType = getItemType(item);
        return !excludedTypes.has(itemType);
      });
    }

    // Then sort
    const sorted = [...filtered].sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);

      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }, [items, sortField, sortDirection, excludedTypes]);

  const toggleTypeFilter = (type: string) => {
    setExcludedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchFavorites() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getFavorites();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setFavorites(result.data.userCollection);
      }
      setIsLoading(false);
    }

    fetchFavorites();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleItemClick = (item: UserCollectionItem) => {
    if (item.itemUserCollection) {
      navigate(`/my-collections/${item.itemUserCollection.id}`);
    } else if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    } else if (item.media) {
      navigate(`/media/${item.media.id}`);
    }
  };

  const handleRemoveFavorite = async (item: UserCollectionItem, event: React.MouseEvent) => {
    event.stopPropagation();

    let input;
    if (item.itemUserCollectionId) {
      input = { userCollectionId: item.itemUserCollectionId };
    } else if (item.collectionId) {
      input = { collectionId: item.collectionId };
    } else {
      input = { mediaId: item.mediaId! };
    }

    const result = await apiClient.toggleFavorite(input);

    if (result.data && !result.data.favorited) {
      // Remove from local state
      setFavorites((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items?.filter((i) => i.id !== item.id),
          _count: prev._count ? { items: prev._count.items - 1 } : undefined,
        };
      });
    }
  };

  const getItemImage = (item: UserCollectionItem) => {
    if (item.collection?.images?.[0]) {
      return apiClient.getImageUrl(item.collection.images[0].id);
    }
    if (item.media?.images?.[0]) {
      return apiClient.getImageUrl(item.media.images[0].id);
    }
    // User collections don't have images
    return null;
  };

  const getItemName = (item: UserCollectionItem) => {
    return item.itemUserCollection?.name || item.collection?.name || item.media?.name || 'Unknown';
  };

  const getItemSubtitle = (item: UserCollectionItem) => {
    if (item.itemUserCollection) {
      const count = item.itemUserCollection._count?.items ?? 0;
      return t('userCollections.itemCount', { count });
    }
    if (item.collection) {
      return item.collection.library?.name || '';
    }
    if (item.media) {
      if (item.media.videoDetails) {
        const { season, episode } = item.media.videoDetails;
        if (season !== null && episode !== null) {
          return `S${season}E${episode}`;
        }
      }
      if (item.media.audioDetails) {
        const { track, disc } = item.media.audioDetails;
        if (track !== null) {
          return disc !== null ? `Disc ${disc}, Track ${track}` : `Track ${track}`;
        }
      }
      return item.media.collection?.name || '';
    }
    return '';
  };

  const getItemIcon = (item: UserCollectionItem) => {
    if (item.itemUserCollection) {
      return <List sx={{ fontSize: 48, color: 'text.secondary' }} />;
    }
    if (item.collection) {
      const libraryType = item.collection.library?.libraryType;
      if (libraryType === 'Film') return <Movie sx={{ fontSize: 48, color: 'text.secondary' }} />;
      if (libraryType === 'Television') return <Tv sx={{ fontSize: 48, color: 'text.secondary' }} />;
      if (libraryType === 'Music') return <Album sx={{ fontSize: 48, color: 'text.secondary' }} />;
      return <Folder sx={{ fontSize: 48, color: 'text.secondary' }} />;
    }
    if (item.media) {
      if (item.media.type === 'Video') return <VideoFile sx={{ fontSize: 48, color: 'text.secondary' }} />;
      return <AudioFile sx={{ fontSize: 48, color: 'text.secondary' }} />;
    }
    return <Folder sx={{ fontSize: 48, color: 'text.secondary' }} />;
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
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

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={2}
        sx={{ mb: 3 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Favorite sx={{ fontSize: 32, color: 'error.main' }} />
          <Typography variant="h4" component="h1">
            {t('favorites.title', 'Favorites')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            ({sortedItems.length})
          </Typography>
        </Box>
        {sortedItems.length > 0 && (
          <SortControls
            options={sortOptions}
            value={sortField}
            direction={sortDirection}
            onValueChange={(v) => setSortField(v as SortField)}
            onDirectionChange={setSortDirection}
          />
        )}
      </Stack>

      {/* Type Filter */}
      {availableTypes.length > 1 && (
        <FilterChips
          label={t('userCollections.filter.type', 'Type')}
          options={availableTypes}
          excluded={excludedTypes}
          onToggle={toggleTypeFilter}
          onClear={() => setExcludedTypes(new Set())}
        />
      )}

      {sortedItems.length === 0 ? (
        <Alert severity="info">
          {t('favorites.empty', 'No favorites yet. Click the heart icon on any film, show, or episode to add it here.')}
        </Alert>
      ) : (
        <Grid container spacing={2}>
          {sortedItems.map((item) => {
            const imageUrl = getItemImage(item);
            const name = getItemName(item);
            const subtitle = getItemSubtitle(item);

            return (
              <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <CardActionArea
                    onClick={() => handleItemClick(item)}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    {imageUrl ? (
                      <CardMedia
                        component="img"
                        image={imageUrl}
                        alt={name}
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
                        {getItemIcon(item)}
                      </Box>
                    )}
                    <CardContent sx={{ textAlign: 'center', py: 1 }}>
                      <Typography variant="body2" noWrap title={name}>
                        {name}
                      </Typography>
                      {subtitle && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {subtitle}
                        </Typography>
                      )}
                    </CardContent>
                  </CardActionArea>
                  <Tooltip title={t('favorites.removeFromFavorites', 'Remove from Favorites')}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleRemoveFavorite(item, e)}
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        bgcolor: 'rgba(0,0,0,0.5)',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                      }}
                    >
                      <Favorite sx={{ color: 'error.main', fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Container>
  );
}
