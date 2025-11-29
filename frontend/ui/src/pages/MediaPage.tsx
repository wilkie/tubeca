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
  Chip,
  Divider,
  Grid,
  Card,
  CardContent,
  CardMedia,
} from '@mui/material';
import { ArrowBack, PlayArrow, Tv, Movie, MusicNote, Album, Person } from '@mui/icons-material';
import { apiClient, type Media, type Image } from '../api/client';

interface CreditWithImages {
  id: string;
  name: string;
  role: string | null;
  creditType: string;
  order: number | null;
  images?: Image[];
}

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

  const videoDetails = media.videoDetails;
  const audioDetails = media.audioDetails;

  // Determine display title for TV episodes
  const displayTitle = videoDetails?.showName && videoDetails?.season && videoDetails?.episode
    ? `${videoDetails.showName} - S${String(videoDetails.season).padStart(2, '0')}E${String(videoDetails.episode).padStart(2, '0')}`
    : media.name;

  const episodeTitle = videoDetails?.showName ? media.name : null;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Back button */}
      <Button startIcon={<ArrowBack />} onClick={handleBack} sx={{ mb: 2 }}>
        {t('common.back')}
      </Button>

      {/* Media details */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h4" component="h1">
              {displayTitle}
            </Typography>
            {episodeTitle && (
              <Typography variant="h6" color="text.secondary">
                {episodeTitle}
              </Typography>
            )}
          </Box>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrow />}
            onClick={handlePlay}
          >
            {t('media.play')}
          </Button>
        </Box>

        {/* Description */}
        {videoDetails?.description && (
          <Typography variant="body1" color="text.secondary" paragraph>
            {videoDetails.description}
          </Typography>
        )}

        {/* Basic info chips */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Chip
            icon={media.type === 'Video' ? (videoDetails?.showName ? <Tv /> : <Movie />) : <MusicNote />}
            label={media.type === 'Video' ? (videoDetails?.showName ? 'TV Episode' : 'Movie') : 'Audio'}
            size="small"
          />
          {media.duration > 0 && (
            <Chip label={formatDuration(media.duration)} size="small" variant="outlined" />
          )}
          {videoDetails?.rating && (
            <Chip label={`${videoDetails.rating.toFixed(1)} / 10`} size="small" variant="outlined" color="primary" />
          )}
          {videoDetails?.releaseDate && (
            <Chip label={new Date(videoDetails.releaseDate).getFullYear()} size="small" variant="outlined" />
          )}
          {audioDetails?.year && (
            <Chip label={audioDetails.year} size="small" variant="outlined" />
          )}
          {audioDetails?.genre && (
            <Chip label={audioDetails.genre} size="small" variant="outlined" />
          )}
        </Box>

        {/* Video Details */}
        {videoDetails && (
          <>
            {videoDetails.credits && videoDetails.credits.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom>
                  {t('media.castAndCrew', 'Cast & Crew')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Directors */}
                  {videoDetails.credits.filter(c => c.creditType === 'Director').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.director', 'Director')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits.filter(c => c.creditType === 'Director').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Writers */}
                  {videoDetails.credits.filter(c => c.creditType === 'Writer').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.writer', 'Writer')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits.filter(c => c.creditType === 'Writer').map(c => c.name).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {/* Cast */}
                  {videoDetails.credits.filter(c => c.creditType === 'Actor').length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('media.cast', 'Cast')}
                      </Typography>
                      <Typography variant="body2">
                        {videoDetails.credits
                          .filter(c => c.creditType === 'Actor')
                          .slice(0, 10)
                          .map(c => c.role ? `${c.name} (${c.role})` : c.name)
                          .join(', ')}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </>
        )}

        {/* Audio Details */}
        {audioDetails && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {audioDetails.artist && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('media.artist', 'Artist')}
                  </Typography>
                  <Typography variant="body1">{audioDetails.artist}</Typography>
                </Box>
              )}
              {audioDetails.album && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Album color="action" />
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('media.album', 'Album')}
                    </Typography>
                    <Typography variant="body1">{audioDetails.album}</Typography>
                  </Box>
                </Box>
              )}
              {audioDetails.track && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('media.track', 'Track')}
                  </Typography>
                  <Typography variant="body1">
                    {audioDetails.disc ? `${audioDetails.disc}-` : ''}{audioDetails.track}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}
      </Paper>

      {/* Credits Photo Grid */}
      {videoDetails?.credits && videoDetails.credits.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('media.castAndCrew', 'Cast & Crew')}
          </Typography>
          <Grid container spacing={2}>
            {(videoDetails.credits as CreditWithImages[]).map((credit) => {
              const primaryImage = credit.images?.[0];

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={credit.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {primaryImage ? (
                      <CardMedia
                        component="img"
                        image={apiClient.getImageUrl(primaryImage.id)}
                        alt={credit.name}
                        sx={{
                          aspectRatio: '2/3',
                          objectFit: 'cover',
                        }}
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
                        <Person sx={{ fontSize: 64, color: 'text.secondary' }} />
                      </Box>
                    )}
                    <CardContent sx={{ textAlign: 'center', py: 1, flexGrow: 1 }}>
                      <Typography variant="body2" noWrap title={credit.name}>
                        {credit.name}
                      </Typography>
                      {credit.role && (
                        <Typography variant="caption" color="text.secondary" noWrap title={credit.role}>
                          {credit.role}
                        </Typography>
                      )}
                      {!credit.role && credit.creditType !== 'Actor' && (
                        <Typography variant="caption" color="text.secondary">
                          {credit.creditType}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}
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
