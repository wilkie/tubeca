import { useState, useEffect } from 'react';
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
  Button,
} from '@mui/material';
import { QueueMusic, Movie, Tv, Album, Folder, VideoFile, AudioFile, Clear, PlayArrow } from '@mui/icons-material';
import { apiClient, type UserCollection, type UserCollectionItem } from '../api/client';
import { usePlayer } from '../context/PlayerContext';

export function QueuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playMedia, refreshQueue: refreshPlayerQueue } = usePlayer();
  const [queue, setQueue] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const items = queue?.items ?? [];

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
      if (item.media.type === 'Video') return <VideoFile sx={{ fontSize: 48, color: 'text.secondary' }} />;
      return <AudioFile sx={{ fontSize: 48, color: 'text.secondary' }} />;
    }
    if (item.collection) {
      const libraryType = item.collection.library?.libraryType;
      if (libraryType === 'Film') return <Movie sx={{ fontSize: 48, color: 'text.secondary' }} />;
      if (libraryType === 'Television') return <Tv sx={{ fontSize: 48, color: 'text.secondary' }} />;
      if (libraryType === 'Music') return <Album sx={{ fontSize: 48, color: 'text.secondary' }} />;
      return <Folder sx={{ fontSize: 48, color: 'text.secondary' }} />;
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
        <Grid container spacing={2}>
          {items.map((item, index) => {
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
                    {/* Queue position badge */}
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 2,
                        bgcolor: 'rgba(0, 0, 0, 0.75)',
                        color: 'white',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {index + 1}
                    </Box>
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
                  {/* Action buttons */}
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                    }}
                  >
                    {item.media && (
                      <Tooltip title={t('queue.play', 'Play')}>
                        <IconButton
                          size="small"
                          onClick={(e) => handlePlayItem(item, e)}
                          sx={{
                            bgcolor: 'rgba(0,0,0,0.5)',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                          }}
                        >
                          <PlayArrow sx={{ color: 'white', fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t('queue.remove', 'Remove from Queue')}>
                      <IconButton
                        size="small"
                        onClick={(e) => handleRemoveFromQueue(item, e)}
                        sx={{
                          bgcolor: 'rgba(0,0,0,0.5)',
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                        }}
                      >
                        <Clear sx={{ color: 'white', fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Container>
  );
}
