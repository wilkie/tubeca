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
  Button,
  IconButton,
  Chip,
  TextField,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Breadcrumbs,
  Link,
  Stack,
  Tooltip,
} from '@mui/material';
import {
  Edit,
  Delete,
  Public,
  Lock,
  Folder,
  VideoFile,
  AudioFile,
  Save,
  Cancel,
  ArrowBack,
  Favorite,
  FavoriteBorder,
} from '@mui/icons-material';
import {
  apiClient,
  type UserCollection,
  type UserCollectionItem,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { SortControls, type SortDirection, type SortOption } from '../components/SortControls';
import { FilterChips } from '../components/FilterChips';

type SortField = 'name' | 'dateAdded' | 'type';

// Get the item type for filtering/sorting
function getItemType(item: UserCollectionItem): string {
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
      const content = item.collection || item.media;
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

export function UserCollectionPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [collection, setCollection] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<UserCollectionItem | null>(null);
  const [sortField, setSortField] = useState<SortField>('dateAdded');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set());
  const [isFavorited, setIsFavorited] = useState(false);

  const isOwner = collection?.userId === user?.id;

  useEffect(() => {
    if (!collectionId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getUserCollection(collectionId!);
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setCollection(result.data.userCollection);

        // Check if this collection is favorited
        const favResult = await apiClient.checkFavorites(undefined, undefined, [collectionId!]);
        if (cancelled) return;
        if (favResult.data) {
          setIsFavorited(favResult.data.userCollectionIds.includes(collectionId!));
        }
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  // Sort options for the dropdown
  const sortOptions: SortOption[] = useMemo(() => [
    { value: 'name', label: t('library.sort.name') },
    { value: 'dateAdded', label: t('library.sort.dateAdded') },
    { value: 'type', label: t('userCollections.filter.type', 'Type') },
  ], [t]);

  const items = useMemo(() => collection?.items ?? [], [collection?.items]);

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

  const handleStartEdit = () => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description || '');
    setEditIsPublic(collection.isPublic);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!collection || !collectionId) return;

    const result = await apiClient.updateUserCollection(collectionId, {
      name: editName,
      description: editDescription,
      isPublic: editIsPublic,
    });

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setCollection({
        ...collection,
        ...result.data.userCollection,
      });
      setIsEditing(false);
    }
  };

  const handleRemoveItem = (item: UserCollectionItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleConfirmRemoveItem = async () => {
    if (!collectionId || !itemToDelete) return;

    const result = await apiClient.removeUserCollectionItem(collectionId, itemToDelete.id);
    if (result.error) {
      setError(result.error);
    } else {
      setCollection((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items?.filter((i) => i.id !== itemToDelete.id),
          _count: prev._count ? { items: (prev._count.items || 0) - 1 } : undefined,
        };
      });
    }

    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  const handleItemClick = (item: UserCollectionItem) => {
    if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    } else if (item.media) {
      navigate(`/media/${item.media.id}`);
    }
  };

  const handleToggleFavorite = async () => {
    if (!collectionId) return;
    const result = await apiClient.toggleFavorite({ userCollectionId: collectionId });
    if (result.data) {
      setIsFavorited(result.data.favorited);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!collection) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{t('collection.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          variant="body2"
          onClick={() => navigate('/my-collections')}
          sx={{ display: 'flex', alignItems: 'center' }}
        >
          <ArrowBack fontSize="small" sx={{ mr: 0.5 }} />
          {t('userCollections.title')}
        </Link>
        <Typography variant="body2" color="text.primary">
          {collection.name}
        </Typography>
      </Breadcrumbs>

      <Box sx={{ mb: 4 }}>
        {isEditing ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('userCollections.name')}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
            />
            <TextField
              label={t('userCollections.description')}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={editIsPublic}
                  onChange={(e) => setEditIsPublic(e.target.checked)}
                />
              }
              label={editIsPublic ? t('userCollections.public') : t('userCollections.private')}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={<Save />}
                onClick={handleSaveEdit}
              >
                {t('common.save')}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Cancel />}
                onClick={handleCancelEdit}
              >
                {t('common.cancel')}
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="h4" component="h1">
                {collection.name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={isFavorited ? t('favorites.removeFromFavorites') : t('favorites.addToFavorites')}>
                  <IconButton onClick={handleToggleFavorite} color={isFavorited ? 'error' : 'default'}>
                    {isFavorited ? <Favorite /> : <FavoriteBorder />}
                  </IconButton>
                </Tooltip>
                {isOwner && (
                  <Button
                    variant="outlined"
                    startIcon={<Edit />}
                    onClick={handleStartEdit}
                  >
                    {t('userCollections.edit')}
                  </Button>
                )}
              </Box>
            </Box>
            {collection.description && (
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                {collection.description}
              </Typography>
            )}
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              gap={2}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip
                  icon={collection.isPublic ? <Public fontSize="small" /> : <Lock fontSize="small" />}
                  label={collection.isPublic ? t('userCollections.public') : t('userCollections.private')}
                  size="small"
                  variant="outlined"
                />
                <Typography variant="body2" color="text.secondary">
                  {t('userCollections.itemCount', { count: sortedItems.length })}
                </Typography>
                {collection.user && !isOwner && (
                  <Typography variant="body2" color="text.secondary">
                    {t('userCollections.createdBy', { name: collection.user.name })}
                  </Typography>
                )}
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
          </>
        )}
      </Box>

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
        <Alert severity="info">{t('userCollections.noItems')}</Alert>
      ) : (
        <Grid container spacing={2}>
          {sortedItems.map((item) => {
            const isCollection = !!item.collection;
            const content = item.collection || item.media;
            if (!content) return null;

            const primaryImage = isCollection
              ? item.collection?.images?.[0]
              : item.media?.images?.[0];
            const hasImage = primaryImage != null;

            // Build subtitle
            let subtitle = '';
            if (!isCollection && item.media) {
              if (item.media.videoDetails) {
                const { season, episode } = item.media.videoDetails;
                if (season != null && episode != null) {
                  subtitle = `S${season}E${episode}`;
                }
              } else if (item.media.audioDetails) {
                const { track, disc } = item.media.audioDetails;
                if (disc != null && track != null) {
                  subtitle = `Disc ${disc}, Track ${track}`;
                } else if (track != null) {
                  subtitle = `Track ${track}`;
                }
              }
              if (item.media.collection) {
                const collectionName = item.media.collection.name;
                if (subtitle) {
                  subtitle = `${collectionName} - ${subtitle}`;
                } else {
                  subtitle = collectionName;
                }
              }
            }

            return (
              <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  {isOwner && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveItem(item);
                      }}
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        zIndex: 1,
                        bgcolor: 'background.paper',
                        '&:hover': { bgcolor: 'error.light', color: 'error.contrastText' },
                      }}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                  <CardActionArea
                    onClick={() => handleItemClick(item)}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    {hasImage ? (
                      <>
                        <CardMedia
                          component="img"
                          image={apiClient.getImageUrl(primaryImage.id)}
                          alt={content.name}
                          sx={{
                            aspectRatio: isCollection ? '2/3' : '16/9',
                            objectFit: 'cover',
                          }}
                        />
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="body2" noWrap title={content.name}>
                            {content.name}
                          </Typography>
                          {subtitle && (
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {subtitle}
                            </Typography>
                          )}
                        </CardContent>
                      </>
                    ) : (
                      <CardContent sx={{ textAlign: 'center', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {isCollection ? (
                          <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                        ) : item.media?.type === 'Video' ? (
                          <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                        ) : (
                          <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                        )}
                        <Typography variant="body2" noWrap title={content.name}>
                          {content.name}
                        </Typography>
                        {subtitle && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {subtitle}
                          </Typography>
                        )}
                      </CardContent>
                    )}
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('userCollections.removeFromCollection')}</DialogTitle>
        <DialogContent>
          <Typography>
            {itemToDelete?.collection?.name || itemToDelete?.media?.name}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirmRemoveItem} color="error">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
