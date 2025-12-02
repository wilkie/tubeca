import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
  Paper,
  Button,
  IconButton,
  Link,
} from '@mui/material';
import { Star, PlayArrow, MoreVert, VideoFile } from '@mui/icons-material';
import { apiClient, type Collection, type Image, type Credit } from '../api/client';
import { formatDuration } from '../utils/format';
import { HeroSection, HeroPoster, HeroLogo } from './HeroSection';
import { CollectionBreadcrumbs, type BreadcrumbItem } from './CollectionBreadcrumbs';
import { CastCrewGrid } from './CastCrewGrid';

interface CreditWithPerson extends Credit {
  person?: {
    id: string;
    images?: Image[];
  } | null;
}

interface MediaItem {
  id: string;
  name: string;
  type: 'Video' | 'Audio';
  duration?: number;
  videoDetails?: {
    description?: string | null;
    releaseDate?: string | null;
    rating?: string | null;
    credits?: CreditWithPerson[];
  } | null;
  images?: Image[];
}

interface FilmHeroViewProps {
  collection: Collection;
  primaryMedia: MediaItem;
  additionalMedia: MediaItem[];
  breadcrumbs: BreadcrumbItem[];
  menuOpen: boolean;
  onBreadcrumbNavigate: (item: BreadcrumbItem) => void;
  onPlay: (mediaId: string) => void;
  onMediaClick: (mediaId: string) => void;
  onPersonClick: (personId: string) => void;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>) => void;
}

