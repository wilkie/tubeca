import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Button,
} from '@mui/material';
import { QueueMusic, Movie, Tv, Album, Folder, VideoFile, AudioFile, Clear } from '@mui/icons-material';
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
import { apiClient, type UserCollection, type UserCollectionItem } from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import { SortableMediaListItem } from '../components/SortableMediaListItem';

export function QueuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playMedia, refreshQueue: refreshPlayerQueue } = usePlayer();
  const [queue, setQueue] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const items = queue?.items ?? [];

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
    let cancelled = false;

    async function fetchQueue() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getPlaybackQueue();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setQueue(result.data.userCollection);
      }
      setIsLoading(false);
    }

    fetchQueue();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);

      // Optimistically update UI
      setQueue((prev) => prev ? { ...prev, items: newItems } : null);

      // Persist the new order
      const input = newItems
        .filter((i) => i.mediaId)
        .map((i) => ({ mediaId: i.mediaId! }));

      const result = await apiClient.setPlaybackQueue(input);

      if (result.data) {
        setQueue(result.data.userCollection);
        refreshPlayerQueue();
      }
    }
  };

  const handleItemClick = (item: UserCollectionItem) => {
    if (item.media) {
      // For films, navigate to the parent collection (the film) instead of the media page
      const libraryType = item.media.collection?.library?.libraryType;
      if (libraryType === 'Film' && item.media.collection) {
        navigate(`/collection/${item.media.collection.id}`);
      } else {
        navigate(`/media/${item.media.id}`);
      }
    } else if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    }
  };

  const handlePlayItem = async (item: UserCollectionItem, _index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (item.media) {
      await playMedia(item.media.id);
      navigate(`/play/${item.media.id}`);
    }
  };

  const handleRemoveFromQueue = async (item: UserCollectionItem, event: React.MouseEvent) => {
    event.stopPropagation();

    // Filter out the item and update the queue
    const newItems = items.filter((i) => i.id !== item.id);
    const input = newItems
      .filter((i) => i.mediaId)
      .map((i) => ({ mediaId: i.mediaId! }));

    const result = await apiClient.setPlaybackQueue(input);

    if (result.data) {
      setQueue(result.data.userCollection);
      refreshPlayerQueue();
    }
  };

  const handleClearQueue = async () => {
    const result = await apiClient.clearPlaybackQueue();
    if (result.data) {
      setQueue(result.data.userCollection);
      refreshPlayerQueue();
    }
  };

  const getItemImage = (item: UserCollectionItem) => {
    // Helper to find image by type preference
    // For list view, always prefer landscape images for consistent row height
    const findImage = (images: { id: string; imageType: string }[] | undefined) => {
      if (!images || images.length === 0) return null;
      // Always prefer landscape images: Thumbnail > Backdrop > Poster
      const typeOrder = ['Thumbnail', 'Backdrop', 'Poster'];
      for (const type of typeOrder) {
        const img = images.find((i) => i.imageType === type);
        if (img) return img;
      }
      return images[0]; // Fall back to any image
    };

    // Check media's own images first
    if (item.media?.images?.[0]) {
      return apiClient.getImageUrl(item.media.images[0].id);
    }
    // Fall back to media's parent collection images (e.g., film poster/thumbnail)
    if (item.media?.collection?.images) {
      const img = findImage(item.media.collection.images);
      if (img) return apiClient.getImageUrl(img.id);
    }
    // Check if the queue item is a collection itself
    if (item.collection?.images) {
      const img = findImage(item.collection.images);
      if (img) return apiClient.getImageUrl(img.id);
    }
    return null;
  };

  const getItemName = (item: UserCollectionItem) => {
    return item.media?.name || item.collection?.name || 'Unknown';
  };

  const getItemSubtitle = (item: UserCollectionItem) => {
    if (item.media) {
      if (item.media.videoDetails) {
        const { season, episode } = item.media.videoDetails;
        if (season !== null && episode !== null) {
          // For TV shows, include the show name (parent of the season)
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
  };

  const getItemIcon = (item: UserCollectionItem) => {
    if (item.media) {
      if (item.media.type === 'Video') return <VideoFile sx={{ fontSize: 32, color: 'text.secondary' }} />;
      return <AudioFile sx={{ fontSize: 32, color: 'text.secondary' }} />;
    }
    if (item.collection) {
      const libraryType = item.collection.library?.libraryType;
      if (libraryType === 'Film') return <Movie sx={{ fontSize: 32, color: 'text.secondary' }} />;
      if (libraryType === 'Television') return <Tv sx={{ fontSize: 32, color: 'text.secondary' }} />;
      if (libraryType === 'Music') return <Album sx={{ fontSize: 32, color: 'text.secondary' }} />;
      return <Folder sx={{ fontSize: 32, color: 'text.secondary' }} />;
    }
    return <Folder sx={{ fontSize: 32, color: 'text.secondary' }} />;
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
          <QueueMusic sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            {t('queue.title', 'Playback Queue')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            ({items.length})
          </Typography>
        </Box>
        {items.length > 0 && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<Clear />}
            onClick={handleClearQueue}
          >
            {t('queue.clear', 'Clear Queue')}
          </Button>
        )}
      </Stack>

      {items.length === 0 ? (
        <Alert severity="info">
          {t('queue.empty', 'Your playback queue is empty. Add items to queue from the media page.')}
        </Alert>
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
                  onRemoveItem={handleRemoveFromQueue}
                  getItemImage={getItemImage}
                  getItemName={getItemName}
                  getItemSubtitle={getItemSubtitle}
                  getItemIcon={getItemIcon}
                  removeTooltip={t('queue.remove', 'Remove from Queue')}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Container>
  );
}
