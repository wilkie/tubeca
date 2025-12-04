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
} from '@mui/material';
import { WatchLater, Movie, Tv, Album, Folder, VideoFile, AudioFile } from '@mui/icons-material';
import { apiClient, type UserCollection, type UserCollectionItem } from '../api/client';

export function WatchLaterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [watchLater, setWatchLater] = useState<UserCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchWatchLater() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getWatchLater();
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setWatchLater(result.data.userCollection);
      }
      setIsLoading(false);
    }

    fetchWatchLater();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleItemClick = (item: UserCollectionItem) => {
    if (item.collection) {
      navigate(`/collection/${item.collection.id}`);
    } else if (item.media) {
      navigate(`/media/${item.media.id}`);
    }
  };

  const handleRemoveFromWatchLater = async (item: UserCollectionItem, event: React.MouseEvent) => {
    event.stopPropagation();

    const input = item.collectionId
      ? { collectionId: item.collectionId }
      : { mediaId: item.mediaId! };

    const result = await apiClient.toggleWatchLater(input);

    if (result.data && !result.data.inWatchLater) {
      // Remove from local state
      setWatchLater((prev) => {
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
    return null;
  };

  const getItemName = (item: UserCollectionItem) => {
    return item.collection?.name || item.media?.name || 'Unknown';
  };

  const getItemSubtitle = (item: UserCollectionItem) => {
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

  const items = watchLater?.items || [];

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <WatchLater sx={{ fontSize: 32, color: 'primary.main' }} />
        <Typography variant="h4" component="h1">
          {t('watchLater.title', 'Watch Later')}
        </Typography>
        {watchLater?._count && (
          <Typography variant="body1" color="text.secondary">
            ({watchLater._count.items})
          </Typography>
        )}
      </Box>

      {items.length === 0 ? (
        <Alert severity="info">
          {t('watchLater.empty', 'No items in your watch later queue. Click the clock icon on any film, show, or episode to add it here.')}
        </Alert>
      ) : (
        <Grid container spacing={2}>
          {items.map((item) => {
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
                  <Tooltip title={t('watchLater.removeFromWatchLater', 'Remove from Watch Later')}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleRemoveFromWatchLater(item, e)}
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        bgcolor: 'rgba(0,0,0,0.5)',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                      }}
                    >
                      <WatchLater sx={{ color: 'primary.main', fontSize: 20 }} />
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
