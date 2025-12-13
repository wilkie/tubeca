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
  PlayArrow,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  apiClient,
  type UserCollection,
  type UserCollectionItem,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { SortControls, type SortDirection, type SortOption } from '../components/SortControls';
import { FilterChips } from '../components/FilterChips';
import { SortableMediaListItem } from '../components/SortableMediaListItem';

type SortField = 'name' | 'dateAdded' | 'type';

// Helper to get image URL for an item
// For list views (playlists), preferLandscape should be true for consistent row heights
function getItemImage(item: UserCollectionItem, preferLandscape: boolean = false): string | null {
  // Helper to find image by type preference
  const findImage = (images: { id: string; imageType: string }[] | undefined) => {
    if (!images || images.length === 0) return null;
    // For landscape preference, prefer Thumbnail > Backdrop > Poster
    // For portrait preference, prefer Poster > Backdrop > Thumbnail
    const libraryType = item.media?.collection?.library?.libraryType || item.collection?.library?.libraryType;
    const useLandscape = preferLandscape || libraryType === 'Film';
    const typeOrder = useLandscape
      ? ['Thumbnail', 'Backdrop', 'Poster']
      : ['Poster', 'Backdrop', 'Thumbnail'];
    for (const type of typeOrder) {
      const img = images.find((i) => i.imageType === type);
      if (img) return img;
    }
    return images[0];
  };

  // Check media's own images first
  if (item.media?.images?.[0]) {
    const img = findImage(item.media.images);
    if (img) return apiClient.getImageUrl(img.id);
  }
  // Fall back to media's parent collection images (e.g., film poster/thumbnail)
  if (item.media?.collection?.images) {
    const img = findImage(item.media.collection.images);
    if (img) return apiClient.getImageUrl(img.id);
  }
  // Check if the item is a collection itself
  if (item.collection?.images) {
    const img = findImage(item.collection.images);
    if (img) return apiClient.getImageUrl(img.id);
  }
  return null;
}

// Helper to get item name
function getItemName(item: UserCollectionItem): string {
  return item.media?.name || item.collection?.name || 'Unknown';
}

