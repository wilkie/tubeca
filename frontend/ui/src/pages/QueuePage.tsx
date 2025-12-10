import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  IconButton,
  Tooltip,
  Stack,
  Button,
} from '@mui/material';
import { QueueMusic, Movie, Tv, Album, Folder, VideoFile, AudioFile, Clear, PlayArrow, DragIndicator } from '@mui/icons-material';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiClient, type UserCollection, type UserCollectionItem } from '../api/client';
import { usePlayer } from '../context/PlayerContext';

interface SortableQueueItemProps {
  item: UserCollectionItem;
  index: number;
  onItemClick: (item: UserCollectionItem) => void;
  onPlayItem: (item: UserCollectionItem, event: React.MouseEvent) => void;
  onRemoveFromQueue: (item: UserCollectionItem, event: React.MouseEvent) => void;
  getItemImage: (item: UserCollectionItem) => string | null;
  getItemName: (item: UserCollectionItem) => string;
  getItemSubtitle: (item: UserCollectionItem) => string;
  getItemIcon: (item: UserCollectionItem) => React.ReactNode;
  t: ReturnType<typeof useTranslation>['t'];
}

function SortableQueueItem({
  item,
  index,
  onItemClick,
  onPlayItem,
  onRemoveFromQueue,
  getItemImage,
  getItemName,
  getItemSubtitle,
  getItemIcon,
  t,
}: SortableQueueItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  const imageUrl = getItemImage(item);
  const name = getItemName(item);
  const subtitle = getItemSubtitle(item);
  const duration = item.media?.duration;

  return (
    <Card ref={setNodeRef} style={style} sx={{ display: 'flex' }}>
      {/* Drag handle */}
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 1,
          cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <DragIndicator />
      </Box>

      {/* Image and Details - single clickable area */}
      <CardActionArea
        onClick={() => onItemClick(item)}
        sx={{ flexGrow: 1, display: 'flex', alignItems: 'stretch' }}
      >
        {/* Image - fixed width based on 2:3 aspect ratio */}
        <Box
          sx={{
            width: 125,
            flexShrink: 0,
            flexGrow: 0,
          }}
        >
          {imageUrl ? (
            <CardMedia
              component="img"
              image={imageUrl}
              alt={name}
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
              {getItemIcon(item)}
            </Box>
          )}
        </Box>

        {/* Details */}
        <CardContent sx={{ py: 1.5, px: 2, flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {name}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                bgcolor: 'action.selected',
                px: 0.5,
                borderRadius: 0.5,
                fontWeight: 600,
              }}
            >
              #{index + 1}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
            {duration && (
              <Typography variant="caption" color="text.secondary">
                {Math.floor(duration / 3600) > 0
                  ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
                  : `${Math.floor(duration / 60)}m`}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </CardActionArea>

      {/* Actions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
        {item.media && (
          <IconButton
            color="primary"
            onClick={(e) => onPlayItem(item, e)}
            sx={{ width: 40, height: 56, borderRadius: 0.5 }}
          >
            <PlayArrow sx={{ fontSize: 28 }} />
          </IconButton>
        )}
        <Tooltip title={t('queue.remove', 'Remove from Queue')}>
          <IconButton
            size="small"
            onClick={(e) => onRemoveFromQueue(item, e)}
          >
            <Clear />
          </IconButton>
        </Tooltip>
      </Box>
    </Card>
  );
}

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
      navigate(`/media/${item.media.id}`);
    } else if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    }
  };

  const handlePlayItem = async (item: UserCollectionItem, event: React.MouseEvent) => {
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
    if (item.media?.images?.[0]) {
      return apiClient.getImageUrl(item.media.images[0].id);
    }
    if (item.collection?.images?.[0]) {
      return apiClient.getImageUrl(item.collection.images[0].id);
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
                <SortableQueueItem
                  key={item.id}
                  item={item}
                  index={index}
                  onItemClick={handleItemClick}
                  onPlayItem={handlePlayItem}
                  onRemoveFromQueue={handleRemoveFromQueue}
                  getItemImage={getItemImage}
                  getItemName={getItemName}
                  getItemSubtitle={getItemSubtitle}
                  getItemIcon={getItemIcon}
                  t={t}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Container>
  );
}
