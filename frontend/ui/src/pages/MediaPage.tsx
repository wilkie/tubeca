import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Button,
} from '@mui/material';
import { ArrowBack, PlayArrow } from '@mui/icons-material';
import { apiClient, type Media } from '../api/client';

export function MediaPage() {
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

  const handlePlay = () => {
    navigate(`/play/${mediaId}`);
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
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!media) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">{t('media.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Back button */}
      <Button startIcon={<ArrowBack />} onClick={handleBack} sx={{ mb: 2 }}>
        {t('common.back')}
      </Button>

      {/* Media details */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Typography variant="h4" component="h1">
            {media.name}
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrow />}
            onClick={handlePlay}
          >
            {t('media.play')}
          </Button>
        </Box>

        {media.description && (
          <Typography variant="body1" color="text.secondary" paragraph>
            {media.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', mt: 3 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('media.type')}
            </Typography>
            <Typography variant="body1">{media.type}</Typography>
          </Box>

          {media.duration > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('media.duration')}
              </Typography>
              <Typography variant="body1">
                {formatDuration(media.duration)}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Container>
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}