export function FilmHeroView({
  collection,
  primaryMedia,
  additionalMedia,
  breadcrumbs,
  menuOpen,
  onBreadcrumbNavigate,
  onPlay,
  onMediaClick,
  onPersonClick,
  onMenuOpen,
}: FilmHeroViewProps) {
  const { t } = useTranslation();

  const backdropImage = collection.images?.find((img) => img.imageType === 'Backdrop');
  const posterImage = collection.images?.find((img) => img.imageType === 'Poster');
  const logoImage = collection.images?.find((img) => img.imageType === 'Logo');

  const credits = primaryMedia.videoDetails?.credits || [];

  return (
    <>
      <HeroSection backdropImageId={backdropImage?.id}>
        {/* Breadcrumbs at top */}
        <Box sx={{ position: 'relative', zIndex: 2, px: 3, pt: 2 }}>
          <CollectionBreadcrumbs
            breadcrumbs={breadcrumbs}
            currentName={collection.name}
            onNavigate={onBreadcrumbNavigate}
            variant="hero"
          />
        </Box>

        {/* Description Card */}
        {(primaryMedia.videoDetails?.description || credits.length > 0) && (
          <Box
            sx={{
              position: 'relative',
              zIndex: 2,
              px: 3,
              mt: 2,
              maxWidth: { xs: '100%', md: '60%', lg: '50%' },
              maxHeight: { xs: 'calc(100vh - 350px)', md: 'calc(100vh - 400px)' },
              overflow: 'hidden',
            }}
          >
            <Paper
              sx={{
                p: 3,
                bgcolor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                maxHeight: '100%',
                overflow: 'auto',
              }}
            >
              {primaryMedia.videoDetails?.description && (
                <Typography
                  variant="body1"
                  sx={{
                    color: 'grey.200',
                    mb: credits.length > 0 ? 2 : 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {primaryMedia.videoDetails.description}
                </Typography>
              )}

              {/* Credits Summary */}
              {credits.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Directors */}
                  {credits.filter((c) => c.creditType === 'Director').length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ color: 'grey.400' }}>
                        {t('media.director', 'Director')}
                      </Typography>
                      <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                        {credits
                          .filter((c) => c.creditType === 'Director')
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
                                >
                                  {c.name}
                                </Link>
                              ) : (
                                c.name
                              )}
                              {index < arr.length - 1 && ', '}
                            </span>
                          ))}
                      </Typography>
                    </Box>
                  )}
                  {/* Writers */}
                  {credits.filter((c) => c.creditType === 'Writer').length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ color: 'grey.400' }}>
                        {t('media.writer', 'Writer')}
                      </Typography>
                      <Typography variant="body2" component="div" sx={{ color: 'grey.200' }}>
                        {credits
                          .filter((c) => c.creditType === 'Writer')
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
                                >
                                  {c.name}
                                </Link>
                              ) : (
                                c.name
                              )}
                              {index < arr.length - 1 && ', '}
                            </span>
                          ))}
                      </Typography>
                    </Box>
                  )}
                  {/* Cast */}
                  {credits.filter((c) => c.creditType === 'Actor').length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ color: 'grey.400' }}>
                        {t('media.cast', 'Cast')}
                      </Typography>
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{
                          color: 'grey.200',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {credits
                          .filter((c) => c.creditType === 'Actor')
                          .slice(0, 10)
                          .map((c, index, arr) => (
                            <span key={c.id}>
                              {c.personId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() => onPersonClick(c.personId!)}
                                  sx={{ color: 'grey.200', '&:hover': { color: 'white' } }}
                                >
                                  {c.role ? `${c.name} (${c.role})` : c.name}
                                </Link>
                              ) : c.role ? (
                                `${c.name} (${c.role})`
                              ) : (
                                c.name
                              )}
                              {index < arr.length - 1 && ', '}
                            </span>
                          ))}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Paper>
          </Box>
        )}

        {/* Bottom Content */}
        <Box
          sx={{
            position: 'relative',
            zIndex: 2,
            width: '100%',
            px: 3,
            pb: 3,
            mt: 'auto',
            display: 'flex',
            gap: 3,
            alignItems: 'flex-end',
          }}
        >
          {posterImage && <HeroPoster imageId={posterImage.id} alt={collection.name} />}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {logoImage ? (
              <HeroLogo imageId={logoImage.id} alt={collection.name} />
            ) : (
              <Typography
                variant="h3"
                component="h1"
                sx={{
                  color: 'white',
                  fontWeight: 'bold',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                  mb: 1,
                }}
              >
                {collection.name}
              </Typography>
            )}

            {/* Metadata Row */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              {primaryMedia.videoDetails?.releaseDate && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {new Date(primaryMedia.videoDetails.releaseDate).getFullYear()}
                </Typography>
              )}
              {primaryMedia.duration && primaryMedia.duration > 0 && (
                <Typography variant="body1" sx={{ color: 'grey.300' }}>
                  {formatDuration(primaryMedia.duration)}
                </Typography>
              )}
              {primaryMedia.videoDetails?.rating && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Star sx={{ color: 'warning.main', fontSize: 20 }} />
                  <Typography variant="body1" sx={{ color: 'grey.300' }}>
                    {primaryMedia.videoDetails.rating}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<PlayArrow />}
                onClick={() => onPlay(primaryMedia.id)}
              >
                {t('media.play', 'Play')}
              </Button>
              <IconButton
                onClick={onMenuOpen}
                aria-label={t('common.moreOptions', 'More options')}
                aria-controls={menuOpen ? 'collection-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={menuOpen ? 'true' : undefined}
                sx={{ color: 'white' }}
              >
                <MoreVert />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </HeroSection>

      {/* Special Features */}
      {additionalMedia.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('collection.specialFeatures', 'Special Features')} ({additionalMedia.length})
          </Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {additionalMedia.map((item) => {
              const primaryImage = item.images?.[0];

              return (
                <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={item.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardActionArea
                      onClick={() => onMediaClick(item.id)}
                      sx={{
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      {primaryImage ? (
                        <>
                          <CardMedia
                            component="img"
                            image={apiClient.getImageUrl(primaryImage.id)}
                            alt={item.name}
                            sx={{ aspectRatio: '16/9', objectFit: 'cover' }}
                          />
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
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
                          <VideoFile sx={{ fontSize: 48, color: 'secondary.main', mb: 1 }} />
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
      )}

      {/* Cast & Crew Grid */}
      {credits.length > 0 && (
        <CastCrewGrid credits={credits} onPersonClick={onPersonClick} />
      )}
    </>
  );
}