// Helper to get item subtitle
function getItemSubtitle(item: UserCollectionItem): string {
  if (item.media) {
    if (item.media.videoDetails) {
      const { season, episode } = item.media.videoDetails;
      if (season !== null && episode !== null) {
        const showName = item.media.collection?.parent?.name;
        const episodeTag = `S${season}E${episode}`;
        return showName ? `${showName} · ${episodeTag}` : episodeTag;
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
  if (item.collection) {
    return item.collection.library?.name || '';
  }
  return '';
}

// Helper to get item icon
function getItemIcon(item: UserCollectionItem): React.ReactNode {
  if (item.media) {
    if (item.media.type === 'Video') return <VideoFile sx={{ fontSize: 32, color: 'text.secondary' }} />;
    return <AudioFile sx={{ fontSize: 32, color: 'text.secondary' }} />;
  }
  return <Folder sx={{ fontSize: 32, color: 'text.secondary' }} />;
}

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
  const { playMedia, refreshQueue } = usePlayer();

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
  const isPlaylist = collection?.collectionType === 'Playlist';

  // DnD sensors for Playlist view
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  // Handle drag end for Playlist reordering
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const items = collection?.items ?? [];

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);

      // Optimistically update UI
      setCollection((prev) => prev ? { ...prev, items: newItems } : null);

      // Persist the new order
      if (collectionId) {
        const result = await apiClient.reorderUserCollectionItems(collectionId, newItems.map((i) => i.id));
        if (result.data) {
          setCollection(result.data.userCollection);
        }
      }
    }
  };

  // Helper to get the playable media ID from an item
  // Items can have media directly (episodes) or be collections with media (films)
  const getPlayableMediaId = (item: UserCollectionItem): string | null => {
    if (item.mediaId) return item.mediaId;
    if (item.collection?.media?.[0]?.id) return item.collection.media[0].id;
    return null;
  };

  // Handle playing from a specific item in the playlist
  const handlePlayItem = async (item: UserCollectionItem, index: number, event: React.MouseEvent) => {
    event.stopPropagation();

    if (isPlaylist) {
      // For playlists, set the queue with all items in playlist order
      const playlistItems = collection?.items ?? [];
      const mediaItems = playlistItems
        .map((i) => getPlayableMediaId(i))
        .filter((id): id is string => id !== null)
        .map((mediaId) => ({ mediaId }));

      if (mediaItems.length === 0) return;

      // Set the playback queue with all playlist items
      await apiClient.setPlaybackQueue(mediaItems);
      refreshQueue();

      // Find the media to play from the clicked item
      const clickedItem = playlistItems[index];
      const clickedMediaId = getPlayableMediaId(clickedItem);
      if (clickedMediaId) {
        await playMedia(clickedMediaId);
        navigate(`/play/${clickedMediaId}`);
      } else {
        // If clicked item has no media, find first playable from that point
        const firstPlayableId = playlistItems.slice(index)
          .map((i) => getPlayableMediaId(i))
          .find((id) => id !== null);
        if (firstPlayableId) {
          await playMedia(firstPlayableId);
          navigate(`/play/${firstPlayableId}`);
        }
      }
    } else {
      // For non-playlists, just play the single item
      const mediaId = getPlayableMediaId(item);
      if (mediaId) {
        await playMedia(mediaId);
        navigate(`/play/${mediaId}`);
      }
    }
  };

  // Handle playing all items in the collection
  const handlePlayAll = async () => {
    // Get items with media (either current sort order or playlist order)
    const itemsToPlay = isPlaylist
      ? (collection?.items ?? [])
      : sortedItems;

    const mediaItems = itemsToPlay
      .map((item) => getPlayableMediaId(item))
      .filter((id): id is string => id !== null)
      .map((mediaId) => ({ mediaId }));

    if (mediaItems.length === 0) return;

    // Set the playback queue with all media items
    await apiClient.setPlaybackQueue(mediaItems);
    refreshQueue();

    // Start playing the first item
    const firstMediaId = itemsToPlay
      .map((item) => getPlayableMediaId(item))
      .find((id) => id !== null);
    if (firstMediaId) {
      await playMedia(firstMediaId);
      navigate(`/play/${firstMediaId}`);
    }
  };

  // Check if there are any playable items
  const hasPlayableItems = useMemo(() => {
    const items = collection?.items ?? [];
    return items.some((item) => item.mediaId || item.collection?.media?.[0]?.id);
  }, [collection?.items]);

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
                {hasPlayableItems && (
                  <Button
                    variant="contained"
                    startIcon={<PlayArrow />}
                    onClick={handlePlayAll}
                  >
                    {t('common.play', 'Play')}
                  </Button>
                )}
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
                {isPlaylist && (
                  <Chip
                    label={t('userCollections.playlist', 'Playlist')}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                )}
                <Typography variant="body2" color="text.secondary">
                  {t('userCollections.itemCount', { count: isPlaylist ? items.length : sortedItems.length })}
                </Typography>
                {collection.user && !isOwner && (
                  <Typography variant="body2" color="text.secondary">
                    {t('userCollections.createdBy', { name: collection.user.name })}
                  </Typography>
                )}
              </Box>
              {/* Sort controls only shown for Set type (not Playlist) */}
              {!isPlaylist && sortedItems.length > 0 && (
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

      {/* Type Filter - only shown for Set type (not Playlist) */}
      {!isPlaylist && availableTypes.length > 1 && (
        <FilterChips
          label={t('userCollections.filter.type', 'Type')}
          options={availableTypes}
          excluded={excludedTypes}
          onToggle={toggleTypeFilter}
          onClear={() => setExcludedTypes(new Set())}
          onSelectOnly={(type) => setExcludedTypes(new Set(availableTypes.filter((t) => t !== type)))}
        />
      )}

      {/* Playlist View - reorderable list */}
      {isPlaylist ? (
        items.length === 0 ? (
          <Alert severity="info">{t('userCollections.noItems')}</Alert>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <Stack spacing={1}>
                {items.map((item, index) => (
                  <SortableMediaListItem
                    key={item.id}
                    item={item}
                    index={index}
                    onItemClick={handleItemClick}
                    onPlayItem={handlePlayItem}
                    onRemoveItem={(i, e) => {
                      e.stopPropagation();
                      handleRemoveItem(i);
                    }}
                    getItemImage={(i) => getItemImage(i, true)}
                    getItemName={getItemName}
                    getItemSubtitle={getItemSubtitle}
                    getItemIcon={getItemIcon}
                    removeTooltip={t('userCollections.removeFromCollection')}
                    showDragHandle={isOwner}
                    showRemoveButton={isOwner}
                    showPlayButton
                    useDeleteIcon
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        )
      ) : (
        /* Set View - Grid of cards */
        sortedItems.length === 0 ? (
          <Alert severity="info">{t('userCollections.noItems')}</Alert>
        ) : (
          <Grid container spacing={2}>
            {sortedItems.map((item) => {
              const isCollectionItem = !!item.collection;
              const content = item.collection || item.media;
              if (!content) return null;

              const primaryImage = isCollectionItem
                ? item.collection?.images?.[0]
                : item.media?.images?.[0];
              const hasImage = primaryImage != null;

              // Build subtitle
              let subtitle = '';
              if (!isCollectionItem && item.media) {
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
                              aspectRatio: isCollectionItem ? '2/3' : '16/9',
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
                          {isCollectionItem ? (
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
        )
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
