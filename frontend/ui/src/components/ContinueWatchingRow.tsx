import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Card, CardActionArea, CardMedia, LinearProgress, Typography } from '@mui/material';
import { PlayArrow } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { ContinueWatchingEntry, Image } from '../api/client';
import { formatDuration } from '../utils/format';

/** Prefer a landscape backdrop from the show, then the collection, then any poster. */
function pickArtwork(entry: ContinueWatchingEntry): Image | undefined {
  const collection = entry.media.collection;
  const pools: Array<Image[] | undefined> = [
    collection?.parent?.images,
    collection?.images,
    entry.media.images,
  ];
  for (const type of ['Backdrop', 'Poster', 'Thumbnail'] as const) {
    for (const pool of pools) {
      const hit = pool?.find((img) => img.imageType === type);
      if (hit) return hit;
    }
  }
  return undefined;
}

interface ContinueWatchingRowProps {
  items: ContinueWatchingEntry[];
}

/**
 * Horizontal strip of in-progress media for the home page. Each card resumes
 * playback via the play route; the player itself reads the saved position.
 */
export function ContinueWatchingRow({ items }: ContinueWatchingRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (items.length === 0) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" gutterBottom>
        {t('home.continueWatching')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
        {items.map(({ media, progress }) => {
          const artwork = pickArtwork({ media, progress });
          const details = media.videoDetails;
          const isEpisode = details?.season != null && details?.episode != null;
          const showName = media.collection?.parent?.name ?? media.collection?.name;
          const subtitle = isEpisode
            ? [showName, t('home.episodeCode', { season: details.season, episode: details.episode })]
                .filter(Boolean)
                .join(' · ')
            : media.collection?.name;
          const percent = progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
          const remaining = Math.max(0, progress.duration - progress.position);

          return (
            <Card key={media.id} sx={{ minWidth: 280, maxWidth: 280, flexShrink: 0 }}>
              <CardActionArea onClick={() => navigate(`/play/${media.id}`)} aria-label={media.name}>
                <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: 'action.hover' }}>
                  {artwork && (
                    <CardMedia
                      component="img"
                      image={apiClient.getImageUrl(artwork.id, 'w400')}
                      alt=""
                      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  <PlayArrow
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: 48,
                      color: 'common.white',
                      opacity: 0.9,
                      filter: 'drop-shadow(0 0 6px rgba(0,0,0,0.6))',
                    }}
                  />
                  <LinearProgress
                    variant="determinate"
                    value={percent}
                    aria-label={`${Math.round(percent)}%`}
                    sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 }}
                  />
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="subtitle1" noWrap>
                    {media.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {subtitle}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('home.timeLeft', { time: formatDuration(remaining) })}
                  </Typography>
                </Box>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
