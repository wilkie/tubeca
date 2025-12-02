import { useTranslation } from 'react-i18next';
import {
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
} from '@mui/material';
import { VideoFile, AudioFile } from '@mui/icons-material';
import { apiClient, type CollectionType, type Image } from '../api/client';

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
  videoDetails?: {
    episode?: number | null;
  } | null;
  audioDetails?: {
    track?: number | null;
    disc?: number | null;
  } | null;
  images?: Image[];
}

interface MediaGridProps {
  media: MediaItem[];
  collectionType?: CollectionType;
  onMediaClick: (mediaId: string) => void;
  title?: string;
}

export function MediaGrid({
  media,
  collectionType,
  onMediaClick,
  title,
}: MediaGridProps) {
  const { t } = useTranslation();

  if (media.length === 0) return null;

  const getMediaLabel = () => {
    switch (collectionType) {
      case 'Season':
        return t('collection.episodes', 'Episodes');
      case 'Album':
        return t('collection.tracks', 'Tracks');
      default:
        return t('collection.media', 'Media');
    }
  };

  // Sort media based on collection type
  const sortedMedia = [...media].sort((a, b) => {
    if (collectionType === 'Season') {
      const aEp = a.videoDetails?.episode ?? Infinity;
      const bEp = b.videoDetails?.episode ?? Infinity;
      return aEp - bEp;
    }

    if (collectionType === 'Album') {
      const aDisc = a.audioDetails?.disc ?? 1;
      const bDisc = b.audioDetails?.disc ?? 1;
      if (aDisc !== bDisc) return aDisc - bDisc;

      const aTrack = a.audioDetails?.track ?? Infinity;
      const bTrack = b.audioDetails?.track ?? Infinity;
      return aTrack - bTrack;
    }

    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {title || getMediaLabel()} ({media.length})
      </Typography>
      <Grid container spacing={2}>
        {sortedMedia.map((item) => {
          let numberLabel: string | null = null;
          if (collectionType === 'Season' && item.videoDetails?.episode) {
            numberLabel = `E${item.videoDetails.episode}`;
          } else if (collectionType === 'Album' && item.audioDetails?.track) {
            numberLabel = `${item.audioDetails.track}`;
          }

          const primaryImage = item.images?.[0];
          const isEpisode = collectionType === 'Season' && item.type === 'Video';
          const hasImage = primaryImage && isEpisode;

          return (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
              <Card
                sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardActionArea
                  onClick={() => onMediaClick(item.id)}
                  sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                >
                  {hasImage ? (
                    <>
                      <CardMedia
                        component="img"
                        image={apiClient.getImageUrl(primaryImage.id)}
                        alt={item.name}
                        sx={{
                          aspectRatio: '16/9',
                          objectFit: 'cover',
                        }}
                      />
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        {numberLabel && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                          >
                            {numberLabel}
                          </Typography>
                        )}
                        <Typography variant="body2" noWrap title={item.name}>
                          {item.name}
                        </Typography>
                      </CardContent>
                    </>
                  ) : (
                    <CardContent
                      sx={{
                        textAlign: 'center',
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      {item.type === 'Video' ? (
                        <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                      ) : (
                        <AudioFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
                      )}
                      {numberLabel && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          {numberLabel}
                        </Typography>
                      )}
                      <Typography variant="body2" noWrap title={item.name}>
                        {item.name}
                      </Typography>
                    </CardContent>
                  )}
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}
