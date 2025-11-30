import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { apiClient, type Media } from '../api/client';
import { VideoPlayer } from '../components/VideoPlayer';

export function PlayPage() {
  const { t } = useTranslation();
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const [media, setMedia] = useState<Media | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaId) return;

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      const result = await apiClient.getMedia(mediaId!);
      if (cancelled) return;

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setMedia(result.data.media);
      }

      setIsLoading(false);
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const handleBack = () => {
    navigate(-1);
  };

  // Callback to generate new URL for seeking (server-side seeking for transcoded streams)
  // Must be defined before early returns to maintain hook order
  const handleSeek = useCallback(
    (startTime: number) => (mediaId ? apiClient.getVideoStreamUrl(mediaId, startTime) : ''),
    [mediaId]
  );

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#000',
        }}
      >
        <CircularProgress sx={{ color: 'white' }} />
      </Box>
    );
  }

  if (error || !media) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#000',
          color: 'white',
        }}
      >
        <Typography variant="h6" gutterBottom>
          {error || t('media.notFound')}
        </Typography>
        <IconButton onClick={handleBack} sx={{ color: 'white' }}>
          <ArrowBack />
        </IconButton>
      </Box>
    );
  }

  const streamUrl =
    media.type === 'Video'
      ? apiClient.getVideoStreamUrl(media.id)
      : apiClient.getAudioStreamUrl(media.id);

  // Get backdrop image from collection or parent collection (for show/film)
  const getBackdropUrl = (): string | undefined => {
    const collection = media.collection;
    if (!collection) return undefined;

    // First check the immediate collection for a backdrop
    const collectionBackdrop = collection.images?.find(
      (img) => img.imageType === 'Backdrop' && img.isPrimary
    );
    if (collectionBackdrop) {
      return apiClient.getImageUrl(collectionBackdrop.id);
    }

    // If not found, check parent collection (e.g., show for a season/episode)
    const parentBackdrop = collection.parent?.images?.find(
      (img) => img.imageType === 'Backdrop' && img.isPrimary
    );
    if (parentBackdrop) {
      return apiClient.getImageUrl(parentBackdrop.id);
    }

    return undefined;
  };

  const posterUrl = getBackdropUrl();

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000',
        zIndex: 9999,
      }}
    >
      {/* Back button overlay */}
      <IconButton
        onClick={handleBack}
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10000,
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.5)',
          '&:hover': {
            backgroundColor: 'rgba(0,0,0,0.7)',
          },
        }}
      >
        <ArrowBack />
      </IconButton>

      {media.type === 'Video' ? (
        <Box sx={{ width: '100%', height: '100%' }}>
          <VideoPlayer
            src={streamUrl}
            title={media.name}
            poster={posterUrl}
            autoPlay={true}
            mediaDuration={media.duration}
            onSeek={handleSeek}
          />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: 'white',
          }}
        >
          <Typography variant="h5" gutterBottom>
            {media.name}
          </Typography>
          <audio controls autoPlay src={streamUrl} style={{ width: '80%', maxWidth: 600 }}>
            {t('media.audioNotSupported')}
          </audio>
        </Box>
      )}
    </Box>
  );
}
